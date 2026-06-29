// =============================================================================
// tests/workflow-done.test.ts — W3: `soly done <type>/<name>` handler
// =============================================================================
//
// W3 of the plans-instead-of-phases redesign. The workflow commits any
// uncommitted changes on the plan branch, pushes to origin, and tries to
// open a draft PR via `gh pr create --draft --fill`. State.md sync lives
// in W4; this test focuses on the git + gh work.
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { buildDoneTransform } from "../workflows/done.ts";
import type { SolyState } from "../core.js";

function fakeState(solyDir: string, exists = true): SolyState {
	return {
		solyDir,
		exists,
		milestone: "—",
		milestoneName: "",
		status: "in-progress",
		lastUpdated: "",
		progress: { totalPhases: 0, completedPhases: 0, totalPlans: 0, completedPlans: 0, percent: 0 },
		position: null,
		currentPhase: null,
		currentPlanPath: null,
		stateBody: "",
		roadmapBody: "",
		phases: [],
		features: [],
		tasks: [],
	};
}

function fakeUi() {
	const calls: Array<{ text: string; level: string }> = [];
	return {
		notify: (text: string, level: "info" | "warning" | "error" = "info") => {
			calls.push({ text, level });
		},
		calls,
	};
}

/** Init a real git repo with .agents/ scaffold + a "local origin" bare remote. */
function initRepoWithLocalOrigin(): { repo: string; originPath: string } {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "soly-done-"));
	const originPath = path.join(base, "origin.git");
	const repo = path.join(base, "work");
	fs.mkdirSync(originPath);
	fs.mkdirSync(repo); // <-- bug fix: cwd must exist before execFileSync
	run(originPath, ["init", "-q", "--bare"]);

	run(repo, ["init", "-q"]);
	run(repo, ["config", "user.email", "t@t"]);
	run(repo, ["config", "user.name", "t"]);
	const solyDir = path.join(repo, ".agents");
	fs.mkdirSync(solyDir, { recursive: true });
	fs.writeFileSync(path.join(solyDir, "STATE.md"), "# STATE");
	fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# ROADMAP");
	run(repo, ["add", "."]);
	run(repo, ["commit", "-q", "-m", "init"]);
	run(repo, ["remote", "add", "origin", originPath]);

	return { repo, originPath };
}

/** Init a git repo with NO origin remote. */
function initRepoNoOrigin(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "soly-done-noorigin-"));
	run(repo, ["init", "-q"]);
	run(repo, ["config", "user.email", "t@t"]);
	run(repo, ["config", "user.name", "t"]);
	const solyDir = path.join(repo, ".agents");
	fs.mkdirSync(solyDir, { recursive: true });
	fs.writeFileSync(path.join(solyDir, "STATE.md"), "# STATE");
	fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# ROADMAP");
	run(repo, ["add", "."]);
	run(repo, ["commit", "-q", "-m", "init"]);
	return repo;
}

