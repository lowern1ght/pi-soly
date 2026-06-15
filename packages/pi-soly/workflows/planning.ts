// =============================================================================
// workflows/planning.ts — `soly plan <target>` / `soly discuss <N>` handlers
// =============================================================================
//
// `soly plan <target>`   — produce a PLAN.md for a phase or task.
//                          Dual-mode: phases and tasks live side by side.
// `soly discuss <N>`     — discuss scope, requirements, and tradeoffs for a
//                          phase before any planning starts (phase-only in v0.2)
//
// Both transform into LLM instructions that load the relevant workflow
// markdown (plan-phase.md / plan-task.md / discuss-phase.md) and delegate
// to a subagent.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describePlanTarget, type SolyCommand } from "./parser.js";
import type { SolyState } from "../core.js";
import {
	extractPlanSummary,
	renderPlanSummaryInline,
	writeIterationContext,
} from "../iteration.js";

/** Build the inline plan summary block for the worker task (so it has the
 *  must_haves / wave / requirements even before reading the iteration file). */
function inlinePlanSummary(planFilePath: string): string {
	const raw = fs.readFileSync(planFilePath, "utf-8");
	const summary = extractPlanSummary(raw);
	if (!summary) return "_(PLAN.md missing frontmatter or unparseable)_";
	return renderPlanSummaryInline(summary);
}

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

export interface PlanningHandlerResult {
	handled: boolean;
	transformedText?: string;
}

function getPhaseForDiscuss(
	state: SolyState,
	args: string[],
): { phase: number; raw: string } | null {
	const raw = (args[0] ?? "").trim();
	if (!raw) return null;
	const m = raw.match(/^(\d+)$/);
	if (!m) return null;
	const n = parseInt(m[1], 10);
	if (!state.phases.find((p) => p.number === n)) return null;
	return { phase: n, raw };
}

