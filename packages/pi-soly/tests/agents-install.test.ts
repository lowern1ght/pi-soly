// =============================================================================
// tests/agents-install.test.ts — Tests for soly assets install (agents + skills)
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	installSolyAgents,
	installSolySkills,
	installSolyAssets,
	checkSolyAgentsInstalled,
	checkSolySkillsInstalled,
} from "../agents-install.js";

let tmpRoot: string;
let fakeExt: string;
let fakeHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-assets-"));
	fakeExt = path.join(tmpRoot, "soly-ext");
	fakeHome = path.join(tmpRoot, "home");
	// Fake extension structure: agents/ + skills/
	fs.mkdirSync(path.join(fakeExt, "agents"), { recursive: true });
	fs.writeFileSync(path.join(fakeExt, "agents", "soly-manager.md"), "# soly-manager (test fixture)\n");
	fs.mkdirSync(path.join(fakeExt, "skills", "soly-framework"), { recursive: true });
	fs.writeFileSync(
		path.join(fakeExt, "skills", "soly-framework", "SKILL.md"),
		"---\nname: soly-framework\ndescription: test fixture\n---\n# soly-framework (test)\n",
	);
	// Fake $HOME
	fs.mkdirSync(fakeHome, { recursive: true });
	// Ensure clean state
	fs.rmSync(path.join(fakeHome, ".pi", "agent", "agents"), { recursive: true, force: true });
	fs.rmSync(path.join(fakeHome, ".pi", "agent", "skills"), { recursive: true, force: true });
	// Redirect HOME/USERPROFILE
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
		const userDir = path.join(fakeHome, ".pi", "agent", "agents");
		const customPath = path.join(userDir, "soly-manager.md");
		fs.writeFileSync(customPath, "# USER CUSTOMIZED soly-manager\n");

		const result = installSolyAgents(fakeExt);
		expect(result.installed).toEqual([]);
		expect(result.skipped).toContain("soly-manager.md");

		const content = fs.readFileSync(customPath, "utf-8");
		expect(content).toContain("USER CUSTOMIZED");
	});

	test("missing source directory is a no-op (not an error)", () => {
		const result = installSolyAgents(path.join(tmpRoot, "nonexistent"));
		expect(result.installed).toEqual([]);
		expect(result.skipped).toEqual([]);
	});

	test("missing source file is reported in errors", () => {
		const freshHome = path.join(tmpRoot, "fresh-home-" + Date.now());
		fs.mkdirSync(freshHome, { recursive: true });
		const prevHome = process.env.HOME;
		process.env.HOME = freshHome;

		try {
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

describe("installSolySkills", () => {
	test("copies soly-framework to ~/.pi/agent/skills/ on first run", () => {
		const result = installSolySkills(fakeExt);
		expect(result.installed.length).toBe(1);
		expect(result.installed).toContain("soly-framework");
		expect(result.errors).toEqual([]);
		const userDir = path.join(fakeHome, ".pi", "agent", "skills", "soly-framework");
		expect(fs.existsSync(path.join(userDir, "SKILL.md"))).toBe(true);
	});

	test("second call is a no-op (idempotent)", () => {
		const result = installSolySkills(fakeExt);
		expect(result.installed).toEqual([]);
		expect(result.skipped.length).toBe(1);
		expect(result.skipped).toContain("soly-framework");
	});

	test("does NOT overwrite user-customized SKILL.md", () => {
		const userDir = path.join(fakeHome, ".pi", "agent", "skills", "soly-framework");
		const customPath = path.join(userDir, "SKILL.md");
		fs.writeFileSync(customPath, "# USER CUSTOMIZED skill\n");

		const result = installSolySkills(fakeExt);
		expect(result.skipped).toContain("soly-framework");

		const content = fs.readFileSync(customPath, "utf-8");
		expect(content).toContain("USER CUSTOMIZED");
	});
});

describe("installSolyAssets", () => {
	test("combines agents + skills install in one call", () => {
		// Use fresh state
		const freshHome = path.join(tmpRoot, "assets-home-" + Date.now());
		fs.mkdirSync(freshHome, { recursive: true });
		const prevHome = process.env.HOME;
		process.env.HOME = freshHome;

		try {
			const result = installSolyAssets(fakeExt);
			expect(result.agents.installed).toContain("soly-manager.md");
			expect(result.skills.installed).toContain("soly-framework");
		} finally {
			process.env.HOME = prevHome;
		}
	});
});

describe("checkSolyAgentsInstalled", () => {
	test("reports soly-manager as present", () => {
		const result = checkSolyAgentsInstalled(fakeExt);
		expect(result.installed).toContain("soly-manager.md");
		expect(result.missing).toEqual([]);
	});

	test("reports missing when soly-manager is not installed", () => {
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

describe("checkSolySkillsInstalled", () => {
	test("reports soly-framework as present", () => {
		const result = checkSolySkillsInstalled(fakeExt);
		expect(result.installed).toContain("soly-framework");
		expect(result.missing).toEqual([]);
	});

	test("reports missing when soly-framework is not installed", () => {
		const emptyHome = path.join(tmpRoot, "empty-skills-home-" + Date.now());
		fs.mkdirSync(emptyHome, { recursive: true });
		const prevHome = process.env.HOME;
		process.env.HOME = emptyHome;
		try {
			const result = checkSolySkillsInstalled(fakeExt);
			expect(result.missing.length).toBe(1);
			expect(result.missing).toContain("soly-framework");
			expect(result.installed).toEqual([]);
		} finally {
			process.env.HOME = prevHome;
		}
	});
});
