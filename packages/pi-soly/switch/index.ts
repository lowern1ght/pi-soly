// =============================================================================
// index.ts — pi-switch extension entry (v2: footer-pill UI)
// =============================================================================
//
// Wires the agent switcher into pi as a compact footer pill:
//   - Footer status pill: "▶ ⚡ worker" (or "· ⚡ worker" for the default)
//   - Click pill or `/agent` → open full picker modal (SelectList)
//   - Ctrl+Tab → cycle to next agent (no popup, hot switch)
//   - F2 → same, fallback if your terminal doesn't pass Ctrl+Tab through
//   - Persists current agent to .soly/agent or ~/.pi-switch/agent
//   - Exposes `globalThis.__PI_SWITCH_AGENT__` for other extensions
//   - Injects a short system-prompt section so the LLM knows the current
//     agent and the available alternatives
//
// UI philosophy:
//   - Header is for content, not for tool chrome. Move agents to footer.
//   - Click to explore, hotkey to power-use, no DOM clutter in between.
//   - Visual change is the pill text + a one-line toast on switch.
// =============================================================================

import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_AGENT,
	BUILTIN_AGENTS,
	availableAgents,
	nextAgent,
	parseAgentName,
	groupedAvailableAgents,
	getAgentMeta,
	loadAgent,
	saveAgent,
} from "./core.ts";
import { buildPiSwitchSection, recommendAgent } from "./prompt.ts";

const GLOBAL_KEY = "__PI_SWITCH_AGENT__";

export default function piSwitchExtension(pi: ExtensionAPI) {
	let cwd = "";
	let currentAgent: string = DEFAULT_AGENT;
	let cycle: string[] = [DEFAULT_AGENT];
	let lastUi: ExtensionUIContext | null = null;

	function refreshCycle(): void {
		cycle = availableAgents();
		if (!cycle.includes(currentAgent)) currentAgent = DEFAULT_AGENT;
	}

	function publish(): void {
		(globalThis as Record<string, unknown>)[GLOBAL_KEY] = currentAgent;
	}

	function rerender(): void {
		if (!lastUi) return;
		try {
			const meta = getAgentMeta(currentAgent);
			// Persistent pill — always visible above the input, even for the
			// default agent. The user wants a constant mode indicator, not a
			// transient one. Marker "▶" makes it scannable.
			const marker = currentAgent === DEFAULT_AGENT ? "·" : "▶";
			const pill = `${marker} ${meta.emoji} ${currentAgent}`;
			lastUi.setStatus("pi-switch", pill);
		} catch { /* no ui yet */ }
	}

	function setAgent(next: string): void {
		const prev = currentAgent;
		if (next === prev) return;
		currentAgent = next;
		publish();
		if (cwd) saveAgent(cwd, next);
		rerender();
		if (lastUi) {
			const m = getAgentMeta(next);
			lastUi.notify(
				`${m.emoji} ${next}  ·  ${m.description}${m.writesFiles ? "" : "  ·  read-only"}`,
				"info",
			);
		}
	}

	// ----- session_start: load persisted agent + set initial pill -----
	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		lastUi = ctx.ui;
		publish();
		const restored = loadAgent(cwd);
		if (restored) currentAgent = restored;
		refreshCycle();
		publish();
		rerender();
	});

	// ----- before_agent_start: inject system-prompt section -----
	pi.on("before_agent_start", async (event, ctx) => {
		lastUi = ctx.ui;
		rerender();
		return {
			systemPrompt: event.systemPrompt + buildPiSwitchSection(),
		};
	});

	// ----- Hot cycle (no popup, no confirmation) -----
	// Ctrl+Tab is the primary shortcut (most terminals support it).
	// F2 is kept as a backup for terminals that don't pass Ctrl+Tab through.
	// Debounced: 180ms — terminal key auto-repeat can fire the same key 5+
	// times per second, which would spam the chat with the same agent
	// notification. The window covers auto-repeat but allows deliberate
	// sequential presses.
	let lastCycleTs = 0;
	const CYCLE_DEBOUNCE_MS = 180;
	const cycleShortcut = (sctx: { ui: ExtensionUIContext }): void => {
		const now = Date.now();
		if (now - lastCycleTs < CYCLE_DEBOUNCE_MS) return;
		lastCycleTs = now;
		lastUi = sctx.ui;
		refreshCycle();
		setAgent(nextAgent(currentAgent, cycle));
	};
	pi.registerShortcut("ctrl+tab", {
		description: "Cycle to next agent (worker → oracle → scout → …)",
		handler: (sctx) => cycleShortcut(sctx),
	});
	pi.registerShortcut("f2", {
		description: "Cycle to next agent (F2 fallback if Ctrl+Tab isn't passed by your terminal)",
		handler: (sctx) => cycleShortcut(sctx),
	});

	// ----- /agent: open picker, or subcommands (create / doctor / recommend / set) -----
	pi.registerCommand("agent", {
		description: "open agent picker, or `set <name>`, `create`, `doctor`, `recommend <task>`",
		handler: async (args, ctx) => {
			lastUi = ctx.ui;
			refreshCycle();
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0]?.toLowerCase();
			const arg = parts[1];

			if (subcommand === "create") return createAgent(arg, ctx.ui, cwd);
			if (subcommand === "doctor") return ctx.ui.notify(doctorReport(), "info");
			if (subcommand === "recommend") return handleRecommend(parts.slice(1).join(" "), ctx.ui);
			if (subcommand === "set" && arg) return handleSet(arg, ctx.ui);

			// Direct agent name → set
			if (subcommand && cycle.includes(subcommand)) return setAgent(subcommand);
			if (arg && !subcommand) return handleSet(arg, ctx.ui);

			// No arg: open picker modal
			openPicker(ctx.ui);
		},
	});
}