export function buildPlanTransform(cmd: SolyCommand, state: SolyState): PlanningHandlerResult {
	if (!state.exists) {
		return {
			handled: true,
			transformedText:
				`soly plan: no .soly/ directory in cwd (${state.solyDir || "<cwd>"}) — cannot plan.\n` +
				`Initialize a soly project first.`,
		};
	}

	const projectRoot = path.dirname(state.solyDir);
	const target = describePlanTarget(cmd.args);
	if (!target) {
		const knownPhases = state.phases.map((p) => p.number).join(", ") || "(none)";
		const knownTasks = state.tasks.map((t) => t.id).join(", ") || "(none)";
		return {
			handled: true,
			transformedText:
				`soly plan: missing or malformed target.\n` +
				`Usage:\n` +
				`  soly plan <N>                              — plan phase N\n` +
				`  soly plan <task-id>                        — plan existing task\n` +
				`  soly plan --new-task <slug> --feature <n>  — create new task dir + PLAN.md\n` +
				`  soly plan --feature <n>                    — plan all ready tasks in a feature\n` +
				`Known phases: ${knownPhases}\n` +
				`Known tasks:  ${knownTasks}`,
		};
	}

	// === PHASE MODE ===
	if (target.kind === "phase") {
		const phase = state.phases.find((p) => p.number === target.phase);
		if (!phase) {
			return {
				handled: true,
				transformedText:
					`soly plan: phase ${target.phase} not found.\n` +
					`Known phases: ${state.phases.map((p) => p.number).join(", ") || "(none)"}`,
			};
		}
		const workflow = loadWorkflowMarkdown("plan-phase.md");
		if (!workflow) {
			return {
				handled: true,
				transformedText:
					`soly plan: workflow markdown not found: workflows-data/plan-phase.md\n` +
					`This is an extension installation issue — reinstall soly.`,
			};
		}
		// Write per-iteration context bundle (B2).
		const iter = writeIterationContext({
			solyDir: state.solyDir,
			projectRoot,
			kind: "plan",
			phaseNumber: target.phase,
		});
		const instruction = `soly plan ${target.raw} — planning phase ${target.phase} (${phase.name}).

**Iteration context file written:** \`${iter.relPath}\` (${iter.tokens} tokens, ${iter.bytes} bytes)
The planner reads this file first — it contains intent, STATE, ROADMAP row for this phase, phase CONTEXT, phase RESEARCH, and prior SUMMARYs.

**0-POINT CHECK — read .soly/docs/ first.**
These documents hold the project's INTENT — business context, design vision, what the user wants this app to be. Plans that ignore intent produce code that "works" but doesn't fit. If the plan would diverge from anything in .soly/docs/, surface that as a discussion point before committing to it.

Phase directory: ${phase.dir}
Current state:   planCount=${phase.planCount}, context=${phase.contextExists}, research=${phase.researchExists}

Launch a subagent to produce the plan. Do NOT plan inline.

subagent({
  agent: "worker",
  context: "fresh",
  async: true,
  task: \`You are a planner. Produce PLAN.md (and ${phase.contextExists ? "" : "optionally CONTEXT.md / "}RESEARCH.md if missing) for phase ${target.phase}.

**FIRST ACTION — read the iteration context file:**
\`\`\`
${iter.relPath}
\`\`\`
It contains intent, STATE, ROADMAP row, phase CONTEXT, phase RESEARCH, and prior SUMMARYs.

Project root: ${projectRoot}
Soly dir:    ${state.solyDir}
Phase dir:   ${phase.dir}

Follow the workflow below VERBATIM.

=== WORKFLOW: plan-phase.md ===
${workflow}
=== END WORKFLOW ===

Hard rules:
  - Do not write production code. Planning only.
  - Wave numbers must be pre-computed; dependency graph must be acyclic.
  - Each plan needs requirements, must_haves.truths, must_haves.artifacts, must_haves.key_links.
  - PATH DISCIPLINE: all PLAN.md / CONTEXT.md / RESEARCH.md files go under \`.soly/phases/<NN>-<slug>/\`. Never write plan files to the project root.
  - Update .soly/STATE.md Current Position at the end.
  - Return: created files, plan count, wave breakdown, open questions.
\`
})

When the subagent returns, summarize the plan structure and ask the user to confirm before any execution.`;
		return { handled: true, transformedText: instruction };
	}

	// === TASK MODE (existing task — flesh out PLAN.md) ===
	if (target.kind === "task") {
		const task = state.tasks.find((t) => t.id === target.taskId);
		if (!task) {
			return {
				handled: true,
				transformedText:
					`soly plan: task ${target.taskId} not found.\n` +
					`Known tasks: ${state.tasks.map((t) => t.id).join(", ") || "(none)"}\n` +
					`Tip: use the \`soly_list_tasks\` tool.`,
			};
		}
		if (!task.planExists) {
			return {
				handled: true,
				transformedText:
					`soly plan: task ${target.taskId} has no PLAN.md at ${task.dir}/PLAN.md.\n` +
					`Use \`soly plan --new-task <slug> --feature ${task.feature}\` to create a different task, or write PLAN.md manually.`,
			};
		}
		if (task.status === "done") {
			return {
				handled: true,
				transformedText:
					`soly plan: task ${target.taskId} is already \`status: done\` (SUMMARY.md exists).\n` +
					`To re-plan, change status to \`ready\` in PLAN.md frontmatter first.`,
			};
		}
		const workflow = loadWorkflowMarkdown("plan-task.md");
		if (!workflow) {
			return {
				handled: true,
				transformedText:
					`soly plan: workflow markdown not found: workflows-data/plan-task.md\n` +
					`This is an extension installation issue — reinstall soly.`,
			};
		}
		const featureDir = path.dirname(path.dirname(task.dir));
		// Write per-iteration context bundle (B2).
		const iter = writeIterationContext({
			solyDir: state.solyDir,
			projectRoot,
			kind: "plan",
			taskId: task.id,
			feature: task.feature,
		});
		const planFile = path.join(task.dir, "PLAN.md");
		const inlineSummary = inlinePlanSummary(planFile);
		const instruction = `soly plan ${target.taskId} — fleshing out PLAN.md for existing task.

**Task:** ${task.id}
**Feature:** ${task.feature}
**Kind:** ${task.kind}
**Current status:** ${task.status}
**PLAN.md path:** ${task.dir}/PLAN.md
**Feature README:** ${featureDir}/README.md

**Iteration context file written:** \`${iter.relPath}\` (${iter.tokens} tokens)
The planner reads this file first — it contains intent, STATE, the feature README, prior task SUMMARYs, and the current task PLAN (refine, don't re-derive).

**Inline plan summary (so you have the must-haves even before reading the file):**
${inlineSummary}

**0-POINT CHECK.** Re-read .soly/docs/ (intent) and .soly/features/${task.feature}/README.md (feature context) before refining the plan.

This task already has PLAN.md. Your job is to flesh it out / improve it based on intent and feature context — not to start from scratch.

Launch a single subagent to refine the plan:

subagent({
  agent: "worker",
  context: "fresh",
  async: true,
  task: \`You are a planner. Refine PLAN.md for an existing task.

**FIRST ACTION — read the iteration context file:**
\`\`\`
${iter.relPath}
\`\`\`
It contains intent, STATE, feature README, prior task SUMMARYs, and the current task PLAN (refine, don't re-derive).

Project root: ${projectRoot}
Soly dir:    ${state.solyDir}
Task dir:    ${task.dir}
Feature dir: ${featureDir}

Follow the workflow below VERBATIM.

=== WORKFLOW: plan-task.md ===
${workflow}
=== END WORKFLOW ===

Hard rules:
  - Do not write production code. Planning only.
  - Preserve the existing frontmatter (id, kind, feature, status, etc.) — only update if you find a bug.
  - If you change the plan body materially, commit it as \`chore(tasks): refine plan <task-id>\`.
  - If you only add small clarifications, no commit needed (or include in same commit).
  - PATH DISCIPLINE: PLAN.md lives at \`.soly/features/<feature>/tasks/<id>/PLAN.md\`. Never write to the project root.
  - Return: what changed, open questions, dependencies discovered.
\`
})

When the subagent returns, summarize what was refined. Do not execute — planning only.`;
		return { handled: true, transformedText: instruction };
	}

	// === NEW-TASK MODE (create task dir + PLAN.md skeleton) ===
	if (target.kind === "new-task") {
		let feature = state.features.find((f) => f.name === target.feature);
		if (!feature) {
			// Auto-create the feature dir + README so the planner can immediately
			// write a PLAN.md. Idempotent; safe to run repeatedly.
			const featuresRoot = path.join(state.solyDir, "features");
			const featureDir = path.join(featuresRoot, target.feature);
			const featureReadme = path.join(featureDir, "README.md");
			try {
				fs.mkdirSync(path.join(featureDir, "tasks"), { recursive: true });
				if (!fs.existsSync(featureReadme)) {
					fs.writeFileSync(
						featureReadme,
						`# Feature: ${target.feature}\n\nDescribe the feature's purpose here.\n`,
						"utf-8",
					);
				}
			} catch (e) {
				return {
					handled: true,
					transformedText:
						`soly plan: could not auto-create .soly/features/${target.feature}/ (${(e as Error).message}). ` +
						`Create it manually: \`mkdir -p .soly/features/${target.feature}/tasks/\``,
				};
			}
			// Re-read state so the planner sees the new feature
			feature = { name: target.feature, slug: target.feature, dir: featureDir, taskCount: 0, readmeExists: true, tasks: [] };
		}
		const workflow = loadWorkflowMarkdown("plan-task.md");
		if (!workflow) {
			return {
				handled: true,
				transformedText:
					`soly plan: workflow markdown not found: workflows-data/plan-task.md\n` +
					`This is an extension installation issue — reinstall soly.`,
			};
		}
		const featureDir = feature.dir;
		// For new-task mode, the PLAN.md doesn't exist yet, so no iteration
		// bundle — the planner will write it as part of its work. We only
		// pass the feature README + intent + state path hints.
		const instruction = `soly plan --new-task ${target.slug} --feature ${target.feature} — creating new task.

**Feature:** ${target.feature}
**Slug:** ${target.slug}
**Feature README:** ${featureDir}/README.md

**0-POINT CHECK.** Re-read .soly/docs/ (intent) and .soly/features/${target.feature}/README.md (feature context) before planning.

**Step 1 — generate task ID.** The task ID is \`<slug>-<4hex>\` (e.g. \`${target.slug}-a3f9\`). Generate 4 lowercase hex chars (use \`crypto.randomBytes(2).toString('hex')\` in node, or any 4-char [0-9a-f]{4} string if you don't have a shell handy).

**Step 2 — create the dir:**
\`\`\`
mkdir -p .soly/features/${target.feature}/tasks/<id>
\`\`\`

**Step 3 — write PLAN.md** with the frontmatter below + the plan body.

**Frontmatter (REQUIRED):**
\`\`\`yaml
---
id: <id>
kind: <be|fe|infra|docs|integration>
feature: ${target.feature}
status: ready
priority: <high|medium|low>
parallelizable: <true|false>
depends-on: []
---

# Task: <title>

[body produced by the planner workflow below]
\`\`\`

Launch a single subagent to flesh out the plan body:

subagent({
  agent: "worker",
  context: "fresh",
  async: true,
  task: \`You are a planner. Create a new task dir + write PLAN.md with frontmatter.

Project root: ${projectRoot}
Soly dir:    ${state.solyDir}
Feature dir: ${featureDir}
Target slug: ${target.slug}

=== WORKFLOW: plan-task.md ===
${workflow}
=== END WORKFLOW ===

Hard rules:
  - Do not write production code. Planning only.
  - Generate the task id as \`<slug>-<4hex>\` (e.g. \`${target.slug}-a3f9\`) — use 4 lowercase hex chars.
  - Create the dir \`.soly/features/${target.feature}/tasks/<id>/\` first.
  - Write PLAN.md with the frontmatter (id, kind, feature, status: ready, priority, parallelizable, depends-on).
  - Pick a \`kind:\` value matching the work (be|fe|infra|docs|integration).
  - Pick a reasonable \`priority:\` (default: medium).
  - Leave \`depends-on:\` as \`[]\` unless you have a clear dep on an existing task.
  - Commit: \`chore(tasks): plan <id>\`.
  - Return: created path, task id, plan summary.
\`
})

When the subagent returns, show the user the new task id + summary. They can then run \`soly execute <id>\`.`;
		return { handled: true, transformedText: instruction };
	}

	// === FEATURE MODE (plan all ready tasks in a feature) ===
	if (target.kind === "feature") {
		const feature = state.features.find((f) => f.name === target.feature);
		if (!feature) {
			return {
				handled: true,
				transformedText:
					`soly plan: feature "${target.feature}" not found.\n` +
					`Known features: ${state.features.map((f) => f.name).join(", ") || "(none)"}`,
			};
		}
		const featureTasks = state.tasks.filter((t) => t.feature === target.feature);
		if (featureTasks.length === 0) {
			return {
				handled: true,
				transformedText:
					`soly plan: no tasks in feature "${target.feature}".\n` +
					`Use \`soly plan --new-task <slug> --feature ${target.feature}\` to create one.`,
			};
		}
		// For "plan all tasks in feature" mode: we don't know which task to
		// bundle, so the planner will iterate per-task. The parent supplies
		// the high-level feature README + task list. Per-task iteration
		// bundles are written by the planner via the extension's write
		// function (call from a child tool if needed).
		const ready = featureTasks.filter((t) => t.status === "ready");
		const done = featureTasks.filter((t) => t.status === "done");
		const blocked = featureTasks.filter((t) => t.status === "blocked");
		const inProgress = featureTasks.filter((t) => t.status === "in-progress");
		if (ready.length === 0) {
			return {
				handled: true,
				transformedText:
					`soly plan --feature ${target.feature}: no tasks need planning.\n` +
					`Tasks: ${featureTasks.length} total, ${done.length} done, ${inProgress.length} in-progress, ${blocked.length} blocked.`,
			};
		}
		return {
			handled: true,
			transformedText:
				`soly plan --feature ${target.feature}: ${ready.length} task(s) need planning.\n\n` +
				`Tasks:\n` +
				ready.map((t, i) => `  ${i + 1}. ${t.id}  [${t.kind}]  prio=${t.priority}`).join("\n") +
				`\n\nLaunch a single subagent to plan them in order. The subagent uses the plan-task.md workflow per task.`,
		};
	}

	// Unreachable (describePlanTarget only returns the 4 kinds above)
	return {
		handled: true,
		transformedText: `soly plan: unknown target kind.`,
	};
}

