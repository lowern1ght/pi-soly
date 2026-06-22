import { describe, expect, it } from "bun:test";
import { ToolCache, stableStringify, cacheKey } from "../mcp/tool-cache.ts";

describe("ToolCache", () => {
	function withClock(initial: number) {
		let now = initial;
		const cache = new ToolCache(60_000, () => now);
		return {
			cache,
			advance: (ms: number) => { now += ms; },
			setNow: (n: number) => { now = n; },
		};
	}

	it("returns undefined for an unknown key and counts a miss", () => {
		const { cache } = withClock(0);
		expect(cache.get("missing")).toBeUndefined();
		expect(cache.stats().misses).toBe(1);
		expect(cache.stats().hits).toBe(0);
	});

	it("stores and retrieves a value, counting a hit", () => {
		const { cache } = withClock(0);
		cache.set("k", { ok: true });
		expect(cache.get("k")).toEqual({ ok: true });
		expect(cache.stats().hits).toBe(1);
		expect(cache.stats().size).toBe(1);
	});

	it("returns undefined and removes an expired entry, counting miss + expiration", () => {
		const { cache, advance } = withClock(0);
		cache.set("k", "v", 1000);
		advance(1500);
		expect(cache.get("k")).toBeUndefined();
		const stats = cache.stats();
		expect(stats.expirations).toBe(1);
		expect(stats.misses).toBe(1);
		expect(stats.size).toBe(0);
	});

	it("honors per-entry ttlMs override", () => {
		const { cache, advance } = withClock(0);
		cache.set("short", "x", 100);
		cache.set("default", "y"); // uses 60_000 default
		advance(500);
		expect(cache.get("short")).toBeUndefined();
		expect(cache.get("default")).toBe("y");
	});

	it("clear() empties the cache (counters preserved)", () => {
		const { cache } = withClock(0);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.clear();
		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toBeUndefined();
		expect(cache.stats().size).toBe(0);
	});

	it("invalidateServer() drops every entry for that server", () => {
		const { cache } = withClock(0);
		cache.set("foo:tool1:x", 1);
		cache.set("foo:tool2:x", 2);
		cache.set("bar:tool1:x", 3);
		cache.invalidateServer("foo");
		expect(cache.get("foo:tool1:x")).toBeUndefined();
		expect(cache.get("foo:tool2:x")).toBeUndefined();
		expect(cache.get("bar:tool1:x")).toBe(3);
	});

	it("delete() returns true when removing an existing key", () => {
		const { cache } = withClock(0);
		cache.set("k", 1);
		expect(cache.delete("k")).toBe(true);
		expect(cache.delete("k")).toBe(false);
	});
});

describe("ToolCache — onChange callback", () => {
	it("fires after a successful set", () => {
		let calls = 0;
		const cache = new ToolCache(60_000, Date.now, () => { calls++; });
		cache.set("k", 1);
		expect(calls).toBe(1);
	});

	it("fires after a hit and after a miss", () => {
		let calls = 0;
		const cache = new ToolCache(60_000, Date.now, () => { calls++; });
		cache.set("k", 1);
		expect(calls).toBe(1);
		cache.get("k"); // hit
		expect(calls).toBe(2);
		cache.get("missing"); // miss
		expect(calls).toBe(3);
	});

	it("fires after an expiration", () => {
		let now = 0;
		const calls: number[] = [];
		const cache = new ToolCache(1000, () => now, () => { calls.push(now); });
		cache.set("k", "v", 1000);
		now = 1500;
		expect(cache.get("k")).toBeUndefined();
		expect(calls).toEqual([0, 1500]);
	});

	it("fires after invalidateServer() when at least one entry is removed", () => {
		let calls = 0;
		const cache = new ToolCache(60_000, Date.now, () => { calls++; });
		cache.set("foo:a", 1);
		cache.set("foo:b", 2);
		cache.set("bar:a", 3);
		const before = calls;
		cache.invalidateServer("foo");
		expect(calls).toBe(before + 1);
		// invalidating a server with no entries is a no-op (no spurious fires)
		cache.invalidateServer("nothing");
		expect(calls).toBe(before + 1);
	});

	it("fires after clear() when there were entries, otherwise stays silent", () => {
		let calls = 0;
		const cache = new ToolCache(60_000, Date.now, () => { calls++; });
		cache.clear(); // empty — no fire
		expect(calls).toBe(0);
		cache.set("k", 1); // fires (1)
		cache.clear(); // fires because entries existed (2)
		expect(calls).toBe(2);
	});

	it("fires after delete() only when the key existed", () => {
		let calls = 0;
		const cache = new ToolCache(60_000, Date.now, () => { calls++; });
		cache.delete("absent");
		expect(calls).toBe(0);
		cache.set("k", 1); // fires (1)
		cache.delete("k"); // fires because it existed (2)
		expect(calls).toBe(2);
	});

	it("swallows exceptions from onChange — UI refresh must never break the cache", () => {
		const cache = new ToolCache(60_000, Date.now, () => { throw new Error("boom"); });
		expect(() => cache.set("k", 1)).not.toThrow();
		expect(() => cache.get("k")).not.toThrow();
		expect(() => cache.clear()).not.toThrow();
		expect(cache.stats().size).toBe(0);
	});

	it("omitting onChange keeps the cache fully functional", () => {
		const cache = new ToolCache(60_000);
		expect(() => {
			cache.set("k", 1);
			cache.get("k");
			cache.get("missing");
			cache.clear();
		}).not.toThrow();
		expect(cache.stats()).toEqual({ size: 0, hits: 1, misses: 1, expirations: 0 });
	});
});

describe("stableStringify", () => {
	it("returns undefined for undefined input (JSON.stringify semantics)", () => {
		// cacheKey normalises undefined → {} before stringifying; stableStringify
		// itself does not — it just JSON.stringify-s the value as-is.
		expect(stableStringify(undefined)).toBeUndefined();
	});

	it("returns '{}' for an empty object", () => {
		expect(stableStringify({})).toBe("{}");
	});

	it("sorts keys so insertion order does not change the output", () => {
		const a = { z: 1, a: 2, m: { y: 3, b: 4 } };
		const b = { a: 2, m: { b: 4, y: 3 }, z: 1 };
		expect(stableStringify(a)).toBe(stableStringify(b));
	});

	it("preserves arrays in order (does NOT sort elements)", () => {
		const a = stableStringify([3, 1, 2]);
		const b = stableStringify([1, 2, 3]);
		expect(a).not.toBe(b);
	});

	it("handles primitives and null", () => {
		expect(stableStringify(42)).toBe("42");
		expect(stableStringify("hi")).toBe('"hi"');
		expect(stableStringify(null)).toBe("null");
	});
});

describe("cacheKey", () => {
	it("returns the same key for equivalent arguments regardless of order", () => {
		const k1 = cacheKey("s", "t", { a: 1, b: 2 });
		const k2 = cacheKey("s", "t", { b: 2, a: 1 });
		expect(k1).toBe(k2);
	});

	it("differs by server, tool, or args", () => {
		const base = cacheKey("s", "t", { x: 1 });
		expect(cacheKey("other", "t", { x: 1 })).not.toBe(base);
		expect(cacheKey("s", "other", { x: 1 })).not.toBe(base);
		expect(cacheKey("s", "t", { x: 2 })).not.toBe(base);
	});

	it("treats undefined args the same as {}", () => {
		expect(cacheKey("s", "t", undefined)).toBe(cacheKey("s", "t", {}));
	});
});