// =============================================================================
// index.ts — pi-keyrouter extension entry point
// =============================================================================
//
// HOW IT WORKS:
//
// 1. pi makes a request with the current API key
// 2. Provider returns 429 (rate-limited) or 401/403 (unauthorized)
// 3. `message_end` fires with the error; we pick the next available key
// 4. We apply it via applyKey() — see below — then return
// 5. pi's BUILT-IN retry logic kicks in → next attempt uses the new key
// 6. Repeat until a key succeeds or we exhaust our key pool
//
// APPLYING A KEY — two mechanisms, tried in this order (see applyKey()):
//
//   1. ctx.modelRegistry.authStorage.setRuntimeApiKey(provider, key)
//      A genuine runtime override, checked BEFORE auth.json by pi-ai's own
//      credential resolver. Present on `ModelRegistry` in some
//      pi-coding-agent releases (confirmed: 0.78.1).
//
//   2. process.env[<PROVIDER>_API_KEY] = key
//      Fallback for releases where `ModelRegistry` no longer exposes
//      `authStorage` to extensions at all (confirmed: 0.80.10 turned
//      `ModelRegistry` into a synchronous compatibility facade over an
//      internal `ModelRuntime`, with nothing extension-reachable that
//      mutates a stored override). pi-ai's env-var credential resolver
//      re-reads `process.env` on every call — no caching — so this takes
//      effect on the very next attempt in the same process. Extensions run
//      in-process with pi-coding-agent (no worker/vm sandbox), so a plain
//      assignment here is visible immediately.
//
//      IMPORTANT: mechanism 2 is priority-3 in pi-ai's resolver (a stored
//      credential in auth.json always wins first). A provider rotated by
//      pi-keyrouter must therefore have NO entry in auth.json, or every
//      override this extension makes is silently ignored. See README.md.
//
// We try mechanism 1 first on every call (a free correctness upgrade on
// builds that still support it — the override there properly outranks
// auth.json) and fall back to mechanism 2 only when it's absent, so this
// extension keeps working across the pi-coding-agent version range instead
// of being pinned to one internal SDK shape. Full investigation, including
// which published SDK versions expose which shape:
//   docs/fix-authstorage-runtime-key-override.md
//
// Usage:
//   pi install npm:pi-keyrouter
//   # create ~/.pi/keyrouter.json with your provider keys (see README)
//   /reload

import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, configPath } from "./config.ts";
import { notifyRotation, notifyOverloaded, notifyExhausted } from "./notification.ts";
import {
	initKeyStates,
	isAvailable,
	markBad,
	markOverloaded,
	pickNextKey,
} from "./rotation.ts";
import type { KeyRouterConfig, RotationEvent, KeyState } from "./types.ts";

/** Regex matching overloaded-style errors. Covers Anthropic 429 + "overloaded",
 *  standard HTTP 529, and "service overloaded" variants. Case-insensitive. */
const OVERLOADED_RE = /\boverloaded\b|\b529\b/i;

/** Regex matching rate-limit style errors (key-specific failures). */
const RATE_LIMITED_RE = /\b429\b|rate.?limit|too many requests/i;

/** Regex matching auth errors (key-specific failures). */
const UNAUTHORIZED_RE = /\b40[13]\b|unauthorized|forbidden/i;

interface ProviderRuntime {
	keys: KeyState[];
	/** Index of the key currently applied via applyKey(). -1 = none set yet. */
	currentIndex: number;
}

/**
 * `ctx.modelRegistry` is deliberately typed `unknown` at every call site in
 * this file rather than pi-coding-agent's own ambient `ModelRegistry` type.
 * Across SDK releases that class has gone from exposing a real `authStorage`
 * field to a facade that has none at all — and trusting the ambient type's
 * optimism (a non-optional `authStorage`) is exactly how the original crash
 * shipped. `applyKey()` below feature-detects the shape at runtime instead,
 * which is correct on both. Full investigation:
 * docs/fix-authstorage-runtime-key-override.md
 */

/**
 * Apply a key for a provider using the best mechanism available on the
 * running pi-coding-agent build. See the header comment for the two
 * mechanisms and their priority/compatibility trade-offs. `modelRegistry`
 * is `ctx.modelRegistry`, untyped on purpose — see note above.
 */
function applyKey(modelRegistry: unknown, providerName: string, key: string): void {
	const authStorage = (modelRegistry as { authStorage?: unknown } | null | undefined)?.authStorage;
	const setRuntimeApiKey = (authStorage as { setRuntimeApiKey?: unknown } | null | undefined)?.setRuntimeApiKey;
	if (typeof setRuntimeApiKey === "function") {
		(setRuntimeApiKey as (provider: string, key: string) => void)(providerName, key);
		return;
	}
	process.env[envVarFor(providerName)] = key;
}