export function buildDiscussTransform(
	cmd: SolyCommand,
	state: SolyState,
	opts: { hasAskPro?: boolean } = {},
): PlanningHandlerResult {
	const hasAskPro = opts.hasAskPro ?? false;
	if (!state.exists) {
		return {
			handled: true,
			transformedText:
				`soly discuss: no .soly/ directory in cwd (${state.solyDir || "<cwd>"}) — cannot discuss.\n` +
				`Initialize a soly project first.`,
		};
	}

	const projectRoot = path.dirname(state.solyDir);
	const target = getPhaseForDiscuss(state, cmd.args);
	if (!target) {
		const known = state.phases.map((p) => p.number).join(", ") || "(none)";
		return {
			handled: true,
			transformedText:
				`soly discuss: phase argument required and must exist.\n` +
				`Usage: soly discuss <N>    (e.g. "soly discuss 11")\n` +
				`Known phases: ${known}`,
		};
	}

	const phase = state.phases.find((p) => p.number === target.phase)!;

	// Write per-iteration context bundle (B2).
	const iter = writeIterationContext({
		solyDir: state.solyDir,
		projectRoot,
		kind: "discuss",
		phaseNumber: target.phase,
	});

	const phaseDir = path.join(state.solyDir, "phases", phase.slug);
	const padded = String(target.phase).padStart(2, "0");
	const contextPath = path.join(phaseDir, `${padded}-CONTEXT.md`);
	const checkpointPath = path.join(phaseDir, `${padded}-DISCUSS-CHECKPOINT.json`);

	// Optional workflow reference (background only — not a strict protocol anymore)
	const workflow = loadWorkflowMarkdown("discuss-phase.md");

	// Resume / refine detection
	let resumeBlock = "";
	if (fs.existsSync(checkpointPath)) {
		try {
			const ck = JSON.parse(fs.readFileSync(checkpointPath, "utf-8")) as {
				decisions?: Array<{ category: string; choice: string }>;
				areas_total?: number;
				areas_completed?: number[];
			};
			const decisions = ck.decisions ?? [];
			resumeBlock = `\n**RESUME MODE** — found checkpoint at \`${path.relative(projectRoot, checkpointPath)}\`:\n${decisions
				.map((d) => `  - ${d.category}: ${d.choice}`)
				.join("\n")}\n\nAcknowledge these as **Decisions Locked** at the top of your output, then continue with the next un-answered gray area. Resume from where the prior session left off.`;
		} catch {
			resumeBlock = `\n**RESUME MODE** — checkpoint file existed but was malformed; ignoring it and starting fresh.`;
		}
	} else if (fs.existsSync(contextPath)) {
		resumeBlock = `\n**REFINE MODE** — \`${padded}-CONTEXT.md\` already exists. Read it, list the existing decisions, and only ask about uncovered gray areas. Don't re-ask locked decisions.`;
	}

	const instruction = `soly discuss ${target.raw} — interactive discussion mode for phase ${target.phase} (${phase.name}).

**Iteration context file written:** \`${iter.relPath}\` (${iter.tokens} tokens, ${iter.bytes} bytes)
Read it first — it contains intent, STATE, ROADMAP, and any existing phase artifacts (CONTEXT, RESEARCH, prior SUMMARYs). It's your single source of truth.

${resumeBlock}

**This is NOT a subagent task.** You're running interactively. Drive the discussion yourself, in this session, by asking the user a few questions one at a time.

---

${
	hasAskPro
		? `**PREFERRED PICKER: \`ask_pro\` (from the \`pi-ask\` extension)** is available in this session.

This is a multi-question tabbed picker — one call shows all your questions as tabs, the user navigates with Tab/arrows and picks with 1-N. It returns all answers in one shot. This is much better UX than N separate \`soly_ask_user\` calls.

**Pattern:**
\`\`\`
ask_pro({
  questions: [
    { header: "Auth",     question: "Which auth approach?", options: [...], multiSelect: false },
    { header: "Tokens",   question: "Where to store tokens?", options: [...], allowOther: true },
    { header: "Errors",   question: "How to handle auth errors?", options: [...], multiSelect: true },
  ]
})
// → { answers: { 0: 1, 1: "Bearer in Authorization header", 2: [0, 2] } }
// or { cancelled: true }
\`\`\`

- Each option: \`{ label, description?, recommended? }\`. Mark the best with \`recommended: true\` (shown as ⭐ in the UI).
- For questions where the user might want a custom answer, add \`allowOther: true\` — the user gets a "Other…" option that opens a text input.
- For multi-select questions (checkboxes), set \`multiSelect: true\`. The answer is an array of option indices (and/or strings if \`allowOther\` is on).
- 2-4 options per question, max 6 questions per call.
- If the user cancels, you get \`{cancelled: true}\` — treat that as "deferred, ask differently" or just end the discuss.
- After getting answers, call \`soly_finish_discuss\` to write the canonical CONTEXT.md.

If \`ask_pro\` is not available (rare — would mean the user uninstalled the \`pi-ask\` extension), fall back to \`soly_ask_user\` (one call per question, see the fallback section below).`
		: `**PICKER: \`soly_ask_user\`** is the available multi-choice picker in this session.

**Pattern (one call per question, one at a time):**
\`\`\`
soly_ask_user({
  title: "Q1: <category>",
  question: "<one short sentence>",
  options: [
    "⭐ <recommended option> — <1 sentence why>",
    "<alternative 1>",
    "<alternative 2>",
  ],
  rationale: "<1–2 sentence note shown above the picker>",
})
\`\`\`

- Always include a recommended answer (⭐ first option) with 1-sentence rationale.
- After each answer, briefly acknowledge ("OK, locking X. Next:") and call \`soly_ask_user\` for the next question. **Do NOT dump all questions at once.**
- Never include "skip" / "you decide" as a default option. If a question is too hard, include a real option like \`"Defer — discuss in a future phase"\`.
- Note: \`soly_ask_user\` does NOT support \`allowOther\` (no text input). For questions that might need a custom answer, include a "Other (describe)" option that says the user can type a free-text answer in their next chat message.

**Tip:** the separate \`pi-ask\` extension provides a better UX (multi-question tabbed picker, \`allowOther\` text input). If it's not installed, \`soly_ask_user\` is the fallback.`
}

