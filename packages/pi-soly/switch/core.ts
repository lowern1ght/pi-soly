// =============================================================================
// core.ts — Generic subrotor switcher for pi
// =============================================================================
//
// Lets the user pick which subagent the LLM uses (for `subagent(...)` calls
// in the pi-subagents system, and for any extension that reads the current
// agent). Generic — works with pi-subagents' built-ins (worker, oracle,
// scout, ...) AND any user-defined agent in `~/.pi/agent/agents/`.
//
// Cycle order (Shift+Tab in pi is taken by thinking-level; we use Ctrl+Tab
// as the primary shortcut, with F2 as fallback for terminals that don't
// pass Ctrl+Tab through).
//
// Communication with other extensions:
// - Writes `globalThis.__PI_SWITCH_ROTOR__` (in-process)
// - Reads/writes `.soly/agent` if it exists (cross-session persistence,
//   shared with soly extension). If no soly project, persists to
//   `~/.pi-switch/agent` instead.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Default agent used when no override is set. */
export const DEFAULT_ROTOR = "worker";

/** Built-in pi-subagents that we always offer in the cycle. */
export const BUILTIN_ROTORS: readonly string[] = [
	"worker",
	"oracle",
	"scout",
	"reviewer",
] as const;

/** Visual metadata for every known agent. Used by the rich status badge,
 *  the header bar, and the multi-line switch notify. */
export interface RotorMeta {
	emoji: string;
	shortLabel: string;
	description: string;
	writesFiles: boolean;
}

export const ROTOR_META: Record<string, RotorMeta> = {
	worker: { emoji: "\u26a1", shortLabel: "worker", description: "generic implementation, all tools", writesFiles: true },
	oracle: { emoji: "\ud83d\udd2e", shortLabel: "oracle", description: "decision-consistency, no file edits", writesFiles: false },
	scout: { emoji: "\ud83d\udd0d", shortLabel: "scout", description: "codebase recon, read-only", writesFiles: false },
	reviewer: { emoji: "\ud83d\udc40", shortLabel: "reviewer", description: "adversarial code review", writesFiles: false },
};

/** Get metadata for an agent. Falls back to a neutral entry for unknown. */
export function getRotorMeta(name: string): RotorMeta {
	return ROTOR_META[name] ?? {
		emoji: "\u2753",
		shortLabel: name.length > 12 ? name.slice(0, 11) + "\u2026" : name,
		description: "user-defined agent",
		writesFiles: true,
	};
}

/** Validate an agent name. */
export function isValidRotorName(name: string): boolean {
	return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/** Discover agent `.md` files in user dir. */
/** All known agent home directories, in priority order (project wins
 *  over user-home; user-home `.agents/` wins over pi-native).
 *  Project-level `.agents/` is a vendor-neutral per-project
 *  convention — same role as `.soly/` or the old `.claude/`.
 *  Agent .md files live DIRECTLY in the dir (not in a subfolder):
 *    .agents/reviewer.md   (NOT .agents/agents/reviewer.md)
 *  Honors $HOME / $USERPROFILE for testability. */
export function rotorHomeDirs(cwd?: string): string[] {
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
	const dirs: string[] = [];
	if (cwd) {
		dirs.push(path.join(cwd, ".agents"));                  // project (vendor-neutral, preferred)
		dirs.push(path.join(cwd, ".pi", "agent", "agents"));   // project (pi native, legacy)
	}
	dirs.push(path.join(home, ".agents"));                       // user (vendor-neutral)
	dirs.push(path.join(home, ".pi", "agent", "agents"));       // user (pi native, legacy)
	return dirs;
}

/** Read all agent names from every home dir. Dedupes, first-occurrence
 *  wins. If cwd is provided, project dirs are scanned first. */
export function discoverUserRotors(cwd?: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const dir of rotorHomeDirs(cwd)) {
		if (!fs.existsSync(dir)) continue;
		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			continue;
		}
		for (const file of entries) {
			if (!file.endsWith(".md")) continue;
			try {
				const raw = fs.readFileSync(path.join(dir, file), "utf-8");
				const m = raw.match(/^---\n([\s\S]*?)\n---/);
				if (!m) continue;
				const fm = m[1] ?? "";
				const nameMatch = fm.match(/^name:\s*(.+)$/m);
				if (nameMatch) {
					const n = (nameMatch[1] ?? "").trim();
					if (isValidRotorName(n) && !seen.has(n)) {
						seen.add(n);
						out.push(n);
					}
				}
			} catch { /* skip unreadable */ }
		}
	}
	return out;
}

/** Build the full cycle of available agents. Built-ins first, then
 *  project-level agents (if cwd given), then user-home agents.
 *  Dedupes while preserving first-occurrence order. */
export function availableAgents(cwd?: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (n: string) => {
		if (!seen.has(n)) {
			seen.add(n);
			out.push(n);
		}
	};
	for (const a of BUILTIN_ROTORS) push(a);
	for (const a of discoverUserRotors(cwd)) push(a);
	return out;
}

/** Cycle order. */
export function nextAgent(current: string, cycle: readonly string[]): string {
	if (cycle.length === 0) return DEFAULT_ROTOR;
	const idx = cycle.indexOf(current);
	if (idx < 0) return cycle[0]!;
	return cycle[(idx + 1) % cycle.length]!;
}

/** Parse a user-supplied agent name. */
export function parseRotorName(raw: string): string | null {
	const n = raw.trim();
	if (!isValidRotorName(n)) return null;
	return n;
}

/** Short badge: `<emoji> <name>`. Null for default (silent). */
export function formatAgentBadge(agent: string): string | null {
	if (agent === DEFAULT_ROTOR) return null;
	const meta = getRotorMeta(agent);
	return `${meta.emoji} ${agent}`;
}

/** Multi-line switch notify. */
export function formatRotorSwitchNotify(prev: string, next: string): string {
	const prevMeta = getRotorMeta(prev);
	const nextMeta = getRotorMeta(next);
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
export function groupedAvailableRotors(cwd?: string): Array<{ header: string; agents: string[] }> {
	const all = availableAgents(cwd);
	const groups: Array<{ header: string; agents: string[] }> = [];
	const builtin = all.filter((a) => BUILTIN_ROTORS.includes(a));
	if (builtin.length > 0) groups.push({ header: "built-in", agents: builtin });
	const user = all.filter((a) => !BUILTIN_ROTORS.includes(a));
	if (user.length > 0) groups.push({ header: "user-defined", agents: user });
	return groups;
}

/** Header line shown above chat. Persistent, dim, single line. */
export function formatHeaderLine(agent: string): string {
	const meta = getRotorMeta(agent);
	const writeTag = meta.writesFiles ? "" : " \u00b7 read-only";
	return `${meta.emoji} ${agent}  \u00b7  ${meta.description}${writeTag}    [Ctrl+Tab to cycle]`;
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
		if (!isValidRotorName(raw)) return null;
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
