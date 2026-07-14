// =============================================================================
// tests/mode-picker.test.ts — first-run picker logic
// =============================================================================
//
// The picker is a small ListPanel that the user sees once per repo. We test
// the underlying logic (resolveMode auto-detect + writeModeConfig round-trip)
// but leave the actual UI to manual / E2E testing — the cost of mocking
// ListPanel is higher than the test value at this size.
// =============================================================================

import { describe, test, expect, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveMode, writeModeConfig } from "../config-mode.ts";

describe("first-run picker — resolve + persist round-trip", () => {
	let cwd: string;
	let home: string;

	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "soly-picker-"));
		fs.mkdirSync(path.join(cwd, ".agents"), { recursive: true });
		home = fs.mkdtempSync(path.join(os.tmpdir(), "soly-picker-home-"));
		fs.mkdirSync(path.join(home, ".pi"), { recursive: true });
	});

	test("fresh repo: needsPicker is true, mode is auto-detected", () => {
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.needsPicker).toBe(true);
		expect(r.source).toBe("auto-detect");
	});

	test("pick + write promotes auto-detect → repo-default", () => {
		// Simulate the picker choosing "plans"
		const choice = writeModeConfig("repo-default", cwd, { mode: "plans", plansDir: ".pi/plans" });
		expect(choice.path).toBe(path.join(cwd, ".agents", "soly.config.json"));

		// Re-resolve — picker is no longer needed.
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("repo-default");
		expect(r.mode).toBe("plans");
		expect(r.plansDir).toBe(".pi/plans");
		expect(r.needsPicker).toBe(false);
	});

	test("pick + write as user-repo goes to .local.json + .gitignore", () => {
		const choice = writeModeConfig("user-repo", cwd, { mode: "phases" }, { homeDir: home });
		expect(choice.path).toBe(path.join(cwd, ".agents", "soly.local.json"));
		const gi = fs.readFileSync(path.join(cwd, ".gitignore"), "utf-8");
		expect(gi).toContain(".agents/soly.local.json");
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("user-repo");
		expect(r.mode).toBe("phases");
	});
});
