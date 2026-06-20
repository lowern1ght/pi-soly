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
		expect(s).toMatch(/related questions/i);
		expect(s).toContain("soly discuss");
	});

	test("explains when NOT to use it (anti-patterns)", () => {
		expect(s).toMatch(/NOT for/i);
		expect(s).toMatch(/yes\/no/i);
		expect(s).toMatch(/open-ended/i);
	});

	test("mentions the key per-question capabilities", () => {
		expect(s).toContain("preview");
		expect(s).toContain("freeText");
		expect(s).toMatch(/skip/i);
	});

	test("is reasonably short (< 1.2 KB) to not bloat every turn", () => {
		// Sanity check — the cost is paid on every turn (before_agent_start).
		// Detailed schema/keyboard contract lives in the tool definition, not here.
		expect(s.length).toBeLessThan(1200);
	});

	test("is a pure function (same output across calls)", () => {
		expect(buildAskProSection()).toBe(s);
	});
});