/**
 * Provider id → env var name, matching pi-ai's own provider definitions
 * (verified against @earendil-works/pi-ai's published `providers/*.js`,
 * e.g. `nvidia.js: envApiKeyAuth("NVIDIA API key", ["NVIDIA_API_KEY"])`).
 * Known providers use their real var name; unknown providers fall back to
 * the `${NAME}_API_KEY` convention pi-ai uses for most providers.
 * `moonshotai` is the one confirmed exception to that convention (its var
 * is `MOONSHOT_API_KEY`, not `MOONSHOTAI_API_KEY`).
 */
function envVarFor(providerName: string): string {
	const known: Record<string, string> = {
		nvidia: "NVIDIA_API_KEY",
		zai: "ZAI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		groq: "GROQ_API_KEY",
		mistral: "MISTRAL_API_KEY",
		minimax: "MINIMAX_API_KEY",
		moonshotai: "MOONSHOT_API_KEY",
		fireworks: "FIREWORKS_API_KEY",
		together: "TOGETHER_API_KEY",
		xai: "XAI_API_KEY",
		openai: "OPENAI_API_KEY",
		anthropic: "ANTHROPIC_API_KEY",
	};
	return known[providerName] ?? `${providerName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

export default function keyRouterExtension(pi: ExtensionAPI): void {
	let config: KeyRouterConfig | undefined;
	const runtimes = new Map<string, ProviderRuntime>();
	let uiCtx: ExtensionUIContext | undefined;
	let activationNotified = false;

	/**
	 * Get-or-create the runtime for a provider. Keyed by the RESOLVED
	 * name (the canonical provider id, e.g. "zai"), but populated from
	 * the provider config passed in directly (avoids name-mismatch bugs).
	 */
	function ensureRuntime(
		resolvedName: string,
		providerCfg: { keys: ReadonlyArray<{ name: string; value: string }> },
	): ProviderRuntime {
		let rt = runtimes.get(resolvedName);
		if (rt) return rt;
		rt = {
			keys: initKeyStates(providerCfg.keys),
			currentIndex: -1,
		};
		runtimes.set(resolvedName, rt);
		return rt;
	}

	/**
	 * Activate the router: load config (once), bootstrap all providers.
	 * Idempotent — safe to call on every before_agent_start. Only runs
	 * the bootstrap the FIRST time for each provider.
	 */
	async function activate(ctx: {
		cwd: string;
		ui: ExtensionUIContext;
		modelRegistry: unknown;
	}): Promise<void> {
		// Load config once (reload clears it)
		if (!config) {
			config = loadConfig(ctx.cwd);
		}
		if (config.providers.length === 0) return;
		uiCtx = ctx.ui;

		let newlyBootstrapped = 0;
		for (const p of config.providers) {
			const resolvedName = resolveProviderName(p.name);
			// Skip providers we've already bootstrapped
			if (runtimes.has(resolvedName)) continue;
			if (bootstrap(resolvedName, p, ctx.modelRegistry)) {
				newlyBootstrapped++;
			}
		}
		// Only notify on first activation (when we bootstrapped at least one)
		if (newlyBootstrapped > 0 && !activationNotified) {
			activationNotified = true;
			ctx.ui.notify(
				`🔑 keyrouter: active (${config.providers.length} provider(s), ${config.providers.reduce((a, p) => a + p.keys.length, 0)} keys)`,
				"info",
			);
		}
	}

	/**
	 * Set the initial key for a provider on first use, applying it
	 * immediately via applyKey(). Returns true iff a key was applied.
	 */
	function bootstrap(
		resolvedName: string,
		providerCfg: { keys: ReadonlyArray<{ name: string; value: string }> },
		modelRegistry: unknown,
	): boolean {
		const rt = ensureRuntime(resolvedName, providerCfg);
		if (rt.currentIndex >= 0) return true; // already bootstrapped
		const idx = pickNextKey(rt.keys, 0, Date.now());
		if (idx < 0) return false;
		const key = rt.keys[idx];
		if (!key) return false;
		applyKey(modelRegistry, resolvedName, key.value);
		rt.currentIndex = idx;
		return true;
	}

	/** Rotate to the next available key. Returns true if rotated. */
	function rotate(
		providerName: string,
		reason: "rate-limited" | "unauthorized",
		status: number,
		setKey: (key: string) => void,
	): boolean {
		const cfg = config;
		if (!cfg) return false;
		const rt = runtimes.get(providerName);
		if (!rt) return false;

		// Mark current key as bad
		const currentKey = rt.currentIndex >= 0 ? rt.keys[rt.currentIndex] : undefined;
		if (currentKey) {
			markBad(currentKey, reason, cfg.cooldownMs, Date.now());
		}

		// Find next available key (different from current)
		const nextIdx = pickNextKey(rt.keys, rt.currentIndex + 1, Date.now());
		if (nextIdx < 0 || nextIdx === rt.currentIndex) {
			// No other key available
			return false;
		}
		const nextKey = rt.keys[nextIdx];
		if (!nextKey) return false;

		// Set the new runtime key — pi's retry will use it
		setKey(nextKey.value);
		rt.currentIndex = nextIdx;

		// Notify with yellow box widget (falls back to plain notify)
		if (currentKey && uiCtx) {
			const event: RotationEvent = {
				provider: providerName,
				fromKey: currentKey.name,
				toKey: nextKey.name,
				reason,
				status,
				attempt: rt.keys.reduce((a, k) => a + k.failures, 0),
			};
			notifyRotation(uiCtx, event);
		}
		return true;
	}

	pi.on("session_start", async (_event, ctx) => {
		await activate(ctx);
	});

	// Lazy bootstrap: also fire on every turn. This handles /reload (which
	// does NOT re-fire session_start) and config changes mid-session.
	// activate() is idempotent — only bootstraps once per provider.
	pi.on("before_agent_start", async (_event, ctx) => {
		await activate(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		if (!config) return;
		const msg = event.message;
		// Only intercept assistant error messages
		if (msg.role !== "assistant" || msg.stopReason !== "error") return;
		const errMsg = msg.errorMessage ?? "";
		if (!errMsg) return;

		// Determine provider from current model first — we need it for both
		// the overload path and the rotation path.
		const model = ctx.model;
		if (!model) return;
		const providerName = resolveProviderName(model.provider);
		const rt = runtimes.get(providerName);
		if (!rt) return; // not a managed provider

		// Overload branch: provider-wide cooldown, NO rotation, NO failure
		// counter bump. Marks every key of this provider so pickNextKey
		// skips them until the window expires.
		if (OVERLOADED_RE.test(errMsg)) {
			const now = Date.now();
			for (const k of rt.keys) markOverloaded(k, config.overloadedCooldownMs, now);
			if (uiCtx) notifyOverloaded(uiCtx, providerName, config.overloadedCooldownMs);
			return;
		}

		// Rotation branch: 429 (key-rate-limited) or 401/403 (key-bad).
		let reason: "rate-limited" | "unauthorized" | null = null;
		let status = 0;
		if (RATE_LIMITED_RE.test(errMsg)) {
			reason = "rate-limited";
			status = 429;
		} else if (UNAUTHORIZED_RE.test(errMsg)) {
			reason = "unauthorized";
			status = errMsg.includes("401") ? 401 : 403;
		}
		if (!reason) return; // not a rotatable error

		const rotated = rotate(providerName, reason, status, (key) => {
			applyKey(ctx.modelRegistry, providerName, key);
		});

		if (!rotated) {
			// All keys exhausted — let pi surface the real error.
			if (uiCtx) {
				const failed = rt.keys.filter((k) => k.failures > 0).map((k) => k.name);
				notifyExhausted(uiCtx, providerName, failed);
			}
		}
	});

	pi.on("session_shutdown", () => {
		runtimes.clear();
		config = undefined;
		uiCtx = undefined;
		activationNotified = false;
	});

	pi.registerCommand("keyrouter", {
		description: "manage key rotation (status, reload)",
		handler: async (args, ctx) => {
			const sub = args.trim().split(/\s+/)[0] ?? "status";
			if (sub === "status") {
				// On-demand activation in case session_start/before_agent_start
				// haven't fired yet (e.g. user ran /keyrouter status right after
				// /reload without sending a prompt).
				if (!config || runtimes.size === 0) {
					await activate(ctx);
				}
				if (!config || runtimes.size === 0) {
					ctx.ui.notify(
						`🔑 keyrouter: not active — no ~/.pi/keyrouter.json found ` +
							`(expected at ${configPath()}). Config is user-level only, never project-scoped.`,
						"warning",
					);
					return;
				}
				const lines: string[] = [`🔑 keyrouter: active`];
				for (const [providerName, rt] of runtimes) {
					const current = rt.currentIndex >= 0 ? rt.keys[rt.currentIndex] : undefined;
					lines.push("");
					lines.push(`  ${providerName} (current: ${current?.name ?? "(none)"})`);
					for (const k of rt.keys) {
						const marker = k === current ? "→" : "•";
						const avail = isAvailable(k, Date.now()) ? "" : " (cooldown)";
						lines.push(
							`    ${marker} ${k.name}  uses=0 fails=${k.failures} status=${k.lastStatus}${avail}`,
						);
					}
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}
			if (sub === "reload") {
				config = loadConfig(ctx.cwd);
				runtimes.clear();
				activationNotified = false;
				ctx.ui.notify(
					`🔑 keyrouter: reloaded (${config.providers.length} provider(s))`,
					"info",
				);
				return;
			}
			ctx.ui.notify("Usage: /keyrouter [status|reload]", "info");
		},
	});
}

/**
 * Resolve the canonical provider id that pi-ai and applyKey() use.
 * The keyrouter config uses display names like "z-ai" but the canonical
 * id is "zai". We try a few mappings; anything else passes through as-is
 * (which is correct for providers whose canonical id equals their common
 * name, e.g. "nvidia", "groq", "mistral").
 */
function resolveProviderName(displayName: string): string {
	const lower = displayName.toLowerCase();
	// Common mappings
	const map: Record<string, string> = {
		"z-ai": "zai",
		"z.ai": "zai",
		"open-router": "openrouter",
		"openai": "openai",
		"anthropic": "anthropic",
	};
	return map[lower] ?? displayName;
}