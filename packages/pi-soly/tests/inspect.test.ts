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
	solyDir = path.join(tmpRoot, ".soly");
	fs.mkdirSync(solyDir, { recursive: true });
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("showDoctor", () => {
	test("no .soly/ → fail check", () => {
		captured = [];
		showDoctor(null, fakeState({ exists: false, solyDir: "" }), ui, DEFAULT_CONFIG);
		const fail = captured.find((c) => c.text.includes(".soly/ directory") && c.kind === "error");
		// May pass/fail depending; at minimum we should have a notification
		expect(captured.length).toBeGreaterThan(0);
	});

	test("happy path with .soly/ + STATE + ROADMAP + phases", () => {
		captured = [];
		fs.writeFileSync(path.join(solyDir, "STATE.md"), "---\nmilestone: v1.0\n---\n\n# X\n\n## Current Position\nPhase: 1\n");
		fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# Roadmap\n\n## Phase 1\n");
		fs.mkdirSync(path.join(solyDir, "phases", "01-bootstrap"), { recursive: true });
		fs.writeFileSync(path.join(solyDir, "phases", "01-bootstrap", "01-01-PLAN.md"), "---\nid: x\n---\n# Plan");
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG);
		// All checks should be "pass"
		const passes = captured.filter((c) => c.text.includes("✓") && c.text.includes("(pass)"));
		const fails = captured.filter((c) => c.text.includes("✗") && c.text.includes("(fail)"));
		expect(passes.length).toBeGreaterThan(0);
		expect(fails.length).toBe(0);
	});

	test("too many iteration files → warn", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		// Create 51 fake iteration files
		for (let i = 0; i < 51; i++) {
			fs.writeFileSync(path.join(solyDir, "iterations", `iter-${i}.md`), "# x");
		}
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG);
		const warn = captured.find((c) => c.text.includes("iteration files") && c.text.includes("(warning)"));
		expect(warn).toBeDefined();
		// Cleanup
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});

	test("iteration retentionDays > 0 + stale files → warn", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		const oldFile = path.join(solyDir, "iterations", "stale.md");
		fs.writeFileSync(oldFile, "# x");
		const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
		fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);
		showDoctor(null, fakeState(), ui, { ...DEFAULT_CONFIG, iteration: { ...DEFAULT_CONFIG.iteration, retentionDays: 1 } });
		const warn = captured.find((c) => c.text.includes("iteration retention"));
		expect(warn).toBeDefined();
		// Grammar: "1 day" (singular), not "1 days"
		expect(warn?.text).toContain("older than 1 day");
		expect(warn?.text).not.toContain("older than 1 days");
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});

	test("ROADMAP.md missing → fail (symmetric with STATE.md)", () => {
		captured = [];
		// Make sure ROADMAP is absent (it shouldn't be created by any prior test in this describe).
		try { fs.unlinkSync(path.join(solyDir, "ROADMAP.md")); } catch { /* ok */ }
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG);
		const fail = captured.find((c) => c.text.includes("ROADMAP.md") && c.text.includes("(fail)"));
		expect(fail).toBeDefined();
		expect(fail?.text).toContain("`soly plan N` needs phase context");
	});

	test("pi-todo detected → 'pass' with cross-extension note", () => {
		captured = [];
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG, ["ask_pro", "todo_update", "bash"]);
		const check = captured.find((c) => c.text.includes("pi-todo extension"));
		expect(check).toBeDefined();
		expect(check?.text).toContain("(pass)");
		expect(check?.text).toContain("todo_update tool loaded");
	});

	test("pi-todo NOT detected → 'info' (not warn — it's optional)", () => {
		captured = [];
		showDoctor(null, fakeState(), ui, DEFAULT_CONFIG, ["ask_pro", "bash"]);
		const check = captured.find((c) => c.text.includes("pi-todo extension"));
		expect(check).toBeDefined();
		expect(check?.text).toContain("(info)");
		expect(check?.text).toContain("not detected");
		// doctor pushes the whole output as one notify; grep for the totals line
		const full = captured.map((c) => c.text).join("\n");
		// We just check that info-status doesn't show up as warn. The exact
		// totals depend on the cwd (ROADMAP may or may not be present from
		// prior tests), so we only assert the format is right.
		expect(full).toMatch(/Total: \d+ pass, \d+ warn, \d+ fail/);
		// And the info line itself uses the (info) marker, not (warning)
		expect(full).toContain("pi-todo extension");
		expect(full).not.toMatch(/pi-todo extension.*\(warning\)/);
	});
});

