// =============================================================================
// tests/prompt.test.ts — Tests for the system-prompt section
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { buildAskProSection } from "../prompt.js";

describe("buildAskProSection", () => {
	const s = buildAskProSection();

	test("starts with a header", () => {
		expect(s.trim().startsWith("## pi-ask")).toBe(true);
	});

	test("explains when to use ask_pro", () => {
		expect(s).toContain("ask_pro");
		expect(s).toContain("when to use");
		// Use-case coverage
		expect(s).toMatch(/focused choice/i);
		expect(s).toMatch(/2.6 related questions/i);
	});

	test("explains when NOT to use it (anti-patterns)", () => {
		expect(s).toContain("DON");
		expect(s).toMatch(/yes\/no/i);
		expect(s).toMatch(/open-ended/i);
		expect(s).toMatch(/more than 6 questions/i);
	});

	test("documents keyboard shortcuts", () => {
		expect(s).toContain("Space");
		expect(s).toContain("Enter");
		expect(s).toContain("Esc");
		expect(s).toContain("Tab");
	});

	test("reminds about the schema", () => {
		expect(s).toContain("header");
		expect(s).toContain("question");
		expect(s).toContain("options");
		expect(s).toContain("recommended");
	});

	test("is reasonably short (< 2.5 KB) to not bloat every turn", () => {
		// Sanity check — if this grows, consider trimming. The cost is
		// paid on every turn (before_agent_start runs every prompt).
		expect(s.length).toBeLessThan(2500);
	});

	test("is a pure function (same output across calls)", () => {
		expect(buildAskProSection()).toBe(s);
	});
});
