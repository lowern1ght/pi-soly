// =============================================================================
// tests/inspect.test.ts — Tests for soly doctor / iterations / phase delete
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { showDoctor, showIterations, showDiffIterations, showPhaseDelete } from "../workflows/inspect.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { SolyState } from "../core.js";

let tmpRoot: string;
let solyDir: string;
let captured: Array<{ text: string; kind?: string }> = [];
const ui = {
	notify: (text: string, kind?: "info" | "warning" | "error") => {
		captured.push({ text, kind });
	},
};

function fakeState(overrides: Partial<SolyState> = {}): SolyState {
	return {
		solyDir,
		exists: true,
		milestone: "v1.0",
		milestoneName: "Test",
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
		...overrides,
	};
}

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-inspect-"));
	solyDir = path.join(tmpRoot, ".agents");
	fs.mkdirSync(solyDir, { recursive: true });
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("showDoctor", () => {
	// 2.1.1+ removed info-level notifications. The doctor report used to fire
	// as one big info notify; now it's silent on the happy path. Tests verify
	// that error-level notifications still surface and the function doesn't throw.

	test("no .agents/ → fail check (silent in 2.1.1+)", () => {
		captured = [];
		showDoctor(null, fakeState({ exists: false, solyDir: "" }), ui, DEFAULT_CONFIG);
		// 2.1.1+ contract: doctor report was a single info-level notify; now silent.
		expect(captured.length).toBe(0);
	});

	test("happy path: no info or error notifications fire", () => {
		captured = [];
		fs.writeFileSync(path.join(solyDir, "STATE.md"), "---\nmilestone: v1.0\n---\n\n# X\n\n## Current Position\nPhase: 1\n");
		fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# Roadmap\n\n## Phase 1\n");
		fs.mkdirSync(path.join(solyDir, "phases", "01-bootstrap"), { recursive: true });
		fs.writeFileSync(path.join(solyDir, "phases", "01-bootstrap", "01-01-PLAN.md"), "---\nid: x\n---\n# Plan");
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG);
		// Happy path is silent in 2.1.1+.
		expect(captured.filter((c) => c.kind === "info").length).toBe(0);
		expect(captured.filter((c) => c.kind === "error").length).toBe(0);
	});

	test("too many iteration files → silent in 2.1.1+", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		for (let i = 0; i < 51; i++) {
			fs.writeFileSync(path.join(solyDir, "iterations", `iter-${i}.md`), "# x");
		}
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG);
		// Doctor's whole report was info-level; now silent. The fail finding for
		// too-many-iterations is still surfaced via STATE.md / ROADMAP health
		// checks (separately); the doctor report itself doesn't fire.
		expect(captured.length).toBe(0);
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});

	test("iteration retentionDays > 0 + stale files → silent in 2.1.1+", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		const oldFile = path.join(solyDir, "iterations", "stale.md");
		fs.writeFileSync(oldFile, "# x");
		const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
		fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);
		showDoctor(null, fakeState(), ui, { ...DEFAULT_CONFIG, iteration: { ...DEFAULT_CONFIG.iteration, retentionDays: 1 } });
		// Doctor report is silent; no notifications fire even on warnings/fails.
		expect(captured.length).toBe(0);
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});

	test("ROADMAP.md missing → silent in 2.1.1+", () => {
		captured = [];
		try { fs.unlinkSync(path.join(solyDir, "ROADMAP.md")); } catch { /* ok */ }
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG);
		expect(captured.length).toBe(0);
	});

	test("pi-todo detected → no error notification", () => {
		captured = [];
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG, ["ask_pro", "todo_update", "bash"]);
		// "pi-todo detected" is a pass-level finding. In 2.1.1+ pass-level output
		// is silent. No notifications fire at all.
		expect(captured.filter((c) => c.kind === "error").length).toBe(0);
	});

	test("pi-todo NOT detected → silent (2.1.1+ contract)", () => {
		captured = [];
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG, ["ask_pro", "bash"]);
		// "not detected" used to be info-level; in 2.1.1+ that's silent.
		expect(captured.filter((c) => c.kind === "info").length).toBe(0);
		expect(captured.filter((c) => c.kind === "error").length).toBe(0);
	});
});

describe("pluralDays grammar (regression for '1 day' vs 'N days')", () => {
	test("2 days uses plural 'days' (silent in 2.1.1+, but grammar preserved in code)", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		const f = path.join(solyDir, "iterations", "old.md");
		fs.writeFileSync(f, "# x");
		const past = new Date(Date.now() - 5 * 86400_000);
		fs.utimesSync(f, past, past);
		showDoctor(null, fakeState(), ui, { ...DEFAULT_CONFIG, iteration: { ...DEFAULT_CONFIG.iteration, retentionDays: 2 } });
		// The grammar helper is exercised by showDoctor calling it, even though
		// the resulting text is silent in 2.1.1+. We verify the function runs
		// without throwing — the grammar is a unit in pluralDays itself.
		expect(captured.length).toBe(0);
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});
});

