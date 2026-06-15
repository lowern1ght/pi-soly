// =============================================================================
// tests/agents-install.test.ts — Tests for soly subagent install
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installSolyAgents, checkSolyAgentsInstalled } from "../agents-install.js";

let tmpRoot: string;
let fakeExt: string;
let fakeHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-agents-"));
	fakeExt = path.join(tmpRoot, "soly-ext");
	fakeHome = path.join(tmpRoot, "home");
	// Fake extension structure: agents/ with the shipped files (all 7)
	fs.mkdirSync(path.join(fakeExt, "agents"), { recursive: true });
	const shippedNames = [
		"soly-worker",
		"soly-debugger",
		"soly-tester",
		"soly-refactor",
		"soly-oracle",
		"soly-reviewer",
		"soly-documenter",
	];
	for (const n of shippedNames) {
		fs.writeFileSync(path.join(fakeExt, "agents", `${n}.md`), `# ${n} (test fixture)\n`);
	}
	// Fake $HOME
	fs.mkdirSync(fakeHome, { recursive: true });
	// Ensure the user agents dir doesn't have leftovers from prior test runs
	fs.rmSync(path.join(fakeHome, ".pi", "agent", "agents"), { recursive: true, force: true });
	// Redirect HOME/USERPROFILE so installSolyAgents() writes to fakeHome
	origHome = process.env.HOME;
	origUserProfile = process.env.USERPROFILE;
	process.env.HOME = fakeHome;
	process.env.USERPROFILE = fakeHome;
});

afterAll(() => {
	if (origHome !== undefined) process.env.HOME = origHome;
	if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("installSolyAgents", () => {
	test("copies shipped agents to ~/.pi/agent/agents/ on first run", () => {
		const result = installSolyAgents(fakeExt);
		expect(result.installed.length).toBe(7);
		expect(result.installed).toContain("soly-worker.md");
		expect(result.installed).toContain("soly-debugger.md");
		expect(result.installed).toContain("soly-tester.md");
		expect(result.installed).toContain("soly-refactor.md");
		expect(result.installed).toContain("soly-oracle.md");
		expect(result.installed).toContain("soly-reviewer.md");
		expect(result.installed).toContain("soly-documenter.md");
		expect(result.skipped).toEqual([]);
		expect(result.errors).toEqual([]);
		// Files now exist in fake home
		const userDir = path.join(fakeHome, ".pi", "agent", "agents");
		expect(fs.existsSync(path.join(userDir, "soly-worker.md"))).toBe(true);
		expect(fs.existsSync(path.join(userDir, "soly-oracle.md"))).toBe(true);
	});

	test("second call is a no-op (idempotent)", () => {
		const result = installSolyAgents(fakeExt);
		expect(result.installed).toEqual([]);
		expect(result.skipped.length).toBe(7);
		expect(result.skipped).toContain("soly-worker.md");
		expect(result.skipped).toContain("soly-debugger.md");
		expect(result.skipped).toContain("soly-oracle.md");
		expect(result.skipped).toContain("soly-documenter.md");
	});

	test("does NOT overwrite user-customized agent files", () => {
		// User customizes soly-worker.md in their agents dir
		const userDir = path.join(fakeHome, ".pi", "agent", "agents");
		const customPath = path.join(userDir, "soly-worker.md");
		fs.writeFileSync(customPath, "# USER CUSTOMIZED soly-worker\n");

		const result = installSolyAgents(fakeExt);
		expect(result.installed).toEqual([]);
		expect(result.skipped).toContain("soly-worker.md");

		// User's content preserved
		const content = fs.readFileSync(customPath, "utf-8");
		expect(content).toContain("USER CUSTOMIZED");
	});

	test("missing source directory is a no-op (not an error)", () => {
		const result = installSolyAgents(path.join(tmpRoot, "nonexistent"));
		expect(result.installed).toEqual([]);
		expect(result.skipped).toEqual([]);
		// errors may be empty (no shipped dir = no shipped agents to install)
	});

	test("missing source file is reported in errors", () => {
		// Use a fresh fake home so the prior install's user-side copies don't
		// make this run a no-op.
		const freshHome = path.join(tmpRoot, "fresh-home-" + Date.now());
		fs.mkdirSync(freshHome, { recursive: true });
		const prevHome = process.env.HOME;
		process.env.HOME = freshHome;

		try {
			// Fresh fake ext with only one of seven agents
			const partialExt = path.join(tmpRoot, "partial-ext-" + Date.now());
			fs.mkdirSync(path.join(partialExt, "agents"), { recursive: true });
			fs.writeFileSync(path.join(partialExt, "agents", "soly-worker.md"), "# worker\n");
			// 6 others deliberately missing
			const result = installSolyAgents(partialExt);
			expect(result.installed).toContain("soly-worker.md");
			expect(result.errors.length).toBe(6);
			expect(result.errors.some((e) => e.includes("soly-oracle.md"))).toBe(true);
			expect(result.errors.some((e) => e.includes("soly-debugger.md"))).toBe(true);
		} finally {
			process.env.HOME = prevHome;
		}
	});
});

describe("checkSolyAgentsInstalled", () => {
	test("reports which shipped agents are present", () => {
		// soly-worker is user-customized from previous test; soly-oracle is installed
		const result = checkSolyAgentsInstalled(fakeExt);
		expect(result.installed).toContain("soly-worker.md"); // user-customized but still "installed"
		expect(result.installed).toContain("soly-oracle.md");
		expect(result.missing).toEqual([]);
	});

	test("reports missing agents when none are installed", () => {
		// Temporarily point HOME to an empty dir
		const emptyHome = path.join(tmpRoot, "empty-home-" + Date.now());
		fs.mkdirSync(emptyHome, { recursive: true });
		const prevHome = process.env.HOME;
		process.env.HOME = emptyHome;
		try {
			const result = checkSolyAgentsInstalled(fakeExt);
			expect(result.missing.length).toBe(7);
			expect(result.missing).toContain("soly-worker.md");
			expect(result.missing).toContain("soly-debugger.md");
			expect(result.missing).toContain("soly-oracle.md");
			expect(result.missing).toContain("soly-documenter.md");
			expect(result.installed).toEqual([]);
		} finally {
			process.env.HOME = prevHome;
		}
	});
});
