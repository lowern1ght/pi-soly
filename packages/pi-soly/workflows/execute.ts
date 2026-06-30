// =============================================================================
// workflows/execute.ts — `soly execute <N>` / `soly execute <N.MM>` handler
// =============================================================================
//
// Intercepts "soly execute 11" (phase) or "soly execute 11.02" (specific plan)
// and transforms it into a detailed LLM instruction that launches a worker
// subagent with the soly execute workflow loaded into its system prompt.
//
// We use `action: "transform"` (not `action: "handled"`) — the LLM still
// receives the request, but with the full workflow context, so it can call
// the `subagent(...)` tool itself and apply the SOLY-specific close-out
// discipline (commits, SUMMARY.md, STATE.md update).
//
// We do NOT spawn the subagent directly from the extension — `subagent(...)`
// is a tool only available to the LLM (via pi-subagents), and the parent
// session needs to keep ownership of the close-out loop.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describeExecuteTarget, type SolyCommand } from "./parser.ts";
import type { SolyState } from "../core.js";
import {
	extractPlanSummary,
	renderPlanSummaryInline,
	writeIterationContext,
} from "../iteration.js";

/** Resolve <extension>/workflows-data/<name>.md regardless of cwd. */
function loadWorkflowMarkdown(name: string): string | null {
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		// workflows-data is sibling of workflows/
		const candidate = path.resolve(here, "..", "workflows-data", name);
		if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf-8");
	} catch {
		// fileURLToPath may fail in some runtimes; fall through.
	}
	return null;
}

/** Build the inline plan summary block for the worker task (so it has the
 *  must_haves / wave / requirements even before reading the iteration file). */
function inlinePlanSummary(planFilePath: string | null): string {
	if (!planFilePath) return "_(no PLAN.md located)_";
	const raw = fs.readFileSync(planFilePath, "utf-8");
	const summary = extractPlanSummary(raw);
	if (!summary) return "_(PLAN.md missing frontmatter or unparseable)_";
	return renderPlanSummaryInline(summary);
}

export interface ExecuteHandlerResult {
	handled: boolean;
	transformedText?: string;
}

/**
 * Build the transformed LLM instruction for a `soly execute ...` command.
 * Returns { handled: false } if the args are malformed.
 *
 * `interactiveRules` is the list of relPaths marked `interactive: true`
 * — passed to the worker so it knows which rules are explicitly OUT of
 * scope (they describe the user-facing conversation, not the work).
 */
