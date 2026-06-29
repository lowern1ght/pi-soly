// =============================================================================
// tests/workflow-migrate.test.ts — W5: `soly migrate phases-to-plans`
// =============================================================================
//
// W5 of the plans-instead-of-phases redesign. Reads each phase under
// .agents/phases/<NN>-slug/, creates branch migrate/legacy-<NN>-slug,
// copies plans/PLAN.md to .agents/plans/legacy-<NN>-slug/PLAN.md, commits.
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { buildMigrateTransform } from "../workflows/migrate.ts";
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

function run(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepoWithPhases(phases: { name: string; plan: string | null }[]): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "soly-migrate-"));
	run(repo, ["init", "-q"]);
	run(repo, ["config", "user.email", "t@t"]);
	run(repo, ["config", "user.name", "t"]);
	const solyDir = path.join(repo, ".agents");
	fs.mkdirSync(solyDir, { recursive: true });
	fs.writeFileSync(path.join(solyDir, "STATE.md"), "# STATE");
	fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# ROADMAP");

	for (const p of phases) {
		const phaseDir = path.join(solyDir, "phases", p.name);
		fs.mkdirSync(phaseDir, { recursive: true });
		if (p.plan) {
			fs.mkdirSync(path.join(phaseDir, "plans"), { recursive: true });
			fs.writeFileSync(path.join(phaseDir, "plans", "PLAN.md"), p.plan);
		}
	}
	run(repo, ["add", "."]);
	run(repo, ["commit", "-q", "-m", "init"]);
	return repo;
}

describe("buildMigrateTransform (real git)", () => {
	let repo: string;

	beforeEach(() => {
		// Each test starts with the same starting point
	});

	afterEach(() => {
		if (repo) fs.rmSync(repo, { recursive: true, force: true });
	});

	test("migrates a single phase with PLAN.md", () => {
		repo = initRepoWithPhases([
			{ name: "03-foo", plan: "# Phase 3 plan\n\n## Goal\nFoo" },
		]);

		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildMigrateTransform(state, ui, repo);

		expect(result.handled).toBe(true);
		expect(result.migrated).toHaveLength(1);
		expect(result.migrated[0]?.phase).toBe("03-foo");
		expect(result.migrated[0]?.branch).toBe("migrate/legacy-03-foo");

		// The migration branch was created
		const branches = run(repo, ["for-each-ref", "refs/heads/", "--format=%(refname:short)"])
			.split("\n").map((b) => b.trim()).filter(Boolean);
		expect(branches).toContain("migrate/legacy-03-foo");

		// PLAN.md was copied to .agents/plans/legacy-03-foo/PLAN.md
		const planTarget = path.join(repo, ".agents", "plans", "legacy-03-foo", "PLAN.md");
		expect(fs.existsSync(planTarget)).toBe(true);
		expect(fs.readFileSync(planTarget, "utf-8")).toMatch(/Phase 3 plan/);
	});

	test("migrates multiple phases; skips ones with no PLAN.md", () => {
		repo = initRepoWithPhases([
			{ name: "03-foo", plan: "# foo" },
			{ name: "07-bar", plan: "# bar" },
			{ name: "11-baz", plan: null },
		]);

		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildMigrateTransform(state, ui, repo);

		expect(result.migrated).toHaveLength(2);
		expect(result.migrated.map((m) => m.phase).sort()).toEqual(["03-foo", "07-bar"]);
		expect(result.skipped.find((s) => s.phase === "11-baz")?.reason).toMatch(/no PLAN\.md/);
	});

	test("skips phases whose branch already exists (idempotent re-runs)", () => {
		repo = initRepoWithPhases([{ name: "03-foo", plan: "# foo" }]);
		run(repo, ["checkout", "-b", "migrate/legacy-03-foo"]);
		run(repo, ["checkout", "master"]);

		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildMigrateTransform(state, ui, repo);

		expect(result.migrated).toHaveLength(0);
		expect(result.skipped.find((s) => s.phase === "03-foo")?.reason).toMatch(/already exists/);
	});

	test("empty .agents/phases/ → no-op with friendly message", () => {
		repo = initRepoWithPhases([]);

		const ui = fakeUi();
		const state = fakeState(path.join(repo, ".agents"));
		const result = buildMigrateTransform(state, ui, repo);

		expect(result.handled).toBe(true);
		expect(result.migrated).toHaveLength(0);
		expect(result.skipped).toHaveLength(0);
		expect(result.transformedText).toMatch(/no phases found/);
	});

	test("no .agents/ directory → clean error", () => {
		repo = fs.mkdtempSync(path.join(os.tmpdir(), "soly-migrate-empty-"));
		run(repo, ["init", "-q"]);
		run(repo, ["config", "user.email", "t@t"]);
		run(repo, ["config", "user.name", "t"]);

		const ui = fakeUi();
		const state = fakeState("/nonexistent", false);
		const result = buildMigrateTransform(state, ui, repo);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toMatch(/no \.agents\/ directory/);

		fs.rmSync(repo, { recursive: true, force: true });
		repo = ""; // signal to afterEach to skip
	});
});
