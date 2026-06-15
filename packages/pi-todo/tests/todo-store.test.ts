// =============================================================================
// tests/todo-store.test.ts — Tests for pi-todo core data model
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	validateTodos,
	buildStatusLine,
	persistTodos,
	loadTodos,
	todoFilePath,
	MAX_TODOS,
	MAX_CONTENT_LEN,
	type TodoState,
	type TodoItem,
} from "../todo-store.js";

let tmpRoot: string;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-todo-store-"));
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// validateTodos
// ---------------------------------------------------------------------------

describe("validateTodos", () => {
	test("empty list → valid empty state", () => {
		const r = validateTodos([]);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.state.todos).toEqual([]);
	});

	test("valid 3-item list", () => {
		const r = validateTodos([
			{ content: "Add user model", status: "in_progress", activeForm: "Adding user model" },
			{ content: "Add auth", status: "pending", activeForm: "Adding auth" },
			{ content: "Wire routes", status: "pending", activeForm: "Wiring routes" },
		]);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.state.todos.length).toBe(3);
			expect(r.state.todos[0]!.status).toBe("in_progress");
		}
	});

	test("non-array input → error", () => {
		const r = validateTodos("not an array");
		expect(r.ok).toBe(false);
	});

	test("non-object item → error", () => {
		const r = validateTodos(["string instead of object"]);
		expect(r.ok).toBe(false);
	});

	test("missing content → error", () => {
		const r = validateTodos([{ content: "", status: "pending", activeForm: "x" }]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]!.field).toBe("todos[0].content");
	});

	test("whitespace-only content → error (trimmed)", () => {
		const r = validateTodos([{ content: "   ", status: "pending", activeForm: "x" }]);
		expect(r.ok).toBe(false);
	});

	test("missing activeForm → error", () => {
		const r = validateTodos([{ content: "x", status: "pending", activeForm: "" }]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]!.field).toBe("todos[0].activeForm");
	});

	test("invalid status → error", () => {
		const r = validateTodos([{ content: "x", status: "frobnicated", activeForm: "x" }]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]!.field).toBe("todos[0].status");
	});

	test(`more than ${MAX_TODOS} items → error`, () => {
		const items = Array.from({ length: MAX_TODOS + 1 }, (_, i) => ({
			content: `task ${i}`,
			status: "pending" as const,
			activeForm: `doing ${i}`,
		}));
		const r = validateTodos(items);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]!.message).toContain("max " + MAX_TODOS);
	});

	test("multiple in_progress → error", () => {
		const r = validateTodos([
			{ content: "a", status: "in_progress", activeForm: "A" },
			{ content: "b", status: "in_progress", activeForm: "B" },
		]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.some((e) => e.message.includes("in_progress"))).toBe(true);
	});

	test("exactly 1 in_progress is allowed", () => {
		const r = validateTodos([
			{ content: "a", status: "pending", activeForm: "A" },
			{ content: "b", status: "in_progress", activeForm: "B" },
			{ content: "c", status: "completed", activeForm: "C" },
		]);
		expect(r.ok).toBe(true);
	});

	test("zero in_progress is allowed (all pending or all completed)", () => {
		const r = validateTodos([
			{ content: "a", status: "pending", activeForm: "A" },
			{ content: "b", status: "completed", activeForm: "B" },
		]);
		expect(r.ok).toBe(true);
	});

	test("content > MAX_CONTENT_LEN → error", () => {
		const longContent = "x".repeat(MAX_CONTENT_LEN + 1);
		const r = validateTodos([{ content: longContent, status: "pending", activeForm: "A" }]);
		expect(r.ok).toBe(false);
	});

	test("duplicate content → error", () => {
		const r = validateTodos([
			{ content: "same", status: "pending", activeForm: "A" },
			{ content: "same", status: "pending", activeForm: "B" },
		]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]!.message).toContain("duplicate");
	});

	test("multiple errors collected, not just first", () => {
		const r = validateTodos([
			{ content: "", status: "frob", activeForm: "" },
			{ content: "ok", status: "pending", activeForm: "ok" },
		]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.length).toBeGreaterThan(1);
	});
});

// ---------------------------------------------------------------------------
// buildStatusLine
// ---------------------------------------------------------------------------

