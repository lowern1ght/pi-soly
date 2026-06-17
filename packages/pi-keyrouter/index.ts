// =============================================================================
// index.ts — pi-keyrouter extension entry point (native setRuntimeApiKey)
// =============================================================================
//
// HOW IT WORKS (native integration, no fetch hacks):
//
// 1. pi makes a request with the current API key
// 2. Provider returns 429 (rate-limited) or 401/403 (unauthorized)
// 3. `after_provider_response` event fires with the HTTP status
// 4. We call ctx.modelRegistry.authStorage.setRuntimeApiKey(provider, nextKey)
// 5. pi's BUILT-IN retry logic kicks in → next attempt uses the new key
// 6. Repeat until a key succeeds or we exhaust our key pool
//
// This is the native integration point documented in the SDK:
//   "API key resolution priority:
//    1. Runtime overrides (via setRuntimeApiKey, not persisted)
//    2. Stored credentials in auth.json
//    3. Environment variables
//    4. Fallback resolver"
//
// We only touch priority #1 (runtime override). auth.json is never modified.
// On session end, runtime overrides vanish (not persisted) — clean slate
// for next session, which is exactly what we want for 429 rate limits.
//
// Usage:
//   pi install npm:pi-keyrouter
//   # create ~/.pi/keyrouter.json with your provider keys
//   /reload

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import {
	initKeyStates,
	isAvailable,
	markBad,
	pickNextKey,
} from "./rotation.ts";
import type { KeyRouterConfig, RotationEvent, KeyState } from "./types.ts";

interface ProviderRuntime {
	keys: KeyState[];
	/** Index of the key currently set via setRuntimeApiKey. -1 = none set yet. */
	currentIndex: number;
}

export default function keyRouterExtension(pi: ExtensionAPI): void {
	let config: KeyRouterConfig | undefined;
	const runtimes = new Map<string, ProviderRuntime>();
	let notify: ((text: string, level: "info" | "warning" | "error") => void) | undefined;

	function ensureRuntime(providerName: string, cfg: KeyRouterConfig): ProviderRuntime | undefined {
		let rt = runtimes.get(providerName);
		if (rt) return rt;
		const providerCfg = cfg.providers.find((p) => p.name === providerName);
		if (!providerCfg) return undefined;
		rt = {
			keys: initKeyStates(providerCfg.keys),
			currentIndex: -1,
		};
		runtimes.set(providerName, rt);
		return rt;
	}

	/** Set the initial key for a provider on first use. */
	function bootstrap(providerName: string): boolean {
		const cfg = config;
		if (!cfg) return false;
		const rt = ensureRuntime(providerName, cfg);
		if (!rt) return false;
		if (rt.currentIndex >= 0) return true; // already bootstrapped
		const idx = pickNextKey(rt.keys, 0, Date.now());
		if (idx < 0) return false;
		const key = rt.keys[idx];
		if (!key) return false;
		// We can't call setRuntimeApiKey here (no ctx), but we mark the index
		// so the first after_provider_response knows where we are.
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

		// Notify
		if (notify && currentKey) {
			const event: RotationEvent = {
				provider: providerName,
				fromKey: currentKey.name,
				toKey: nextKey.name,
				reason,
				status,
				attempt: rt.keys.reduce((a, k) => a + k.failures, 0),
			};
			notify(
				`🔑 keyrouter: ${event.provider} — ${event.fromKey} → ${event.toKey} ` +
					`(HTTP ${event.status}, ${event.reason})`,
				"warning",
			);
		}
		return true;
	}

	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig(ctx.cwd);
		if (config.providers.length === 0) {
			return; // nothing to do
		}
		notify = (text, level) => ctx.ui.notify(text, level);

		// Bootstrap all providers: set the first key as runtime override
		const authStorage = ctx.modelRegistry.authStorage;
		let bootstrapped = 0;
		for (const p of config.providers) {
			const providerName = resolveProviderName(p.name);
			if (bootstrap(providerName)) {
				const rt = runtimes.get(providerName);
				if (rt && rt.currentIndex >= 0) {
					const key = rt.keys[rt.currentIndex];
					if (key) {
						authStorage.setRuntimeApiKey(providerName, key.value);
						bootstrapped++;
					}
				}
			}
		}
		if (bootstrapped > 0) {
			ctx.ui.notify(
				`🔑 keyrouter: active (${bootstrapped} provider(s), ${config.providers.reduce((a, p) => a + p.keys.length, 0)} keys)`,
				"info",
			);
		}
	});

	pi.on("after_provider_response", async (event, ctx) => {
		if (!config) return;
		if (event.status !== 429 && event.status !== 401 && event.status !== 403) return;

		// Determine provider from current model
		const model = ctx.model;
		if (!model) return;
		const providerName = resolveProviderName(model.provider);
		const rt = runtimes.get(providerName);
		if (!rt) return; // not a managed provider

		const reason: "rate-limited" | "unauthorized" =
			event.status === 429 ? "rate-limited" : "unauthorized";

		const authStorage = ctx.modelRegistry.authStorage;
		const rotated = rotate(providerName, reason, event.status, (key) => {
			authStorage.setRuntimeApiKey(providerName, key);
		});

		if (!rotated) {
			// All keys exhausted — clear runtime override so pi falls back to auth.json
			// (which has the user's original key). pi will surface the real error.
			if (notify) {
				const failed = rt.keys.filter((k) => k.failures > 0).map((k) => k.name);
				notify(
					`🔑 keyrouter: ${providerName} — all keys exhausted (${failed.join(", ")}). ` +
						`Letting pi surface the original HTTP ${event.status}.`,
					"error",
				);
			}
		}
	});

	pi.on("session_shutdown", () => {
		runtimes.clear();
		config = undefined;
		notify = undefined;
	});

	pi.registerCommand("keyrouter", {
		description: "manage key rotation (status, reload)",
		handler: async (args, ctx) => {
			const sub = args.trim().split(/\s+/)[0] ?? "status";
			if (sub === "status") {
				if (!config || runtimes.size === 0) {
					ctx.ui.notify("🔑 keyrouter: not active", "info");
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
 * Resolve the internal provider name that authStorage uses.
 * The keyrouter config uses display names like "z-ai" but authStorage
 * uses the canonical provider id like "zai". We try a few mappings.
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