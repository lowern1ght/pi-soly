// Quick sanity test for the discuss transform — what does the LLM see
// when ask_pro IS available vs NOT available?

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildDiscussTransform } from "../workflows/planning.js";
import type { SolyState } from "../core.js";

function fakeState(solyDir: string): SolyState {
	return {
		solyDir,
		exists: true,
		milestone: "v1.0",
		milestoneName: "Test",
		status: "in-progress",
		lastUpdated: "",
		progress: {
			totalPhases: 1,
			completedPhases: 0,
			totalPlans: 0,
			completedPlans: 0,
			percent: 0,
		},
		position: { phase: "5 (Auth)", plan: "?", status: "in-progress" },
		currentPhase: {
			number: 5,
			name: "Auth",
			slug: "05-auth",
			dir: path.join(solyDir, "phases", "05-auth"),
			planCount: 0,
			contextExists: false,
			researchExists: false,
			plans: [],
		},
		currentPlanPath: null,
		stateBody: "",
		roadmapBody: "",
		phases: [
			{
				number: 5,
				name: "Auth",
				slug: "05-auth",
				dir: path.join(solyDir, "phases", "05-auth"),
				planCount: 0,
				contextExists: false,
				researchExists: false,
				plans: [],
			},
		],
		features: [],
		tasks: [],
	};
}

describe("buildDiscussTransform — pi-ask integration", () => {
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-int-"));
	const solyDir = path.join(tmpRoot, ".soly");
	const state = fakeState(solyDir);

	test("when hasAskPro=true, prompt mentions ask_pro (PREFERRED)", () => {
		const cmd = { verb: "discuss" as const, args: ["5"], raw: "soly discuss 5" };
		const result = buildDiscussTransform(cmd, state, { hasAskPro: true });
		expect(result.handled).toBe(true);
		expect(result.transformedText).toContain("PREFERRED PICKER");
		expect(result.transformedText).toContain("`ask_pro`");
		expect(result.transformedText).toContain("allowOther");
		// The fallback path is mentioned too, but as a note
		expect(result.transformedText).toMatch(/fall back to .soly_ask_user/);
	});

	test("when hasAskPro=false, prompt falls back to soly_ask_user", () => {
		const cmd = { verb: "discuss" as const, args: ["5"], raw: "soly discuss 5" };
		const result = buildDiscussTransform(cmd, state, { hasAskPro: false });
		expect(result.handled).toBe(true);
		// Mentions soly_ask_user as the primary picker
		expect(result.transformedText).toContain("PICKER: `soly_ask_user`");
		expect(result.transformedText).toContain("soly_ask_user");
		// Mentions pi-ask as a tip
		expect(result.transformedText).toMatch(/pi-ask.*extension/);
		// ask_pro should NOT be presented as the preferred picker
		expect(result.transformedText).not.toContain("PREFERRED PICKER: `ask_pro`");
	});

	test("default (no opts) behaves as hasAskPro=false", () => {
		const cmd = { verb: "discuss" as const, args: ["5"], raw: "soly discuss 5" };
		const result = buildDiscussTransform(cmd, state);
		expect(result.handled).toBe(true);
		expect(result.transformedText).toContain("PICKER: `soly_ask_user`");
	});
});
