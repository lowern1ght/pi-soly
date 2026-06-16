// =============================================================================
// tests/prompt.test.ts — Tests for the system-prompt section + recommendAgent
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { buildPiSwitchSection, recommendAgent, TASK_AGENT_HINTS } from "../prompt.js";

describe("buildPiSwitchSection", () => {
	const s = buildPiSwitchSection();

	test("starts with header", () => {
		expect(s.trim().startsWith("## pi-switch")).toBe(true);
	});
	test("mentions /agent command and Ctrl+Tab", () => {
		expect(s).toContain("/agent");
		expect(s).toContain("Ctrl+Tab");
	});
	test("explains built-in categories", () => {
		expect(s).toContain("oracle");
		expect(s).toContain("scout");
		expect(s).toContain("worker");
	});
	test("mentions worker as the main cycle rotor", () => {
		expect(s).toContain("worker");
	});
	test("explains user-defined", () => {
		expect(s).toMatch(/user[- ]?defined/i);
		expect(s).toContain("~/.pi/agent/agents/");
	});
	test("has anti-patterns", () => {
		expect(s).toContain("DON");
	});
	test("includes task→agent heuristics table", () => {
		expect(s).toContain("debug");
		expect(s).toContain("refactor");
	});
	test("is reasonably short (< 5KB)", () => {
		expect(s.length).toBeLessThan(5000);
	});
});

describe("TASK_AGENT_HINTS", () => {
	test("every hint has required fields", () => {
		for (const h of TASK_AGENT_HINTS) {
			expect(h.agent.length).toBeGreaterThan(0);
			expect(h.emoji.length).toBeGreaterThan(0);
			expect(h.why.length).toBeGreaterThan(5);
			expect(h.pattern).toBeInstanceOf(RegExp);
		}
	});
});

describe("recommendAgent", () => {
	test("research keywords → researcher (English)", () => {
		expect(recommendAgent("look up the latest pi-subagents API")?.agent).toBe("researcher");
		expect(recommendAgent("what is the best lib for X?")?.agent).toBe("researcher");
	});
	test("research keywords → researcher (Russian)", () => {
		expect(recommendAgent("Изучи React Server Components")?.agent).toBe("researcher");
		expect(recommendAgent("Найди инфу про Zustand")?.agent).toBe("researcher");
	});
	test("debug keywords → worker", () => {
		expect(recommendAgent("fix this bug")?.agent).toBe("worker");
		expect(recommendAgent("why is this crash happening")?.agent).toBe("worker");
		expect(recommendAgent("repro the failing test")?.agent).toBe("worker");
		expect(recommendAgent("Почему падает тест?")?.agent).toBe("worker");
	});
	test("refactor keywords → worker", () => {
		expect(recommendAgent("refactor this function")?.agent).toBe("worker");
		expect(recommendAgent("simplify the auth flow")?.agent).toBe("worker");
		expect(recommendAgent("Упрости эту функцию")?.agent).toBe("worker");
	});
	test("test keywords → worker", () => {
		expect(recommendAgent("write tests for the parser")?.agent).toBe("worker");
		expect(recommendAgent("improve coverage")?.agent).toBe("worker");
		expect(recommendAgent("Напиши тесты для парсера")?.agent).toBe("worker");
	});
	test("review keywords → reviewer", () => {
		expect(recommendAgent("review this PR")?.agent).toBe("reviewer");
		expect(recommendAgent("audit the security")?.agent).toBe("reviewer");
		expect(recommendAgent("Проверь этот код")?.agent).toBe("reviewer");
	});
	test("docs keywords → worker", () => {
		expect(recommendAgent("update the readme")?.agent).toBe("worker");
		expect(recommendAgent("add jsdoc to the function")?.agent).toBe("worker");
		expect(recommendAgent("Обнови документацию")?.agent).toBe("worker");
	});
	test("plan keywords → worker", () => {
		expect(recommendAgent("plan the migration")?.agent).toBe("worker");
		expect(recommendAgent("design the API")?.agent).toBe("worker");
		expect(recommendAgent("Спланируй миграцию")?.agent).toBe("worker");
	});
	test("implement keywords → worker", () => {
		expect(recommendAgent("implement the feature")?.agent).toBe("worker");
		expect(recommendAgent("build the auth module")?.agent).toBe("worker");
		expect(recommendAgent("Сделай эту фичу")?.agent).toBe("worker");
	});
	test("no match → null", () => {
		expect(recommendAgent("hello world")).toBeNull();
		expect(recommendAgent("")).toBeNull();
	});
	test("returns emoji and why", () => {
		const r = recommendAgent("fix this bug");
		expect(r?.emoji).toBeTruthy();
		expect(r?.why).toBeTruthy();
	});
});
