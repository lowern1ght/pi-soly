// =============================================================================
// workflows/quick.ts — Direct-response workflow handlers
// =============================================================================
//
// These verbs (status, log, diff) return immediate results without an LLM
// round-trip. The extension reads disk / runs git, formats a notification,
// and the LLM never sees the request.
//
// Why: these are common, low-judgment operations where the LLM would just
// regurgitate what the extension can compute more accurately and faster.
// =============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { readIfExists, buildProgressBar, type SolyState } from "../core.js";
import type { SolyConfig } from "../config.js";
import type { SolyCommand } from "./parser.ts";

const execFileAsync = promisify(execFile);

/** Minimum UI surface needed for the quick handlers. */
interface QuickUI {
	notify: (text: string, kind?: "info" | "warning" | "error") => void;
}

// =============================================================================
// soly status
// =============================================================================

export function showStatus(
	_cmd: SolyCommand,
	state: SolyState,
	ui: QuickUI,
	config?: SolyConfig,
): void {
	if (!state.exists) {
		ui.notify("soly: no .agents/ directory in cwd", "error");
		return;
	}
	const maxPhases = config?.display.maxPhasesInStatus ?? 20;

	const lines: string[] = [];
	lines.push("=== soly status ===");
	lines.push("");
	lines.push(
		`milestone: ${state.milestone}${state.milestoneName ? ` — ${state.milestoneName}` : ""}`,
	);
	lines.push(`status:    ${state.status}`);
	if (state.lastUpdated) lines.push(`updated:   ${state.lastUpdated}`);
	lines.push("");

	if (state.position) {
		lines.push(`position:`);
		lines.push(`  phase:  ${state.position.phase}`);
		lines.push(`  plan:   ${state.position.plan}`);
		lines.push(`  status: ${state.position.status}`);
	} else {
		lines.push("position: (none — run `soly plan <N>` to start a phase)");
	}
	lines.push("");

	lines.push(
		`progress:  ${buildProgressBar(state.progress.percent, 30)} ${state.progress.percent}%`,
	);
	lines.push(`           ${state.progress.completedPhases}/${state.progress.totalPhases} phases, ${state.progress.completedPlans}/${state.progress.totalPlans} plans`);
	lines.push("");

	if (state.phases.length > 0) {
		lines.push("phases:");
		const current = state.currentPhase?.number;
		for (const p of state.phases.slice(0, maxPhases)) {
			const marker = current === p.number ? "→" : " ";
			const cr = (p.contextExists ? "C" : "·") + (p.researchExists ? "R" : "·");
			lines.push(
				`  ${marker} ${String(p.number).padStart(2, "0")}. ${p.name.padEnd(28)} [${cr}] plans=${p.planCount}`,
			);
		}
		if (state.phases.length > maxPhases) {
			lines.push(`  ... and ${state.phases.length - maxPhases} more (use config.display.maxPhasesInStatus to show more)`);
		}
	}

	// NEW (A7): recent activity — last 3 iteration files
	const iterDir = path.join(state.solyDir, "iterations");
	if (fs.existsSync(iterDir)) {
		const files = fs.readdirSync(iterDir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => ({ f, stat: fs.statSync(path.join(iterDir, f)) }))
			.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
			.slice(0, 3);
		if (files.length > 0) {
			lines.push("");
			lines.push("recent iterations:");
			for (const { f, stat } of files) {
				const ago = humanizeAge(Date.now() - stat.mtimeMs);
				lines.push(`  ${f}  (${ago})`);
			}
		}
	}

	ui.notify(lines.join("\n"), "info");
}

// =============================================================================
// soly log
// =============================================================================

