// =============================================================================
// mode/system-prompt.ts — mode-aware system prompt sections
// =============================================================================
//
// In plans mode: project state section is omitted (no STATE.md/ROADMAP.md
// to inject). Plan workflow hint is present. Branch-prompt options are
// the same.
//
// In phases mode: project state section is present (current behaviour).
// Phase workflow hint is present. Branch-prompt options are the same.
//
// Always-on rules section, knowledge-base section, and rulecheck (in v3.1.0)
// are mode-agnostic — they describe how to behave, not which workflow.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { type SolyMode } from "../config-mode.ts";
import { buildProjectStateSection, loadProjectState } from "../core.ts";

export interface SystemPromptSections {
	/** "## project state" — only in phases mode. */
	projectState: string | null;
	/** "## plan workflow" hint — only in plans mode. */
	planWorkflow: string | null;
	/** "## phase workflow" hint — only in phases mode. */
	phaseWorkflow: string | null;
	/** "## branch naming" — both modes (LLM asks the user either way). */
	branchNaming: string;
	/** "## first run" — only when picker was just shown. */
	firstRun: string | null;
}

/** Render the "## plan workflow" hint shown in plans mode. Mirrors the
 *  phase workflow hint already in nudge.ts so the LLM has parallel context. */
const PLAN_WORKFLOW_HINT = `**Route project work through the soly plan workflow.** Each plan is a git branch with \`.pi/plans/<slug>/PLAN.md\` on it (gitignored, local-first). Two parallel plans don't collide.

**Branch naming — LLM asks the user.** When scaffolding a new plan, call \`ask_pro\` with branch-prefix options (feat/, fix/, chore/, no prefix, free text). Wait for the choice before creating the branch.

**Read the user's intent and act on it — don't make them memorize verbs.** When the user expresses a workflow intent in plain language — even loosely ("давай план", "let's plan this", "go", "start", "wrap it up") — use the \`/soly\` picker or the \`soly_workflow\` tool. You propose the next step, they say what they want, you run it. Everything runs INLINE in this session — no external worker or subagent.

**You may scaffold a new plan yourself** when the user asks for a new piece of work and the scope is clear (or the user just confirmed). Ask the user for the branch prefix via \`ask_pro\` first, then \`/soly new <slug>\`.

Lifecycle — call \`/soly <verb>\` (or the \`soly_workflow\` tool with the matching action):
   - \`new\`      — scaffold: branch + \`.pi/plans/<slug>/PLAN.md\` + commit
   - \`discuss\`  — interactive discussion of the plan (uses \`ask_pro\`)
   - \`plan\`     — flesh out PLAN.md via \`ask_pro\`
   - \`execute\`  — execute the plan inline in THIS session
   - \`done\`     — commit + push (only if user wants to share; otherwise stays local)
   - \`soly verify\`  — self-review loop until clean
   - \`soly status\`  — current plan state (no LLM round-trip)

**STUDY THE REPO before scaffolding or fleshing out a plan.** Use \`soly_snippet(path, offset, limit)\` and \`soly_doc_search(query)\` for bounded reads. Don't \`read\` the whole tree.

**No shared state files.** \`.pi/plans/<slug>/PLAN.md\` is yours alone — it does NOT appear in \`STATE.md\` or \`ROADMAP.md\` (those are phases-mode concerns).`;

/** Render the branch-naming hint, the same for both modes. */
const BRANCH_NAMING_HINT = `**Branch naming.** When scaffolding a new plan or phase, call \`ask_pro\` with branch-prefix options:

  ❯ feat/&lt;slug&gt;     — feature work (recommended default)
    fix/&lt;slug&gt;      — bug fixes
    chore/&lt;slug&gt;    — chores (renames, dep bumps, format-only)
    &lt;slug&gt;       — no prefix (project default if any)
    Other…       — free text

Wait for the user's choice before creating the branch. The prefix applies to the new plan/phase only — existing branches are not renamed.`;

/** Build all mode-aware system-prompt sections. Returns nulls for sections
 *  that don't apply to the current mode. */
export function buildModeAwareSections(
	cwd: string,
	mode: SolyMode,
	opts: { firstRun?: { mode: SolyMode; filePath: string } | null } = {},
): SystemPromptSections {
	let projectState: string | null = null;
	let phaseWorkflow: string | null = null;
	let planWorkflow: string | null = null;

	if (mode === "phases") {
		// Existing behaviour: load STATE.md/ROADMAP.md and inject.
		try {
			const state = loadProjectState(cwd);
			if (state.exists) {
				const section = buildProjectStateSection(state);
				if (section.hasContent) projectState = section.section;
			}
		} catch {
			// best effort — skip on error
		}
		phaseWorkflow = "phase-mode-workflow-hint"; // injected by nudge.ts already
	} else {
		// Plans mode: inject the plan workflow hint (replaces phase hint).
		planWorkflow = PLAN_WORKFLOW_HINT;
	}

	let firstRun: string | null = null;
	if (opts.firstRun) {
		firstRun = `## first run — mode selected

You just chose mode: **${opts.firstRun.mode}** (saved to \`${opts.firstRun.filePath}\`). This applies to this repo going forward. To change later, edit that file.`;
	}

	return {
		projectState,
		planWorkflow,
		phaseWorkflow,
		branchNaming: BRANCH_NAMING_HINT,
		firstRun,
	};
}
