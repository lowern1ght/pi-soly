// =============================================================================
// workflows/index.ts — Single `input` event hook for all soly workflow verbs
// =============================================================================
//
// Intercepts plain-text "soly <verb> ..." user input (NOT /soly slash commands
// — those still go through pi.registerCommand in commands.ts).
//
// For each verb, the handler either:
//   - transforms the input into a detailed LLM instruction (execute / pause /
//     compact / resume / plan / discuss) — LLM drives the heavy lifting
//   - shows a direct response (status / log / diff) — extension computes
//     immediately, no LLM round-trip needed
//
// "Direct response" verbs (status/log/diff) return action: "handled" — the
// LLM never sees them, and the user gets an immediate UI notification.
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseSolyCommand, type SolyCommand } from "./parser.js";
import { buildExecuteTransform } from "./execute.js";
import { buildPauseTransform } from "./pause.js";
import { buildResumeTransform } from "./resume.js";
import { showStatus, showLog, showDiff } from "./quick.js";
import { showDoctor, showIterations, showDiffIterations, showPhaseDelete, showTodos } from "./inspect.js";
import { buildPlanTransform, buildDiscussTransform } from "./planning.js";
import type { SolyState } from "../core.js";
import type { SolyConfig } from "../config.js";

export interface WorkflowsDeps {
	getState: () => SolyState;
	/** List of rule relPaths marked `interactive: true` — passed to subagent
	 *  workers so they know which rules are explicitly out of scope. */
	getInteractiveRules: () => string[];
	/** List of active tool names. Used to detect optional cross-extension
	 *  dependencies (e.g. `ask_pro` from the separate `pi-ask` extension). */
	getActiveTools: () => string[];
	/** Current merged config (per-project + global + defaults). */
	getConfig: () => SolyConfig;
	/** Fired when a recognized soly verb is parsed (handled OR transformed).
	 *  Used by the parent extension to reset drift counters etc. */
	onWorkflowUsed?: () => void;
}