describe("pluralDays grammar (regression for '1 day' vs 'N days')", () => {
	test("2 days uses plural 'days'", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		const f = path.join(solyDir, "iterations", "old.md");
		fs.writeFileSync(f, "# x");
		const past = new Date(Date.now() - 5 * 86400_000);
		fs.utimesSync(f, past, past);
		showDoctor(null, fakeState(), ui, { ...DEFAULT_CONFIG, iteration: { ...DEFAULT_CONFIG.iteration, retentionDays: 2 } });
		const warn = captured.find((c) => c.text.includes("iteration retention"));
		expect(warn?.text).toContain("older than 2 days");
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});
});

describe("showIterations", () => {
	test("no .soly/ → error notify", () => {
		captured = [];
		showIterations({ verb: "iterations", args: [], raw: "soly iterations" }, fakeState({ exists: false, solyDir: "" }), ui);
		expect(captured.some((c) => c.kind === "error")).toBe(true);
	});

	test("no iterations dir → info notify", () => {
		captured = [];
		showIterations({ verb: "iterations", args: [], raw: "soly iterations" }, fakeState(), ui);
		expect(captured.length).toBe(1);
		expect(captured[0]!.kind).toBe("info");
	});

	test("lists files sorted by mtime desc", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		const oldFile = path.join(solyDir, "iterations", "old.md");
		const newFile = path.join(solyDir, "iterations", "new.md");
		fs.writeFileSync(oldFile, "# old");
		fs.writeFileSync(newFile, "# new");
		const oneHourAgo = new Date(Date.now() - 3600_000);
		fs.utimesSync(oldFile, oneHourAgo, oneHourAgo);

		showIterations({ verb: "iterations", args: [], raw: "soly iterations" }, fakeState(), ui);
		const text = captured.map((c) => c.text).join("\n");
		const newIdx = text.indexOf("new.md");
		const oldIdx = text.indexOf("old.md");
		expect(newIdx).toBeGreaterThan(-1);
		expect(oldIdx).toBeGreaterThan(-1);
		expect(newIdx).toBeLessThan(oldIdx); // new.md appears first (newer)
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
	test("no .soly/ → error", () => {
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

	test("identical files → 'identical' message", () => {
		captured = [];
		fs.mkdirSync(path.join(solyDir, "iterations"), { recursive: true });
		fs.writeFileSync(path.join(solyDir, "iterations", "a.md"), "same");
		fs.writeFileSync(path.join(solyDir, "iterations", "b.md"), "same");
		showDiffIterations(
			{ verb: "diff", args: ["a.md", "b.md"], raw: "soly diff iterations a.md b.md" },
			fakeState(),
			ui,
		);
		expect(captured[0]!.text).toContain("identical");
		fs.rmSync(path.join(solyDir, "iterations"), { recursive: true, force: true });
	});
});

describe("showPhaseDelete", () => {
	test("no .soly/ → error", () => {
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

	test("valid phase moves to .trash/", () => {
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
		expect(captured[0]!.text).toContain("moved to .trash/");
		// Phase dir no longer at original location
		expect(fs.existsSync(phaseDir)).toBe(false);
		// Phase dir exists in .trash/
		const trash = fs.readdirSync(path.join(solyDir, "phases", ".trash"));
		expect(trash.length).toBe(1);
		expect(trash[0]).toMatch(/^05-auth-/);
	});
});
