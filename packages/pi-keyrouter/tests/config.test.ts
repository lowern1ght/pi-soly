// =============================================================================
// tests/config.test.ts — config loader tests (user-level only)
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultConfig, loadConfig, configPath } from "../config.ts";

let tmp: string;

function fakeHome(): string {
	const h = path.join(tmp, "fake-home");
	// Mirror the real layout: ~/.pi/keyrouter.json
	fs.mkdirSync(path.join(h, ".pi"), { recursive: true });
	return h;
}

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keyrouter-cfg-"));
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("defaultConfig", () => {
	test("returns empty config with sensible defaults", () => {
		const cfg = defaultConfig();
		expect(cfg.providers).toEqual([]);
		expect(cfg.maxRetries).toBe(3);
		expect(cfg.cooldownMs).toBe(60_000);
	});
});

describe("configPath", () => {
	test("points at ~/.pi/keyrouter.json (never project-scoped)", () => {
		const home = fakeHome();
		const p = configPath(undefined, home);
		expect(p).toBe(path.join(home, ".pi", "keyrouter.json"));
	});

	test("cwd argument is ignored — always user-level", () => {
		const home = fakeHome();
		const fromProject = configPath("/some/project", home);
		const fromRoot = configPath("/", home);
		expect(fromProject).toBe(fromRoot);
	});
});

describe("loadConfig", () => {
	test("returns default when no config file found", () => {
		const cfg = loadConfig(undefined, fakeHome());
		expect(cfg.providers).toEqual([]);
		expect(cfg.maxRetries).toBe(3);
		expect(cfg.cooldownMs).toBe(60_000);
	});

	test("loads from ~/.pi/keyrouter.json", () => {
		const home = fakeHome();
		fs.writeFileSync(
			path.join(home, ".pi", "keyrouter.json"),
			JSON.stringify({
				providers: [
					{
						name: "z-ai",
						match: ["api.z.ai"],
						keys: [
							{ name: "primary", value: "k1" },
							{ name: "backup", value: "k2" },
						],
					},
				],
			}),
		);
		const cfg = loadConfig(undefined, home);
		expect(cfg.providers.length).toBe(1);
		expect(cfg.providers[0]?.name).toBe("z-ai");
		expect(cfg.providers[0]?.keys.length).toBe(2);
	});

	test("ignores malformed JSON, returns default", () => {
		const home = fakeHome();
		fs.writeFileSync(path.join(home, ".pi", "keyrouter.json"), "{ not valid json");
		const cfg = loadConfig(undefined, home);
		expect(cfg.providers).toEqual([]);
	});

	test("filters out invalid provider entries", () => {
		const home = fakeHome();
		fs.writeFileSync(
			path.join(home, ".pi", "keyrouter.json"),
			JSON.stringify({
				providers: [
					{ name: "valid", match: ["x"], keys: [{ name: "a", value: "v" }] },
					{ name: "missing-match" },
					{ name: "missing-keys", match: ["x"] },
					{ keys: [{ name: "a", value: "v" }] },
				],
			}),
		);
		const cfg = loadConfig(undefined, home);
		expect(cfg.providers.length).toBe(1);
		expect(cfg.providers[0]?.name).toBe("valid");
	});

	test("applies custom maxRetries and cooldownMs", () => {
		const home = fakeHome();
		fs.writeFileSync(
			path.join(home, ".pi", "keyrouter.json"),
			JSON.stringify({ providers: [], maxRetries: 5, cooldownMs: 30_000 }),
		);
		const cfg = loadConfig(undefined, home);
		expect(cfg.maxRetries).toBe(5);
		expect(cfg.cooldownMs).toBe(30_000);
	});

	test("falls back to default maxRetries/cooldownMs when not specified", () => {
		const home = fakeHome();
		fs.writeFileSync(path.join(home, ".pi", "keyrouter.json"), JSON.stringify({ providers: [] }));
		const cfg = loadConfig(undefined, home);
		expect(cfg.maxRetries).toBe(3);
		expect(cfg.cooldownMs).toBe(60_000);
	});

	test("NEVER reads from cwd — project-local keyrouter.json is ignored", () => {
		// This is a security guarantee: even if a malicious project drops a
		// keyrouter.json in cwd, we don't load it (would let a repo override
		// the user's keys).
		const home = fakeHome();
		const project = path.join(tmp, "project");
		fs.mkdirSync(project, { recursive: true });
		fs.writeFileSync(
			path.join(project, "keyrouter.json"),
			JSON.stringify({ providers: [{ name: "evil", match: ["x"], keys: [{ name: "a", value: "stolen" }] }] }),
		);
		const cfg = loadConfig(project, home);
		expect(cfg.providers).toEqual([]); // project config ignored
	});
});