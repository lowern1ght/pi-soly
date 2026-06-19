// =============================================================================
// workflows/migrate.ts — `soly migrate`: legacy layout → unified (LLM-runnable)
// =============================================================================
//
// The unified model is `phases/<N>/tasks/<id>/PLAN.md`. Two legacy shapes need
// converting:
//   - standalone plan files `phases/<N>/<NN-MM>-PLAN.md` (+ *-SUMMARY.md)
//   - the separate features model `features/<f>/tasks/<id>/`
//
// Conversion is semantic (derive a task id/kind/deps from a plan), so we hand
// the model a careful, verify-before-delete protocol rather than doing blind
// file moves in the extension. Returns a transform the LLM executes inline.
// =============================================================================

import type { SolyState } from "../core.ts";

export type MigrateResult = { handled: boolean; transformedText?: string };

/** Phases that still use legacy standalone plan files and have no tasks/ yet. */
function legacyPhases(state: SolyState): string[] {
	return state.phases
		.filter((p) => p.plans.length > 0 && (!p.tasks || p.tasks.length === 0))
		.map((p) => `${p.slug} (${p.plans.length} plan${p.plans.length === 1 ? "" : "s"})`);
}

export function buildMigrateTransform(state: SolyState): MigrateResult {
	if (!state.exists) {
		return {
			handled: true,
			transformedText:
				`soly migrate: no .soly/ project in this directory — nothing to migrate.`,
		};
	}

	const phases = legacyPhases(state);
	const features = state.features.map((f) => `${f.slug} (${f.taskCount} task${f.taskCount === 1 ? "" : "s"})`);

	if (phases.length === 0 && features.length === 0) {
		return {
			handled: true,
			transformedText:
				`soly migrate: already on the unified model (phase = group of tasks). Nothing to migrate.`,
		};
	}

	const detected: string[] = [];
	if (phases.length > 0) detected.push(`- Legacy plan files in: ${phases.join(", ")}`);
	if (features.length > 0) detected.push(`- Legacy \`features/\` dirs: ${features.join(", ")}`);

	return {
		handled: true,
		transformedText: `soly migrate — convert the legacy layout to the unified model (phase = group of tasks).

Target layout:
  .soly/phases/<N>/tasks/<task-id>/PLAN.md   (frontmatter: id, kind, status, depends-on, feature?)
  .soly/phases/<N>/tasks/<task-id>/SUMMARY.md

Detected legacy artifacts:
${detected.join("\n")}

Do the conversion YOURSELF, carefully, one item at a time. NEVER delete an old file until the new one is written and you've confirmed its contents. Use \`soly_read\` / \`soly_snippet\` to read, your file tools to write/move.

**A. For each legacy plan \`phases/<N>/<NN-MM>-PLAN.md\`:**
1. Read it. Derive a stable task id \`<short-slug>-<4hex>\` from the plan's title/intent (lowercase, hyphenated, e.g. \`auth-login-a3f9\`).
2. Write \`phases/<N>/tasks/<id>/PLAN.md\` with frontmatter, then the original body unchanged:
   \`\`\`
   ---
   id: <id>
   kind: <be|fe|infra|docs|test>   # infer from the plan
   status: <ready|done>            # done if a matching *-SUMMARY.md exists
   depends-on: []                  # fill if the plan depends on earlier plans/tasks
   ---
   <original plan body>
   \`\`\`
3. If a matching \`<NN-MM>-SUMMARY.md\` exists, move it to \`phases/<N>/tasks/<id>/SUMMARY.md\`.
4. Verify the new files exist and read correctly, THEN delete the old \`<NN-MM>-PLAN.md\` and its \`*-SUMMARY.md\`.

**B. For each \`features/<f>/tasks/<id>/\`:**
1. Decide which phase it belongs to (ask the user with \`ask_pro\` if it's not obvious from the task/feature).
2. Move the whole task dir to \`phases/<N>/tasks/<id>/\` and add \`feature: <f>\` to its PLAN.md frontmatter.
3. When a feature's tasks are all moved, remove the now-empty \`features/<f>/\`.

**Close out:** update any path references in STATE.md / ROADMAP.md, run \`soly status\` and \`soly doctor\` to confirm the new layout loads, then commit. Report a short summary of what moved (counts + any tasks you couldn't place).`,
	};
}
