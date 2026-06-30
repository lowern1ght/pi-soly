// =============================================================================
// tests/workflow-plan-mode.test.ts — W2: `soly plan|execute|discuss <type>/<name>`
// =============================================================================
//
// W2 of the plans-instead-of-phases redesign. The parser recognizes
// `<type>/<name>` plans; the three workflow handlers dispatch them to the
// right path (`.agents/plans/<name>/PLAN.md`).
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { describePlanTarget, describeExecuteTarget } from "../workflows/parser.ts";
import { buildPlanTransform } from "../workflows/planning.ts";
import { buildExecuteTransform } from "../workflows/execute.ts";
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

function initTmpRepoWithSoly(): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "soly-planmode-"));
	execFileSync("git", ["init", "-q"], { cwd: tmp });
	execFileSync("git", ["config", "user.email", "t@t"], { cwd: tmp });
	execFileSync("git", ["config", "user.name", "t"], { cwd: tmp });
	const solyDir = path.join(tmp, ".agents");
	fs.mkdirSync(solyDir, { recursive: true });
	fs.writeFileSync(path.join(solyDir, "STATE.md"), "# STATE");
	fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# ROADMAP");
	execFileSync("git", ["add", "."], { cwd: tmp });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
	return tmp;
}

describe("describePlanTarget — plan kind (W2)", () => {
	test("auth-jwt → plan", () => {
		const t = describePlanTarget(["auth-jwt"]);
		expect(t).toEqual({ kind: "plan", name: "auth-jwt", prefix: null, raw: "auth-jwt" });
	});

	test("feature/auth-jwt → plan (prefixed form)", () => {
		const t = describePlanTarget(["feature/auth-jwt"]);
		expect(t).toEqual({ kind: "plan", name: "auth-jwt", prefix: "feature", raw: "feature/auth-jwt" });
	});

	test("login-redirect → plan", () => {
		const t = describePlanTarget(["login-redirect"]);
		expect(t?.kind).toBe("plan");
	});

	test("upgrade-deps → plan", () => {
		const t = describePlanTarget(["upgrade-deps"]);
		expect(t).toMatchObject({ kind: "plan", name: "upgrade-deps", prefix: null });
	});

	test("plain 11 → still phase (backward compat)", () => {
		const t = describePlanTarget(["11"]);
		expect(t).toEqual({ kind: "phase", phase: 11, raw: "11" });
	});

	test("legacy <type>/<name> form is now accepted as <prefix>/<slug> (1.16.x)", () => {
		const t = describePlanTarget(["feat/auth-jwt"]);
		expect(t).toEqual({ kind: "plan", name: "auth-jwt", prefix: "feat", raw: "feat/auth-jwt" });
	});

	test("Foo/Bar (uppercase) → null", () => {
		const t = describePlanTarget(["Foo/Bar"]);
		expect(t).toBeNull();
	});

	test("name with leading dash → null", () => {
		const t = describePlanTarget(["-auth"]);
		expect(t).toBeNull();
	});

	test("name with trailing dash → null", () => {
		const t = describePlanTarget(["auth-"]);
		expect(t).toBeNull();
	});
});

describe("describeExecuteTarget — plan kind (W2)", () => {
	test("auth-jwt → plan", () => {
		const t = describeExecuteTarget(["auth-jwt"]);
		expect(t).toEqual({ kind: "plan", name: "auth-jwt", prefix: null, raw: "auth-jwt" });
	});

	test("feature/auth-jwt → plan (prefixed form)", () => {
		const t = describeExecuteTarget(["feature/auth-jwt"]);
		expect(t).toEqual({ kind: "plan", name: "auth-jwt", prefix: "feature", raw: "feature/auth-jwt" });
	});

	test("plain 5 → still phase (backward compat)", () => {
		const t = describeExecuteTarget(["5"]);
		expect(t?.kind).toBe("phase");
	});
});

