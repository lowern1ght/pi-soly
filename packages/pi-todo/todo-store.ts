// =============================================================================
// todo-store.ts — In-memory + persistent todo state for pi-todo
// =============================================================================
//
// State model:
//   - TodoItem: { content, status, activeForm }
//   - TodoState: { todos: TodoItem[], updatedAt }
//
// Validation rules (enforced by `validate`):
//   - At most MAX_TODOS items (10)
//   - At most ONE in_progress at a time
//   - status must be one of "pending" | "in_progress" | "completed"
//   - content + activeForm non-empty
//
// Persistence:
//   - Primary: <cwd>/.soly/todos.json (soly integration mode)
//   - Fallback: <cwd>/.pi-todos.json (standalone)
//   - File is written atomically (write-then-rename) to avoid corruption
//     if the process is killed mid-write.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
	/** Short imperative: "Add user model". 1-2 lines max. */
	content: string;
	/** Live state. */
	status: TodoStatus;
	/** Present continuous: "Adding user model". Shown next to in_progress. */
	activeForm: string;
}

export interface TodoState {
	todos: TodoItem[];
	updatedAt: number;
}

/** Hard limit — more is noise. */
export const MAX_TODOS = 10;
export const MAX_CONTENT_LEN = 200;

export interface ValidationError {
	field: string;
	message: string;
}

export type ValidationResult =
	| { ok: true; state: TodoState }
	| { ok: false; errors: ValidationError[] };

/** Validate a list of TodoItem inputs. Returns a normalized state or errors. */
export function validateTodos(items: unknown): ValidationResult {
	if (!Array.isArray(items)) {
		return { ok: false, errors: [{ field: "todos", message: "must be an array" }] };
	}
	if (items.length === 0) {
		return { ok: true, state: { todos: [], updatedAt: Date.now() } };
	}
	if (items.length > MAX_TODOS) {
		return {
			ok: false,
			errors: [
				{ field: "todos", message: `max ${MAX_TODOS} items allowed, got ${items.length}` },
			],
		};
	}
	const errors: ValidationError[] = [];
	const todos: TodoItem[] = [];
	let inProgressCount = 0;
	const seenContents = new Set<string>();

	for (let i = 0; i < items.length; i++) {
		const raw = items[i];
		if (typeof raw !== "object" || raw === null) {
			errors.push({ field: `todos[${i}]`, message: "must be an object" });
			continue;
		}
		const obj = raw as Record<string, unknown>;
		const content = typeof obj.content === "string" ? obj.content.trim() : "";
		const activeForm = typeof obj.activeForm === "string" ? obj.activeForm.trim() : "";
		const status = obj.status as TodoStatus;

		if (!content) {
			errors.push({ field: `todos[${i}].content`, message: "required" });
		} else if (content.length > MAX_CONTENT_LEN) {
			errors.push({
				field: `todos[${i}].content`,
				message: `max ${MAX_CONTENT_LEN} chars, got ${content.length}`,
			});
		} else if (seenContents.has(content)) {
			errors.push({
				field: `todos[${i}].content`,
				message: `duplicate content: "${content}"`,
			});
		} else {
			seenContents.add(content);
		}
		if (!activeForm) {
			errors.push({ field: `todos[${i}].activeForm`, message: "required" });
		}
		if (status !== "pending" && status !== "in_progress" && status !== "completed") {
			errors.push({
				field: `todos[${i}].status`,
				message: `must be "pending" | "in_progress" | "completed", got ${JSON.stringify(status)}`,
			});
		}
		if (status === "in_progress") inProgressCount++;

		todos.push({ content, activeForm, status });
	}

	if (inProgressCount > 1) {
		errors.push({
			field: "todos",
			message: `at most 1 in_progress allowed, got ${inProgressCount}`,
		});
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, state: { todos, updatedAt: Date.now() } };
}

/** Derive the status line (compact form) from a state.
 *  Returns "" when there are no todos (so the caller can hide the line). */
export function buildStatusLine(state: TodoState): string {
	if (state.todos.length === 0) return "";
	const total = state.todos.length;
	const completed = state.todos.filter((t) => t.status === "completed").length;
	const inProgress = state.todos.find((t) => t.status === "in_progress");
	if (inProgress) {
		return `todos ${completed}/${total} ⋯ ${inProgress.activeForm}`;
	}
	if (completed === total) {
		return `todos ${completed}/${total} ✓ all done`;
	}
	return `todos ${completed}/${total}`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Pick a stable on-disk path for the current cwd. Prefers .soly/ for
 *  soly integration; falls back to .pi-todos.json. */
export function todoFilePath(cwd: string): string {
	const solyDir = path.join(cwd, ".soly");
	if (fs.existsSync(solyDir)) return path.join(solyDir, "todos.json");
	return path.join(cwd, ".pi-todos.json");
}

/** Atomic write: write to .tmp, then rename. Avoids corruption on crash. */
export function persistTodos(cwd: string, state: TodoState): void {
	const target = todoFilePath(cwd);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const tmp = target + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
	fs.renameSync(tmp, target);
}

/** Read the persisted state. Returns null if file missing or corrupt. */
export function loadTodos(cwd: string): TodoState | null {
	const file = todoFilePath(cwd);
	try {
		if (!fs.existsSync(file)) return null;
		const raw = fs.readFileSync(file, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) return null;
		const obj = parsed as Record<string, unknown>;
		if (!Array.isArray(obj.todos)) return null;
		// Re-validate on load — schema may have evolved
		const result = validateTodos(obj.todos);
		return result.ok ? result.state : null;
	} catch {
		return null;
	}
}
