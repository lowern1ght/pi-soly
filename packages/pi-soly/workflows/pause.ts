// =============================================================================
// workflows/pause.ts — `soly pause` / `soly compact` handler
// =============================================================================
//
// Intercepts "soly pause" (just write handoff) and "soly compact" (write
// handoff AND trigger session compaction).
//
// Like execute, we transform the input into a detailed LLM instruction that
// walks the LLM through the soly pause-work workflow. The LLM produces both:
//   - .agents/HANDOFF.json  (machine-readable state for resume)
//   - .agents/.continue-here.md  (human-readable context)
//
// For `compact`, we additionally call ctx.compact() AFTER the handoff files
// are written — but we still let the LLM drive the handoff generation, since
// the work-done/work-remaining/decisions/blockers content requires reading
// the current session context.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SolyCommand } from "./parser.ts";
import type { SolyState } from "../core.js";

/** Resolve <extension>/workflows-data/<name>.md regardless of cwd. */
function loadWorkflowMarkdown(name: string): string | null {
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const candidate = path.resolve(here, "..", "workflows-data", name);
		if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf-8");
	} catch {
		// fall through
	}
	return null;
}

export interface PauseHandlerResult {
	handled: boolean;
	transformedText?: string;
	/** Whether the extension should also call ctx.compact() after the handoff. */
	triggerCompact: boolean;
}

/** Build HANDOFF.json scaffold from current state — the LLM fills in details. */
function handoffScaffold(state: SolyState): string {
	const projectRoot = path.dirname(state.solyDir);
	const position = state.position;
	const phase = state.currentPhase;

	return JSON.stringify(
		{
			schema_version: "1.0",
			generated_by: "soly extension",
			generated_at: new Date().toISOString(),
			project_root: projectRoot,
			soly_dir: state.solyDir,
			milestone: state.milestone,
			milestone_name: state.milestoneName,
			status: state.status,
			position: position
				? {
						phase: position.phase,
						plan: position.plan,
						status: position.status,
					}
				: null,
			current_phase: phase
				? {
						number: phase.number,
						name: phase.name,
						slug: phase.slug,
						dir: phase.dir,
						plan_count: phase.planCount,
					}
				: null,
			progress: state.progress,
			work_completed: [], // LLM fills in
			work_remaining: [], // LLM fills in
			decisions: [], // LLM fills in (or read from STATE.md Decisions table)
			blockers: [], // LLM fills in
			human_actions_pending: [], // LLM fills in
			resume_command: "soly resume", // not yet implemented; documented
		},
		null,
		2,
	);
}

export function buildPauseTransform(
	cmd: SolyCommand,
	state: SolyState,
): PauseHandlerResult {
	if (!state.exists) {
		return {
			handled: true,
			transformedText:
				`soly: no .agents/ directory found in cwd (${state.solyDir || "<cwd>"}) — nothing to pause.\n` +
				`If you wanted to start a soly project, see the soly quickstart.`,
			triggerCompact: false,
		};
	}

	const isCompact = cmd.verb === "compact";
	const workflow = loadWorkflowMarkdown("pause-work.md");
	if (!workflow) {
		return {
			handled: true,
			transformedText:
				`soly: pause-work workflow markdown not found: workflows-data/pause-work.md\n` +
				`This is an extension installation issue — reinstall soly.`,
			triggerCompact: false,
		};
	}

	const scaffold = handoffScaffold(state);

	const actionLine = isCompact
		? `Action: PAUSE + COMPACT the session after handoff files are written.`
		: `Action: PAUSE only. Do not call ctx.compact() — the user wants to keep the session as-is.`;

	const instruction = `soly ${cmd.verb} — preparing handoff for resume.

${actionLine}

Current position (from .agents/STATE.md):
${state.position
	? `  phase: ${state.position.phase}\n  plan:  ${state.position.plan}\n  status: ${state.position.status}`
	: "  (no position set — likely pre-planning or paused at a milestone boundary)"}

Use this HANDOFF.json scaffold as your starting point (you'll fill in the work_*, decisions, blockers, human_actions_pending arrays from the current session context):

\`\`\`json
${scaffold}
\`\`\`

Follow the workflow below VERBATIM — these are the user-approved soly instructions, not suggestions.

=== WORKFLOW: pause-work.md ===
${workflow}
=== END WORKFLOW ===

After you write both .agents/HANDOFF.json and .agents/.continue-here.md, tell the user:
  - where the files were written (absolute paths)
  - the resume command: soly resume
  - ${isCompact ? "session will be compacted at end of this turn" : "session state preserved as-is"}

${isCompact ? `IMPORTANT: the extension will call ctx.compact() for you at the end of this turn. Do NOT call it yourself — your job is just to produce the handoff files. The compaction will happen automatically once this turn completes.` : ""}`;

	return { handled: true, transformedText: instruction, triggerCompact: isCompact };
}
