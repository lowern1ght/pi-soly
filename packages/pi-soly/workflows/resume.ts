// =============================================================================
// workflows/resume.ts — `soly resume [phase]` handler
// =============================================================================
//
// Intercepts "soly resume" (or "soly resume <N>" to scope to a specific phase)
// and transforms it into a kickoff prompt that re-establishes the full
// session context from the last handoff.
//
// Reads:
//   - .agents/HANDOFF.json       (machine-readable state, written by pause/compact)
//   - .agents/.continue-here.md  (human-readable context, written by pause/compact)
//
// If neither file exists, falls back to a "no prior handoff" message that
// tells the LLM to load context from .agents/STATE.md + ROADMAP.md normally.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { SolyCommand } from "./parser.ts";
import type { SolyState } from "../core.js";
import { readIfExists } from "../core.js";

interface HandoffJson {
	schema_version?: string;
	generated_at?: string;
	milestone?: string;
	milestone_name?: string;
	status?: string;
	position?: { phase?: string; plan?: string; status?: string } | null;
	current_phase?: {
		number?: number;
		name?: string;
		slug?: string;
		dir?: string;
		plan_count?: number;
	} | null;
	progress?: {
		total_phases?: number;
		completed_phases?: number;
		total_plans?: number;
		completed_plans?: number;
		percent?: number;
	};
	work_completed?: string[];
	work_remaining?: string[];
	decisions?: string[];
	blockers?: string[];
	human_actions_pending?: string[];
}

export interface ResumeHandlerResult {
	handled: boolean;
	transformedText?: string;
}

function parseHandoff(solyDir: string): HandoffJson | null {
	const handoffPath = path.join(solyDir, "HANDOFF.json");
	const raw = readIfExists(handoffPath);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return parsed as HandoffJson;
	} catch {
		return null;
	}
}

function formatListSection(label: string, items: string[] | undefined): string {
	if (!items || items.length === 0) return `  (none)\n`;
	return `  - ${items.join("\n  - ")}\n`;
}

function formatHandoffSummary(h: HandoffJson): string {
	const lines: string[] = [];

	lines.push("=== From .agents/HANDOFF.json ===");
	if (h.generated_at) lines.push(`  generated_at: ${h.generated_at}`);
	if (h.milestone) lines.push(`  milestone: ${h.milestone}${h.milestone_name ? ` — ${h.milestone_name}` : ""}`);
	if (h.status) lines.push(`  status: ${h.status}`);

	if (h.position) {
		lines.push(`  position: phase=${h.position.phase ?? "?"}, plan=${h.position.plan ?? "?"}, status=${h.position.status ?? "?"}`);
	}
	if (h.current_phase) {
		lines.push(
			`  current_phase: #${h.current_phase.number ?? "?"} ${h.current_phase.name ?? ""} (${h.current_phase.plan_count ?? 0} plans)`,
		);
	}
	if (h.progress) {
		lines.push(
			`  progress: ${h.progress.completed_phases ?? 0}/${h.progress.total_phases ?? 0} phases, ${h.progress.completed_plans ?? 0}/${h.progress.total_plans ?? 0} plans, ${h.progress.percent ?? 0}%`,
		);
	}

	lines.push("");
	lines.push("Work completed (from last session):");
	lines.push(formatListSection("", h.work_completed));
	lines.push("Work remaining:");
	lines.push(formatListSection("", h.work_remaining));
	lines.push("Decisions logged:");
	lines.push(formatListSection("", h.decisions));
	lines.push("Blockers / open questions:");
	lines.push(formatListSection("", h.blockers));
	lines.push("Human actions pending:");
	lines.push(formatListSection("", h.human_actions_pending));

	return lines.join("\n");
}

export function buildResumeTransform(cmd: SolyCommand, state: SolyState): ResumeHandlerResult {
	if (!state.exists) {
		return {
			handled: true,
			transformedText:
				`soly resume: no .agents/ directory in cwd (${state.solyDir || "<cwd>"}) — nothing to resume.\n` +
				`Initialize a soly project first, or run \`soly pause\` later to create handoff files.`,
		};
	}

	const handoff = parseHandoff(state.solyDir);
	const continueMd = readIfExists(path.join(state.solyDir, ".continue-here.md"));

	// Optional phase scope: "soly resume 11" → focus kickoff on phase 11
	const phaseArg = cmd.args[0]?.trim();
	let phaseFilter: number | null = null;
	let phaseFilterInvalid = false;
	if (phaseArg) {
		const m = phaseArg.match(/^(\d+)$/);
		if (m) {
			phaseFilter = parseInt(m[1], 10);
			// Validate that the phase actually exists
			if (state.phases.length > 0 && !state.phases.find((p) => p.number === phaseFilter)) {
				phaseFilterInvalid = true;
			}
		} else {
			phaseFilterInvalid = true;
		}
	}
	if (phaseFilterInvalid) {
		const known = state.phases.map((p) => p.number).join(", ") || "(none)";
		const argStr = cmd.args[0] ?? "";
		return {
			handled: true,
			transformedText:
				`soly resume: invalid or unknown phase "${argStr}".\n` +
				`Usage: soly resume [N]    (e.g. "soly resume 5")\n` +
				`Known phases: ${known}`,
		};
	}

	if (!handoff && !continueMd) {
		// No prior handoff — fall back to loading from .agents/STATE.md directly.
		const fallbackScope = phaseFilter != null
			? `Focus: phase ${phaseFilter}.`
			: "Scope: full project.";
		return {
			handled: true,
			transformedText:
				`soly resume: no handoff files found (looked for .agents/HANDOFF.json and .agents/.continue-here.md).\n` +
				`No prior \`soly pause\` was run — loading context from .agents/STATE.md and .agents/ROADMAP.md directly.\n\n` +
				`${fallbackScope}\n\n` +
				`Read .agents/STATE.md (Current Position, Decisions, Blockers sections) and .agents/ROADMAP.md.\n` +
				`Summarize: where the project is, what's next, what's blocking. Then ask the user what to focus on first.`,
		};
	}

	const handoffBlock = handoff ? formatHandoffSummary(handoff) : "(no HANDOFF.json found)";
	const continueBlock = continueMd
		? `\n=== From .agents/.continue-here.md ===\n${continueMd.trim()}\n`
		: "";

	const focusLine = phaseFilter != null
		? `Focus: phase ${phaseFilter} only.`
		: "Focus: pick up exactly where the last session left off.";

	const instruction = `soly resume — restoring session context from last handoff.

${focusLine}

${handoffBlock}
${continueBlock}

=== Resume protocol ===

1. **Read .agents/docs/ first** — the project's 0-point intent. Pickup is meaningless without knowing what the user is building toward.
2. Read .agents/STATE.md to confirm current position (the handoff may be stale).
3. Read .agents/ROADMAP.md and any CONTEXT.md / RESEARCH.md for the active phase.
4. Compare handoff's "work remaining" with the actual repo state (git status, recent commits, .agents/ files).
5. Produce a one-screen "Where we are" summary:
   - current phase + plan
   - what's actually been done (verified via filesystem / git)
   - what's still pending
   - any new blockers discovered since handoff
6. Surface any stale handoff data — if the handoff says "remaining: X" but the repo shows X is done, say so.
7. Ask the user: "Pick up from <next concrete step> — confirm or change?" before doing any work.

Do NOT start coding. Resume is about restoring shared understanding, not action.
`;

	return { handled: true, transformedText: instruction };
}
