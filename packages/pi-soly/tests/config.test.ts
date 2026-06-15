// =============================================================================
// tests/config.test.ts — Unit tests for config.ts
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	DEFAULT_CONFIG,
	loadConfig,
	pruneOldIterations,
	SOLY_CONFIG_VERSION,
} from "../config.js";

let tmpRoot: string;
let projectSolyDir: string;
let fakeHome: string;
let globalConfigPath: string;
let originalUserProfile: string | undefined;
let originalHome: string | undefined;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-cfg-"));
	// The "project" is at tmpRoot/.soly (cwd is tmpRoot).
	projectSolyDir = path.join(tmpRoot, ".soly");
	fs.mkdirSync(projectSolyDir, { recursive: true });
	// The "fake home" is a SEPARATE subtree so the global config doesn't
	// accidentally look like a project config.
	fakeHome = path.join(tmpRoot, "_home");
	fs.mkdirSync(path.join(fakeHome, ".soly"), { recursive: true });
	// Redirect HOME / USERPROFILE so os.homedir() returns fakeHome.
	originalUserProfile = process.env.USERPROFILE;
	originalHome = process.env.HOME;
	process.env.USERPROFILE = fakeHome;
	process.env.HOME = fakeHome;
	globalConfigPath = path.join(fakeHome, ".soly", "config.json");
});

afterAll(() => {
	if (originalUserProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = originalUserProfile;
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("loadConfig — defaults", () => {
	test("no files → returns DEFAULT_CONFIG", () => {
		const r = loadConfig(tmpRoot, fakeHome);
		expect(r.config).toEqual(DEFAULT_CONFIG);
		expect(r.warnings).toEqual([]);
	});

	test("sources report null when no config files", () => {
		const r = loadConfig(tmpRoot, fakeHome);
		expect(r.sources.global).toBeNull();
		expect(r.sources.project).toBeNull();
	});
});

describe("loadConfig — global only", () => {
	test("global config is loaded and merged", () => {
		fs.writeFileSync(
			globalConfigPath,
			JSON.stringify({
				version: SOLY_CONFIG_VERSION,
				iteration: { retentionDays: 7 },
				hotReload: { pollMs: 5000 },
			}),
		);
		const r = loadConfig(tmpRoot, fakeHome);
		expect(r.config.iteration.retentionDays).toBe(7);
		expect(r.config.hotReload.pollMs).toBe(5000);
		// Untouched fields keep defaults
		expect(r.config.iteration.includeResearch).toBe(true);
		expect(r.config.agent.preferAskPro).toBe(true);
		expect(r.config.agent.useSolyWorkerSubagents).toBe(false); // opt-in default off
	});

	test("useSolyWorkerSubagents can be enabled via per-project config", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "soly-cfg-worker-"));
		fs.mkdirSync(path.join(cwd, ".soly"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".soly", "config.json"),
			JSON.stringify({ version: 1, agent: { useSolyWorkerSubagents: true } }),
		);
		const r = loadConfig(cwd, fakeHome);
		expect(r.config.agent.useSolyWorkerSubagents).toBe(true);
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	test("global file path is reported in sources", () => {
		fs.writeFileSync(globalConfigPath, JSON.stringify({ version: SOLY_CONFIG_VERSION }));
		const r = loadConfig(tmpRoot, fakeHome);
		expect(r.sources.global).toBe(globalConfigPath);
		expect(r.sources.project).toBeNull();
	});

	test("malformed JSON is silently ignored, defaults used", () => {
		fs.writeFileSync(globalConfigPath, "{ this is not valid json");
		const r = loadConfig(tmpRoot, fakeHome);
		expect(r.config).toEqual(DEFAULT_CONFIG);
	});

	test("version mismatch produces a warning", () => {
		fs.writeFileSync(
			globalConfigPath,
			JSON.stringify({ version: 99, iteration: { retentionDays: 30 } }),
		);
		const r = loadConfig(tmpRoot, fakeHome);
		expect(r.warnings.length).toBe(1);
		expect(r.warnings[0]).toContain("version 99");
		// But the parseable fields are still applied
		expect(r.config.iteration.retentionDays).toBe(30);
	});
});

describe("loadConfig — project overrides global", () => {
	test("project config takes precedence over global", () => {
		fs.writeFileSync(
			globalConfigPath,
			JSON.stringify({ version: SOLY_CONFIG_VERSION, iteration: { retentionDays: 7 } }),
		);
		fs.writeFileSync(
			path.join(projectSolyDir, "config.json"),
			JSON.stringify({ version: SOLY_CONFIG_VERSION, iteration: { retentionDays: 30 } }),
		);
		const r = loadConfig(tmpRoot, fakeHome);
		expect(r.config.iteration.retentionDays).toBe(30);
		expect(r.sources.global).toBe(globalConfigPath);
		expect(r.sources.project).toBe(path.join(projectSolyDir, "config.json"));
	});

	test("project-only setting doesn't appear in global config", () => {
		fs.writeFileSync(
			path.join(projectSolyDir, "config.json"),
			JSON.stringify({
				version: SOLY_CONFIG_VERSION,
				editor: { command: "cursor" },
			}),
		);
		const r = loadConfig(tmpRoot, fakeHome);
		expect(r.config.editor.command).toBe("cursor");
		expect(r.warnings).toEqual([]);
	});
});

describe("loadConfig — type safety", () => {
	test("wrong-type values are ignored, defaults used", () => {
		fs.writeFileSync(
			globalConfigPath,
			JSON.stringify({
				version: SOLY_CONFIG_VERSION,
				iteration: { retentionDays: "not a number" },
				agent: { preferAskPro: "true" }, // wrong type
			}),
		);
		const r = loadConfig(tmpRoot, fakeHome);
		// Defaults kept
		expect(r.config.iteration.retentionDays).toBe(0);
		expect(r.config.agent.preferAskPro).toBe(true);
	});
});

describe("pruneOldIterations", () => {
	beforeAll(() => {
		// Clean any leftover files
		const dir = path.join(projectSolyDir, "iterations");
		if (fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		fs.mkdirSync(dir, { recursive: true });
	});

	test("retentionDays=0 → no pruning", () => {
		fs.writeFileSync(path.join(projectSolyDir, "iterations", "old.md"), "# old");
		const r = pruneOldIterations(projectSolyDir, 0);
		expect(r.pruned).toBe(0);
		expect(fs.existsSync(path.join(projectSolyDir, "iterations", "old.md"))).toBe(true);
	});

	test("retentionDays=1 → files older than 1 day get pruned", () => {
		// Create a "new" file (mtime = now) and an "old" file (mtime = 2 days ago)
		const dir = path.join(projectSolyDir, "iterations");
		const newFile = path.join(dir, "new.md");
		const oldFile = path.join(dir, "old.md");
		fs.writeFileSync(newFile, "# new");
		fs.writeFileSync(oldFile, "# old");
		// Backdate the old file
		const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
		fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);

		const r = pruneOldIterations(projectSolyDir, 1);
		expect(r.pruned).toBe(1);
		expect(fs.existsSync(newFile)).toBe(true);
		expect(fs.existsSync(oldFile)).toBe(false);
	});

	test("missing iterations dir → no error", () => {
		const freshSolyDir = path.join(tmpRoot, "no-iter", ".soly");
		fs.mkdirSync(freshSolyDir, { recursive: true });
		const r = pruneOldIterations(freshSolyDir, 7);
		expect(r.pruned).toBe(0);
		expect(r.kept).toBe(0);
	});
});