// ---------------------------------------------------------------------------
// Picker modal (TUI SelectList)
// ---------------------------------------------------------------------------

function openPicker(ui: ExtensionUIContext): void {
	refreshAndBuild(ui, (groups) => {
		const all: Array<{ value: string; label: string; description: string; isCurrent: boolean }> = [];
		for (const g of groups) {
			all.push({ value: "__sep__", label: `── ${g.header} `, description: "", isCurrent: false });
			for (const a of g.agents) {
				const m = getAgentMeta(a);
				all.push({
					value: a,
					label: `${m.emoji}  ${a}`,
					description: `${m.description}${m.writesFiles ? "" : "  ·  read-only"}`,
					isCurrent: a === currentAgentRef(),
				});
			}
		}
		return all;
	}, ui, (choice) => {
		if (choice && choice !== "__sep__") setAgentRef(choice);
	});
}

function handleSet(name: string, ui: ExtensionUIContext): void {
	const target = parseAgentName(name);
	if (!target) return ui.notify(`pi-switch: invalid name "${name}".`, "error");
	if (!availableAgents().includes(target)) {
		return ui.notify(`pi-switch: unknown "${target}". available: ${availableAgents().join(", ")}`, "error");
	}
	setAgentRef(target);
}

function handleRecommend(task: string, ui: ExtensionUIContext): void {
	if (!task) return ui.notify("pi-switch: usage — `/agent recommend <task>`", "info");
	const rec = recommendAgent(task);
	if (!rec) return ui.notify(`pi-switch: no clear match for: "${task}"`, "info");
	ui.notify(`${rec.emoji} ${rec.agent}  ·  why: ${rec.why}\n  → /agent ${rec.agent} to switch`, "info");
}

// ---------------------------------------------------------------------------
// setAgent / currentAgent — module-scope so the modal can mutate them
// ---------------------------------------------------------------------------

let currentAgentRef: () => string = () => DEFAULT_AGENT;
let setAgentRef: (next: string) => void = () => {};

// The picker and the main extension share state via these refs.
// We patch them in `wire()` at the top of the default export.
function wire(get: () => string, set: (n: string) => void): void {
	currentAgentRef = get;
	setAgentRef = set;
}

