// =============================================================================
// tests/quota.test.ts — quota provider system (format, registry, poller)
// =============================================================================
//
// Covers the pure pieces: formatReset edge cases, registry resolution
// (exact + region-suffix fallback), and the poller's write-into-ChromeData
// behavior with a mock provider. The MiniMax adapter's mmx subprocess is
// not exercised here (network/CLI dependent) — only its JSON parser via
// parseGeneralQuota would be testable, but it's not exported. The e2e
// test (pi-install-e2e) covers that the module loads.
// =============================================================================

import { describe, test, expect } from "bun:test";
import { formatReset } from "../quota/format.ts";
import { registerQuotaProvider, getQuotaProvider, resolveQuotaProvider } from "../quota/registry.ts";
import type { QuotaProvider, QuotaSnapshot } from "../quota/types.ts";
import { startQuotaPoller } from "../quota/poller.ts";
import { emptyChromeData } from "../visual/data.ts";

// ---------------------------------------------------------------------------
// formatReset
// ---------------------------------------------------------------------------

describe("formatReset", () => {
	test("returns 'now' for zero or negative", () => {
		expect(formatReset(0)).toBe("now");
		expect(formatReset(-1000)).toBe("now");
	});

	test("formats sub-hour durations as 'in Nm'", () => {
		expect(formatReset(60_000)).toBe("in 1m");
		expect(formatReset(1_200_000)).toBe("in 20m");
		expect(formatReset(59 * 60_000)).toBe("in 59m");
	});

	test("formats whole hours without minutes", () => {
		expect(formatReset(3_600_000)).toBe("in 1h");
		expect(formatReset(7_200_000)).toBe("in 2h");
		expect(formatReset(5 * 3_600_000)).toBe("in 5h");
	});

	test("formats hours + minutes", () => {
		expect(formatReset(9_000_000)).toBe("in 2h30m");
		expect(formatReset(3_600_000 + 15 * 60_000)).toBe("in 1h15m");
	});
});

// ---------------------------------------------------------------------------
// registry — resolveQuotaProvider region-suffix fallback
// ---------------------------------------------------------------------------

describe("resolveQuotaProvider", () => {
	const mock: QuotaProvider = {
		id: "testprov",
		async fetch() {
			return { remainingPercent: 42, resetsInMs: 1000 };
		},
	};

	test("exact match returns the provider", () => {
		registerQuotaProvider(mock);
		expect(resolveQuotaProvider("testprov")).toBe(mock);
	});

	test("region suffix falls back to base id", () => {
		// "testprov-cn" should resolve to the "testprov" adapter.
		expect(resolveQuotaProvider("testprov-cn")).toBe(mock);
		expect(resolveQuotaProvider("testprov-eu")).toBe(mock);
	});

	test("unknown provider returns undefined", () => {
		expect(resolveQuotaProvider("nonexistent")).toBeUndefined();
		expect(resolveQuotaProvider("nonexistent-cn")).toBeUndefined();
	});

	test("getQuotaProvider is exact-match only (no fallback)", () => {
		expect(getQuotaProvider("testprov")).toBe(mock);
		expect(getQuotaProvider("testprov-cn")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// poller — writes quota into ChromeData
// ---------------------------------------------------------------------------

describe("startQuotaPoller", () => {
	test("writes snapshot into ChromeData on first tick", async () => {
		const data = emptyChromeData();
		data.modelProvider = "mockprov";
		const snapshot: QuotaSnapshot = { remainingPercent: 67, resetsInMs: 1_200_000 };
		const mockProv: QuotaProvider = {
			id: "mockprov",
			async fetch() {
				return snapshot;
			},
		};
		registerQuotaProvider(mockProv);

		const poller = startQuotaPoller(data, () => true, 10);
		// The first tick is async (fires immediately). Give it a tick.
		await new Promise((r) => setTimeout(r, 50));

		expect(data.quotaPercent).toBe(67);
		expect(data.quotaResetsLabel).toBe("in 20m");
		poller.stop();
	});

	test("clears quota when provider has no adapter", async () => {
		const data = emptyChromeData();
		data.modelProvider = "no-adapter-prov";
		data.quotaPercent = 50; // pre-existing value
		data.quotaResetsLabel = "in 10m";

		const poller = startQuotaPoller(data, () => true, 10);
		await new Promise((r) => setTimeout(r, 50));

		expect(data.quotaPercent).toBeNull();
		expect(data.quotaResetsLabel).toBeNull();
		poller.stop();
	});

	test("keeps previous snapshot on fetch failure (null)", async () => {
		const data = emptyChromeData();
		data.modelProvider = "flakyprov";
		data.quotaPercent = 80; // pre-existing
		data.quotaResetsLabel = "in 5m";
		const flaky: QuotaProvider = {
			id: "flakyprov",
			async fetch() {
				return null; // fetch failed
			},
		};
		registerQuotaProvider(flaky);

		const poller = startQuotaPoller(data, () => true, 10);
		await new Promise((r) => setTimeout(r, 50));

		// Previous value kept — stale is better than flashing.
		expect(data.quotaPercent).toBe(80);
		expect(data.quotaResetsLabel).toBe("in 5m");
		poller.stop();
	});

	test("does nothing when disabled", async () => {
		const data = emptyChromeData();
		data.modelProvider = "mockprov";

		const poller = startQuotaPoller(data, () => false, 10);
		await new Promise((r) => setTimeout(r, 50));

		expect(data.quotaPercent).toBeNull();
		poller.stop();
	});

	test("stop() cancels the timer (no further ticks)", async () => {
		const data = emptyChromeData();
		data.modelProvider = "mockprov";
		let fetchCount = 0;
		const countingProv: QuotaProvider = {
			id: "mockprov",
			async fetch() {
				fetchCount++;
				return { remainingPercent: 10, resetsInMs: null };
			},
		};
		// Overwrite the earlier mockprov registration.
		registerQuotaProvider(countingProv);

		const poller = startQuotaPoller(data, () => true, 10);
		await new Promise((r) => setTimeout(r, 30));
		poller.stop();
		const countAtStop = fetchCount;
		// Wait past one interval — no new fetches should fire.
		await new Promise((r) => setTimeout(r, 50));
		expect(fetchCount).toBe(countAtStop);
	});
});