---

**Common flow (applies to both pickers):**

1. **Open with a 1–2 sentence framing** of what this phase delivers (grounded in ROADMAP + intent). No implementation details. Then show the locked decisions (if any from resume). Then say: "I have <N> questions about this phase. Let's go."

2. **Call the picker ONCE** (preferred) **or per-question** (fallback) as above. Always include a recommended answer (⭐ first option) with 1-sentence rationale.

3. **Save checkpoint after each answer** with \`soly_save_discuss_checkpoint({phase_number, decisions, areas_total, areas_completed})\` so the user can quit and resume. The final \`soly_finish_discuss\` will delete the checkpoint and write CONTEXT.md.

4. **After all questions captured, call \`soly_finish_discuss\`:**
   \`\`\`
   soly_finish_discuss({
     phase_number: ${target.phase},
     domain: "<1–2 paragraphs: what this phase delivers>",
     decisions: [
       { category: "<cat>", choice: "<what was chosen>", rationale: "<why>" },
       ...
     ],
     canonical_refs: [".soly/docs/<file>", ".soly/ROADMAP.md", ...],
     deferred_ideas: ["<scope creep for future phase>", ...],
     codebase_context: ["src/components/Card.tsx — has rounded/shadow variants, reuse", ...],
   })
   \`\`\`

5. **Tell the user the next step** after \`soly_finish_discuss\` returns: \`soly plan ${target.phase}\`.

---

**Available tools for this flow:**
- ${hasAskPro ? "`ask_pro` — multi-question tabbed picker (PREFERRED)" : "`soly_ask_user` — single-question picker (fallback)"}
- \`soly_save_discuss_checkpoint\` — save partial progress (use after each answer)
- \`soly_finish_discuss\` — finalize: writes CONTEXT.md, deletes checkpoint
- \`soly_read\`, \`soly_snippet\`, \`soly_doc_search\`, \`soly_intent\` — read .soly/ artifacts as needed
- \`soly_log_decision\` — log to STATE.md Decisions table (use sparingly)
- Standard pi tools: \`read\`, \`bash\`, \`grep\`, \`find\` for codebase context

**Workflow reference (background only — not a strict protocol anymore):**
${workflow ? "```\n" + workflow.slice(0, 1500) + "\n[...truncated, see .pi/agent/extensions/soly/workflows-data/discuss-phase.md for full reference]\n```" : "_(workflow markdown missing)_"}

---

**Hard rules:**
- **One picker call** (ask_pro) **or N calls** (soly_ask_user) — never dump all questions as text in your reply.
- Always include a recommended answer (⭐ first option) with 1-sentence rationale.
- Use \`soly_save_discuss_checkpoint\` after each answer (so resume works).
- Use \`soly_finish_discuss\` to finalize — don't just say "done".
- **No scope creep.** Defer scope-creep items to \`deferred_ideas\`.
- **No PLAN.md** from this flow — that's \`soly plan ${target.phase}\`.
- **No SUMMARY.md** — that's from \`soly execute\`.
- **No code edits.** Discussion only.
- If intent docs (0-point) are silent on a constraint, ask the user — don't assume.

Begin.`;

	return { handled: true, transformedText: instruction };
}
