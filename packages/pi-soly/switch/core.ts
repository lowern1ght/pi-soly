// =============================================================================
// core.ts — Generic subagent switcher for pi
// =============================================================================
//
// Lets the user pick which subagent the LLM uses (for `subagent(...)` calls
// in the pi-subagents system, and for any extension that reads the current
// agent). Generic — works with pi-subagents' built-ins (worker, oracle,
// scout, ...) AND any user-defined agent in `~/.pi/agent/agents/`.
//
// Cycle order (Shift+Tab in pi is taken by thinking-level, so we use
// Ctrl+Shift+S — mnemonic for "S"witch).
//
// Communication with other extensions:
// - Writes `globalThis.__PI_SWITCH_AGENT__` (in-process)
// - Reads/writes `.soly/agent` if it exists (cross-session persistence,
//   shared with soly extension). If no soly project, persists to
//   `~/.pi-switch/agent` instead.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Default agent used when no override is set. */
export const DEFAULT_AGENT = "worker";

/** Built-in pi-subagents that we always offer in the cycle. */
export const BUILTIN_AGENTS: readonly string[] = [
	"worker",
	"oracle",
	"scout",
	"researcher",
	"planner",
	"context-builder",
	"reviewer",
	"delegate",
] as const;

/** Visual metadata for every known agent. Used by the rich status badge,
 *  the header bar, and the multi-line switch notify. */
export interface AgentMeta {
	emoji: string;
	shortLabel: string;
	description: string;
	writesFiles: boolean;
}

export const AGENT_META: Record<string, AgentMeta> = {
	worker: { emoji: "\u26a1", shortLabel: "worker", description: "generic implementation, all tools", writesFiles: true },
	oracle: { emoji: "\ud83d\udd2e", shortLabel: "oracle", description: "decision-consistency, no file edits", writesFiles: false },
	scout: { emoji: "\ud83d\udd0d", shortLabel: "scout", description: "codebase recon, read-only", writesFiles: false },
	researcher: { emoji: "\ud83d\udcda", shortLabel: "researcher", description: "external docs / libraries", writesFiles: false },
	planner: { emoji: "\ud83d\udccb", shortLabel: "planner", description: "planning + ordering, no code", writesFiles: false },
	"context-builder": { emoji: "\ud83c\udfd7", shortLabel: "ctx-builder", description: "context handoff for other agents", writesFiles: true },
	reviewer: { emoji: "\ud83d\udc40", shortLabel: "reviewer", description: "adversarial code review", writesFiles: false },
	delegate: { emoji: "\ud83e\udd1d", shortLabel: "delegate", description: "pure orchestration, dispatches others", writesFiles: false },
};

/** Get metadata for an agent. Falls back to a neutral entry for unknown. */
export function getAgentMeta(name: string): AgentMeta {
	return AGENT_META[name] ?? {
		emoji: "\u2753",
		shortLabel: name.length > 12 ? name.slice(0, 11) + "\u2026" : name,
		description: "user-defined agent",
		writesFiles: true,
	};
}

