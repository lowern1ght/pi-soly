// =============================================================================
// tests/prompt.test.ts — Tests for the system-prompt section
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { buildTodoSection } from "../prompt.js";

describe("buildTodoSection", () => {
	const s = buildTodoSection();

	test("starts with header", () => {
		expect(s.trim().startsWith("## pi-todo")).toBe(true);
	});

	test("mentions todo_update tool", () => {
		expect(s).toContain("todo_update");
	});

	test("DO list covers best practices", () => {
		expect(s).toMatch(/Seed todos/i);
		expect(s).toMatch(/in_progress/i);
		expect(s).toMatch(/activeForm/i);
	});

	test("DON'T list covers anti-patterns", () => {
		expect(s).toContain("DON");
		expect(s).toMatch(/single-step/i);
		expect(s).toMatch(/every tool call/i);
		expect(s).toMatch(/more than 10/i);
		expect(s).toMatch(/multiple.*in_progress/i);
	});

	test("explains status transitions", () => {
		expect(s).toContain("pending");
		expect(s).toContain("in_progress");
		expect(s).toContain("completed");
	});

	test("is reasonably short (< 2.5 KB)", () => {
		expect(s.length).toBeLessThan(2500);
	});

	test("pure function (deterministic)", () => {
		expect(buildTodoSection()).toBe(s);
	});
});
