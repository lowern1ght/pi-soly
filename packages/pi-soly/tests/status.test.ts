// =============================================================================
// tests/status.test.ts — Tests for the comprehensive status report
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { formatStatus, type StatusState } from "../status.js";
import { appendNotification } from "../notifications-log.js";

let tmpRoot: string;
let projDir: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-status-"));
	origHome = process.env.HOME;
	origUserProfile = process.env.USERPROFILE;
	process.env.HOME = tmpRoot;
	process.env.USERPROFILE = tmpRoot;
	projDir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
	fs.mkdirSync(path.join(projDir, ".agents"), { recursive: true });
});

afterAll(() => {
	if (origHome !== undefined) process.env.HOME = origHome;
	if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeState(overrides: Partial<StatusState> = {}): StatusState {
	return {
		exists: true,
		solyDir: path.join(projDir, ".agents"),
		milestone: "v0.6.0",
		currentPosition: "01-bootstrap (in_progress)",
		phases: [
			{ number: 1, name: "bootstrap", slug: "01-bootstrap", status: "in_progress" },
			{ number: 2, name: "auth", slug: "02-auth", status: "pending" },
		],
		...overrides,
	};
}

describe("formatStatus", () => {
	test("includes version in header", () => {
		const out = formatStatus(projDir, makeState(), { version: "1.3.0" });
		expect(out).toContain("v1.3.0");
	});


	test("shows project state (milestone + current)", () => {
		const out = formatStatus(projDir, makeState());
		expect(out).toContain("v0.6.0");
		expect(out).toContain("01-bootstrap");
	});

	test("handles missing .agents/ (no .soly/)", () => {
		const empty = makeState({ exists: false, solyDir: "" });
		const out = formatStatus(projDir, empty);
		expect(out).toContain("no .agents/");
		expect(out).toContain("/soly-init");
	});

	test("includes recent decisions from STATE.md", () => {
		fs.writeFileSync(
			path.join(projDir, ".agents", "STATE.md"),
			`# state
## Decisions

| Date | Decision | Why |
|------|----------|-----|
| 2026-06-01 | first decision | reason one |
| 2026-06-08 | second decision | reason two |
| 2026-06-15 | third decision | reason three |
`,
		);
		const out = formatStatus(projDir, makeState());
		expect(out).toContain("third decision");
		expect(out).toContain("2026-06-15");
	});

	test("caps recent decisions", () => {
		const rows = ["## Decisions\n", "| Date | Decision | Why |", "|------|----------|-----|"];
		for (let i = 0; i < 20; i++) {
			rows.push(`| 2026-06-${String(i + 1).padStart(2, "0")} | decision ${i} | why ${i} |`);
		}
		fs.writeFileSync(path.join(projDir, ".agents", "STATE.md"), rows.join("\n"));
		const out = formatStatus(projDir, makeState(), { recentDecisions: 3 });
		const decisionMatches = out.match(/decision \d+/g) ?? [];
		// 3 most recent: decision 17, 18, 19
		expect(decisionMatches.length).toBeLessThanOrEqual(3);
	});

	test("includes recent notifications from log", () => {
		for (let i = 0; i < 3; i++) {
			appendNotification(projDir, {
				kind: "nudge",
				title: `nudge ${i}`,
				body: [`body ${i}`],
			});
		}
		const out = formatStatus(projDir, makeState());
		expect(out).toContain("nudge 2");
		expect(out).toContain("nudge");
	});

	test("shows 'none recorded' when log empty", () => {
		// Use a fresh project dir so previous test notifications don't leak in
		const freshDir = fs.mkdtempSync(path.join(tmpRoot, "fresh-"));
		fs.mkdirSync(path.join(freshDir, ".agents"), { recursive: true });
		const out = formatStatus(freshDir, { ...makeState(), solyDir: path.join(freshDir, ".agents") });
		expect(out).toContain("none recorded");
		fs.rmSync(freshDir, { recursive: true, force: true });
	});

	test("includes /soly-log hint when notifications present", () => {
		appendNotification(projDir, { kind: "info", title: "x", body: [] });
		const out = formatStatus(projDir, makeState());
		expect(out).toContain("/soly-log");
	});
});
