// =============================================================================
// tests/rules-stats.test.ts — verify buildRulesContextStats + formatter
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import {
	buildRulesContextStats,
	formatRulesContextStats,
	type RuleFile,
} from "../core.js";

const makeRule = (overrides: Partial<RuleFile> = {}): RuleFile => ({
	relPath: "test.md",
	absPath: "/test.md",
	meta: {},
	body: "Sample rule body that is long enough to have some tokens to count for testing purposes.",
	raw: "",
	enabled: true,
	mtimeMs: 0,
	source: "project-soly",
	sourceLabel: "local",
	priority: 0,
	interactiveOnly: false,
	...overrides,
});

describe("buildRulesContextStats", () => {
	test("empty rules → all zeros", () => {
		const stats = buildRulesContextStats([], 40000);
		expect(stats.totalLoaded).toBe(0);
		expect(stats.totalTokens).toBe(0);
		expect(stats.alwaysOn).toEqual([]);
		expect(stats.globMatched).toEqual([]);
		expect(stats.disabled).toEqual([]);
	});

	test("always-rule goes to alwaysOn", () => {
		const r = makeRule({ relPath: "always.md", meta: { always: true } });
		const stats = buildRulesContextStats([r], 40000);
		expect(stats.alwaysOn.length).toBe(1);
		expect(stats.globMatched.length).toBe(0);
		expect(stats.alwaysOn[0]?.always).toBe(true);
	});

	test("glob-rule goes to globMatched", () => {
		const r = makeRule({ relPath: "ts.md", meta: { globs: ["**/*.ts"] } });
		const stats = buildRulesContextStats([r], 40000);
		expect(stats.alwaysOn.length).toBe(0);
		expect(stats.globMatched.length).toBe(1);
		expect(stats.globMatched[0]?.globs).toEqual(["**/*.ts"]);
	});

	test("disabled rule goes to disabled", () => {
		const r = makeRule({ relPath: "off.md", enabled: false });
		const stats = buildRulesContextStats([r], 40000);
		expect(stats.disabled.length).toBe(1);
		expect(stats.alwaysOn.length).toBe(0);
		expect(stats.globMatched.length).toBe(0);
	});

	test("loadedLastTurn flag for always-on rules", () => {
		const r = makeRule({ relPath: "always.md", meta: { always: true } });
		const stats = buildRulesContextStats([r], 40000, {
			promptFiles: [],
			matchedRelPaths: [],
		});
		// always-on rules are always loaded (loadedLastTurn=true by default)
		expect(stats.alwaysOn[0]?.loadedLastTurn).toBe(true);
	});

	test("loadedLastTurn flag for matched glob rule", () => {
		const r = makeRule({ relPath: "ts.md", meta: { globs: ["**/*.ts"] } });
		const stats = buildRulesContextStats([r], 40000, {
			promptFiles: ["src/auth.ts"],
			matchedRelPaths: ["ts.md"],
		});
		expect(stats.globMatched[0]?.loadedLastTurn).toBe(true);
	});

	test("loadedLastTurn=false for unmatched glob rule", () => {
		const r = makeRule({ relPath: "ts.md", meta: { globs: ["**/*.ts"] } });
		const stats = buildRulesContextStats([r], 40000, {
			promptFiles: ["src/auth.ts"],
			matchedRelPaths: [],
		});
		expect(stats.globMatched[0]?.loadedLastTurn).toBe(false);
	});

	test("contextBudgetPct computed correctly", () => {
		const r = makeRule({ relPath: "big.md" });
		// Make body big enough to be 1000 tokens
		r.body = "x".repeat(4000);
		const stats = buildRulesContextStats([r], 40000);
		// 1000 / 40000 = 2.5%
		expect(stats.contextBudgetPct).toBeCloseTo(2.5, 1);
	});

	test("totalTokens sums always + glob", () => {
		const r1 = makeRule({ relPath: "a.md", meta: { always: true } });
		r1.body = "x".repeat(400); // 100 tokens
		const r2 = makeRule({ relPath: "b.md", meta: { globs: ["**/*.ts"] } });
		r2.body = "x".repeat(400); // 100 tokens
		const stats = buildRulesContextStats([r1, r2], 40000);
		expect(stats.totalTokens).toBe(200);
	});

	test("lastTurn.promptFiles propagated", () => {
		const stats = buildRulesContextStats([], 40000, {
			promptFiles: ["foo.ts", "bar.py"],
			matchedRelPaths: [],
		});
		expect(stats.lastTurn.promptFiles).toEqual(["foo.ts", "bar.py"]);
	});
});

describe("formatRulesContextStats", () => {
	test("includes emoji header", () => {
		const stats = buildRulesContextStats([], 40000);
		expect(formatRulesContextStats(stats)).toContain("📊");
	});

	test("shows always-on section", () => {
		const r = makeRule({ relPath: "code.md", meta: { always: true, description: "Code style" } });
		const stats = buildRulesContextStats([r], 40000);
		const out = formatRulesContextStats(stats);
		expect(out).toContain("ALWAYS-ON");
		expect(out).toContain("code.md");
		expect(out).toContain("Code style");
	});

	test("shows glob-matched section with globs", () => {
		const r = makeRule({ relPath: "ts.md", meta: { globs: ["**/*.ts", "**/*.tsx"] } });
		const stats = buildRulesContextStats([r], 40000);
		const out = formatRulesContextStats(stats);
		expect(out).toContain("GLOB-MATCHED");
		expect(out).toContain("**/*.ts");
		expect(out).toContain("**/*.tsx");
	});

	test("shows disabled section", () => {
		const r = makeRule({ relPath: "off.md", enabled: false });
		const stats = buildRulesContextStats([r], 40000);
		const out = formatRulesContextStats(stats);
		expect(out).toContain("DISABLED");
	});

	test("shows prompt files when present", () => {
		const stats = buildRulesContextStats([], 40000, {
			promptFiles: ["src/auth.ts"],
			matchedRelPaths: [],
		});
		const out = formatRulesContextStats(stats);
		expect(out).toContain("src/auth.ts");
	});

	test("shows fallback message when no prompt files", () => {
		const stats = buildRulesContextStats([], 40000);
		const out = formatRulesContextStats(stats);
		expect(out).toContain("no file paths in prompt");
	});
});