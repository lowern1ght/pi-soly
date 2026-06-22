import { describe, expect, it } from "bun:test";
import { ToolCache } from "../mcp/tool-cache.ts";
import type { McpExtensionState } from "../mcp/state.ts";

/**
 * `showStatus` lives in mcp/commands.ts and pulls cache stats off the state
 * object via `state.toolCache.stats()`. We exercise the rendering branch in
 * isolation: build a minimal state, capture `ctx.ui.notify`, and assert the
 * rendered text contains the expected cache block.
 *
 * Kept separate from mcp-tool-cache.test.ts so the surface under test is the
 * panel rendering, not the cache primitive.
 */

type Notified = { body: string; level: string };

async function renderStatus(state: McpExtensionState): Promise<Notified> {
	const { showStatus } = await import("../mcp/commands.ts");
	const notified: Notified = { body: "", level: "" };
	const ctx = {
		hasUI: true,
		ui: {
			notify(body: string, level: string) {
				notified.body = body;
				notified.level = level;
			},
		},
	} as never;
	await showStatus(state, ctx as never);
	return notified;
}

function fakeState(toolCache: ToolCache | undefined): McpExtensionState {
	return {
		manager: {} as never,
		lifecycle: {} as never,
		toolMetadata: new Map(),
		config: { mcpServers: {} } as never,
		failureTracker: new Map(),
		uiResourceHandler: {} as never,
		consentManager: {} as never,
		uiServer: null,
		completedUiSessions: [],
		toolCache,
		openBrowser: async () => {},
	} as McpExtensionState;
}

describe("showStatus — cache stats block", () => {
	it("omits the Cache block when the cache has seen no traffic", async () => {
		const cache = new ToolCache(60_000);
		const { body } = await renderStatus(fakeState(cache));
		expect(body).not.toContain("Cache:");
	});

	it("omits the Cache block when no cache is attached (defensive)", async () => {
		const { body } = await renderStatus(fakeState(undefined));
		expect(body).not.toContain("Cache:");
	});

	it("renders size/hits/misses/expirations and a hit-rate percent after traffic", async () => {
		const cache = new ToolCache(60_000);
		// Seed: 2 entries, 8 hits, 2 misses, 1 expiration.
		cache.set("a", 1);
		cache.set("b", 2);
		for (let i = 0; i < 8; i++) cache.get("a");
		cache.get("missing-1");
		cache.get("missing-2");
		// Force one expiration by setting with ttl=0 (already expired by clock).
		cache.set("c", 3, 0);
		// Advance reads will treat it as expired, but we want exactly 1
		// expiration in stats — `set` itself does not bump expirations,
		// only `get` on an already-expired entry does. With TTL 0 the
		// next `get` will trip exactly one expiration.
		cache.get("c");

		const { body } = await renderStatus(fakeState(cache));

		expect(body).toContain("Cache: 2 entries");
		expect(body).toContain("8 hits");
		// 'c' has ttl=0, so the very next get() trips an expiration AND a miss.
		expect(body).toContain("3 misses");
		expect(body).toContain("1 expired");
		// 8 / (8+3) = 73% (rounded)
		expect(body).toContain("73% hit rate");
	});

	it("renders 0% hit rate when there are misses but no hits", async () => {
		const cache = new ToolCache(60_000);
		cache.set("a", 1);
		cache.get("missing");
		const { body } = await renderStatus(fakeState(cache));
		expect(body).toContain("0% hit rate");
		expect(body).toContain("1 entries");
		expect(body).toContain("0 hits");
		expect(body).toContain("1 misses");
	});

	it("renders 0% hit rate (no NaN) when only expirations have happened", async () => {
		let now = 0;
		const cache = new ToolCache(1000, () => now);
		cache.set("a", 1, 1000);
		now = 5000;
		cache.get("a"); // counts as miss + expiration; no hit
		const { body } = await renderStatus(fakeState(cache));
		expect(body).toContain("0% hit rate");
		expect(body).toContain("1 expired");
	});
});
