// =============================================================================
// tests/notifications-log.test.ts — Tests for the notification history log
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendNotification, readNotifications, formatNotifications, logFilePath } from "../notifications-log.js";

let tmpRoot: string;
let fakeHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-notif-log-"));
	fakeHome = path.join(tmpRoot, "home");
	fs.mkdirSync(fakeHome, { recursive: true });
	origHome = process.env.HOME;
	origUserProfile = process.env.USERPROFILE;
	process.env.HOME = fakeHome;
	process.env.USERPROFILE = fakeHome;
});

afterAll(() => {
	if (origHome !== undefined) process.env.HOME = origHome;
	if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeProject(): string {
	return fs.mkdtempSync(path.join(tmpRoot, "proj-"));
}

describe("appendNotification", () => {
	test("creates log file in .agents/.soly/notifications.log", () => {
		const proj = makeProject();
		appendNotification(proj, { kind: "nudge", title: "soly · non-trivial", body: ["line 1"] });
		const logPath = logFilePath(proj);
		expect(fs.existsSync(logPath)).toBe(true);
		const content = fs.readFileSync(logPath, "utf-8");
		expect(content).toContain("soly · non-trivial");
		expect(content).toContain("line 1");
		fs.rmSync(proj, { recursive: true, force: true });
	});

	test("appends multiple entries as JSONL", () => {
		const proj = makeProject();
		appendNotification(proj, { kind: "nudge", title: "first", body: [] });
		appendNotification(proj, { kind: "deprecation", title: "second", body: [] });
		appendNotification(proj, { kind: "info", title: "third", body: [] });
		const content = fs.readFileSync(logFilePath(proj), "utf-8");
		const lines = content.split("\n").filter((l) => l.length > 0);
		expect(lines.length).toBe(3);
		// Each line is valid JSON
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
		fs.rmSync(proj, { recursive: true, force: true });
	});

	test("includes ISO timestamp", () => {
		const proj = makeProject();
		appendNotification(proj, { kind: "info", title: "t", body: [] });
		const entries = readNotifications(proj);
		expect(entries.length).toBe(1);
		expect(entries[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		fs.rmSync(proj, { recursive: true, force: true });
	});

	test("creates parent dir if missing", () => {
		const proj = makeProject();
		// No .agents/ yet
		expect(fs.existsSync(path.join(proj, ".agents"))).toBe(false);
		appendNotification(proj, { kind: "info", title: "t", body: [] });
		expect(fs.existsSync(path.join(proj, ".agents", ".soly"))).toBe(true);
		fs.rmSync(proj, { recursive: true, force: true });
	});
});

describe("readNotifications", () => {
	test("returns empty array when log doesn't exist", () => {
		const proj = makeProject();
		expect(readNotifications(proj)).toEqual([]);
		fs.rmSync(proj, { recursive: true, force: true });
	});

	test("returns newest first", () => {
		const proj = makeProject();
		appendNotification(proj, { kind: "info", title: "old", body: [] });
		// Wait 10ms to ensure different timestamps (ISO has 1ms resolution but
		// tests run fast; on some systems two writes in the same ms collide)
		const wait = () => new Promise((r) => setTimeout(r, 10));
		// can't await in sync — but we just need the second write to land
		fs.appendFileSync(logFilePath(proj), "ignored\n", "utf-8");
		appendNotification(proj, { kind: "info", title: "new", body: [] });
		const entries = readNotifications(proj);
		expect(entries.length).toBe(2);
		expect(entries[0]?.title).toBe("new");
		expect(entries[1]?.title).toBe("old");
		fs.rmSync(proj, { recursive: true, force: true });
	});

	test("respects limit", () => {
		const proj = makeProject();
		for (let i = 0; i < 10; i++) {
			appendNotification(proj, { kind: "info", title: `entry ${i}`, body: [] });
		}
		const entries = readNotifications(proj, 3);
		expect(entries.length).toBe(3);
		fs.rmSync(proj, { recursive: true, force: true });
	});

	test("skips malformed lines", () => {
		const proj = makeProject();
		appendNotification(proj, { kind: "info", title: "valid", body: [] });
		fs.appendFileSync(logFilePath(proj), "{not valid json}\n", "utf-8");
		appendNotification(proj, { kind: "info", title: "valid2", body: [] });
		const entries = readNotifications(proj);
		expect(entries.length).toBe(2);
		expect(entries.every((e) => e.title.startsWith("valid"))).toBe(true);
		fs.rmSync(proj, { recursive: true, force: true });
	});
});

describe("formatNotifications", () => {
	test("empty list", () => {
		expect(formatNotifications([])).toContain("no notifications");
	});

	test("includes title and body", () => {
		const out = formatNotifications([
			{ ts: "2026-06-16T14:30:00Z", kind: "nudge", title: "soly · test", body: ["line 1", "line 2"] },
		]);
		expect(out).toContain("soly · test");
		expect(out).toContain("line 1");
		expect(out).toContain("line 2");
	});
});
