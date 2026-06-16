// =============================================================================
// tests/agents-install.test.ts — Tests for soly-manager install
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
	// Fake extension structure: agents/ with the single shipped file
	fs.mkdirSync(path.join(fakeExt, "agents"), { recursive: true });
	fs.writeFileSync(path.join(fakeExt, "agents", "soly-manager.md"), "# soly-manager (test fixture)\n");
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
	test("copies soly-manager to ~/.pi/agent/agents/ on first run", () => {
		const result = installSolyAgents(fakeExt);
		expect(result.installed.length).toBe(1);
		expect(result.installed).toContain("soly-manager.md");
		expect(result.skipped).toEqual([]);
		expect(result.errors).toEqual([]);
		// File now exists in fake home
		const userDir = path.join(fakeHome, ".pi", "agent", "agents");
		expect(fs.existsSync(path.join(userDir, "soly-manager.md"))).toBe(true);
	});

	test("second call is a no-op (idempotent)", () => {
		const result = installSolyAgents(fakeExt);
		expect(result.installed).toEqual([]);
		expect(result.skipped.length).toBe(1);
		expect(result.skipped).toContain("soly-manager.md");
	});

	test("does NOT overwrite user-customized soly-manager.md", () => {
		// User customizes soly-manager.md in their agents dir
		const userDir = path.join(fakeHome, ".pi", "agent", "agents");
		const customPath = path.join(userDir, "soly-manager.md");
		fs.writeFileSync(customPath, "# USER CUSTOMIZED soly-manager\n");

		const result = installSolyAgents(fakeExt);
		expect(result.installed).toEqual([]);
		expect(result.skipped).toContain("soly-manager.md");

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
			// Fresh fake ext with NO agents dir contents
			const partialExt = path.join(tmpRoot, "partial-ext-" + Date.now());
			fs.mkdirSync(path.join(partialExt, "agents"), { recursive: true });
			// soly-manager.md deliberately missing
			const result = installSolyAgents(partialExt);
			expect(result.installed).toEqual([]);
			expect(result.errors.length).toBe(1);
			expect(result.errors.some((e) => e.includes("soly-manager.md"))).toBe(true);
		} finally {
			process.env.HOME = prevHome;
		}
	});
});

describe("checkSolyAgentsInstalled", () => {
	test("reports soly-manager as present", () => {
		// soly-manager is user-customized from previous test; still "installed"
		const result = checkSolyAgentsInstalled(fakeExt);
		expect(result.installed).toContain("soly-manager.md");
		expect(result.missing).toEqual([]);
	});

	test("reports missing when soly-manager is not installed", () => {
		// Temporarily point HOME to an empty dir
		const emptyHome = path.join(tmpRoot, "empty-home-" + Date.now());
		fs.mkdirSync(emptyHome, { recursive: true });
		const prevHome = process.env.HOME;
		process.env.HOME = emptyHome;
		try {
			const result = checkSolyAgentsInstalled(fakeExt);
			expect(result.missing.length).toBe(1);
			expect(result.missing).toContain("soly-manager.md");
			expect(result.installed).toEqual([]);
		} finally {
			process.env.HOME = prevHome;
		}
	});
});