describe("buildPlanTransform — plan mode", () => {
	let repo: string;

	beforeEach(() => {
		repo = initTmpRepoWithSoly();
	});

	afterEach(() => {
		fs.rmSync(repo, { recursive: true, force: true });
	});

	test("returns transformedText that points to .agents/plans/<name>/PLAN.md", () => {
		// Scaffold a plan via fs (skip the new-workflow to keep this test focused)
		const planFile = path.join(repo, ".agents", "plans", "auth-jwt", "PLAN.md");
		fs.mkdirSync(path.dirname(planFile), { recursive: true });
		fs.writeFileSync(planFile, "# Plan: auth-jwt\n\n## Goal\nTBD\n");

		const state = fakeState(path.join(repo, ".agents"));
		const result = buildPlanTransform(
			{ verb: "plan", args: ["auth-jwt"], raw: "soly plan auth-jwt" } as never,
			state,
		);

		expect(result.handled).toBe(true);
		expect(result.transformedText).toContain(".agents/plans/auth-jwt/PLAN.md");
		expect(result.transformedText).toContain("auth-jwt");
	});

	test("<prefix>/<slug> input reads from the flattened dir (1.16.1 regression)", () => {
		// Plan dir is `.agents/plans/feature-auth-jwt/`, NOT `.agents/plans/auth-jwt/`.
		// Pre-1.16.1 this read from `.agents/plans/auth-jwt/` and silently missed
		// the file on prefix-styled plans.
		const planFile = path.join(repo, ".agents", "plans", "feature-auth-jwt", "PLAN.md");
		fs.mkdirSync(path.dirname(planFile), { recursive: true });
		fs.writeFileSync(planFile, "# Plan: feature/auth-jwt\n\n## Goal\nTBD\n");

		const state = fakeState(path.join(repo, ".agents"));
		const result = buildPlanTransform(
			{ verb: "plan", args: ["feature/auth-jwt"], raw: "soly plan feature/auth-jwt" } as never,
			state,
		);

		expect(result.handled).toBe(true);
		expect(result.transformedText).toContain(".agents/plans/feature-auth-jwt/PLAN.md");
		// TBD placeholder because we wrote empty TBD content — but the
		// important thing is the path the LLM is told to use.
		expect(result.transformedText).not.toContain("has no PLAN.md");
	});

	test("error if PLAN.md does not exist (uses TBD placeholder in body)", () => {
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildPlanTransform(
			{ verb: "plan", args: ["missing-plan"], raw: "soly plan missing-plan" } as never,
			state,
		);
		// Even with missing PLAN.md, plan-mode should return handled (LLM will be
		// told to ask the user + write a stub). It should not error.
		expect(result.handled).toBe(true);
		expect(result.transformedText).toContain(".agents/plans/missing-plan/PLAN.md");
	});
});

describe("buildExecuteTransform — plan mode", () => {
	let repo: string;

	beforeEach(() => {
		repo = initTmpRepoWithSoly();
	});

	afterEach(() => {
		fs.rmSync(repo, { recursive: true, force: true });
	});

	test("returns transformedText that includes plan body", () => {
		const planFile = path.join(repo, ".agents", "plans", "auth-jwt", "PLAN.md");
		fs.mkdirSync(path.dirname(planFile), { recursive: true });
		fs.writeFileSync(planFile, "# Plan: auth-jwt\n\n## Goal\nShip JWT auth\n");

		const state = fakeState(path.join(repo, ".agents"));
		const result = buildExecuteTransform(
			{ verb: "execute", args: ["auth-jwt"], raw: "soly execute auth-jwt" } as never,
			state,
		);

		expect(result.handled).toBe(true);
		expect(result.transformedText).toContain(".agents/plans/auth-jwt/PLAN.md");
		expect(result.transformedText).toContain("Ship JWT auth");
	});

	test("clean error if PLAN.md does not exist", () => {
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildExecuteTransform(
			{ verb: "execute", args: ["missing"], raw: "soly execute missing" } as never,
			state,
		);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/has no PLAN\.md/);
		expect(result.transformedText).toContain(".agents/plans/missing/PLAN.md");
	});
});
