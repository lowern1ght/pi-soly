// =============================================================================
// tests/agents-install.test.ts — Tests for soly assets install (skills only)
// =============================================================================
//
// As of 1.3.0, soly no longer ships subagents. Only the soly-framework skill
// is installed. The installSolyAssets function returns { skills: ... }.
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	installSolySkills,
	installSolyAssets,
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
	// Fake extension structure: skills/ + SKILL.md
	fs.mkdirSync(path.join(fakeExt, "skills", "soly-framework"), { recursive: true });
	fs.writeFileSync(
		path.join(fakeExt, "skills", "soly-framework", "SKILL.md"),
		"---\nname: soly-framework\ndescription: test fixture\n---\n# soly-framework (test)\n",
	);
	// Fake $HOME — clean state
	fs.mkdirSync(fakeHome, { recursive: true });
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

	test("missing source directory is a no-op", () => {
		const result = installSolySkills(path.join(tmpRoot, "nonexistent"));
		expect(result.installed).toEqual([]);
		expect(result.skipped).toEqual([]);
	});
});

describe("installSolyAssets", () => {
	test("returns only skills (no agents field since 1.3.0)", () => {
		const result = installSolyAssets(fakeExt);
		expect(result.skills).toBeDefined();
		// No agents field — that's the breaking change
		expect((result as Record<string, unknown>).agents).toBeUndefined();
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
