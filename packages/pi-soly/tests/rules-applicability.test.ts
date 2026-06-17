// =============================================================================
// tests/rules-applicability.test.ts — verify rulesApplicableToFiles helper
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { rulesApplicableToFiles, type RuleFile } from "../core.js";

const makeRule = (overrides: Partial<RuleFile> = {}): RuleFile => ({
	relPath: "test.md",
	absPath: "/test.md",
	meta: {},
	body: "",
	raw: "",
	enabled: true,
	mtimeMs: 0,
	source: "project-soly",
	sourceLabel: "local",
	priority: 0,
	interactiveOnly: false,
	...overrides,
});

describe("rulesApplicableToFiles", () => {
	test("returns empty for no rules", () => {
		expect(rulesApplicableToFiles([], ["foo.ts"])).toEqual([]);
	});

	test("returns empty for no files", () => {
		expect(rulesApplicableToFiles([makeRule()], [])).toEqual([]);
	});

	test("always-rule applies to any file", () => {
		const rule = makeRule({ relPath: "always.md", meta: { always: true } });
		expect(rulesApplicableToFiles([rule], ["foo.ts"])).toEqual(["always.md"]);
	});

	test("glob-rule matches matching file", () => {
		const rule = makeRule({
			relPath: "ts-rules.md",
			meta: { globs: ["**/*.ts"] },
		});
		expect(rulesApplicableToFiles([rule], ["src/foo.ts"])).toEqual(["ts-rules.md"]);
	});

	test("glob-rule does not match non-matching file", () => {
		const rule = makeRule({
			relPath: "ts-rules.md",
			meta: { globs: ["**/*.ts"] },
		});
		expect(rulesApplicableToFiles([rule], ["foo.py"])).toEqual([]);
	});

	test("disabled rule is ignored", () => {
		const rule = makeRule({
			relPath: "disabled.md",
			meta: { always: true },
			enabled: false,
		});
		expect(rulesApplicableToFiles([rule], ["foo.ts"])).toEqual([]);
	});

	test("dedupes when same rule applies to multiple files", () => {
		const rule = makeRule({ relPath: "ts-rules.md", meta: { always: true } });
		expect(rulesApplicableToFiles([rule], ["foo.ts", "bar.ts"])).toEqual(["ts-rules.md"]);
	});

	test("multiple rules — returns all that apply", () => {
		const r1 = makeRule({ relPath: "always.md", meta: { always: true } });
		const r2 = makeRule({ relPath: "ts.md", meta: { globs: ["**/*.ts"] } });
		const r3 = makeRule({ relPath: "py.md", meta: { globs: ["**/*.py"] } });
		const result = rulesApplicableToFiles([r1, r2, r3], ["foo.ts"]);
		expect(result).toContain("always.md");
		expect(result).toContain("ts.md");
		expect(result).not.toContain("py.md");
	});

	test("multiple globs on one rule — file matches any", () => {
		const rule = makeRule({
			relPath: "frontend.md",
			meta: { globs: ["**/*.tsx", "**/*.css"] },
		});
		expect(rulesApplicableToFiles([rule], ["app.tsx"])).toEqual(["frontend.md"]);
		expect(rulesApplicableToFiles([rule], ["style.css"])).toEqual(["frontend.md"]);
		expect(rulesApplicableToFiles([rule], ["main.ts"])).toEqual([]);
	});
});