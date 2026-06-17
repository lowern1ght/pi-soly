// =============================================================================
// tests/smoke.test.ts — load-time smoke test
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";

describe("pi-keyrouter smoke", () => {
	test("module loads without errors", async () => {
		const mod = await import("../index.ts");
		expect(typeof mod.default).toBe("function");
	});

	test("default export accepts a mock pi", async () => {
		const mod = await import("../index.ts");
		const calls: string[] = [];
		const mockPi = new Proxy(
			{},
			{
				get: (_t, prop: string) => {
					calls.push(prop);
					return () => {};
				},
			},
		);
		expect(() => mod.default(mockPi as never)).not.toThrow();
	});

	test("config module loads", async () => {
		const { defaultConfig, loadConfig } = await import("../config.ts");
		expect(defaultConfig).toBeDefined();
		expect(loadConfig).toBeDefined();
	});

	test("rotation module loads", async () => {
		const rotation = await import("../rotation.ts");
		expect(rotation.initKeyStates).toBeDefined();
		expect(rotation.pickNextKey).toBeDefined();
		expect(rotation.markBad).toBeDefined();
		expect(rotation.markOk).toBeDefined();
		expect(rotation.matchProvider).toBeDefined();
	});
});