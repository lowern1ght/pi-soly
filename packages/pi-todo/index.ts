// =============================================================================
// index.ts — pi-todo extension entry point
// =============================================================================
//
// Registers one LLM tool: `todo_update`. Lets the LLM maintain a live,
// visible task list that the user sees in the footer as the agent works.
//
// Design notes:
//   - State is in-memory (per extension instance) + persisted to disk on
//     every change. Path: `<cwd>/.soly/todos.json` if `.soly/` exists
//     (soly integration), else `<cwd>/.pi-todos.json`.
//   - On session_start we load any persisted state so the user can resume
//     mid-task across sessions.
//   - Validation enforces "exactly 0 or 1 in_progress" and max 10 items.
//   - Status line shows compact form: "todos 2/5 ⋯ Doing the thing".
//
// Integrates with soly:
//   - soly checks `pi.getActiveTools()` for `todo_update` and adds a hint
//     in its system prompt
//   - soly workflow templates (execute-plan.md) tell the LLM to seed todos
//     from the plan's acceptance criteria
//   - soly's status line shows todo count when `.soly/todos.json` exists
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import {
	validateTodos,
	buildStatusLine,
	persistTodos,
	loadTodos,
	MAX_TODOS,
	type TodoState,
} from "./todo-store.ts";
import { buildTodoSection } from "./prompt.ts";

const STATUS_ID = "pi-todo";

export default function piTodoExtension(pi: ExtensionAPI) {
	let cwd = "";
	let state: TodoState = { todos: [], updatedAt: 0 };
	/** Stored reference to the most recent UI context — pi-todo has no
	 *  long-lived "current UI" handle, so we capture the latest ctx.ui
	 *  whenever an event fires and reuse it for refreshStatus(). */
	let lastUi: { setStatus: (key: string, text: string | undefined) => void } | null = null;

	function refreshStatus(): void {
		if (!lastUi) return;
		const line = buildStatusLine(state);
		lastUi.setStatus(STATUS_ID, line || undefined);
	}

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		lastUi = ctx.ui;
		const loaded = loadTodos(cwd);
		if (loaded) {
			state = loaded;
			refreshStatus();
		}
	});

	// Capture the latest UI context for refreshStatus() (called from the
	// tool's execute, which has its own ctx, but we want a fallback).
	pi.on("before_agent_start", async (event, ctx) => {
		lastUi = ctx.ui;
		return {
			systemPrompt: event.systemPrompt + buildTodoSection(),
		};
	});

	pi.on("turn_end", async (_event, ctx) => {
		lastUi = ctx.ui;
	});

	pi.registerTool({
		name: "todo_update",
		label: "pi-todo todo_update",
		description:
			"Update the live task list shown in the footer. Full-replace: pass the complete desired list. Use at the start of any multi-step work (≥3 steps) to give the user visibility. Schema: {todos: [{content, status: 'pending'|'in_progress'|'completed', activeForm}]}. Rules: at most 10 items, exactly 0 or 1 in_progress. Set `activeForm` to present-continuous ('Adding user model') so the footer shows the live action.",
		parameters: Type.Object({
			todos: Type.Array(
				Type.Object({
					content: Type.String({
						description: "Short imperative description (1 short line, max 200 chars).",
					}),
					status: Type.Union(
						[Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")],
						{ description: "pending = not started, in_progress = currently working (exactly 1), completed = done." },
					),
					activeForm: Type.String({
						description: "Present-continuous form ('Adding user model') shown next to in_progress.",
					}),
				}),
				{
					description: `Full list of todos. Empty array = clear. Max ${MAX_TODOS} items.`,
				},
			),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = validateTodos(params.todos);
			if (!result.ok) {
				const msg = result.errors
					.map((e) => `  - ${e.field}: ${e.message}`)
					.join("\n");
				return {
					content: [
						{
							type: "text",
							text: `todo_update validation failed:\n${msg}`,
						},
					],
					details: { error: "validation", errors: result.errors },
				};
			}

			state = result.state;

			// Persist (best-effort — don't fail the tool if disk is read-only)
			if (cwd) {
				try {
					persistTodos(cwd, state);
				} catch (err) {
					ctx?.ui?.notify?.(
						`pi-todo: persist failed (${(err as Error).message}) — state kept in memory only`,
						"warning",
					);
				}
			}

			refreshStatus();

			// Pretty echo for the LLM
			const lines: string[] = [];
			if (state.todos.length === 0) {
				lines.push("(todo list cleared)");
			} else {
				const total = state.todos.length;
				const done = state.todos.filter((t) => t.status === "completed").length;
				lines.push(`Todo list updated: ${done}/${total} done.`);
				for (const t of state.todos) {
					const mark =
						t.status === "completed" ? "✓" : t.status === "in_progress" ? "⋯" : "○";
					lines.push(`  ${mark} ${t.content}${t.status === "in_progress" ? ` (${t.activeForm})` : ""}`);
				}
			}
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { state, persistedTo: cwd ? path.join(cwd, ".soly", "todos.json") : null },
			};
		},
	});
}
