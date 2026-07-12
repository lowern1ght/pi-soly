// =============================================================================
// tests/fuzzy.test.ts — shared fuzzyScore unit tests
// =============================================================================

import { describe, test, expect } from "bun:test";
import { fuzzyScore } from "../visual/fuzzy.ts";

describe("fuzzyScore", () => {
	test("empty query matches everything (score 1)", () => {
		expect(fuzzyScore("", "anything")).toBe(1);
		expect(fuzzyScore("", "")).toBe(1);
	});

	test("exact substring match scores highest (>100)", () => {
		const score = fuzzyScore("cat", "category");
		expect(score).toBeGreaterThan(100);
	});

	test("substring match score reflects density", () => {
		// Shorter text with same query → higher density → higher score
		const longText = fuzzyScore("cat", "catastrophic");
		const shortText = fuzzyScore("cat", "cat");
		expect(shortText).toBeGreaterThan(longText);
	});

	test("case-insensitive substring match", () => {
		expect(fuzzyScore("CAT", "category")).toBeGreaterThan(100);
		expect(fuzzyScore("cat", "CATEGORY")).toBeGreaterThan(100);
	});

	test("in-order subsequence matches (score >0, <100)", () => {
		// "c-a-t" in "contact" — not contiguous but in order
		const score = fuzzyScore("cat", "contact");
		expect(score).toBeGreaterThan(0);
		expect(score).toBeLessThan(100);
	});

	test("out-of-order does not match (score 0)", () => {
		// "tac" is not a subsequence of "cat" (wrong order)
		expect(fuzzyScore("tac", "cat")).toBe(0);
	});

	test("missing characters do not match (score 0)", () => {
		expect(fuzzyScore("xyz", "category")).toBe(0);
	});

	test("partial subsequence (not all chars found) = 0", () => {
		// "ctx" in "cat" — c matches, t matches, but x doesn't
		expect(fuzzyScore("ctx", "cat")).toBe(0);
	});

	test("identical query and text", () => {
		expect(fuzzyScore("hello", "hello")).toBeGreaterThan(100);
	});
});
