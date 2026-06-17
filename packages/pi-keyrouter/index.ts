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
import { loadConfig, configPath } from "./config.ts";
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
	let activationNotified = false;

	/**
	 * Get-or-create the runtime for a provider. Keyed by the RESOLVED
	 * name (the authStorage id, e.g. "zai"), but populated from the
	 * provider config passed in directly (avoids name-mismatch bugs).
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
		ui: { notify: (t: string, l?: "info" | "warning" | "error") => void };
		modelRegistry: { authStorage: { setRuntimeApiKey: (p: string, k: string) => void } };
	}): Promise<void> {
		// Load config once (reload clears it)
		if (!config) {
			config = loadConfig(ctx.cwd);
		}
		if (config.providers.length === 0) return;
		notify = (text, level) => ctx.ui.notify(text, level);

		const authStorage = ctx.modelRegistry.authStorage;
		let newlyBootstrapped = 0;
		for (const p of config.providers) {
			const resolvedName = resolveProviderName(p.name);
			// Skip providers we've already bootstrapped
			if (runtimes.has(resolvedName)) continue;
			if (bootstrap(resolvedName, p)) {
				const rt = runtimes.get(resolvedName);
				if (rt && rt.currentIndex >= 0) {
					const key = rt.keys[rt.currentIndex];
					if (key) {
						authStorage.setRuntimeApiKey(resolvedName, key.value);
						newlyBootstrapped++;
					}
				}
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

	/** Set the initial key for a provider on first use. */
	function bootstrap(
		resolvedName: string,
		providerCfg: { keys: ReadonlyArray<{ name: string; value: string }> },
	): boolean {
		const rt = ensureRuntime(resolvedName, providerCfg);
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

		// Detect error type from the message string.
		// pi's error messages look like: "429 Usage limit reached..."
		// or "401 Unauthorized" / "403 Forbidden".
		let reason: "rate-limited" | "unauthorized" | null = null;
		let status = 0;
		if (/\b429\b|rate.?limit|too many requests/i.test(errMsg)) {
			reason = "rate-limited";
			status = 429;
		} else if (/\b40[13]\b|unauthorized|forbidden/i.test(errMsg)) {
			reason = "unauthorized";
			status = errMsg.includes("401") ? 401 : 403;
		}
		if (!reason) return; // not a rotatable error

		// Determine provider from current model
		const model = ctx.model;
		if (!model) return;
		const providerName = resolveProviderName(model.provider);
		const rt = runtimes.get(providerName);
		if (!rt) return; // not a managed provider

		const authStorage = ctx.modelRegistry.authStorage;
		const rotated = rotate(providerName, reason, status, (key) => {
			authStorage.setRuntimeApiKey(providerName, key);
		});

		if (!rotated) {
			// All keys exhausted — let pi surface the real error.
			if (notify) {
				const failed = rt.keys.filter((k) => k.failures > 0).map((k) => k.name);
				notify(
					`🔑 keyrouter: ${providerName} — all keys exhausted (${failed.join(", ")}). ` +
						`Letting pi surface the original error.`,
					"error",
				);
			}
		}
	});

	pi.on("session_shutdown", () => {
		runtimes.clear();
		config = undefined;
		notify = undefined;
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