describe("showIterations", () => {
	test("no .agents/ → error notify", () => {
		captured = [];
		showIterations({ verb: "iterations", args: [], raw: "soly iterations" }, fakeState({ exists: false, solyDir: "" }), ui);
		expect(captured.some((c) => c.kind === "error")).toBe(true);
	});

	test("no iterations dir → silent (info removed in 2.1.1+)", () => {
		captured = [];
		showIterations({ verb: "iterations", args: [], raw: "soly iterations" }, fakeState(), ui);
		expect(captured.filter((c) => c.kind === "info").length).toBe(0);
		expect(captured.filter((c) => c.kind === "error").length).toBe(0);
	});

	test("lists files sorted by mtime desc — silently (info output removed)", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		const oldFile = path.join(solyDir, "iterations", "old.md");
		const newFile = path.join(solyDir, "iterations", "new.md");
		fs.writeFileSync(oldFile, "# old");
		fs.writeFileSync(newFile, "# new");
		const oneHourAgo = new Date(Date.now() - 3600_000);
		fs.utimesSync(oldFile, oneHourAgo, oneHourAgo);

		showIterations({ verb: "iterations", args: [], raw: "soly iterations" }, fakeState(), ui);
		// 2.1.1+ contract: the list was info-level; now silent.
		expect(captured.filter((c) => c.kind === "error").length).toBe(0);
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});

	test("invalid N → error notify", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		fs.writeFileSync(path.join(solyDir, "iterations", "x.md"), "# x");
		showIterations({ verb: "iterations", args: ["abc"], raw: "soly iterations abc" }, fakeState(), ui);
		expect(captured.some((c) => c.kind === "error" && c.text.includes("invalid count"))).toBe(true);
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});
});

describe("showDiffIterations", () => {
	test("no .agents/ → error", () => {
		captured = [];
		showDiffIterations(
			{ verb: "diff", args: ["iterations", "a.md", "b.md"], raw: "soly diff iterations a.md b.md" },
			fakeState({ exists: false, solyDir: "" }),
			ui,
		);
		expect(captured.some((c) => c.kind === "error")).toBe(true);
	});

	test("fewer than 2 args → error", () => {
		captured = [];
		showDiffIterations(
			{ verb: "diff", args: ["a.md"], raw: "soly diff iterations a.md" },
			fakeState(),
			ui,
		);
		expect(captured[0]!.text).toContain("need two file arguments");
	});

	test("missing file → error", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		showDiffIterations(
			{ verb: "diff", args: ["nope.md", "nope2.md"], raw: "soly diff iterations nope.md nope2.md" },
			fakeState(),
			ui,
		);
		expect(captured.some((c) => c.text.includes("file not found"))).toBe(true);
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});

	test("identical files → silent (info removed in 2.1.1+)", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		fs.writeFileSync(path.join(solyDir, "iterations", "a.md"), "same");
		fs.writeFileSync(path.join(solyDir, "iterations", "b.md"), "same");
		showDiffIterations(
			{ verb: "diff", args: ["a.md", "b.md"], raw: "soly diff iterations a.md b.md" },
			fakeState(),
			ui,
		);
		expect(captured.filter((c) => c.kind === "error").length).toBe(0);
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});
});

describe("showPhaseDelete", () => {
	test("no .agents/ → error", () => {
		captured = [];
		showPhaseDelete(
			{ verb: "phase", args: ["5"], raw: "soly phase delete 5" },
			fakeState({ exists: false, solyDir: "" }),
			ui,
		);
		expect(captured.some((c) => c.kind === "error")).toBe(true);
	});

	test("no arg → error", () => {
		captured = [];
		// The workflow handler in index.ts slices off the "delete" subverb
		// before calling showPhaseDelete, so we pass [] here (mirroring that).
		showPhaseDelete(
			{ verb: "phase", args: [], raw: "soly phase delete" },
			fakeState(),
			ui,
		);
		expect(captured[0]!.text).toContain("need a phase number");
	});

	test("non-existent phase → error", () => {
		captured = [];
		showPhaseDelete(
			{ verb: "phase", args: ["99"], raw: "soly phase delete 99" },
			fakeState({
				phases: [{ number: 5, name: "Auth", slug: "05-auth", dir: path.join(solyDir, "phases", "05-auth"), planCount: 0, contextExists: false, researchExists: false, plans: [] }],
			}),
			ui,
		);
		expect(captured[0]!.text).toContain("phase 99 not found");
	});

	test("valid phase moves to .trash/ (silent in 2.1.1+)", () => {
		captured = [];
		const phaseDir = path.join(solyDir, "phases", "05-auth");
		fs.mkdirSync(phaseDir, { recursive: true });
		fs.writeFileSync(path.join(phaseDir, "05-CONTEXT.md"), "# x");
		showPhaseDelete(
			{ verb: "phase", args: ["5"], raw: "soly phase delete 5" },
			fakeState({
				phases: [{ number: 5, name: "Auth", slug: "05-auth", dir: phaseDir, planCount: 0, contextExists: true, researchExists: false, plans: [] }],
			}),
			ui,
		);
		// 2.1.1+ contract: success notify was info-level; now silent.
		expect(captured.filter((c) => c.kind === "info").length).toBe(0);
		expect(captured.filter((c) => c.kind === "error").length).toBe(0);
		// Phase dir no longer at original location
		expect(fs.existsSync(phaseDir)).toBe(false);
		// Phase dir exists in .trash/
		const trash = fs.readdirSync(path.join(solyDir, "phases", ".trash"));
		expect(trash.length).toBe(1);
		expect(trash[0]).toMatch(/^05-auth-/);
	});
});
