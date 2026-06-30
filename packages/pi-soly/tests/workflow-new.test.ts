// =============================================================================
// tests/workflow-new.test.ts — `soly new <type>/<name>` handler
// =============================================================================
//
// W1 of the plans-instead-of-phases redesign. `soly new` scaffolds a new
// plan: git checkout -b <type>/<name>, mkdir .agents/plans/<name>/, write
// stub PLAN.md, commit.
//
// parsePlanName is pure; the rest uses a real git repo in a tmp dir.
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { buildNewTransform } from "../workflows/new.ts";
import { parsePlanName } from "../workflows/parser.ts";
import type { SolyCommand, WorkflowVerb } from "../workflows/parser.ts";
import type { SolyState } from "../core.js";

function cmd(args: string[]): SolyCommand {
	return { verb: "new" as WorkflowVerb, args, raw: `soly new ${args.join(" ")}` };
}

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

/** Init a tmp git repo with .agents/ scaffold + an initial commit. */
function initTmpRepo(): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "soly-new-"));
	run(tmp, ["init", "-q"]);
	run(tmp, ["config", "user.email", "test@soly"]);
	run(tmp, ["config", "user.name", "test"]);
	const solyDir = path.join(tmp, ".agents");
	fs.mkdirSync(solyDir, { recursive: true });
	fs.writeFileSync(path.join(solyDir, "STATE.md"), "# STATE\n");
	fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# ROADMAP\n");
	run(tmp, ["add", "."]);
	run(tmp, ["commit", "-q", "-m", "init"]);
	return tmp;
}

function run(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

describe("parsePlanName (pure)", () => {
	test("valid kebab-case slug", () => {
		const r = parsePlanName("statistic-preparation");
		expect(r).toEqual({ name: "statistic-preparation" });
	});

	test("digits allowed", () => {
		expect(parsePlanName("api-v2-rate-limit")).toEqual({ name: "api-v2-rate-limit" });
	});

	test("single-letter segments", () => {
		expect(parsePlanName("a-b")).toEqual({ name: "a-b" });
	});

	test("rejects empty", () => {
		const r = parsePlanName("");
		expect("error" in r).toBe(true);
	});

	test("rejects type prefix (1.15.x dropped the <type>/<name> convention)", () => {
		const r = parsePlanName("feat/auth-jwt");
		expect("error" in r).toBe(true);
	});

	test("rejects name with uppercase", () => {
		const r = parsePlanName("AuthJwt");
		expect("error" in r).toBe(true);
	});

	test("rejects name with space", () => {
		const r = parsePlanName("auth jwt");
		expect("error" in r).toBe(true);
	});

	test("rejects name with leading dash", () => {
		const r = parsePlanName("-auth");
		expect("error" in r).toBe(true);
	});

	test("rejects name with trailing dash", () => {
		const r = parsePlanName("auth-");
		expect("error" in r).toBe(true);
	});

	test("rejects too-long name (>64)", () => {
		const r = parsePlanName("a".repeat(65));
		expect("error" in r && (r as { error: string }).error).toMatch(/too long/);
	});
});

describe("buildNewTransform (real git)", () => {
	let repo: string;

	beforeEach(() => {
		repo = initTmpRepo();
	});

	afterEach(() => {
		fs.rmSync(repo, { recursive: true, force: true });
	});

	test("scaffolds new branch + plan dir + stub PLAN.md + commit", () => {
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildNewTransform(cmd(["auth-jwt"]), state, ui, repo);

		expect(result.handled).toBe(true);
		expect(result.scaffolded).toBeDefined();
		expect(result.scaffolded?.branch).toBe("auth-jwt");

		// Branch was created and is now checked out
		const current = run(repo, ["branch", "--show-current"]);
		expect(current).toBe("auth-jwt");

		// Plan directory + PLAN.md exist
		const planFile = path.join(repo, ".agents", "plans", "auth-jwt", "PLAN.md");
		expect(fs.existsSync(planFile)).toBe(true);
		const content = fs.readFileSync(planFile, "utf-8");
		expect(content).toMatch(/# Plan: auth-jwt/);
		expect(content).toMatch(/Goal/);
		expect(content).toMatch(/Steps/);
		expect(content).toMatch(/Acceptance/);

		// Commit was made (HEAD is on a new commit; HEAD~1 has the init message)
		const lastMsg = run(repo, ["log", "-1", "--format=%s"]);
		expect(lastMsg).toMatch(/plan: scaffold auth-jwt/);

		// ui.notify was called
		expect(ui.calls.length).toBe(1);
		expect(ui.calls[0].text).toMatch(/auth-jwt/);
		expect(ui.calls[0].text).toMatch(/PLAN\.md/);
	});

	test("reuses existing branch if it exists", () => {
		// Pre-create the branch + commit a file INSIDE the plan dir so git can
		// commit later (empty dirs don't get committed by default).
		run(repo, ["checkout", "-b", "auth-jwt"]);
		const planDir = path.join(repo, ".agents", "plans", "auth-jwt");
		fs.mkdirSync(planDir, { recursive: true });
		fs.writeFileSync(path.join(planDir, "PREEXISTING.md"), "# preexisting");
		run(repo, ["add", "."]);
		run(repo, ["commit", "-q", "-m", "preexisting"]);
		run(repo, ["checkout", "master"]);

		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildNewTransform(cmd(["auth-jwt"]), state, ui, repo);

		expect(result.handled).toBe(true);
		// Notice should mention "reused"
		expect(ui.calls[0]?.text).toMatch(/reused/);
		// We should be on the existing branch now
		expect(run(repo, ["branch", "--show-current"])).toBe("auth-jwt");
	});

	test("blocks when working tree has uncommitted changes", () => {
		fs.writeFileSync(path.join(repo, "dirty.txt"), "user changes");
		run(repo, ["add", "dirty.txt"]); // index but uncommitted

		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildNewTransform(cmd(["auth-jwt"]), state, ui, repo);

		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/uncommitted changes/);
		// No branch should have been created
		const branches = run(repo, ["branch", "--list"]).split("\n");
		expect(branches.find((b) => b.includes("auth-jwt"))).toBeUndefined();
	});

	test("blocks when not in a git repo", () => {
		const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), "soly-norepo-"));
		try {
			const ui = fakeUi();
			const state = fakeState(path.join(notARepo, ".agents"));
			const result = buildNewTransform(cmd(["auth-jwt"]), state, ui, notARepo);
			expect(result.handled).toBe(true);
			expect(result.transformedText).toMatch(/not in a git repository/);
		} finally {
			fs.rmSync(notARepo, { recursive: true, force: true });
		}
	});

	test("blocks when no .agents/ directory exists", () => {
		const ui = fakeUi();
		const state = fakeState("/nonexistent", false);
		const result = buildNewTransform(cmd(["auth-jwt"]), state, ui, repo);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/no \.agents\/ directory/);
	});

	test("blocks when not on master/main/plan branch", () => {
		run(repo, ["checkout", "-b", "randomBranch_underscores"]);
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildNewTransform(cmd(["auth-jwt"]), state, ui, repo);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/not master\/main/);
	});

	test("rejects legacy <type>/<name> input (1.15.x convention)", () => {
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildNewTransform(cmd(["feat/auth-jwt"]), state, ui, repo);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/bad plan name/);
		// No branch created
		expect(run(repo, ["branch", "--show-current"])).toBe("master");
	});

	test("rejects single-character name (regex needs >=2)", () => {
		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildNewTransform(cmd(["x"]), state, ui, repo);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/bad plan name/);
	});
});
