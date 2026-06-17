// =============================================================================
// tests/fetch-wrapper.test.ts — integration tests for the fetch wrapper
// =============================================================================
//
// Mocks globalThis.fetch with a programmable handler. Verifies:
// - On 429, rotates to next key
// - On 401, rotates to next key
// - On 200, returns response
// - After maxRetries, returns last failed response
// - onRotate callback fires with correct event
// - Non-matching URLs are not intercepted

/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installKeyRouter, type KeyRouterHandle } from "../fetch-wrapper.ts";
import type { RotationEvent } from "../types.ts";

interface MockResponse {
	status: number;
	body?: string;
	headers?: Record<string, string>;
}

let originalFetch: typeof fetch;
let responses: MockResponse[] = [];
let requests: Array<{ url: string; auth: string | null }> = [];
let handle: KeyRouterHandle | undefined;
let rotationEvents: RotationEvent[] = [];

beforeEach(() => {
	originalFetch = globalThis.fetch;
	responses = [];
	requests = [];
	rotationEvents = [];
});

afterEach(() => {
	if (handle) {
		handle.disable();
		handle = undefined;
	}
	globalThis.fetch = originalFetch;
});

function queueResponses(...resp: MockResponse[]): void {
	responses.push(...resp);
}

function mockFetch(): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const auth = (init?.headers as Headers | undefined)?.get?.("Authorization") ?? null;
		requests.push({ url, auth });
		const resp = responses.shift();
		if (!resp) {
			return new Response("no mock response queued", { status: 599 });
		}
		return new Response(resp.body ?? "", {
			status: resp.status,
			headers: resp.headers ?? {},
		});
	}) as typeof fetch;
}

describe("fetch wrapper — non-matching URL", () => {
	test("does not intercept", async () => {
		globalThis.fetch = mockFetch();
		queueResponses({ status: 200, body: "ok" });
		handle = installKeyRouter(
			{
				providers: [{ name: "z-ai", match: ["api.z.ai"], keys: [{ name: "a", value: "k1" }] }],
				maxRetries: 3,
				cooldownMs: 1000,
			},
			(e) => rotationEvents.push(e),
		);
		const resp = await fetch("https://example.com/api");
		expect(resp.status).toBe(200);
		expect(rotationEvents.length).toBe(0);
	});
});

describe("fetch wrapper — success", () => {
	test("returns 200 with the configured key", async () => {
		globalThis.fetch = mockFetch();
		queueResponses({ status: 200, body: "ok" });
		handle = installKeyRouter(
			{
				providers: [{ name: "z-ai", match: ["z.ai"], keys: [{ name: "primary", value: "my-key" }] },
				],
				maxRetries: 3,
				cooldownMs: 1000,
			},
			(e) => rotationEvents.push(e),
		);
		const resp = await fetch("https://api.z.ai/v1/chat", { method: "POST" });
		expect(resp.status).toBe(200);
		expect(requests[0]?.auth).toBe("Bearer my-key");
		expect(rotationEvents.length).toBe(0);
	});
});

describe("fetch wrapper — 429 rotation", () => {
	test("rotates to next key on 429", async () => {
		globalThis.fetch = mockFetch();
		queueResponses(
			{ status: 429, body: "rate limited" },
			{ status: 200, body: "ok" },
		);
		handle = installKeyRouter(
			{
				providers: [
					{
						name: "z-ai",
						match: ["z.ai"],
						keys: [
							{ name: "primary", value: "key-1" },
							{ name: "backup", value: "key-2" },
						],
					},
				],
				maxRetries: 3,
				cooldownMs: 1000,
			},
			(e) => rotationEvents.push(e),
		);
		const resp = await fetch("https://api.z.ai/v1/chat");
		expect(resp.status).toBe(200);
		expect(requests[0]?.auth).toBe("Bearer key-1");
		expect(requests[1]?.auth).toBe("Bearer key-2");
		expect(rotationEvents.length).toBe(1);
		expect(rotationEvents[0]).toMatchObject({
			provider: "z-ai",
			fromKey: "primary",
			toKey: "backup",
			reason: "rate-limited",
			status: 429,
		});
	});

	test("exhausts retries and returns last 429", async () => {
		globalThis.fetch = mockFetch();
		queueResponses(
			{ status: 429 },
			{ status: 429 },
			{ status: 429 },
		);
		handle = installKeyRouter(
			{
				providers: [
					{
						name: "z-ai",
						match: ["z.ai"],
						keys: [
							{ name: "a", value: "k1" },
							{ name: "b", value: "k2" },
						],
					},
				],
				maxRetries: 3,
				cooldownMs: 1000,
			},
			(e) => rotationEvents.push(e),
		);
		const resp = await fetch("https://api.z.ai/v1/chat");
		expect(resp.status).toBe(429);
		expect(rotationEvents.length).toBe(2);
	});
});

describe("fetch wrapper — 401 rotation", () => {
	test("skips bad key on 401", async () => {
		globalThis.fetch = mockFetch();
		queueResponses({ status: 401, body: "unauthorized" }, { status: 200 });
		handle = installKeyRouter(
			{
				providers: [
					{
						name: "z-ai",
						match: ["z.ai"],
						keys: [
							{ name: "dead", value: "k1" },
							{ name: "live", value: "k2" },
						],
					},
				],
				maxRetries: 3,
				cooldownMs: 1000,
			},
			(e) => rotationEvents.push(e),
		);
		const resp = await fetch("https://api.z.ai/v1/chat");
		expect(resp.status).toBe(200);
		expect(rotationEvents[0]?.reason).toBe("unauthorized");
		expect(rotationEvents[0]?.fromKey).toBe("dead");
		expect(rotationEvents[0]?.toKey).toBe("live");
	});
});

describe("fetch wrapper — getSnapshot", () => {
	test("reports current key + per-key stats", async () => {
		globalThis.fetch = mockFetch();
		queueResponses({ status: 429 }, { status: 200 });
		handle = installKeyRouter(
			{
				providers: [
					{
						name: "z-ai",
						match: ["z.ai"],
						keys: [
							{ name: "a", value: "k1" },
							{ name: "b", value: "k2" },
						],
					},
				],
				maxRetries: 3,
				cooldownMs: 60_000,
			},
			() => {},
		);
		await fetch("https://api.z.ai/v1/chat");
		const snap = handle.getSnapshot();
		expect(snap.length).toBe(1);
		const p = snap[0]!;
		expect(p.provider).toBe("z-ai");
		expect(p.current).toBe("b"); // rotated to b after success
		const a = p.keys.find((k) => k.name === "a")!;
		const b = p.keys.find((k) => k.name === "b")!;
		expect(a.failures).toBe(1);
		expect(a.cooldownRemainingMs).toBeGreaterThan(0);
		expect(b.uses).toBe(1);
	});
});