/** Validate an agent name. */
export function isValidAgentName(name: string): boolean {
	return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/** Discover agent `.md` files in user dir. */
export function discoverUserAgents(userDir: string = path.join(os.homedir(), ".pi", "agent", "agents")): string[] {
	if (!fs.existsSync(userDir)) return [];
	const names: string[] = [];
	for (const file of fs.readdirSync(userDir)) {
		if (!file.endsWith(".md")) continue;
		try {
			const raw = fs.readFileSync(path.join(userDir, file), "utf-8");
			const m = raw.match(/^---\n([\s\S]*?)\n---/);
			if (!m) continue;
			const fm = m[1] ?? "";
			const nameMatch = fm.match(/^name:\s*(.+)$/m);
			if (nameMatch) {
				const n = (nameMatch[1] ?? "").trim();
				if (isValidAgentName(n)) names.push(n);
			}
		} catch { /* skip */ }
	}
	return names;
}

/** Build the full cycle of available agents. Built-ins first, then
 *  user-discovered. Dedupes while preserving first-occurrence order. */
export function availableAgents(userDir?: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (n: string) => {
		if (!seen.has(n)) {
			seen.add(n);
			out.push(n);
		}
	};
	for (const a of BUILTIN_AGENTS) push(a);
	for (const a of discoverUserAgents(userDir)) push(a);
	return out;
}

/** Cycle order. */
export function nextAgent(current: string, cycle: readonly string[]): string {
	if (cycle.length === 0) return DEFAULT_AGENT;
	const idx = cycle.indexOf(current);
	if (idx < 0) return cycle[0]!;
	return cycle[(idx + 1) % cycle.length]!;
}

/** Parse a user-supplied agent name. */
export function parseAgentName(raw: string): string | null {
	const n = raw.trim();
	if (!isValidAgentName(n)) return null;
	return n;
}

/** Short badge: `<emoji> <name>`. Null for default (silent). */
export function formatAgentBadge(agent: string): string | null {
	if (agent === DEFAULT_AGENT) return null;
	const meta = getAgentMeta(agent);
	return `${meta.emoji} ${agent}`;
}

/** Multi-line switch notify. */
export function formatAgentSwitchNotify(prev: string, next: string): string {
	const prevMeta = getAgentMeta(prev);
	const nextMeta = getAgentMeta(next);
	const lines: string[] = [
		"pi-switch agent changed",
		"",
		`  ${prevMeta.emoji} ${prev.padEnd(16)} →  ${nextMeta.emoji} ${next}`,
		`  ${"".padEnd(16)}     ${nextMeta.description}`,
		"",
		`  writes files: ${nextMeta.writesFiles ? "yes" : "no (read-only)"}  ·  next subagent call uses: ${next}`,
	];
	return lines.join("\n");
}

/** Group agents: built-ins + user-defined. */
export function groupedAvailableAgents(userDir?: string): Array<{ header: string; agents: string[] }> {
	const all = availableAgents(userDir);
	const groups: Array<{ header: string; agents: string[] }> = [];
	const builtin = all.filter((a) => BUILTIN_AGENTS.includes(a));
	if (builtin.length > 0) groups.push({ header: "built-in", agents: builtin });
	const user = all.filter((a) => !BUILTIN_AGENTS.includes(a));
	if (user.length > 0) groups.push({ header: "user-defined", agents: user });
	return groups;
}

/** Header line shown above chat. Persistent, dim, single line. */
export function formatHeaderLine(agent: string): string {
	const meta = getAgentMeta(agent);
	const writeTag = meta.writesFiles ? "" : " \u00b7 read-only";
	return `${meta.emoji} ${agent}  \u00b7  ${meta.description}${writeTag}    [Ctrl+Shift+S to cycle]`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Where to persist the current agent. Prefers `.soly/agent` if a soly
 *  project exists (shared with soly extension). Otherwise `~/.pi-switch/agent`. */
export function agentFilePath(cwd: string): string {
	const solyAgent = path.join(cwd, ".soly", "agent");
	if (fs.existsSync(path.join(cwd, ".soly"))) return solyAgent;
	// Respect HOME/USERPROFILE for testability (otherwise os.homedir() ignores them on Windows)
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
	const fallbackDir = path.join(home, ".pi-switch");
	fs.mkdirSync(fallbackDir, { recursive: true });
	return path.join(fallbackDir, "agent");
}

/** Read persisted agent from disk. Returns null if missing/invalid. */
export function loadAgent(cwd: string): string | null {
	try {
		const file = agentFilePath(cwd);
		if (!fs.existsSync(file)) return null;
		const raw = fs.readFileSync(file, "utf-8").trim();
		if (!isValidAgentName(raw)) return null;
		return raw;
	} catch {
		return null;
	}
}

/** Write current agent to disk. */
export function saveAgent(cwd: string, agent: string): void {
	try {
		const file = agentFilePath(cwd);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, agent + "\n", "utf-8");
	} catch { /* best-effort */ }
}