describe("buildStatusLine", () => {
	const items = (n: number, status: TodoItem["status"] = "pending"): TodoItem[] =>
		Array.from({ length: n }, (_, i) => ({
			content: `t${i}`,
			status,
			activeForm: `doing t${i}`,
		}));

	test("empty state → empty string (don't show the line)", () => {
		const state: TodoState = { todos: [], updatedAt: 0 };
		expect(buildStatusLine(state)).toBe("");
	});

	test("all pending → 'todos 0/N'", () => {
		const state: TodoState = { todos: items(5), updatedAt: 0 };
		expect(buildStatusLine(state)).toBe("todos 0/5");
	});

	test("some completed → 'todos K/N'", () => {
		const ts = items(5);
		ts[0]!.status = "completed";
		ts[1]!.status = "completed";
		const state: TodoState = { todos: ts, updatedAt: 0 };
		expect(buildStatusLine(state)).toBe("todos 2/5");
	});

	test("with in_progress → shows activeForm", () => {
		const ts = items(5);
		ts[0]!.status = "completed";
		ts[1]!.status = "in_progress";
		ts[1]!.activeForm = "Doing the thing";
		const state: TodoState = { todos: ts, updatedAt: 0 };
		expect(buildStatusLine(state)).toBe("todos 1/5 ⋯ Doing the thing");
	});

	test("all completed → 'all done' marker", () => {
		const state: TodoState = { todos: items(3, "completed"), updatedAt: 0 };
		expect(buildStatusLine(state)).toBe("todos 3/3 ✓ all done");
	});
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("persistence", () => {
	test("todoFilePath prefers .soly/todos.json when .soly/ exists", () => {
		const cwd = path.join(tmpRoot, "with-soly");
		fs.mkdirSync(path.join(cwd, ".soly"), { recursive: true });
		expect(todoFilePath(cwd)).toBe(path.join(cwd, ".soly", "todos.json"));
	});

	test("todoFilePath falls back to .pi-todos.json when no .soly/", () => {
		const cwd = path.join(tmpRoot, "no-soly");
		fs.mkdirSync(cwd, { recursive: true });
		expect(todoFilePath(cwd)).toBe(path.join(cwd, ".pi-todos.json"));
	});

	test("persistTodos + loadTodos round-trip (soly mode)", () => {
		const cwd = path.join(tmpRoot, "rt-soly");
		fs.mkdirSync(path.join(cwd, ".soly"), { recursive: true });
		const state: TodoState = {
			todos: [
				{ content: "x", status: "completed", activeForm: "X" },
				{ content: "y", status: "in_progress", activeForm: "Y" },
			],
			updatedAt: 12345,
		};
		persistTodos(cwd, state);
		const loaded = loadTodos(cwd);
		expect(loaded).not.toBeNull();
		expect(loaded!.todos.length).toBe(2);
		expect(loaded!.todos[1]!.status).toBe("in_progress");
	});

	test("persistTodos + loadTodos round-trip (standalone mode)", () => {
		const cwd = path.join(tmpRoot, "rt-standalone");
		fs.mkdirSync(cwd, { recursive: true });
		const state: TodoState = {
			todos: [{ content: "only", status: "pending", activeForm: "Only" }],
			updatedAt: 999,
		};
		persistTodos(cwd, state);
		const loaded = loadTodos(cwd);
		expect(loaded).not.toBeNull();
		expect(loaded!.todos[0]!.content).toBe("only");
	});

	test("loadTodos returns null when file missing", () => {
		const cwd = path.join(tmpRoot, "missing");
		fs.mkdirSync(cwd, { recursive: true });
		expect(loadTodos(cwd)).toBeNull();
	});

	test("loadTodos returns null for corrupt JSON", () => {
		const cwd = path.join(tmpRoot, "corrupt");
		fs.mkdirSync(path.join(cwd, ".soly"), { recursive: true });
		fs.writeFileSync(path.join(cwd, ".soly", "todos.json"), "{not json");
		expect(loadTodos(cwd)).toBeNull();
	});

	test("loadTodos validates on read (invalid → null)", () => {
		const cwd = path.join(tmpRoot, "bad-shape");
		fs.mkdirSync(path.join(cwd, ".soly"), { recursive: true });
		// Valid JSON but invalid shape (status is wrong)
		fs.writeFileSync(
			path.join(cwd, ".soly", "todos.json"),
			JSON.stringify({ todos: [{ content: "x", status: "frob", activeForm: "x" }] }),
		);
		expect(loadTodos(cwd)).toBeNull();
	});

	test("persistTodos to .soly/ creates intermediate dirs (mkdir recursive)", () => {
		const cwd = path.join(tmpRoot, "with-soly-mkdir");
		fs.mkdirSync(path.join(cwd, ".soly"), { recursive: true });
		// No phases/ subdir — write to .soly/todos.json
		persistTodos(cwd, { todos: [], updatedAt: 0 });
		expect(fs.existsSync(path.join(cwd, ".soly", "todos.json"))).toBe(true);
	});
});
