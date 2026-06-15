// =============================================================================
// index.ts — pi-switch extension entry
// =============================================================================
//
// Wires the agent switcher into pi:
//   - Header bar above chat (Claude Code-style, dim, persistent)
//   - Ctrl+Shift+S to cycle (Shift+Tab is taken by pi's thinking-level cycler)
//   - /agent slash command: show current + available, or set explicitly
//   - Persists current agent to .soly/agent (shared with soly) or ~/.pi-switch/agent
//   - Exposes `globalThis.__PI_SWITCH_AGENT__` for other extensions to read
//   - Injects a system-prompt section so the LLM knows when to use which agent
// =============================================================================

import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_AGENT,
	BUILTIN_AGENTS,
	availableAgents,
	nextAgent,
	parseAgentName,
	formatAgentBadge,
	formatAgentSwitchNotify,
	formatHeaderLine,
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
		if (!cycle.includes(currentAgent)) {
			currentAgent = DEFAULT_AGENT;
		}
	}

	function publish(): void {
		(globalThis as Record<string, unknown>)[GLOBAL_KEY] = currentAgent;
	}

	function rerender(): void {
		if (!lastUi) return;
		try {
			setHeaderBar(lastUi, () => formatHeaderLine(currentAgent));
			const badge = formatAgentBadge(currentAgent);
			lastUi.setStatus("pi-switch", badge ?? undefined);
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
			lastUi.notify(formatAgentSwitchNotify(prev, next), "info");
		}
	}

	// ----- session_start: load persisted agent + set initial header -----
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
		// Re-render the header on each turn (in case agent was changed via /agent)
		rerender();
		return {
			systemPrompt: event.systemPrompt + buildPiSwitchSection(),
		};
	});

	// ----- Ctrl+Shift+S: cycle to next agent -----
	pi.registerShortcut("ctrl+shift+s", {
		description: "Cycle pi-switch agent: worker → oracle → user-defined…",
		handler: (sctx) => {
			lastUi = sctx.ui;
			refreshCycle();
			const next = nextAgent(currentAgent, cycle);
			setAgent(next);
		},
	});

	// ----- /agent slash command (also handles subcommands: create, doctor) -----
	pi.registerCommand("agent", {
		description: "show or set the active subagent, or `create <name>` to scaffold, or `doctor` to diagnose",
		handler: async (args, ctx) => {
			lastUi = ctx.ui;
			refreshCycle();
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0]?.toLowerCase();
			const arg = parts[1];

			// Subcommand: create
			if (subcommand === "create") {
				if (!arg) {
					ctx.ui.notify("pi-switch: usage — `/agent create <name>`", "info");
					return;
				}
				createAgent(arg, { ui: ctx.ui, cwd });
				return;
			}

			// Subcommand: doctor
			if (subcommand === "doctor") {
				ctx.ui.notify(doctorReport(), "info");
				return;
			}

			// Subcommand: recommend
			if (subcommand === "recommend") {
				const task = parts.slice(1).join(" ");
				if (!task) {
					ctx.ui.notify("pi-switch: usage — `/agent recommend <task description>`", "info");
					return;
				}
				const rec = recommendAgent(task);
				if (!rec) {
					ctx.ui.notify(`pi-switch: no clear agent match for: "${task}"`, "info");
					return;
				}
				ctx.ui.notify(
					`pi-switch recommendation: ${rec.emoji} ${rec.agent}\n  why: ${rec.why}\n  → /agent ${rec.agent} to switch`,
					"info",
				);
				return;
			}

			// Direct agent name → set (handles `/agent <name>` as a single-arg shortcut).
			// Check FIRST: if parts[0] is a valid agent name, treat as set even
			// if it happens to be a "subcommand-looking" word. This way
			// `/agent researcher` always sets to researcher, never falls
			// through to the listing branch.
			if (subcommand && cycle.includes(subcommand)) {
				setAgent(subcommand);
				return;
			}
			// Optional second arg: also set, for explicit `/agent <name>` syntax.
			if (arg) {
				const target = parseAgentName(arg);
				if (!target) {
					ctx.ui.notify(`pi-switch: invalid name "${arg}".`, "error");
					return;
				}
				if (!cycle.includes(target)) {
					ctx.ui.notify(
						`pi-switch: unknown "${target}". available: ${cycle.join(", ")}`,
						"error",
					);
					return;
				}
				setAgent(target);
				return;
			}

			// No arg: show current + grouped available
			const curMeta = getAgentMeta(currentAgent);
			const groups = groupedAvailableAgents();
			const lines: string[] = [
				`current: ${curMeta.emoji} ${currentAgent}  (${curMeta.description})`,
				"",
				"available:",
				"",
			];
			for (const g of groups) {
				lines.push(`─── ${g.header} ${"─".repeat(Math.max(0, 40 - g.header.length))}`);
				for (const a of g.agents) {
					const meta = getAgentMeta(a);
					const marker = a === currentAgent ? "→" : " ";
					lines.push(`  ${marker} ${meta.emoji} ${a.padEnd(16)}  ${meta.description}`);
				}
				lines.push("");
			}
			lines.push("cycle with Ctrl+Shift+S, or `/agent <name>`");
			lines.push("subcommands: `/agent create <name>`, `/agent doctor`, `/agent recommend <task>`");
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}

// ---------------------------------------------------------------------------
// Header bar (Claude Code-style, persistent above chat)
// ---------------------------------------------------------------------------

function setHeaderBar(ui: ExtensionUIContext, getLine: () => string): void {
	// ui.setHeader takes a factory. The factory is called fresh on each
	// render of the TUI. We return a Text whose content is read on each
	// render, so updating `currentAgent` automatically reflects in the header.
	ui.setHeader((_tui, _theme) => {
		// The Text component reads getLine() at render time.
		// We use a closure over a getter to read the current value.
		const text = new Text(getLine(), 1, 0);
		// Text satisfies Component & { dispose?() } — cast to satisfy TS.
		return text as unknown as Parameters<typeof ui.setHeader>[0] extends ((t: infer T, th: infer Th) => infer R) ? R : never;
	});
}

// ---------------------------------------------------------------------------
// /agent create — scaffold a new agent .md file
// ---------------------------------------------------------------------------

/** Template for a new user agent. User edits the system prompt to specialize. */
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

function createAgent(
	name: string,
	ctx: {
		ui: {
			notify: (t: string, k?: "info" | "warning" | "error") => void;
			input: (t: string, p?: string) => Promise<string | undefined>;
		};
		cwd: string;
	},
): void {
	if (!parseAgentName(name)) {
		ctx.ui.notify(`pi-switch: invalid name "${name}". Use letters/digits/dashes/underscores, ≤64 chars.`, "error");
		return;
	}
	const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
	fs.mkdirSync(userDir, { recursive: true });
	const file = path.join(userDir, `${name}.md`);
	if (fs.existsSync(file)) {
		ctx.ui.notify(`pi-switch: ${file} already exists. edit it directly.`, "warning");
		return;
	}
	// Ask for description
	void ctx.ui.input(`description for "${name}":`, "one-liner that shows in the picker")?.then((desc) => {
		const description = desc?.trim() || `custom agent (${name})`;
		fs.writeFileSync(file, agentTemplate(name, description), "utf-8");
		ctx.ui.notify(
			`pi-switch: created ${file}\n  → next Ctrl+Shift+S to see it in the cycle\n  → edit the system prompt to specialize`,
			"info",
		);
	});
}

function doctorReport(): string {
	const cycle = availableAgents();
	const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const lines: string[] = ["pi-switch doctor:", ""];

	// Cycle stats
	const builtins = cycle.filter((a) => BUILTIN_AGENTS.includes(a));
	const users = cycle.filter((a) => !BUILTIN_AGENTS.includes(a));
	lines.push(`cycle: ${cycle.length} agents (${builtins.length} built-in, ${users.length} user)`);
	lines.push("");

	// User dir check
	if (!fs.existsSync(userDir)) {
		lines.push(`user dir: ${userDir} (does not exist — user agents won't be discovered)`);
	} else {
		const files = fs.readdirSync(userDir).filter((f) => f.endsWith(".md"));
		lines.push(`user dir: ${userDir} (${files.length} file(s))`);

		// Validate each user agent
		const issues: string[] = [];
		for (const f of files) {
			try {
				const raw = fs.readFileSync(path.join(userDir, f), "utf-8");
				if (!raw.startsWith("---\n")) {
					issues.push(`${f}: no YAML frontmatter`);
					continue;
				}
				const m = raw.match(/^---\n([\s\S]*?)\n---/);
				if (!m) { issues.push(`${f}: malformed frontmatter`); continue; }
				const fm = m[1] ?? "";
				if (!/^name:\s*\S/m.test(fm)) issues.push(`${f}: missing 'name:' in frontmatter`);
				else if (!/^description:\s*\S/m.test(fm)) issues.push(`${f}: missing 'description:' in frontmatter`);
			} catch (e) {
				issues.push(`${f}: read error: ${(e as Error).message}`);
			}
		}
		if (issues.length === 0) {
			lines.push("validation: all user agents OK ✓");
		} else {
			lines.push("validation issues:");
			for (const i of issues) lines.push(`  - ${i}`);
		}
	}

	// Persistence check
	const persisted = process.env.PI_SWITCH_HOME || os.homedir();
	const fallbackFile = path.join(persisted, ".pi-switch", "agent");
	lines.push("");
	lines.push(`persistence: ${fs.existsSync(fallbackFile) ? fallbackFile : "no standalone persistence (uses .soly/agent if soly project)"}`);

	return lines.join("\n");
}