export function registerWorkflows(pi: ExtensionAPI, deps: WorkflowsDeps): void {
	const { getState, getInteractiveRules, getActiveTools, getConfig, onWorkflowUsed } = deps;
	// The current agent is owned by the separate `pi-switch` extension.
	// It writes `globalThis.__PI_SWITCH_AGENT__` (in-process) and
	// `.soly/agent` (persisted). We read the in-process value first (fresh);
	// fall back to "worker" if pi-switch isn't installed.
	const getCurrentAgent = (): string => {
		return (globalThis as { __PI_SWITCH_AGENT__?: string }).__PI_SWITCH_AGENT__ ?? "worker";
	};

	// Track whether we need to fire ctx.compact() at the end of the upcoming
	// turn. Reset on every user input — only set if the user types
	// "soly compact" (which expands to a handoff + compact request).
	let pendingCompact = false;

	pi.on("input", async (event, ctx) => {
		// Only handle plain interactive text. Skip:
		//   - extension-injected messages (recursion guard)
		//   - RPC / programmatic sources (we want explicit user intent)
		//   - slash commands ("/soly ...") — those go through pi's command
		//     handler in commands.ts, not here
		if (event.source !== "interactive") return;
		if (event.text.trim().startsWith("/")) return;

		const cmd = parseSolyCommand(event.text);
		if (!cmd) return;

		// Notify the parent extension that a soly verb was used
		// (resets the drift counter, etc.). Fires for BOTH "handled"
		// and "transform" actions — both are real workflow usage.
		onWorkflowUsed?.();

		const state = getState();

		// ----- LLM-driven transforms -----

		if (cmd.verb === "execute") {
			const result = buildExecuteTransform(cmd, state, getInteractiveRules(), {
				useSolyWorker: getConfig().agent.useSolyWorkerSubagents,
			});
			if (!result.handled || !result.transformedText) return;
			return { action: "transform", text: result.transformedText };
		}

		if (cmd.verb === "pause" || cmd.verb === "compact") {
			const result = buildPauseTransform(cmd, state);
			if (!result.handled || !result.transformedText) return;
			if (result.triggerCompact) pendingCompact = true;
			return { action: "transform", text: result.transformedText };
		}

		if (cmd.verb === "resume") {
			const result = buildResumeTransform(cmd, state);
			if (!result.handled || !result.transformedText) return;
			return { action: "transform", text: result.transformedText };
		}

		if (cmd.verb === "plan") {
			const result = buildPlanTransform(cmd, state);
			if (!result.handled || !result.transformedText) return;
			return { action: "transform", text: result.transformedText };
		}

		if (cmd.verb === "discuss") {
			const hasAskPro = getActiveTools().includes("ask_pro");
			const result = buildDiscussTransform(cmd, state, { hasAskPro });
			if (!result.handled || !result.transformedText) return;
			return { action: "transform", text: result.transformedText };
		}

		if (cmd.verb === "help") {
			return {
				action: "transform",
				text: `soly subcommand picker (esc to cancel).

Available verbs (all start with \`soly <verb>\` or use \`/soly <verb>\` in slash form):

  position       — one-screen current position summary
  state          — full STATE.md body
  plan           — current PLAN.md body
  context        — current phase CONTEXT.md
  research       — current phase RESEARCH.md
  roadmap        — ROADMAP.md body
  progress       — progress bar + counts
  phases         — list all phases with C/R markers
  tasks          — list all tasks grouped by feature (new in v2)
  task <id>      — show one task's PLAN + SUMMARY
  features       — list all features (new in v2)
  milestone      — show the active milestone document
  log [N]        — last N (default 20) decisions from STATE.md
  diff           — git status + uncommitted .soly/ changes
  doctor         — health check: missing files, broken refs, stale iterations
  iterations [N] — list recent iteration files
  todos          — show pi-todo live list (.soly/todos.json or .pi-todos.json)
  phase delete <N> — soft-delete a phase
  reload         — re-read project state from disk
  plan <N>       — produce PLAN.md for phase N
  discuss <N>    — interactive discussion of phase N
  execute <N>    — execute all plans in phase N (or \`execute N.MM\` for one plan)
  pause          — write HANDOFF.json + .continue-here.md
  compact        — pause + auto-compact session
  resume [N]     — restore from handoff (scoped to phase N if given)
  help           — this picker

Unknown / missing verb? Use \`/soly\` (slash) for the picker.`,
			};
		}

		// ----- Direct responses (no LLM round-trip) -----

		if (cmd.verb === "status") {
			showStatus(cmd, state, ctx.ui, getConfig());
			return { action: "handled" };
		}

		if (cmd.verb === "log") {
			showLog(cmd, state, ctx.ui);
			return { action: "handled" };
		}

		if (cmd.verb === "diff") {
			// Subverb: "soly diff iterations <a> <b>" — compare two iteration files
			if (cmd.args[0] === "iterations" || cmd.args[0] === "iter") {
				showDiffIterations(
					{ verb: "diff", args: cmd.args.slice(1), raw: cmd.raw },
					state,
					ctx.ui,
				);
			} else {
				await showDiff(cmd, state, ctx.ui);
			}
			return { action: "handled" };
		}

		if (cmd.verb === "doctor") {
			showDoctor(cmd, state, ctx.ui, getConfig(), getActiveTools());
			return { action: "handled" };
		}

		if (cmd.verb === "iterations") {
			showIterations(cmd, state, ctx.ui);
			return { action: "handled" };
		}

		if (cmd.verb === "todos") {
			showTodos(cmd, state, ctx.ui);
			return { action: "handled" };
		}

		if (cmd.verb === "phase") {
			// "soly phase delete <N>" — soft delete
			if (cmd.args[0] === "delete" || cmd.args[0] === "rm") {
				showPhaseDelete(
					{ verb: "phase", args: cmd.args.slice(1), raw: cmd.raw },
					state,
					ctx.ui,
				);
			} else {
				return {
					action: "transform",
					text: `soly phase — usage:
  soly phase delete <N>   — soft-delete phase N (move to .soly/phases/.trash/)
  soly phase list        — list all phases (same as /soly phases)
  soly phase <N>         — alias for "soly plan <N>" (route through planner)`,
				};
			}
			return { action: "handled" };
		}
	});

	// After the LLM finishes a turn that was triggered by "soly compact",
	// fire ctx.compact() to actually compress the session.
	pi.on("agent_end", async (_event, ctx) => {
		if (!pendingCompact) return;
		pendingCompact = false;
		ctx.compact({
			customInstructions:
				"Session was paused via `soly compact`. Handoff files are in .soly/HANDOFF.json " +
				"and .soly/.continue-here.md. Preserve milestone/phase/plan position and key " +
				"decisions in the summary. Drop implementation-detail noise.",
			onComplete: () => {
				ctx.ui.notify("soly: session compacted. Use `soly resume` to pick up.", "info");
			},
			onError: (err) => {
				ctx.ui.notify(`soly: compact failed — ${err.message}`, "error");
			},
		});
	});
}

/** Re-export for callers that want to inspect the parsed command. */
export type { SolyCommand };
