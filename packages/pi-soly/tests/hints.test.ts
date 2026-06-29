// =============================================================================
// tests/hints.test.ts — Tests for buildNextHint + buildDriftReminder
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { buildNextHint, buildDriftReminder, type SolyState, type PhaseInfo } from "../core.js";

function phase(overrides: Partial<PhaseInfo>): PhaseInfo {
	return {
		number: 1,
		name: "x",
		slug: "01-x",
		dir: "/tmp/01-x",
		planCount: 0,
		contextExists: false,
		researchExists: false,
		plans: [],
		...overrides,
	};
}

function state(over: Partial<SolyState>): SolyState {
	return {
		solyDir: "/tmp/.agents",
		exists: true,
		milestone: "v1.0",
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
		...over,
	};
}

describe("buildNextHint", () => {
	test("no .agents/ → null", () => {
		expect(buildNextHint(state({ exists: false }))).toBeNull();
	});

	test("no phases, no position → 'soly plan 1'", () => {
		expect(buildNextHint(state({ phases: [] }))).toBe("→ next: soly plan 1");
	});

	test("latest phase has no CONTEXT → 'soly discuss N'", () => {
		const s = state({ phases: [phase({ number: 3, contextExists: false, planCount: 0 })] });
		expect(buildNextHint(s)).toBe("→ next: soly discuss 3");
	});

	test("latest phase has CONTEXT but no PLAN → 'soly plan N'", () => {
		const s = state({
			phases: [phase({ number: 5, contextExists: true, planCount: 0 })],
		});
		expect(buildNextHint(s)).toBe("→ next: soly plan 5");
	});

	test("latest phase has CONTEXT + PLANs → 'soly execute N'", () => {
		const s = state({
			phases: [phase({ number: 7, contextExists: true, planCount: 3 })],
		});
		expect(buildNextHint(s)).toBe("→ next: soly execute 7");
	});

	test("position is in-progress → 'soly execute N'", () => {
		const s = state({ position: { phase: "10", plan: "10-02", status: "in-progress" } });
		expect(buildNextHint(s)).toBe("→ next: soly execute 10");
	});

	test("position is complete → 'soly plan N+1'", () => {
		const s = state({ position: { phase: "10", plan: "10-99", status: "complete" } });
		expect(buildNextHint(s)).toBe("→ next: soly plan 11");
	});

	test("position complete on phase 99 → null (sentinel)", () => {
		const s = state({ position: { phase: "99", plan: "99-99", status: "complete" } });
		expect(buildNextHint(s)).toBeNull();
	});

	test("position with non-numeric phase → 'soly status' (graceful)", () => {
		const s = state({ position: { phase: "—", plan: "—", status: "in-progress" } });
		expect(buildNextHint(s)).toBe("→ next: soly status");
	});
});

describe("buildDriftReminder", () => {
	test("below threshold (4) → null", () => {
		expect(buildDriftReminder(0)).toBeNull();
		expect(buildDriftReminder(4)).toBeNull();
	});

	test("at threshold (5) → short reminder with 'soly status'", () => {
		const r = buildDriftReminder(5);
		expect(r).not.toBeNull();
		expect(r).toContain("5 turns");
		expect(r).toContain("`soly status`");
	});

	test("at 10+ → stronger reminder with 'soly pause'", () => {
		const r = buildDriftReminder(15);
		expect(r).not.toBeNull();
		expect(r).toContain("15 turns");
		expect(r).toContain("`soly pause`");
		expect(r).toContain("HANDOFF");
	});

	test("exactly 1 turn after threshold (should not be reachable but defensive)", () => {
		// The function doesn't enforce a minimum, but the caller should
		// not call it with 1 unless they want a 1-turn message.
		const r = buildDriftReminder(6);
		expect(r).toContain("6 turns");
	});
});
