// =============================================================================
// tests/rotation.test.ts — pure rotation logic tests
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import {
	initKeyStates,
	isAvailable,
	markBad,
	markOk,
	matchProvider,
	pickNextKey,
	recordUse,
	waitForNextKey,
} from "../rotation.ts";
import type { KeyState } from "../types.ts";

describe("initKeyStates", () => {
	test("creates state for each key", () => {
		const states = initKeyStates([
			{ name: "a", value: "key-a" },
			{ name: "b", value: "key-b" },
		]);
		expect(states.length).toBe(2);
		expect(states[0]?.name).toBe("a");
		expect(states[0]?.value).toBe("key-a");
		expect(states[0]?.lastStatus).toBe("untried");
		expect(states[0]?.cooldownUntil).toBe(0);
	});
});

describe("isAvailable", () => {
	test("untried key is available", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "untried",
			cooldownUntil: 0,
			uses: 0,
			failures: 0,
		};
		expect(isAvailable(s, 1000)).toBe(true);
	});

	test("key in cooldown is not available", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "rate-limited",
			cooldownUntil: 2000,
			uses: 0,
			failures: 0,
		};
		expect(isAvailable(s, 1000)).toBe(false);
		expect(isAvailable(s, 2000)).toBe(true);
		expect(isAvailable(s, 2001)).toBe(true);
	});
});

describe("markBad / markOk", () => {
	test("markBad sets cooldown and status", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "untried",
			cooldownUntil: 0,
			uses: 0,
			failures: 0,
		};
		markBad(s, "rate-limited", 5000, 1000);
		expect(s.lastStatus).toBe("rate-limited");
		expect(s.cooldownUntil).toBe(6000);
		expect(s.failures).toBe(1);
	});

	test("markBad with unauthorized sets correct status", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "untried",
			cooldownUntil: 0,
			uses: 0,
			failures: 0,
		};
		markBad(s, "unauthorized", 10000, 0);
		expect(s.lastStatus).toBe("unauthorized");
	});

	test("markOk clears cooldown", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "rate-limited",
			cooldownUntil: 5000,
			uses: 0,
			failures: 1,
		};
		markOk(s);
		expect(s.lastStatus).toBe("ok");
		expect(s.cooldownUntil).toBe(0);
	});
});

describe("recordUse", () => {
	test("increments uses", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "untried",
			cooldownUntil: 0,
			uses: 0,
			failures: 0,
		};
		recordUse(s);
		recordUse(s);
		expect(s.uses).toBe(2);
	});
});

describe("pickNextKey", () => {
	test("returns preferred when available", () => {
		const states = initKeyStates([
			{ name: "a", value: "k1" },
			{ name: "b", value: "k2" },
		]);
		expect(pickNextKey(states, 0, 1000)).toBe(0);
		expect(pickNextKey(states, 1, 1000)).toBe(1);
	});

	test("rotates to next when preferred on cooldown", () => {
		const states = initKeyStates([
			{ name: "a", value: "k1" },
			{ name: "b", value: "k2" },
		]);
		markBad(states[0]!, "rate-limited", 5000, 1000);
		expect(pickNextKey(states, 0, 1000)).toBe(1);
	});

	test("picks soonest-expiring when all on cooldown", () => {
		const states = initKeyStates([
			{ name: "a", value: "k1" },
			{ name: "b", value: "k2" },
		]);
		markBad(states[0]!, "rate-limited", 5000, 1000); // cooldown until 6000
		markBad(states[1]!, "rate-limited", 3000, 1000); // cooldown until 4000
		expect(pickNextKey(states, 0, 1000)).toBe(1); // b expires first
	});

	test("returns -1 for empty list", () => {
		expect(pickNextKey([], 0, 0)).toBe(-1);
	});
});

describe("matchProvider", () => {
	test("matches by URL substring (case-insensitive)", () => {
		const providers = [{ name: "z-ai", match: ["api.z.ai"] }];
		expect(matchProvider(providers, "https://api.z.ai/v1/chat")).toBeDefined();
		expect(matchProvider(providers, "https://API.Z.AI/v1/chat")).toBeDefined();
		expect(matchProvider(providers, "https://example.com")).toBeUndefined();
	});

	test("returns first matching provider", () => {
		const providers = [
			{ name: "first", match: ["example.com"] },
			{ name: "second", match: ["example.com"] },
		];
		expect(matchProvider(providers, "https://example.com")?.name).toBe("first");
	});

	test("matches one of multiple substrings", () => {
		const providers = [{ name: "z-ai", match: ["api.z.ai", "z.ai"] }];
		expect(matchProvider(providers, "https://z.ai/x")).toBeDefined();
	});
});

describe("waitForNextKey", () => {
	test("returns 0 when at least one key is available", () => {
		const states = initKeyStates([
			{ name: "a", value: "k1" },
			{ name: "b", value: "k2" },
		]);
		markBad(states[0]!, "rate-limited", 5000, 1000);
		expect(waitForNextKey(states, 1000)).toBe(0);
	});

	test("returns min cooldown when all on cooldown", () => {
		const states = initKeyStates([
			{ name: "a", value: "k1" },
			{ name: "b", value: "k2" },
		]);
		markBad(states[0]!, "rate-limited", 5000, 1000); // until 6000
		markBad(states[1]!, "rate-limited", 2000, 1000); // until 3000
		expect(waitForNextKey(states, 1000)).toBe(2000);
	});
});