function humanizeAge(ms: number): string {
	if (ms < 60_000) return "just now";
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
	if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`;
	return `${Math.round(ms / (30 * 86_400_000))}mo ago`;
}

const DECISIONS_HEADER = /^##\s*Decisions\s*$/;
const DECISIONS_TABLE_HEADER = /^\|\s*Decision\s*\|/;
const DECISIONS_TABLE_SEPARATOR = /^\|[\s\-:|]+\|$/;
const DECISIONS_TABLE_ROW = /^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*$/;

export function showLog(cmd: SolyCommand, state: SolyState, ui: QuickUI): void {
	if (!state.exists) {
		ui.notify("soly log: no .agents/ directory in cwd", "error");
		return;
	}

	const statePath = path.join(state.solyDir, "STATE.md");
	const raw = readIfExists(statePath);
	if (!raw) {
		ui.notify("soly log: STATE.md not found", "error");
		return;
	}

	const lines = raw.split(/\r?\n/);
	const decisionsIdx = lines.findIndex((l) => DECISIONS_HEADER.test(l));
	if (decisionsIdx === -1) {
		ui.notify("soly log: no Decisions table in STATE.md", "info");
		return;
	}

	// Collect rows from the table
	const rows: Array<{ decision: string; rationale: string; phase: string }> = [];
	for (let i = decisionsIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.startsWith("|")) break; // table ended
		if (DECISIONS_TABLE_HEADER.test(line) || DECISIONS_TABLE_SEPARATOR.test(line)) continue;
		const m = line.match(DECISIONS_TABLE_ROW);
		if (m) rows.push({ decision: m[1].trim(), rationale: m[2].trim(), phase: m[3].trim() });
	}

	if (rows.length === 0) {
		ui.notify("soly log: Decisions table is empty", "info");
		return;
	}

	// Optional limit: `soly log 5` — last 5 decisions
	const limitArg = cmd.args[0]?.trim();
	if (limitArg) {
		const parsed = parseInt(limitArg, 10);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			ui.notify(
				`soly log: invalid limit "${limitArg}" (must be a positive integer)`,
				"error",
			);
			return;
		}
	}
	const limit = limitArg ? parseInt(limitArg, 10) : 20;
	const tail = Number.isFinite(limit) && limit > 0 ? rows.slice(-limit) : rows.slice(-20);

	const out: string[] = [];
	out.push(`=== last ${tail.length} of ${rows.length} decisions ===`);
	out.push("");
	for (const r of tail) {
		out.push(`  [${r.phase}] ${r.decision}`);
		out.push(`           ${r.rationale}`);
		out.push("");
	}
	ui.notify(out.join("\n"), "info");
}

// =============================================================================
// soly diff
// =============================================================================

interface DiffResult {
	stdout: string;
	stderr: string;
	code: number;
}

async function safeExec(file: string, args: string[], cwd: string): Promise<DiffResult> {
	try {
		const { stdout, stderr } = await execFileAsync(file, args, {
			cwd,
			maxBuffer: 4 * 1024 * 1024,
			encoding: "utf-8",
		});
		return { stdout, stderr, code: 0 };
	} catch (e) {
		const err = e as { stdout?: string; stderr?: string; code?: number };
		return {
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
			code: typeof err.code === "number" ? err.code : 1,
		};
	}
}

export async function showDiff(
	_cmd: SolyCommand,
	state: SolyState,
	ui: QuickUI,
): Promise<void> {
	// Graceful without .agents/: use cwd as project root, skip the .agents/ filter
	const projectRoot = state.solyDir ? path.dirname(state.solyDir) : process.cwd();
	const solyDir = state.solyDir; // may be empty when run outside a soly project

	// 1. git status (short)
	const status = await safeExec("git", ["status", "--short", "--branch"], projectRoot);
	// 2. git diff (tracked changes, no untracked)
	const diff = await safeExec("git", ["diff", "--stat"], projectRoot);
	// 3. uncommitted .agents/ file changes (since last commit)
	const solyChanges = await safeExec(
		"git",
		["status", "--short", "--", solyDir],
		projectRoot,
	);

	const out: string[] = [];
	out.push(state.exists ? "=== soly diff ===" : "=== git diff (no .agents/ in cwd) ===");
	out.push("");

	if (status.code !== 0) {
		out.push("(git not available or not a git repo)");
	} else {
		out.push("git status --short --branch:");
		out.push(status.stdout.trim() || "  (clean working tree)");
		out.push("");
		if (diff.stdout.trim()) {
			out.push("git diff --stat:");
			out.push(diff.stdout.trim());
			out.push("");
		}
		if (solyDir) {
			if (solyChanges.stdout.trim()) {
				out.push("uncommitted .agents/ changes:");
				out.push(solyChanges.stdout.trim());
			} else {
				out.push("uncommitted .agents/ changes: (none)");
			}
		}
	}

	ui.notify(out.join("\n"), "info");
}
