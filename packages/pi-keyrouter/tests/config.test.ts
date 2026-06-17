// =============================================================================
// tests/config.test.ts — config loader tests
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultConfig, loadConfig } from "../config.ts";

let tmp: string;

function fakeHome(): string {
	const h = path.join(tmp, "fake-home");
	fs.mkdirSync(h, { recursive: true });
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

describe("loadConfig", () => {
	test("returns default when no config file found", () => {
		const cfg = loadConfig(tmp, fakeHome());
		expect(cfg.providers).toEqual([]);
		expect(cfg.maxRetries).toBe(3);
		expect(cfg.cooldownMs).toBe(60_000);
	});

	test("loads from cwd/.pi/keyrouter.json", () => {
		const dir = path.join(tmp, ".pi");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "keyrouter.json"),
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
		const cfg = loadConfig(tmp, fakeHome());
		expect(cfg.providers.length).toBe(1);
		expect(cfg.providers[0]?.name).toBe("z-ai");
		expect(cfg.providers[0]?.keys.length).toBe(2);
	});

	test("ignores malformed JSON, returns default", () => {
		fs.writeFileSync(path.join(tmp, "keyrouter.json"), "{ not valid json");
		const cfg = loadConfig(tmp, fakeHome());
		expect(cfg.providers).toEqual([]);
	});

	test("filters out invalid provider entries", () => {
		fs.writeFileSync(
			path.join(tmp, "keyrouter.json"),
			JSON.stringify({
				providers: [
					{ name: "valid", match: ["x"], keys: [{ name: "a", value: "v" }] },
					{ name: "missing-match" },
					{ name: "missing-keys", match: ["x"] },
					{ keys: [{ name: "a", value: "v" }] },
				],
			}),
		);
		const cfg = loadConfig(tmp, fakeHome());
		expect(cfg.providers.length).toBe(1);
		expect(cfg.providers[0]?.name).toBe("valid");
	});

	test("applies custom maxRetries and cooldownMs", () => {
		fs.writeFileSync(
			path.join(tmp, "keyrouter.json"),
			JSON.stringify({ providers: [], maxRetries: 5, cooldownMs: 30_000 }),
		);
		const cfg = loadConfig(tmp, fakeHome());
		expect(cfg.maxRetries).toBe(5);
		expect(cfg.cooldownMs).toBe(30_000);
	});

	test("falls back to default maxRetries/cooldownMs when not specified", () => {
		fs.writeFileSync(path.join(tmp, "keyrouter.json"), JSON.stringify({ providers: [] }));
		const cfg = loadConfig(tmp, fakeHome());
		expect(cfg.maxRetries).toBe(3);
		expect(cfg.cooldownMs).toBe(60_000);
	});
});