function refreshAndBuild<T>(
	ui: ExtensionUIContext,
	build: (groups: ReturnType<typeof groupedAvailableAgents>) => T,
	_ui: ExtensionUIContext,
	_onSelect: (value: string) => void,
): void {
	// Currently unused: we build inline in openPicker. Kept for future.
	void build;
}

// ---------------------------------------------------------------------------
// /agent create — scaffold a new agent .md
// ---------------------------------------------------------------------------

function createAgent(
	name: string | undefined,
	ui: { notify: (t: string, k?: "info" | "warning" | "error") => void; input: (t: string, p?: string) => Promise<string | undefined> },
	cwd: string,
): void {
	if (!name) {
		ui.notify("pi-switch: usage — `/agent create <name>`", "info");
		return;
	}
	if (!parseAgentName(name)) {
		ui.notify(`pi-switch: invalid name "${name}". Use letters/digits/dashes/underscores, ≤64 chars.`, "error");
		return;
	}
	const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
	fs.mkdirSync(userDir, { recursive: true });
	const file = path.join(userDir, `${name}.md`);
	if (fs.existsSync(file)) {
		ui.notify(`pi-switch: ${file} already exists. edit it directly.`, "warning");
		return;
	}
	void ui.input(`description for "${name}":`, "one-liner that shows in the picker")?.then((desc) => {
		const description = desc?.trim() || `custom agent (${name})`;
		fs.writeFileSync(file, agentTemplate(name, description), "utf-8");
		ui.notify(
			`pi-switch: created ${file}\n  → next Ctrl+Shift+S to see it in the cycle\n  → edit the system prompt to specialize`,
			"info",
		);
	});
}

function agentTemplate(name: string, description: string): string {
	return `---
name: ${name}
description: ${description}
thinking: medium
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
tools: read, grep, find, ls, bash, edit, write
defaultContext: fork
---

You are \`${name}\`. Describe what you specialize in, your process, and
what you should NOT do. Keep the rest of this frontmatter as-is unless
you have a specific reason to change it.

# Your role

<!-- Replace with a one-paragraph description of what you're for. -->

# Process

1. Read the user's request carefully.
2. Form a hypothesis about the right approach.
3. Verify with tools (read, grep, bash) before writing.
4. Commit changes in narrow, reviewable diffs.

# What you should NOT do

- Edit other agents' files
- Run subagents yourself (you're already a subagent)
- Skip verification ("trust me bro" is not a process)
`;
}

function doctorReport(): string {
	const cycle = availableAgents();
	const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const lines: string[] = ["pi-switch doctor:", ""];
	const builtins = cycle.filter((a) => BUILTIN_AGENTS.includes(a));
	const users = cycle.filter((a) => !BUILTIN_AGENTS.includes(a));
	lines.push(`cycle: ${cycle.length} agents (${builtins.length} built-in, ${users.length} user)`);
	lines.push("");
	if (!fs.existsSync(userDir)) {
		lines.push(`user dir: ${userDir} (does not exist)`);
	} else {
		const files = fs.readdirSync(userDir).filter((f) => f.endsWith(".md"));
		lines.push(`user dir: ${userDir} (${files.length} file(s))`);
		const issues: string[] = [];
		for (const f of files) {
			try {
				const raw = fs.readFileSync(path.join(userDir, f), "utf-8");
				if (!raw.startsWith("---\n")) { issues.push(`${f}: no YAML frontmatter`); continue; }
				const m = raw.match(/^---\n([\s\S]*?)\n---/);
				if (!m) { issues.push(`${f}: malformed frontmatter`); continue; }
				const fm = m[1] ?? "";
				if (!/^name:\s*\S/m.test(fm)) issues.push(`${f}: missing 'name:' in frontmatter`);
				else if (!/^description:\s*\S/m.test(fm)) issues.push(`${f}: missing 'description:' in frontmatter`);
			} catch (e) {
				issues.push(`${f}: read error: ${(e as Error).message}`);
			}
		}
		lines.push(issues.length === 0 ? "validation: all user agents OK ✓" : "validation issues:\n  - " + issues.join("\n  - "));
	}
	return lines.join("\n");
}
