// =============================================================================
// tests/phase-tasks.test.ts — unified model: tasks under phases
// =============================================================================
//
// Step 1 of the phases→tasks unification: a phase loads the tasks under its
// `tasks/<id>/` subdir into PhaseInfo.tasks (legacy `plans` still load too).
// =============================================================================

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadProjectState } from "../core.ts";

describe("unified model: tasks under phases", () => {
	test("a phase loads tasks from phases/<N>/tasks/<id>/PLAN.md", () => {
		const solyDir = fs.mkdtempSync(path.join(os.tmpdir(), "soly-phase-tasks-"));
		const taskDir = path.join(solyDir, "phases", "01-foundation", "tasks", "auth-login-a3f9");
		fs.mkdirSync(taskDir, { recursive: true });
		fs.writeFileSync(
			path.join(taskDir, "PLAN.md"),
			"---\nid: auth-login-a3f9\nkind: be\nfeature: auth\nstatus: ready\npriority: high\ndepends-on: []\n---\n\n# Plan\n",
		);

		const state = loadProjectState(solyDir);
		const phase = state.phases.find((p) => p.number === 1);
		expect(phase).toBeDefined();
		expect(phase?.tasks?.length).toBe(1);
		expect(phase?.tasks?.[0]?.id).toBe("auth-login-a3f9");
		expect(phase?.tasks?.[0]?.feature).toBe("auth");
		expect(phase?.tasks?.[0]?.status).toBe("ready");

		fs.rmSync(solyDir, { recursive: true, force: true });
	});

	test("a legacy phase with no tasks/ dir yields an empty task list", () => {
		const solyDir = fs.mkdtempSync(path.join(os.tmpdir(), "soly-legacy-phase-"));
		const phaseDir = path.join(solyDir, "phases", "02-legacy");
		fs.mkdirSync(phaseDir, { recursive: true });
		fs.writeFileSync(path.join(phaseDir, "02-01-PLAN.md"), "# legacy plan\n");

		const state = loadProjectState(solyDir);
		const phase = state.phases.find((p) => p.number === 2);
		expect(phase?.tasks ?? []).toEqual([]);
		expect(phase?.plans.length).toBe(1); // legacy plan still detected

		fs.rmSync(solyDir, { recursive: true, force: true });
	});
});
