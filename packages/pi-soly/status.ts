// =============================================================================
// status.ts — Comprehensive one-screen status report
// =============================================================================
//
// Used by `/soly status` and `/soly-rotor status`. Gathers everything in
// one place: version, current rotor, project state, recent decisions,
// recent notifications, and (if available) token budget.
//
// Output is a multi-line string formatted for the TUI notify.
// =============================================================================

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { SOLY_DIRNAME } from "./core.js";
import { readNotifications } from "./notifications-log.js";

/** Subset of project state we need (avoids pulling in whole SolyState). */
export interface StatusState {
	exists: boolean;
	solyDir: string;
	milestone?: string;
	currentPosition?: string;
	phases: Array<{ number: number; name: string; slug: string; status: string }>;
	features?: string[];
}

export interface StatusOptions {
	/** Show this many recent decisions (from STATE.md). Default 5. */
	recentDecisions?: number;
	/** Show this many recent notifications. Default 5. */
	recentNotifications?: number;
	/** Include the rotor switcher section. Default true. */
	includeRotors?: boolean;
	/** Include token budget (if available). Default true. */
	includeTokenBudget?: boolean;
	/** Current package version (read from package.json at build time, or passed). */
	version?: string;
}

/** Format the comprehensive status report. */
export function formatStatus(
	cwd: string,
	state: StatusState,
	currentRotor: string,
	options: StatusOptions = {},
): string {
	const recentDecisions = options.recentDecisions ?? 5;
	const recentNotifs = options.recentNotifications ?? 5;
	const version = options.version ?? "0.0.0";
	const lines: string[] = [];

	// Header
	lines.push("╭─ soly · v" + version + " ──────────────────────────────────────╮");
	lines.push(`│ rotor: ${currentRotor.padEnd(8)}    soly: idle                   │`);
	lines.push("╰──────────────────────────────────────────────────────────╯");
	lines.push("");

	// Project state
	lines.push("  Project state");
	lines.push("  ─────────────");
	if (!state.exists) {
		lines.push("  no .agents/ or .soly/ found in cwd");
		lines.push("  → run /soly-init to scaffold");
	} else {
		lines.push(`  milestone:  ${state.milestone ?? "—"}`);
		lines.push(`  current:    ${state.currentPosition ?? "ready"}`);
		lines.push(`  phases:     ${state.phases.length}`);
		if (state.features && state.features.length > 0) {
			lines.push(`  features:   ${state.features.length}`);
		}
	}
	lines.push("");

	// Recent decisions (from STATE.md)
	if (state.exists) {
		const decisions = readDecisions(state.solyDir, recentDecisions);
		if (decisions.length > 0) {
			lines.push("  Recent decisions");
			lines.push("  ───────────────");
			for (const d of decisions) {
				lines.push(`  ${d}`);
			}
			lines.push("");
		}
	}

	// Recent notifications
	const notifs = readNotifications(cwd, recentNotifs);
	if (notifs.length > 0) {
		lines.push("  Last notifications");
		lines.push("  ─────────────────");
		for (const n of notifs) {
			const date = n.ts.slice(0, 16).replace("T", " ");
			lines.push(`  [${date}] [${n.kind.padEnd(11)}] ${n.title}`);
		}
		lines.push("");
		lines.push("  → /soly-log [N] for full history");
	} else {
		lines.push("  Last notifications");
		lines.push("  ─────────────────");
		lines.push("  (none recorded)");
	}

	return lines.join("\n");
}

/** Read the Decisions table from STATE.md. Returns formatted lines. */
function readDecisions(solyDir: string, limit: number): string[] {
	const statePath = path.join(solyDir, "STATE.md");
	let raw: string;
	try {
		raw = readFileSync(statePath, "utf-8");
	} catch {
		return [];
	}

	// Find the Decisions section
	const m = raw.match(/## Decisions\s*\n([\s\S]*?)(?=\n## |\n*$)/);
	if (!m || !m[1]) return [];

	const lines = m[1].split("\n").filter((l) => l.startsWith("|") && !l.includes("---"));
	if (lines.length === 0) return [];

	// Skip header row, take last N
	const rows = lines.slice(1);
	const tail = rows.slice(-limit);

	return tail.map((row) => {
		const cells = row.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
		if (cells.length < 2) return row;
		const date = (cells[0] ?? "").slice(0, 10);
		const decision = (cells[1] ?? "").slice(0, 50);
		const why = (cells[2] ?? "").slice(0, 40);
		return `${date}  ${decision.padEnd(50)}  ${why}`;
	});
}
