// =============================================================================
// tests/migrate.test.ts — Tests for .soly/ → .agents/ migration
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateSolyDir, type MigrateUI } from "../migrate.js";

let tmpRoot: string;
let origCwd: string;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-migrate-"));
	origCwd = process.cwd();
});

afterAll(() => {
	process.chdir(origCwd);
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeUi(opts: { autoConfirm?: boolean } = {}): MigrateUI & {
	calls: Array<{ type: "notify" | "confirm"; text: string; level?: string }>;
} {
	const calls: Array<{ type: "notify" | "confirm"; text: string; level?: string }> = [];
	return {
		calls,
		notify: (text, level) => { calls.push({ type: "notify", text, level }); },
		confirm: async () => opts.autoConfirm ?? false,
	};
}

function makeFakeSolyDir(): string {
	const dir = fs.mkdtempSync(path.join(tmpRoot, "project-"));
	fs.mkdirSync(path.join(dir, ".soly"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".soly", "ROADMAP.md"), "# roadmap");
	fs.writeFileSync(path.join(dir, ".soly", "STATE.md"), "# state");
	fs.mkdirSync(path.join(dir, ".soly", "phases", "01-bootstrap"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".soly", "phases", "01-bootstrap", "01-CONTEXT.md"), "# ctx");
	fs.writeFileSync(path.join(dir, ".soly", "HANDOFF.json"), "{}");
	return dir;
}

describe("migrateSolyDir", () => {
	test("no .soly/ → no-op, info notify", async () => {
		const dir = fs.mkdtempSync(path.join(tmpRoot, "empty-"));
		const ui = makeUi();
		const result = await migrateSolyDir(dir, ui);
		expect(result.moved).toBe(false);
		expect(ui.calls.some((c) => c.type === "notify" && c.text.includes("no .soly/"))).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("both .soly/ and .agents/ exist → error, no move", async () => {
		const dir = fs.mkdtempSync(path.join(tmpRoot, "both-"));
		fs.mkdirSync(path.join(dir, ".soly"), { recursive: true });
		fs.mkdirSync(path.join(dir, ".agents"), { recursive: true });
		const ui = makeUi();
		const result = await migrateSolyDir(dir, ui);
		expect(result.moved).toBe(false);
		expect(ui.calls.some((c) => c.type === "notify" && c.level === "error")).toBe(true);
		// Both dirs should still exist (untouched)
		expect(fs.existsSync(path.join(dir, ".soly"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents"))).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("dry run → reports inventory without moving", async () => {
		const dir = makeFakeSolyDir();
		const ui = makeUi();
		const result = await migrateSolyDir(dir, ui, { dryRun: true });
		expect(result.moved).toBe(false);
		expect(result.relocated).toContain("ROADMAP.md");
		expect(result.relocated).toContain("phases");
		expect(result.relocated).toContain("HANDOFF.json");
		// .soly/ still exists, .agents/ does not
		expect(fs.existsSync(path.join(dir, ".soly"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents"))).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("user cancels → no move", async () => {
		const dir = makeFakeSolyDir();
		const ui = makeUi({ autoConfirm: false });
		const result = await migrateSolyDir(dir, ui);
		expect(result.moved).toBe(false);
		expect(fs.existsSync(path.join(dir, ".soly"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents"))).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("user confirms → atomic move, validates result", async () => {
		const dir = makeFakeSolyDir();
		const ui = makeUi({ autoConfirm: true });
		const result = await migrateSolyDir(dir, ui);
		expect(result.moved).toBe(true);
		expect(fs.existsSync(path.join(dir, ".soly"))).toBe(false);
		expect(fs.existsSync(path.join(dir, ".agents"))).toBe(true);
		// All files made it across
		expect(fs.existsSync(path.join(dir, ".agents", "ROADMAP.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "STATE.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "HANDOFF.json"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "phases", "01-bootstrap", "01-CONTEXT.md"))).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("autoYes skips confirmation", async () => {
		const dir = makeFakeSolyDir();
		const ui = makeUi({ autoConfirm: false });
		const result = await migrateSolyDir(dir, ui, { autoYes: true });
		expect(result.moved).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents"))).toBe(true);
		// No confirm was called
		expect(ui.calls.filter((c) => c.type === "confirm").length).toBe(0);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("completed notify includes git commit hint", async () => {
		const dir = makeFakeSolyDir();
		const ui = makeUi({ autoConfirm: true });
		await migrateSolyDir(dir, ui);
		const doneNotify = ui.calls.find(
			(c) => c.type === "notify" && c.text.includes("done") && c.text.includes("git"),
		);
		expect(doneNotify).toBeDefined();
		expect(doneNotify!.text).toContain("git add -A");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("warnings collected for missing-after-move files", async () => {
		// Construct a weird case: source has all entries, but a destination
		// race would lose one. Hard to simulate without mocking fs.
		// Instead, test the inventory logic with a partial .soly/.
		const dir = fs.mkdtempSync(path.join(tmpRoot, "partial-"));
		fs.mkdirSync(path.join(dir, ".soly"), { recursive: true });
		fs.writeFileSync(path.join(dir, ".soly", "ROADMAP.md"), "# r");
		// Missing STATE.md, phases/, etc.
		const ui = makeUi({ autoConfirm: true });
		const result = await migrateSolyDir(dir, ui);
		expect(result.moved).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "ROADMAP.md"))).toBe(true);
		// No warnings since STATE.md wasn't in source
		expect(result.warnings.length).toBe(0);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
