// =============================================================================
// workflows/llm-tools.ts — `soly_workflow` tool (first-party, no subagents)
// =============================================================================
//
// Exposes the soly lifecycle to the LLM as a single callable tool so the model
// can drive the workflow itself in response to the user's natural-language
// intent — instead of the user having to type `soly <verb>` by hand.
//
//   soly_workflow({ action: "new" | "plan" | "discuss" | "execute" | "done",
//                   target?: "<slug>" | "<prefix>/<slug>" | "<N>" | "<task-id>" })
//
// The tool reuses the SAME builders the plain-text `soly <verb>` input hook
// uses (buildNewTransform / buildPlanTransform / …), so there is exactly one
// implementation of each verb. It returns the builder's instruction text as
// the tool result — which flows back into the model's context, and the model
// continues the work INLINE, in this session. No external subagent plugin.
//
// `verify` is intentionally NOT exposed here: it's a stateful self-review loop
// driven by the interactive input channel (the user types `soly verify`).
// Starting it mid-tool-call would fight the streaming turn.
// =============================================================================

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SolyCommand } from "./parser.ts";
import { buildExecuteTransform } from "./execute.ts";
import { buildPlanTransform, buildDiscussTransform } from "./planning.ts";
import { buildNewTransform } from "./new.ts";
import { buildDoneTransform } from "./done.ts";
import type { SolyState } from "../core.js";
import type { SolyConfig } from "../config.js";

/** Actions the LLM can drive through `soly_workflow`. Order matches lifecycle. */
export const WORKFLOW_ACTIONS = ["new", "discuss", "plan", "execute", "done"] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

/** Actions that put the session into a visible "mode" (chrome top bar). */
const MODE_ACTIONS: readonly WorkflowAction[] = ["execute", "plan", "discuss"];

export interface WorkflowToolDeps {
	getState: () => SolyState;
	getInteractiveRules: () => string[];
	getActiveTools: () => string[];
	getConfig: () => SolyConfig;
	/** Reset drift counters etc. (same hook the input handler fires). */
	onWorkflowUsed?: () => void;
	/** Set the active workflow-mode label shown in the chrome top bar. */
	setVerbLabel?: (verb: string | null) => void;
}

/** Build the shared `{ handled, transformedText }` result for one action.
 *  Pure dispatch over the existing builders — no side effects beyond what the
 *  individual builders do (new/done touch git + ui.notify). */
function dispatch(
	action: WorkflowAction,
	cmd: SolyCommand,
	deps: WorkflowToolDeps,
	ui: { notify: (t: string, level?: "info" | "warning" | "error") => void },
	cwd: string,
): { handled: boolean; transformedText?: string } {
	const state = deps.getState();
	switch (action) {
		case "new":
			return buildNewTransform(cmd, state, ui, cwd, "");
		case "done":
			return buildDoneTransform(cmd, state, ui, cwd, {
				defaultBranchPrefix: "",
			});
		case "plan":
			return buildPlanTransform(cmd, state);
		case "execute":
			return buildExecuteTransform(cmd, state, deps.getInteractiveRules());
		case "discuss":
			return buildDiscussTransform(cmd, state, {
				hasAskPro: deps.getActiveTools().includes("ask_pro"),
			});
	}
}

export function registerWorkflowTool(pi: ExtensionAPI, deps: WorkflowToolDeps): void {
	pi.registerTool({
		name: "soly-workflow",
		label: "soly workflow",
		description:
			"Drive the soly plan lifecycle in THIS session (no subagent needed). Call this when the user expresses intent to plan or ship work — even loosely (\"let's plan this\", \"go\", \"start executing\", \"wrap it up\"). Actions: `new` (scaffold a plan branch + stub PLAN.md), `discuss` (interactive scoping via ask_pro), `plan` (flesh out PLAN.md), `execute` (implement the plan inline), `done` (commit + push + draft PR). `target` is the plan slug / `<prefix>/<slug>` / phase number / task id (required for new/done; optional for the phase-based forms). The result is the full workflow instruction — follow it inline; do not delegate. (For the `verify` self-review loop, tell the user to type `soly verify` — it's a stateful loop, not a one-shot action.)",
		promptSnippet:
			"Run a soly workflow step (new/discuss/plan/execute/done) when the user asks to plan or ship work",
		promptGuidelines: [
			"Use soly_workflow when the user expresses intent to plan, discuss, execute, or finish a piece of work — call it yourself instead of asking them to type a `soly <verb>` command.",
			"After soly_workflow returns, follow the returned instruction inline in this session; there is no separate worker to hand off to.",
		],
		parameters: Type.Object({
			action: StringEnum([...WORKFLOW_ACTIONS] as [WorkflowAction, ...WorkflowAction[]]),
			target: Type.Optional(
				Type.String({
					description:
						"Plan slug (e.g. `auth-jwt`), `<prefix>/<slug>` (e.g. `fix/login-bug`), phase number (e.g. `3` or `3.02`), or task id. Required for new/done.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const action = params.action as WorkflowAction;
			const target = (params.target ?? "").trim();
			const cmd: SolyCommand = {
				verb: action,
				args: target ? target.split(/\s+/) : [],
				raw: `soly ${action}${target ? ` ${target}` : ""}`,
			};

			// Same bookkeeping the input hook does for a recognized verb.
			deps.onWorkflowUsed?.();
			if (MODE_ACTIONS.includes(action)) deps.setVerbLabel?.(action);

			const result = dispatch(action, cmd, deps, ctx.ui, ctx.cwd);
			const text = result.transformedText ?? `soly_workflow: nothing to do for action "${action}".`;
			return {
				content: [{ type: "text", text }],
				details: { action, target: target || null, handled: result.handled },
			};
		},
	});
}
