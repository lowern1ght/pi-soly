// =============================================================================
// tests/mode-runtime.test.ts — plan-storage + branch-prompt + command-gate
// =============================================================================

import { describe, test, expect, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolvePlansDir, ensurePlansDir, planDirFor, usesPlanDir } from "../mode/plan-storage.ts";
import { gateCommand } from "../mode/command-gate.ts";
import { validateCustomPrefix } from "../mode/branch-prompt.ts";
import type { ResolvedMode } from "../config-mode.ts";

function makeResolved(overrides: Partial<ResolvedMode> = {}): ResolvedMode {
	return {
		mode: "plans",
		plansDir: ".pi/plans",
		source: "repo-default",
		warnings: [],
		needsPicker: false,
		...overrides,
	};
}

describe("mode/plan-storage", () => {
	let cwd: string;
	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "soly-storage-"));
	});

	test("resolvePlansDir returns cwd-relative path when plansDir is relative", () => {
		const abs = resolvePlansDir(cwd, makeResolved({ plansDir: ".pi/plans" }));
		expect(abs).toBe(path.join(cwd, ".pi/plans"));
	});

	test("resolvePlansDir respects absolute paths", () => {
		const abs = resolvePlansDir(cwd, makeResolved({ plansDir: "/tmp/soly-external" }));
		expect(abs).toBe("/tmp/soly-external");
	});

	test("ensurePlansDir creates the directory and is idempotent", () => {
		const abs = ensurePlansDir(cwd, makeResolved({ plansDir: ".pi/plans" }));
		expect(fs.existsSync(abs)).toBe(true);
		// Calling again doesn't throw
		expect(() => ensurePlansDir(cwd, makeResolved({ plansDir: ".pi/plans" }))).not.toThrow();
	});

	test("planDirFor joins slug with plans dir", () => {
		const dir = planDirFor(cwd, makeResolved({ plansDir: ".pi/plans" }), "auth-jwt");
		expect(dir).toBe(path.join(cwd, ".pi", "plans", "auth-jwt"));
	});

	test("usesPlanDir is true for plans, false for phases", () => {
		expect(usesPlanDir("plans")).toBe(true);
		expect(usesPlanDir("phases")).toBe(false);
	});
});

describe("mode/command-gate", () => {
	test("allows when declared mode matches current", () => {
		const r = gateCommand("plans", "plans");
		expect(r.allowed).toBe(true);
	});
	test("allows 'both' regardless of current", () => {
		expect(gateCommand("both", "plans").allowed).toBe(true);
		expect(gateCommand("both", "phases").allowed).toBe(true);
	});
	test("denies with helpful reason when mode mismatches", () => {
		const r = gateCommand("phases", "plans");
		expect(r.allowed).toBe(false);
		expect(r.reason).toContain("phases mode");
		expect(r.reason).toContain("current: plans");
	});
});

describe("mode/branch-prompt validateCustomPrefix", () => {
	test("empty string is valid (no prefix)", () => {
		expect(validateCustomPrefix("")).toBe("");
	});
	test("plain word gets trailing slash", () => {
		expect(validateCustomPrefix("feat")).toBe("feat/");
	});
	test("already-slash-terminated is preserved", () => {
		expect(validateCustomPrefix("feat/")).toBe("feat/");
	});
	test("rejects too long", () => {
		expect(validateCustomPrefix("a".repeat(41))).toBeNull();
	});
	test("rejects leading dash", () => {
		expect(validateCustomPrefix("-bad/")).toBeNull();
	});
	test("rejects leading dot", () => {
		expect(validateCustomPrefix(".bad/")).toBeNull();
	});
	test("rejects spaces", () => {
		expect(validateCustomPrefix("bad prefix/")).toBeNull();
	});
	test("rejects double slashes", () => {
		expect(validateCustomPrefix("a//b")).toBeNull();
	});
	test("rejects special chars", () => {
		expect(validateCustomPrefix("a?b/")).toBeNull();
	});
	test("trims whitespace", () => {
		expect(validateCustomPrefix("  feat/  ")).toBe("feat/");
	});
});
