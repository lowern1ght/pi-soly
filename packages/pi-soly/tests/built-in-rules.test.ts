// =============================================================================
// tests/built-in-rules.test.ts — built-in rules shipped with the package
// =============================================================================

/// <reference types="bun-types" />
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { builtInRulesDir, loadAllRules, loadBuiltInRules } from "../core.ts";
import type { SourceSpec } from "../core.ts";

describe("built-in rules — directory resolution", () => {
	test("builtInRulesDir() points to a directory that exists", () => {
		const dir = builtInRulesDir();
		expect(fs.existsSync(dir)).toBe(true);
		expect(fs.statSync(dir).isDirectory()).toBe(true);
	});

	test("builtInRulesDir() contains the temp-files rule shipped with 2.1.4", () => {
		const dir = builtInRulesDir();
		expect(fs.existsSync(path.join(dir, "temp-files.md"))).toBe(true);
	});
});

describe("loadBuiltInRules", () => {
	test("returns rules with source='built-in' and priority=10", () => {
		const rules = loadBuiltInRules();
		expect(rules.length).toBeGreaterThan(0);
		for (const r of rules) {
			expect(r.source).toBe("built-in");
			expect(r.sourceLabel).toBe("soly");
			expect(r.priority).toBe(10);
		}
	});

	test("temp-files rule content covers the key invariants", () => {
		const rules = loadBuiltInRules();
		const tf = rules.find((r) => r.relPath === "temp-files.md");
		expect(tf).toBeDefined();
		// The rule must call out the forbidden hardcoded paths AND the OS-correct APIs.
		const body = tf!.body;
		expect(body).toContain("/tmp");
		expect(body).toContain("os.tmpdir()");
		expect(body).toContain("$TMPDIR");
		expect(body).toContain("%TEMP%");
		expect(body).toContain("Path.GetTempPath()");
		// And explain why (sandboxing / Windows path / multi-user).
		expect(body).toMatch(/Windows/i);
		expect(body).toMatch(/macOS/i);
	});

	test("built-in rules parse frontmatter (description etc.) cleanly", () => {
		const rules = loadBuiltInRules();
		for (const r of rules) {
			// No thrown error during load means parseRuleFrontmatter worked.
			// Optionally assert body is non-empty.
			expect(r.body.length).toBeGreaterThan(50);
		}
	});
});

describe("built-in rules — cannot be overridden", () => {
	let tmpProject: string;
	let tmpGlobal: string;

	beforeEach(() => {
		tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "soly-builtin-proj-"));
		tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "soly-builtin-global-"));
		// Put the user's fake temp-files.md in BOTH project and global sources.
		const userRulePath = path.join(tmpProject, "temp-files.md");
		fs.writeFileSync(
			userRulePath,
			"---\ndescription: USER WROTE THIS\n---\nUser's temp-files rule.\n",
			"utf-8",
		);
	});

	afterEach(() => {
		fs.rmSync(tmpProject, { recursive: true, force: true });
		fs.rmSync(tmpGlobal, { recursive: true, force: true });
	});

	test("user rule with same relPath as built-in is dropped (built-in wins)", () => {
		const sources: SourceSpec[] = [
			{ dir: builtInRulesDir(), source: "built-in", sourceLabel: "soly", priority: 10 },
			{ dir: tmpProject, source: "project-agents", sourceLabel: "agents", priority: 3 },
		];
		const result = loadAllRules(sources);
		// The single temp-files.md that wins is the built-in (higher priority).
		const tf = result.rules.filter((r) => r.relPath === "temp-files.md");
		expect(tf.length).toBe(1);
		expect(tf[0]!.source).toBe("built-in");
		expect(tf[0]!.body).not.toContain("USER WROTE THIS");
		// And the user's was tracked as overridden.
		expect(result.overridden).toContain("temp-files.md");
	});

	test("user rule with different relPath coexists with built-in", () => {
		// NOTE: beforeEach also writes temp-files.md to tmpProject, which is
		// overridden by built-in. This test focuses on a non-colliding
		// user rule coexisting with built-in.
		const userRulePath = path.join(tmpProject, "user-custom-rule.md");
		fs.writeFileSync(userRulePath, "User's custom rule.\n", "utf-8");
		const sources: SourceSpec[] = [
			{ dir: builtInRulesDir(), source: "built-in", sourceLabel: "soly", priority: 10 },
			{ dir: tmpProject, source: "project-agents", sourceLabel: "agents", priority: 3 },
		];
		const result = loadAllRules(sources);
		// Built-in temp-files rule still wins (priority 10 > 3).
		expect(result.rules.find((r) => r.relPath === "temp-files.md")).toBeDefined();
		// And the user's custom rule (different relPath) coexists.
		expect(result.rules.find((r) => r.relPath === "user-custom-rule.md")).toBeDefined();
		// Only the colliding temp-files.md is in overridden — nothing else.
		expect(result.overridden).toEqual(["temp-files.md"]);
	});
});

describe("built-in rules — system prompt integration", () => {
	// Smoke test: buildRulesSection is what actually goes into the system
	// prompt. The built-in rule should appear there with its MANDATORY
	// header. (This is the same test the rules-reinforcement suite uses,
	// but it now implicitly includes built-ins.)
	test("buildRulesSection puts built-in rules in a dedicated section above the MANDATORY block", async () => {
		const { buildRulesSection } = await import("../core.ts");
		const sources: SourceSpec[] = [
			{ dir: builtInRulesDir(), source: "built-in", sourceLabel: "soly", priority: 10 },
		];
		const result = loadAllRules(sources);
		const { section } = buildRulesSection(result.rules);
		// The new built-in section header is present.
		expect(section).toContain("🔒 Built-in rules (shipped with soly)");
		expect(section).toContain("temp-files");
		// The rule's body is in the section (the OS-aware content).
		expect(section).toContain("os.tmpdir()");
		expect(section).toContain("$TMPDIR");
		// The MANDATORY contract is preserved on the existing project-rules
		// section header (now only present when there are project rules).
		// With only built-in rules, the MANDATORY header should NOT appear.
		expect(section).not.toContain("MANDATORY: soly project rules");
	});

	test("with both built-in and project rules, the section has both headers in the right order", async () => {
		const { buildRulesSection } = await import("../core.ts");
		// Use a temp project dir with a simple user rule.
		const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), "soly-builtin-coexist-"));
		try {
			fs.writeFileSync(
				path.join(tmpUser, "user-rule.md"),
				"---\nalways: true\ndescription: User rule\n---\nA user-written rule.\n",
			);
			const sources: SourceSpec[] = [
				{ dir: builtInRulesDir(), source: "built-in", sourceLabel: "soly", priority: 10 },
				{ dir: tmpUser, source: "project-agents", sourceLabel: "agents", priority: 3 },
			];
			const result = loadAllRules(sources);
			const { section } = buildRulesSection(result.rules);
			// Both sections present.
			expect(section).toContain("🔒 Built-in rules (shipped with soly)");
			expect(section).toContain("MANDATORY: soly project rules");
			// Built-in section comes FIRST.
			const builtInIdx = section.indexOf("🔒 Built-in rules (shipped with soly)");
			const mandatoryIdx = section.indexOf("MANDATORY: soly project rules");
			expect(builtInIdx).toBeGreaterThanOrEqual(0);
			expect(mandatoryIdx).toBeGreaterThan(builtInIdx);
			// Both rules' content present.
			expect(section).toContain("temp-files");
			expect(section).toContain("A user-written rule.");
		} finally {
			fs.rmSync(tmpUser, { recursive: true, force: true });
		}
	});
});