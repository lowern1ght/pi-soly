// =============================================================================
// tests/rules-reinforcement.test.ts — verify rules section has mandatory header
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { buildRulesSection, type RuleFile } from "../core.js";

const makeRule = (overrides: Partial<RuleFile> = {}): RuleFile => ({
	relPath: "test.md",
	absPath: "/test.md",
	meta: { description: "test rule", always: true },
	body: "Always use strict mode.",
	raw: "---\nalways: true\ndescription: test rule\n---\nAlways use strict mode.",
	enabled: true,
	mtimeMs: 0,
	source: "project-soly",
	sourceLabel: "local",
	priority: 0,
	interactiveOnly: false,
	...overrides,
});

describe("rules reinforcement", () => {
	test("section header is MANDATORY", () => {
		const { section } = buildRulesSection([makeRule()]);
		expect(section).toContain("MANDATORY");
		expect(section).toContain("NON-NEGOTIABLE");
		expect(section).toContain("⚠️");
	});

	test("does NOT instruct the model to re-read rules before editing", () => {
		// The "Before writing or editing ANY code, re-read the rules …" sentence
		// was removed: it made the LLM echo "Apply rules." in chat on every turn,
		// which is noise, not signal. Rules stay in the system prompt (mandatory,
		// rule-wins-over-instinct); the LLM just no longer gets a per-turn script
		// to narrate. Regression guard.
		const { section } = buildRulesSection([makeRule()]);
		expect(section.toLowerCase()).not.toContain("before writing or editing");
	});

	test("rule-wins-over-instinct is preserved", () => {
		const { section } = buildRulesSection([makeRule()]);
		expect(section).toContain("rule wins");
	});

	test("section works without rules (no crash)", () => {
		const { section } = buildRulesSection([]);
		// Empty section is fine — no mandatory header without rules
		expect(section).toBe("");
	});

	test("disabled rules are not included in section", () => {
		const { section } = buildRulesSection([makeRule({ enabled: false })]);
		expect(section).toBe("");
	});

	test("loaded list contains applicable rules", () => {
		const { loaded } = buildRulesSection([makeRule()]);
		expect(loaded.some((k) => k.endsWith("test.md"))).toBe(true);
	});
});