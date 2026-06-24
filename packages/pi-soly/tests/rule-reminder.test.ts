// =============================================================================
// tests/rule-reminder.test.ts — pre-action rule reminder helpers
// =============================================================================
//
// Covers `getApplicableRulesForFile` (per-file rule filter) and
// `formatRuleReminder` (compact markdown the LLM sees right after
// editing). The reminder is the per-edit reinforcement that closes
// the "rules read at turn start, forgotten by edit time" gap.

import { describe, expect, test } from "bun:test";
import {
	formatRuleReminder,
	getApplicableRulesForFile,
	type RuleFile,
	type RuleFrontmatter,
} from "../core.ts";

/** Tiny factory: builds a RuleFile with sensible defaults for testing. */
function rule(
	relPath: string,
	meta: RuleFrontmatter,
	overrides: Partial<RuleFile> = {},
): RuleFile {
	return {
		relPath,
		absPath: `/fake/${relPath}`,
		meta,
		body: `# ${relPath}\n\nbody`,
		raw: `---\n---\n\nbody`,
		enabled: true,
		mtimeMs: 0,
		source: "project-soly",
		sourceLabel: "soly",
		priority: 0,
		interactiveOnly: false,
		...overrides,
	};
}

describe("getApplicableRulesForFile", () => {
	test("glob match: ts files in src/", () => {
		const rules = [
			rule("ts-style.md", { globs: ["src/**/*.ts"] }),
			rule("md-style.md", { globs: ["**/*.md"] }),
		];
		const r = getApplicableRulesForFile("src/index.ts", rules);
		expect(r.map((x) => x.relPath)).toEqual(["ts-style.md"]);
	});

	test("always:true applies to every file", () => {
		const rules = [
			rule("global.md", { always: true, description: "Global rule" }),
			rule("ts-style.md", { globs: ["**/*.ts"] }),
		];
		const r = getApplicableRulesForFile("README.md", rules);
		expect(r.map((x) => x.relPath)).toEqual(["global.md"]);
	});

	test("no globs + no always = universal (matches everything)", () => {
		const rules = [rule("blank.md", {})];
		expect(getApplicableRulesForFile("anything.txt", rules).length).toBe(1);
	});

	test("disabled rules are excluded", () => {
		const rules = [
			rule("on.md", { always: true }, { enabled: true }),
			rule("off.md", { always: true }, { enabled: false }),
		];
		const r = getApplicableRulesForFile("foo.ts", rules);
		expect(r.map((x) => x.relPath)).toEqual(["on.md"]);
	});

	test("no match returns empty", () => {
		const rules = [rule("py.md", { globs: ["**/*.py"] })];
		expect(getApplicableRulesForFile("index.ts", rules)).toEqual([]);
	});

	test("multiple globs on one rule = OR-match", () => {
		const rules = [
			rule("code.md", { globs: ["src/**/*.ts", "lib/**/*.ts"] }),
		];
		expect(getApplicableRulesForFile("lib/util.ts", rules).length).toBe(1);
	});
});

describe("formatRuleReminder", () => {
	test("empty list returns empty string (caller should skip injection)", () => {
		expect(formatRuleReminder([], "x.ts")).toBe("");
	});

	test("single rule: shows path, description, and confirm prompt", () => {
		const rules = [rule("ts.md", { description: "Strict mode required" })];
		const out = formatRuleReminder(rules, "src/index.ts");
		expect(out).toContain("src/index.ts");
		expect(out).toContain("ts.md");
		expect(out).toContain("Strict mode required");
		expect(out.toLowerCase()).toContain("confirm");
	});

	test("caps at 3 by default; mentions overflow", () => {
		const rules = [
			rule(`r${1}.md`, { description: "d1" }),
			rule(`r${2}.md`, { description: "d2" }),
			rule(`r${3}.md`, { description: "d3" }),
			rule(`r${4}.md`, { description: "d4" }),
			rule(`r${5}.md`, { description: "d5" }),
		];
		const out = formatRuleReminder(rules, "x.ts");
		expect(out).toContain("r1.md");
		expect(out).toContain("r2.md");
		expect(out).toContain("r3.md");
		expect(out).not.toContain("r4.md");
		expect(out).not.toContain("r5.md");
		expect(out).toContain("2 more");
	});

	test("priority order: high before medium before low", () => {
		const rules = [
			rule("low.md", { description: "L", priority: "low" }),
			rule("high.md", { description: "H", priority: "high" }),
			rule("med.md", { description: "M", priority: "medium" }),
		];
		const out = formatRuleReminder(rules, "x.ts");
		const hPos = out.indexOf("high.md");
		const mPos = out.indexOf("med.md");
		const lPos = out.indexOf("low.md");
		expect(hPos).toBeLessThan(mPos);
		expect(mPos).toBeLessThan(lPos);
	});

	test("custom cap honored", () => {
		const rules = [
			rule("a.md", {}),
			rule("b.md", {}),
			rule("c.md", {}),
		];
		const out = formatRuleReminder(rules, "x.ts", 2);
		expect(out).toContain("a.md");
		expect(out).toContain("b.md");
		expect(out).not.toContain("c.md");
		expect(out).toContain("1 more");
	});

	test("rule without description omits the dash", () => {
		const out = formatRuleReminder([rule("bare.md", {})], "x.ts");
		expect(out).toContain("bare.md");
		expect(out).not.toContain("—"); // em-dash should be absent when no description
	});
});
