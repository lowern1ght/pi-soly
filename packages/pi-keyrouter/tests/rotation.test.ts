// =============================================================================
// tests/rotation.test.ts — pure rotation logic tests
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import {
	initKeyStates,
	isAvailable,
	isOverloaded,
	markBad,
	markOk,
	markOverloaded,
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
			overloadedUntil: 0,
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
			overloadedUntil: 0,
			uses: 0,
			failures: 0,
		};
		expect(isAvailable(s, 1000)).toBe(false);
		expect(isAvailable(s, 2000)).toBe(true);
		expect(isAvailable(s, 2001)).toBe(true);
	});

	test("key in overload window is not available", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "untried",
			cooldownUntil: 0,
			overloadedUntil: 2000,
			uses: 0,
			failures: 0,
		};
		expect(isAvailable(s, 1000)).toBe(false);
		expect(isAvailable(s, 2000)).toBe(true);
		expect(isAvailable(s, 2001)).toBe(true);
	});

	test("overload and cooldown are checked independently", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "rate-limited",
			cooldownUntil: 3000,
			overloadedUntil: 1500,
			uses: 0,
			failures: 1,
		};
		// At t=1000: cooldown blocks (until 3000)
		expect(isAvailable(s, 1000)).toBe(false);
		// At t=1600: overload cleared (1500), but cooldown still active
		expect(isAvailable(s, 1600)).toBe(false);
		// At t=3000: both cleared
		expect(isAvailable(s, 3000)).toBe(true);
	});
});

describe("markOverloaded / isOverloaded", () => {
	test("markOverloaded sets overloadedUntil, no failure bump", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "ok",
			cooldownUntil: 0,
			overloadedUntil: 0,
			uses: 5,
			failures: 2,
		};
		markOverloaded(s, 30000, 1000);
		expect(s.overloadedUntil).toBe(31000);
		// Overload is provider-wide, not a key-specific failure.
		expect(s.failures).toBe(2);
		expect(s.lastStatus).toBe("ok");
		expect(s.cooldownUntil).toBe(0);
	});

	test("isOverloaded reflects window", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "untried",
			cooldownUntil: 0,
			overloadedUntil: 0,
			uses: 0,
			failures: 0,
		};
		expect(isOverloaded(s, 1000)).toBe(false);
		markOverloaded(s, 5000, 1000);
		expect(isOverloaded(s, 1000)).toBe(true);
		expect(isOverloaded(s, 5999)).toBe(true);
		expect(isOverloaded(s, 6000)).toBe(false);
	});
});

describe("pickNextKey with overload", () => {
	test("skips keys in overload window even if cooldown is clear", () => {
		const states = initKeyStates([
			{ name: "a", value: "k1" },
			{ name: "b", value: "k2" },
		]);
		markOverloaded(states[0]!, 5000, 1000); // a overloaded until 6000
		// b is the only available one
		expect(pickNextKey(states, 0, 1000)).toBe(1);
	});

	test("returns soonest-expiring overload when all overloaded", () => {
		const states = initKeyStates([
			{ name: "a", value: "k1" },
			{ name: "b", value: "k2" },
		]);
		markOverloaded(states[0]!, 5000, 1000); // until 6000
		markOverloaded(states[1]!, 2000, 1000); // until 3000
		expect(pickNextKey(states, 0, 1000)).toBe(1); // b recovers first
	});

	test("single key in overload is still returned (best available option)", () => {
		// pickNextKey returns the only candidate rather than -1 — callers
		// that want to wait should consult waitForNextKey or the overload
		// status themselves. This documents the current behavior.
		const states = initKeyStates([{ name: "a", value: "k1" }]);
		markOverloaded(states[0]!, 1000, 1000); // until 2000
		expect(pickNextKey(states, 0, 1500)).toBe(0);
	});
});

describe("markBad / markOk", () => {
	test("markBad sets cooldown and status", () => {
		const s: KeyState = {
			name: "a",
			value: "k",
			lastStatus: "untried",
			cooldownUntil: 0,
			overloadedUntil: 0,
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
			overloadedUntil: 0,
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
			overloadedUntil: 0,
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
			overloadedUntil: 0,
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