function run(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** Create a fake `gh` script that returns a fake PR URL. Works on Win + Unix. */
function makeFakeGh(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gh-"));
	const isWin = process.platform === "win32";
	const scriptPath = path.join(dir, isWin ? "gh.cmd" : "gh");
	const body = isWin
		? `@echo off
echo https://github.com/test/repo/pull/42
`
		: `#!/bin/sh
echo "https://github.com/test/repo/pull/42"
`;
	fs.writeFileSync(scriptPath, body);
	if (!isWin) fs.chmodSync(scriptPath, 0o755);
	return scriptPath;
}

describe("buildDoneTransform (real git, mocked gh)", () => {
	let repo: string;
	let originPath: string;

	beforeEach(() => {
		({ repo, originPath } = initRepoWithLocalOrigin());
	});

	afterEach(() => {
		fs.rmSync(path.dirname(repo), { recursive: true, force: true });
	});

	test("full happy path: commits uncommitted file, pushes, opens draft PR", () => {
		// Create the plan branch with an uncommitted file
		run(repo, ["checkout", "-b", "feat/auth-jwt"]);
		fs.mkdirSync(path.join(repo, "src"), { recursive: true });
		fs.writeFileSync(path.join(repo, "src", "auth.ts"), "// wip");
		// Don't add/commit — let soly do it

		const ghPath = makeFakeGh();
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildDoneTransform(
			{ verb: "done", args: ["feat/auth-jwt"], raw: "soly done feat/auth-jwt" } as never,
			state,
			ui,
			repo,
			{ ghPath },
		);

		expect(result.handled).toBe(true);
		expect(result.completed?.branch).toBe("feat/auth-jwt");
		expect(result.completed?.pushed).toBe(true);
		expect(result.completed?.prUrl).toBe("https://github.com/test/repo/pull/42");

		// Remote should have the new branch with the WIP commit
		const logOut = run(originPath, ["log", "--oneline", "feat/auth-jwt"]);
		expect(logOut).toMatch(/wip/);

		// ui.notify called with success summary
		expect(ui.calls.some((c) => c.text.includes("Draft PR:"))).toBe(true);
	});

	test("blocks when current branch is not the plan branch", () => {
		run(repo, ["checkout", "-b", "feat/something-else"]);
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildDoneTransform(
			{ verb: "done", args: ["feat/auth-jwt"], raw: "soly done feat/auth-jwt" } as never,
			state,
			ui,
			repo,
		);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/not the plan branch "feat\/auth-jwt"/);
		expect(result.completed).toBeUndefined();
	});

	test("no-op on clean tree (no extra commit)", () => {
		run(repo, ["checkout", "-b", "feat/auth-jwt"]);
		// Working tree is already clean
		const headBefore = run(repo, ["rev-parse", "HEAD"]);

		const ghPath = makeFakeGh();
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildDoneTransform(
			{ verb: "done", args: ["feat/auth-jwt"], raw: "soly done feat/auth-jwt" } as never,
			state,
			ui,
			repo,
			{ ghPath },
		);

		expect(result.handled).toBe(true);
		expect(result.completed?.pushed).toBe(true);
		// Head didn't move (no new commit created)
		expect(run(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
	});

	test("skips PR when gh is not available, warns via ui.notify", () => {
		run(repo, ["checkout", "-b", "feat/auth-jwt"]);
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildDoneTransform(
			{ verb: "done", args: ["feat/auth-jwt"], raw: "soly done feat/auth-jwt" } as never,
			state,
			ui,
			repo,
			// No ghPath → uses "gh" which doesn't exist on the test machine
		);

		expect(result.handled).toBe(true);
		expect(result.completed?.pushed).toBe(true);
		expect(result.completed?.prUrl).toBeNull();
		// ui.notify warned about missing gh
		expect(ui.calls.some((c) => c.text.includes("`gh` CLI not found"))).toBe(true);
	});

	test("skips push when there's no origin remote, warns", () => {
		// Use a fresh repo with no remote
		const repoNoOrigin = initRepoNoOrigin();
		try {
			run(repoNoOrigin, ["checkout", "-b", "feat/auth-jwt"]);
			fs.writeFileSync(path.join(repoNoOrigin, "f.txt"), "x");

			const ui = fakeUi();
			const state = fakeState(path.join(repoNoOrigin, ".agents"));
			const result = buildDoneTransform(
				{ verb: "done", args: ["feat/auth-jwt"], raw: "soly done feat/auth-jwt" } as never,
				state,
				ui,
				repoNoOrigin,
			);

			expect(result.handled).toBe(true);
			expect(result.completed?.pushed).toBe(false);
			expect(result.completed?.prUrl).toBeNull();
			expect(ui.calls.some((c) => c.text.includes("no 'origin' remote"))).toBe(true);
		} finally {
			fs.rmSync(repoNoOrigin, { recursive: true, force: true });
		}
	});

	test("bad plan name returns clean error", () => {
		run(repo, ["checkout", "-b", "feat/anything"]);
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildDoneTransform(
			{ verb: "done", args: ["no-slash"], raw: "soly done no-slash" } as never,
			state,
			ui,
			repo,
		);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/bad plan name/);
	});

	test("blocks when no .agents/ directory", () => {
		run(repo, ["checkout", "-b", "feat/auth-jwt"]);
		const ui = fakeUi();
		const state = fakeState("/nonexistent", false);
		const result = buildDoneTransform(
			{ verb: "done", args: ["feat/auth-jwt"], raw: "soly done feat/auth-jwt" } as never,
			state,
			ui,
			repo,
		);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/no \.agents\/ directory/);
	});
});
