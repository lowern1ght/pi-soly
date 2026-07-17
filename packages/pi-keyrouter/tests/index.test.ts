// =============================================================================
// tests/index.test.ts — extension entry point, exercised with a realistic ctx
// =============================================================================
//
// Regression coverage for the `ctx.modelRegistry.authStorage` crash: on the
// pi-coding-agent releases where `ModelRegistry` no longer exposes
// `authStorage` at all (confirmed: 0.80.10 — see
// docs/fix-authstorage-runtime-key-override.md), the OLD code threw
// "Cannot read properties of undefined (reading 'setRuntimeApiKey')" from
// every `before_agent_start` and every rotatable `message_end`. None of the
// other test files invoke these handlers with a realistic ctx (they only
// test the pure helper modules in isolation), so this crash shipped with a
// fully green test suite.
//
// Every test below builds a ctx shaped like a REAL ExtensionContext for a
// given SDK generation and actually invokes the registered handlers —
// `mockPi` below is not a Proxy stand-in like smoke.test.ts's, it captures
// real handler functions and calls them.

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

const TEST_CONFIG = {
	providers: [
		{
			name: "nvidia",
			match: ["integrate.api.nvidia.com"],
			keys: [
				{ name: "primary", value: "primary-key-value" },
				{ name: "backup", value: "backup-key-value" },
			],
		},
	],
	maxRetries: 3,
	cooldownMs: 60_000,
	overloadedCooldownMs: 30_000,
};

// Replace config.ts's loadConfig so activate() gets a controlled config
// instead of reading the real ~/.pi/keyrouter.json on whatever machine runs
// the test suite.
mock.module("../config.ts", () => ({
	loadConfig: () => structuredClone(TEST_CONFIG),
	configPath: () => "/fake-home/.pi/keyrouter.json",
}));

const { default: keyRouterExtension } = await import("../index.ts");

/** Minimal ExtensionAPI stand-in that actually stores handlers/commands so
 *  tests can invoke them, unlike a Proxy that swallows every call. */
function makeMockPi() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	let commandHandler: ((args: string, ctx: unknown) => unknown) | undefined;
	return {
		pi: {
			on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(event, handler);
			},
			registerCommand(_name: string, spec: { handler: (args: string, ctx: unknown) => unknown }) {
				commandHandler = spec.handler;
			},
		} as never,
		fire(event: string, payload: unknown, ctx: unknown) {
			const handler = handlers.get(event);
			if (!handler) throw new Error(`no handler registered for "${event}"`);
			return handler(payload, ctx);
		},
		runCommand(args: string, ctx: unknown) {
			if (!commandHandler) throw new Error("no command handler registered");
			return commandHandler(args, ctx);
		},
	};
}

function makeUi() {
	const notified: Array<{ text: string; level: string }> = [];
	return {
		notified,
		ui: {
			notify: (text: string, level: string) => {
				notified.push({ text, level });
			},
		},
	};
}

const ENV_KEYS = ["NVIDIA_API_KEY"];

beforeEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
});

describe("before_agent_start / activate — realistic ctx shapes", () => {
	test("modern SDK shape (modelRegistry present, NO authStorage) — does not throw, falls back to env var", async () => {
		const { pi, fire } = makeMockPi();
		const { ui } = makeUi();
		keyRouterExtension(pi);

		const ctx = {
			cwd: "/fake/project",
			ui,
			// Matches the real, currently-published ModelRegistry shape
			// (0.80.10): the object exists, `authStorage` simply isn't a
			// property on it at all.
			modelRegistry: {},
		};

		let threw: unknown;
		try {
			await fire("before_agent_start", {}, ctx);
		} catch (err) {
			threw = err;
		}

		expect(threw).toBeUndefined();
		expect(process.env.NVIDIA_API_KEY).toBe("primary-key-value");
	});

	test("legacy SDK shape (authStorage present) — uses the native override, does not touch process.env", async () => {
		const { pi, fire } = makeMockPi();
		const { ui } = makeUi();
		keyRouterExtension(pi);

		const calls: Array<[string, string]> = [];
		const ctx = {
			cwd: "/fake/project",
			ui,
			modelRegistry: {
				authStorage: {
					setRuntimeApiKey: (provider: string, key: string) => {
						calls.push([provider, key]);
					},
				},
			},
		};

		await fire("before_agent_start", {}, ctx);

		expect(calls).toEqual([["nvidia", "primary-key-value"]]);
		expect(process.env.NVIDIA_API_KEY).toBeUndefined();
	});
});

describe("message_end — rotation branch, realistic ctx shapes", () => {
	async function activateThenFail(modelRegistry: unknown, errorMessage: string) {
		const { pi, fire } = makeMockPi();
		const { ui, notified } = makeUi();
		keyRouterExtension(pi);

		const activateCtx = { cwd: "/fake/project", ui, modelRegistry };
		await fire("before_agent_start", {}, activateCtx);

		const messageEndCtx = { ...activateCtx, model: { provider: "nvidia" } };
		const event = {
			message: { role: "assistant", stopReason: "error", errorMessage },
		};
		await fire("message_end", event, messageEndCtx);
		return { notified };
	}

	test("429 on modern SDK shape — rotates via env var instead of crashing", async () => {
		let threw: unknown;
		let notified: Array<{ text: string; level: string }> = [];
		try {
			({ notified } = await activateThenFail({}, "429 rate limit exceeded"));
		} catch (err) {
			threw = err;
		}

		expect(threw).toBeUndefined();
		expect(process.env.NVIDIA_API_KEY).toBe("backup-key-value");
		expect(notified.some((n) => n.text.includes("primary → backup"))).toBe(true);
	});

	test("401 unauthorized on modern SDK shape — rotates via env var instead of crashing", async () => {
		let threw: unknown;
		try {
			await activateThenFail({}, "401 unauthorized");
		} catch (err) {
			threw = err;
		}

		expect(threw).toBeUndefined();
		expect(process.env.NVIDIA_API_KEY).toBe("backup-key-value");
	});

	test("429 on legacy SDK shape — rotates via native override, not env var", async () => {
		const calls: Array<[string, string]> = [];
		const modelRegistry = {
			authStorage: {
				setRuntimeApiKey: (provider: string, key: string) => {
					calls.push([provider, key]);
				},
			},
		};

		await activateThenFail(modelRegistry, "429 too many requests");

		expect(calls).toEqual([
			["nvidia", "primary-key-value"],
			["nvidia", "backup-key-value"],
		]);
		expect(process.env.NVIDIA_API_KEY).toBeUndefined();
	});
});

describe("/keyrouter status command — realistic ctx", () => {
	test("on-demand activation does not throw on the modern SDK shape", async () => {
		const { pi, runCommand } = makeMockPi();
		const { ui, notified } = makeUi();
		keyRouterExtension(pi);

		const ctx = { cwd: "/fake/project", ui, modelRegistry: {} };

		let threw: unknown;
		try {
			await runCommand("status", ctx);
		} catch (err) {
			threw = err;
		}

		expect(threw).toBeUndefined();
		expect(notified.length).toBeGreaterThan(0);
		expect(process.env.NVIDIA_API_KEY).toBe("primary-key-value");
	});
});