export function buildExecuteTransform(
	cmd: SolyCommand,
	state: SolyState,
	interactiveRules: string[] = [],
	opts: { agent?: string } = {},
): ExecuteHandlerResult {
	if (!state.exists) {
		return {
			handled: true,
			transformedText:
				`soly: no .agents/ directory found in cwd (${state.solyDir || "<cwd>"}) — cannot execute phase.\n` +
				`Initialize a soly project first (see soly quickstart) before running "soly execute".`,
		};
	}

	const projectRoot = path.dirname(state.solyDir);
	const target = describeExecuteTarget(cmd.args);
	if (!target) {
		return {
			handled: true,
			transformedText:
				`soly execute: missing or malformed target.\n` +
				`Usage:\n` +
				`  soly execute <N>            — execute all plans in phase N\n` +
				`  soly execute <N.MM>         — execute a specific plan\n` +
				`  soly execute <task-id>      — execute a specific task (new dual-mode)\n` +
				`  soly execute --all          — execute all ready tasks (sequential in v0.1)\n` +
				`  soly execute --feature <n>  — execute all tasks in a feature (sequential in v0.1)`,
		};
	}

	// === TASK MODE (new dual-mode) ===
	if (target.kind === "task") {
		const task = state.tasks.find((t) => t.id === target.taskId);
		if (!task) {
			return {
				handled: true,
				transformedText:
					`soly execute: task ${target.taskId} not found in .agents/features/*/tasks/.\n` +
					`Known tasks: ${state.tasks.map((t) => t.id).join(", ") || "(none)"}\n` +
					`Tip: use the \`soly_list_tasks\` tool to see all available tasks.`,
			};
		}
		if (!task.planExists) {
			return {
				handled: true,
				transformedText:
					`soly execute: task ${target.taskId} has no PLAN.md at ${task.dir}/PLAN.md.\n` +
					`Create a PLAN.md with frontmatter (id, kind, feature, status, depends-on) before executing.`,
			};
		}
		if (task.status === "blocked") {
			return {
				handled: true,
				transformedText:
					`soly execute: task ${target.taskId} is \`status: blocked\`.\n` +
					`Resolve blockers in PLAN.md before executing.`,
			};
		}
		if (task.status === "done") {
			return {
				handled: true,
				transformedText:
					`soly execute: task ${target.taskId} is already \`status: done\`.\n` +
					`SUMMARY.md exists at ${task.dir}/SUMMARY.md. To re-run, change status to \`ready\` in PLAN.md frontmatter.`,
			};
		}
		// Check deps
		const unmetDeps = task.dependsOn.filter((depId) => {
			const dep = state.tasks.find((t) => t.id === depId);
			return !dep || dep.status !== "done";
		});
		if (unmetDeps.length > 0) {
			return {
				handled: true,
				transformedText:
					`soly execute: task ${target.taskId} has unmet dependencies: [${unmetDeps.join(", ")}].\n` +
					`Tasks must be \`status: done\` (have a SUMMARY.md) before their dependents can run.`,
			};
		}
		const workflow = loadWorkflowMarkdown("execute-task.md");
		if (!workflow) {
			return {
				handled: true,
				transformedText:
					`soly execute: workflow markdown not found: workflows-data/execute-task.md\n` +
					`This is an extension installation issue — reinstall soly.`,
			};
		}
		const featureDir = path.dirname(path.dirname(task.dir));

		// Write per-iteration context bundle (B2 of the soly design).
		// Worker reads this file first; no need to chase 6+ .agents/ files.
		const iter = writeIterationContext({
			solyDir: state.solyDir,
			projectRoot,
			kind: "exec",
			taskId: task.id,
			feature: task.feature,
		});
		const inlineSummary = inlinePlanSummary(path.join(task.dir, "PLAN.md"));

		const instruction = `soly execute ${target.taskId} — launching worker for task.

**Task:** ${task.id}
**Feature:** ${task.feature}
**Kind:** ${task.kind}
**Status:** ${task.status}
**Priority:** ${task.priority}
**Depends-on:** [${task.dependsOn.join(", ") || "none"}]
**Parallelizable:** ${task.parallelizable}
**Dir:** ${task.dir}

**Iteration context file written:** \`${iter.relPath}\` (${iter.tokens} tokens, ${iter.bytes} bytes)
The worker reads this file first — it contains intent, STATE, ROADMAP (n/a for tasks), the feature README, prior task SUMMARYs, and the current task PLAN.

**0-POINT CHECK.** Worker must re-read .agents/docs/ (intent) and .agents/features/${task.feature}/README.md before implementing.

Launch a single subagent for this work. Do NOT do the work inline.

subagent({
  agent: ${JSON.stringify(opts.agent ?? "worker")},
  context: "fresh",
  async: true,
  maxSubagentDepth: 1,
  task: \`You are soly-executor (single-task writer).

Your job: execute ONE task (atomic unit) and produce its SUMMARY.md.

**FIRST ACTION — read the iteration context file:**
\`\`\`
${iter.relPath}
\`\`\`
It contains intent, STATE, feature README, prior task SUMMARYs, and the current PLAN. Do NOT skip it. The must-haves below are also inlined so you have them even before reading the file.

**Inline plan summary (from PLAN.md frontmatter + Must Haves):**
${inlineSummary}

Project root: ${projectRoot}
Soly dir:    ${state.solyDir}
Feature dir: ${featureDir}
Task dir:    ${task.dir}

**0-POINT CHECK — read .agents/docs/ first.**
These are the project's INTENT (business context, design vision). Re-read them before implementing. If you find a conflict between intent and PLAN.md, flag it instead of silently choosing one.

**Follow the worker self-audit gate (see .agents/rules/process/worker-audit.md):**
1. Run \`dotnet build\` (or relevant build) — 0 warnings
2. Cross-check diff against .agents/rules/coding/*
3. Invoke \`analyzer-coach\` skill for any rule gaps
4. Loop until clean (max 3 iterations)
5. Commit (production-code commit(s))
6. Write SUMMARY.md, commit it
7. Update PLAN.md frontmatter: \`status: done\`

=== WORKFLOW: execute-task.md ===
${workflow}
=== END WORKFLOW ===

Hard rules:
  - Do not skip the close-out order: production commits -> SUMMARY commit -> status: done.
  - Do not modify any .agents/rules/ files.
  - Do not run subagents yourself.
  - Do not start a task whose \`depends-on:\` lists tasks that are not \`done\`.
  - PATH DISCIPLINE: all files YOU create must live under \`.agents/\` (iteration, handoff, etc.) or under the project's source dirs. Never write to the project root.
  - Return: changed files, commands run with exit codes, validation evidence, surprises, decisions needing parent approval.
  - Interactive-only rules are NOT in scope for you: ${interactiveRules.length > 0 ? interactiveRules.join(", ") : "(none)"}.
\`
})

When the subagent completes, synthesize the result. Do not re-execute its work. Then suggest \`soly verify\` to self-review the change with fresh eyes before calling it done.`;
		return { handled: true, transformedText: instruction };
	}

	// === ALL / FEATURE (new dual-mode, sequential in v0.1) ===
	if (target.kind === "all" || target.kind === "feature") {
		const allTasks =
			target.kind === "all"
				? state.tasks
				: state.tasks.filter((t) => t.feature === target.feature);
		if (allTasks.length === 0) {
			return {
				handled: true,
				transformedText:
					target.kind === "all"
						? `soly execute --all: no tasks found in .agents/features/*/tasks/.`
						: `soly execute --feature ${target.feature}: no tasks found for that feature.`,
			};
		}
		const ready = allTasks.filter((t) => t.status === "ready");
		const blocked = allTasks.filter((t) => t.status === "blocked");
		const done = allTasks.filter((t) => t.status === "done");
		if (ready.length === 0) {
			return {
				handled: true,
				transformedText:
					`soly execute: no ready tasks in scope.\n` +
					`Tasks: ${allTasks.length} total, ${done.length} done, ${blocked.length} blocked.`,
			};
		}
		return {
			handled: true,
			transformedText:
				`soly execute ${target.kind === "all" ? "--all" : `--feature ${target.feature}`}: ${ready.length} task(s) ready.\n\n` +
				`**v0.1 limitation:** tasks run sequentially, not in parallel. Parallel mode is v0.2.\n\n` +
				`Ready tasks (in suggested order):\n` +
				ready.map((t, i) => `  ${i + 1}. ${t.id}  [${t.kind}]  prio=${t.priority}`).join("\n") +
				`\n\nLaunch a single subagent to execute them one at a time in this order. The subagent uses the task execution workflow (execute-task.md) per task.`,
		};
	}

	// === PLAN MODE (new dual-mode: `<type>/<name>` plans live under .agents/plans/<prefix>-<name>/) ===
	if (target.kind === "plan") {
		// Plan dir is always flattened: `<prefix>-<name>` if a prefix is
		// present, else just `<name>`.
		const dirSlug = target.prefix ? `${target.prefix}-${target.name}` : target.name;
		const planDirAbs = `${state.solyDir}/plans/${dirSlug}`;
		const planFile = `${planDirAbs}/PLAN.md`;
		let planBody: string;
		try {
			planBody = fs.readFileSync(planFile, "utf-8");
		} catch {
			return {
				handled: true,
				transformedText:
					`soly execute: plan ${target.raw} has no PLAN.md at ${planFile}.\n` +
					`Run \`soly plan ${target.raw}\` first to flesh it out.`,
			};
		}
		const workflow = loadWorkflowMarkdown("execute-plan.md");
		if (!workflow) {
			return {
				handled: true,
				transformedText:
					`soly execute: workflow markdown not found: workflows-data/execute-plan.md\n` +
					`This is an extension installation issue — reinstall soly.`,
			};
		}
		// Write per-iteration context bundle so the worker has intent + STATE
		// + the plan body in one file.
		const iter = writeIterationContext({
			solyDir: state.solyDir,
			projectRoot,
			kind: "exec",
			planName: target.name,
		});
		const instruction = `soly execute ${target.raw} — executing plan.

**Plan:** ${target.name}
**Branch:** ${target.raw}
**PLAN.md:** ${planFile}

**Iteration context file written:** \`${iter.relPath}\` (${iter.tokens} tokens)
The worker reads this file first — it contains intent, STATE, ROADMAP, the
plan body inline, and any prior SUMMARYs for this plan (none on first run).

**Inline plan body (so you have must-haves before reading the file):**
\`\`\`markdown
${planBody.slice(0, 4000)}${planBody.length > 4000 ? "\n…(truncated)" : ""}
\`\`\`

**0-POINT CHECK.** Worker must re-read .agents/docs/ (intent) before implementing.

Launch a single subagent to execute the plan. Do NOT do the work inline.

subagent({
  agent: ${JSON.stringify(opts.agent ?? "worker")},
  context: "fresh",
  async: true,
  maxSubagentDepth: 1,
  task: \`You are soly-executor. Execute the plan at \`${planFile}\` end-to-end.

**FIRST ACTION — read the iteration context file:**
\`\`\`
${iter.relPath}
\`\`\`
It contains intent, STATE, ROADMAP, and the full plan body. Do NOT skip it.

Project root: ${projectRoot}
Soly dir:    ${state.solyDir}
Plan dir:    ${planDirAbs}

**0-POINT CHECK — read .agents/docs/ first.**

Follow the workflow below VERBATIM.

=== WORKFLOW: execute-plan.md ===
${workflow}
=== END WORKFLOW ===

Hard rules:
  - All work happens on branch \`${target.raw}\`. Do not switch branches.
  - When the plan is fully executed and verified, write a SUMMARY.md next to
    PLAN.md summarizing what was done, what was deferred, and any deviations.
  - Do not commit unless the workflow tells you to; the user reviews and merges.
\`)
}`;
		return { handled: true, transformedText: instruction };
	}

	// === PHASE MODE ===
	if (target.kind !== "phase") {
		return { handled: false };
	}
	const phase = state.phases.find((p) => p.number === target.phase);
	if (!phase) {
		return {
			handled: true,
			transformedText:
				`soly execute: phase ${target.phase} not found in .agents/phases/.\n` +
				`Known phases: ${state.phases.map((p) => p.number).join(", ") || "(none)"}`,
		};
	}

	const isPlanLevel = target.plan != null;
	// Unified model: a phase with tasks/ executes those (dependency-ordered) via
	// the task-centric workflow; legacy phases (plan files, no tasks) keep the
	// wave/plan workflow.
	const phaseTasks = phase.tasks ?? [];
	const useTasks = !isPlanLevel && phaseTasks.length > 0;
	const workflowName = isPlanLevel ? "execute-plan.md" : useTasks ? "execute-task.md" : "execute-phase.md";
	const workflow = loadWorkflowMarkdown(workflowName);
	if (!workflow) {
		return {
			handled: true,
			transformedText:
				`soly execute: workflow markdown not found: workflows-data/${workflowName}\n` +
				`This is an extension installation issue — reinstall soly.`,
		};
	}

	// Write per-iteration context bundle (B2 of the soly design).
	// For plan-level execution: bundle includes the specific PLAN.md.
	// For phase-level execution: bundle includes all plan frontmatter summaries
	// (the phase workflow iterates waves on its own).
	const iter = writeIterationContext({
		solyDir: state.solyDir,
		projectRoot,
		kind: "exec",
		phaseNumber: target.phase,
		planNumber: isPlanLevel ? (target.plan ?? undefined) : undefined,
	});

	// For plan-level: find the PLAN.md. We always use the directory scan
	// (the conventional name would require knowing the slug suffix, which
	// is fragile and changed over time). Pattern: NN-MM-slug-PLAN.md.
	let planFileResolved: string | null = null;
	if (isPlanLevel && phase.dir) {
		const padded = String(target.plan).padStart(2, "0");
		let entries: string[];
		try {
			entries = fs.readdirSync(phase.dir);
		} catch {
			entries = [];
		}
		const re = new RegExp(`^\\d{2,}-${padded}-.+-PLAN\\.md$`);
		const match = entries.find((f) => re.test(f));
		if (match) planFileResolved = path.join(phase.dir, match);
	}
	const inlineSummary = isPlanLevel ? inlinePlanSummary(planFileResolved) : "_(phase-level exec — iterate all PLAN.md files; each iteration has its own bundle)_";

	// Build the LLM instruction. Keep it terse at the top, then dump the
	// workflow markdown verbatim so the LLM has full context.
	const targetDesc = isPlanLevel
		? `phase ${target.phase} plan ${String(target.plan).padStart(2, "0")}`
		: useTasks
			? `phase ${target.phase} (${phase.name}) — ${phaseTasks.length} task(s)`
			: `phase ${target.phase} (${phase.name}) — all ${phase.planCount} plan(s)`;

	const scopeBlock = isPlanLevel
		? `Target: ONE plan = ${targetDesc}.
The iteration context file lists the specific plan at section 6.`
		: useTasks
			? `Target: ${targetDesc} — the unified task model.
Execute the tasks under \`${phase.dir}/tasks/\`. Run only tasks whose \`depends-on\` are all satisfied (status: done), in dependency order — sequential is fine. Each task produces its own SUMMARY.md in its task dir and flips its PLAN.md frontmatter to \`status: done\`. The wave/plan language in the workflow below maps onto these tasks.`
			: `Target: ${targetDesc}.
The iteration context file lists all plans (their frontmatter) in section 6, grouped by wave.`;

	const childRole = isPlanLevel
		? `soly-executor (single-plan writer)`
		: `soly-executor (wave-based parallel phase executor)`;

	const instruction = `soly execute ${target.raw} — launching worker for ${targetDesc}.

**Iteration context file written:** \`${iter.relPath}\` (${iter.tokens} tokens, ${iter.bytes} bytes)
The worker reads this file first — it contains intent, STATE, ROADMAP row for this phase, phase CONTEXT, phase RESEARCH, prior SUMMARYs, ${isPlanLevel ? "and the current PLAN" : "and all PLAN frontmatter summaries"}, and (for exec) the Critical Anti-Patterns from .continue-here.md.

**0-POINT CHECK — worker must read .agents/docs/ first.**
These are the project's INTENT docs. The worker is about to implement tasks; if the implementation diverges from intent, it will be wrong even if the tests pass. Have the worker re-read .agents/docs/ (and any intent docs linked from PLAN.md) before each plan.

${scopeBlock}

Launch a single subagent for this work. Do NOT do the work inline.

subagent({
  agent: ${JSON.stringify(opts.agent ?? "worker")},
  context: "fresh",
  async: true,
  maxSubagentDepth: 1,  // worker must not spawn sub-sub-agents
  task: \`You are ${childRole}.

Your job: ${isPlanLevel ? "execute ONE plan and produce its SUMMARY.md" : useTasks ? "execute the phase's ready tasks in dependency order, each producing its SUMMARY.md" : "execute ALL plans in this phase using wave-based parallel execution"}.

**FIRST ACTION — read the iteration context file:**
\`\`\`
${iter.relPath}
\`\`\`
It contains intent, STATE, ROADMAP, phase CONTEXT, phase RESEARCH, prior SUMMARYs, ${isPlanLevel ? "and the current PLAN" : "and the wave-grouped plan index"}, and (for exec) the Critical Anti-Patterns.

${isPlanLevel
	? `**Inline plan summary (so you have must-haves even before reading the file):**
${inlineSummary}`
	: `**Note for phase-level exec:** for each plan you execute, you may write a new bundle via the extension (the parent will regenerate; you do not need to). Or, simpler: read the plan file directly from the source path listed in section 6. The must-haves of the current plan are in section 6 too.`}

Project root: ${projectRoot}
Soly dir:    ${state.solyDir}
Phase dir:   ${phase.dir}

**0-POINT CHECK — read .agents/docs/ first.**
These are the project's INTENT (business context, design vision). Re-read them before implementing each plan. If you find a conflict between intent and PLAN.md, flag it instead of silently choosing one.

Follow the workflow below VERBATIM — these are the user-approved soly instructions, not suggestions.

=== WORKFLOW: ${workflowName} ===
${workflow}
=== END WORKFLOW ===

Hard rules:
  - Do not skip the close-out order: production commits -> SUMMARY commit -> STATE/ROADMAP update.
  - Do not modify any .agents/rules/ files.
  - Do not run subagents yourself.
  - PATH DISCIPLINE: all files YOU create must live under \`.agents/\` (e.g. .agents/iterations/, .agents/phases/<slug>/, .agents/HANDOFF.json) or under the project's source dirs. Never write PLAN/SUMMARY/CONTEXT/RESEARCH/iteration files to the project root.
  - Return: changed files, commands run with exit codes, validation evidence, surprises, and any decisions needing parent approval.
  - Interactive-only rules are NOT in scope for you: ${interactiveRules.length > 0 ? interactiveRules.join(", ") : "(none)"}. They describe how the user-facing conversation should go, not how to execute work.
\`
})

When the subagent completes, synthesize the result and confirm STATE.md was updated. Do not re-execute its work. Then suggest \`soly verify\` to self-review the work with fresh eyes before calling the phase done.`;

	return { handled: true, transformedText: instruction };
}
