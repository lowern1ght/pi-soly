// =============================================================================
// tests/watcher.test.ts — Tests for rotor hot-reload watcher
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { watchRotors } from "../watcher.js";

let tmpRoot: string;
let fakeHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotor-watch-"));
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

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

describe("watchRotors", () => {
	test("calls onChange when a rotor .md is added", async () => {
		const projectDir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
		fs.mkdirSync(path.join(projectDir, ".agents"), { recursive: true });
		let changes = 0;
		const handle = watchRotors(projectDir, {
			home: fakeHome,
			onChange: () => { changes++; },
		});
		try {
			fs.writeFileSync(path.join(projectDir, ".agents", "new-rotor.md"), "---\nname: new-rotor\n---\n# body");
			await sleep(400);
			expect(changes).toBeGreaterThan(0);
		} finally {
			handle.stop();
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	});

	test("coalesces multiple rapid changes into one onChange", async () => {
		const projectDir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
		fs.mkdirSync(path.join(projectDir, ".agents"), { recursive: true });
		let changes = 0;
		const handle = watchRotors(projectDir, {
			home: fakeHome,
			onChange: () => { changes++; },
		});
		try {
			// Burst: 3 quick writes
			fs.writeFileSync(path.join(projectDir, ".agents", "a.md"), "x");
			await sleep(50);
			fs.writeFileSync(path.join(projectDir, ".agents", "a.md"), "xy");
			await sleep(50);
			fs.writeFileSync(path.join(projectDir, ".agents", "a.md"), "xyz");
			await sleep(400); // wait past debounce
			// All three bursts collapse into ~1-2 calls (debounce)
			expect(changes).toBeLessThan(3);
			expect(changes).toBeGreaterThanOrEqual(1);
		} finally {
			handle.stop();
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	});

	test("ignores non-.md files", async () => {
		const projectDir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
		fs.mkdirSync(path.join(projectDir, ".agents"), { recursive: true });
		let changes = 0;
		const handle = watchRotors(projectDir, {
			home: fakeHome,
			onChange: () => { changes++; },
		});
		try {
			fs.writeFileSync(path.join(projectDir, ".agents", "notes.txt"), "ignore me");
			fs.writeFileSync(path.join(projectDir, ".agents", ".hidden.md"), "also ignore");
			await sleep(300);
			expect(changes).toBe(0);
		} finally {
			handle.stop();
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	});

	test("calls onNotify with summary", async () => {
		const projectDir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
		fs.mkdirSync(path.join(projectDir, ".agents"), { recursive: true });
		const notifies: string[] = [];
		const handle = watchRotors(projectDir, {
			home: fakeHome,
			onChange: () => {},
			onNotify: (msg) => { notifies.push(msg); },
		});
		try {
			fs.writeFileSync(path.join(projectDir, ".agents", "x.md"), "x");
			await sleep(1000); // debounce (200) + coalesce (500) + buffer
			expect(notifies.length).toBeGreaterThan(0);
			expect(notifies[0]).toContain("rotors reloaded");
		} finally {
			handle.stop();
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	});

	test("stop() prevents further callbacks", async () => {
		const projectDir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
		fs.mkdirSync(path.join(projectDir, ".agents"), { recursive: true });
		let changes = 0;
		const handle = watchRotors(projectDir, {
			home: fakeHome,
			onChange: () => { changes++; },
		});
		handle.stop();
		fs.writeFileSync(path.join(projectDir, ".agents", "a.md"), "x");
		await sleep(300);
		expect(changes).toBe(0);
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	test("handles non-existent dirs gracefully (creates them)", () => {
		const projectDir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
		// Don't create .agents — watcher should create it
		const handle = watchRotors(projectDir, {
			home: fakeHome,
			onChange: () => {},
		});
		// .agents should now exist (created by watchRotors)
		expect(fs.existsSync(path.join(projectDir, ".agents"))).toBe(true);
		handle.stop();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});
});
