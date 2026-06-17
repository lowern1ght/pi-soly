// =============================================================================
// fetch-wrapper.ts — wraps global fetch with key-rotation logic
// =============================================================================
//
// Replaces `globalThis.fetch` with a function that:
// 1. Intercepts requests whose URL matches a configured provider.
// 2. Picks the best available key (rotation logic in rotation.ts).
// 3. Sets the Authorization header.
// 4. On 429/401, marks the key as bad and retries with the next key
//    (up to maxRetries).
// 5. Calls onRotate on every key switch.
//
// On failure, the original response is returned (not a synthetic one) so
// pi sees the real error if all retries fail.

import {
	initKeyStates,
	isAvailable,
	markBad,
	markOk,
	matchProvider,
	pickNextKey,
	recordUse,
	waitForNextKey,
} from "./rotation.ts";
import type {
	KeyRouterConfig,
	KeyState,
	ProviderConfig,
	RotationEvent,
} from "./types.ts";

/** State tracked per provider. */
interface ProviderState {
	config: ProviderConfig;
	keys: KeyState[];
	preferredIndex: number;
}

export interface KeyRouterHandle {
	/** Restore the original fetch and stop intercepting. */
	disable: () => void;
	/** Snapshot of current state (for /keyrouter status command). */
	getSnapshot: () => KeyRouterSnapshot[];
}

export interface KeyRouterSnapshot {
	provider: string;
	current: string;
	keys: Array<{
		name: string;
		uses: number;
		failures: number;
		lastStatus: string;
		cooldownRemainingMs: number;
	}>;
}

/**
 * Install the fetch wrapper. Returns a handle for disable / inspection.
 *
 * @param config — key router config
 * @param onRotate — called on every key switch (for UI notification)
 */
export function installKeyRouter(
	config: KeyRouterConfig,
	onRotate: (event: RotationEvent) => void,
): KeyRouterHandle {
	// Capture original fetch BEFORE wrapping
	const originalFetch = globalThis.fetch.bind(globalThis);

	// Build per-provider state
	const providerStates = new Map<string, ProviderState>();
	for (const p of config.providers) {
		providerStates.set(p.name, {
			config: p,
			keys: initKeyStates(p.keys),
			preferredIndex: 0,
		});
	}

	async function wrappedFetch(
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const matched = matchProvider(
			Array.from(providerStates.values()).map((s) => s.config),
			url,
		);
		if (!matched) {
			return originalFetch(input, init);
		}
		const state = providerStates.get(matched.name);
		if (!state || state.keys.length === 0) {
			return originalFetch(input, init);
		}

		const now = Date.now();
		const maxRetries = Math.max(1, config.maxRetries);
		let attempt = 0;
		let lastResponse: Response | undefined;
		let lastError: unknown;
		let lastPreferred = state.preferredIndex;

		while (attempt < maxRetries) {
			attempt += 1;
			const idx = pickNextKey(state.keys, lastPreferred, now);
			if (idx < 0) break;
			const key = state.keys[idx];
			if (!key) break;

			// If the chosen key is on cooldown, wait briefly
			if (!isAvailable(key, now)) {
				const wait = waitForNextKey(state.keys, now);
				if (wait > 0 && wait < 2000) {
					await new Promise((r) => setTimeout(r, wait));
				}
			}

			recordUse(key);
			const initCopy = { ...(init ?? {}) };
			const headers = new Headers(initCopy.headers ?? {});
			headers.set("Authorization", `Bearer ${key.value}`);
			initCopy.headers = headers;

			let response: Response;
			try {
				response = await originalFetch(input, initCopy);
			} catch (e) {
				lastError = e;
				// Network errors don't consume a retry budget
				// (we'll loop back and try again)
				lastPreferred = (idx + 1) % state.keys.length;
				continue;
			}

			if (response.status === 429) {
				markBad(key, "rate-limited", config.cooldownMs, Date.now());
				lastResponse = response;
				if (attempt >= maxRetries) break;
				const nextIdx = pickNextKey(state.keys, idx + 1, Date.now());
				if (nextIdx === idx) break;
				const nextKey = state.keys[nextIdx];
				if (nextKey) {
					onRotate({
						provider: matched.name,
						fromKey: key.name,
						toKey: nextKey.name,
						reason: "rate-limited",
						status: 429,
						attempt,
					});
				}
				state.preferredIndex = nextIdx;
				lastPreferred = nextIdx;
				continue;
			}

			if (response.status === 401 || response.status === 403) {
				markBad(key, "unauthorized", config.cooldownMs, Date.now());
				lastResponse = response;
				if (attempt >= maxRetries) break;
				const nextIdx = pickNextKey(state.keys, idx + 1, Date.now());
				if (nextIdx === idx) break;
				const nextKey = state.keys[nextIdx];
				if (nextKey) {
					onRotate({
						provider: matched.name,
						fromKey: key.name,
						toKey: nextKey.name,
						reason: "unauthorized",
						status: response.status,
						attempt,
					});
				}
				state.preferredIndex = nextIdx;
				lastPreferred = nextIdx;
				continue;
			}

			// Success — mark ok and return
			markOk(key);
			state.preferredIndex = idx;
			return response;
		}

		// All retries exhausted — return the last response if we have one
		if (lastResponse) return lastResponse;
		// Or re-throw the last network error
		if (lastError !== undefined) throw lastError;
		// Or fall through to original fetch
		return originalFetch(input, init);
	}

	// Install wrapper
	(globalThis as { fetch: typeof fetch }).fetch = wrappedFetch as typeof fetch;

	function getSnapshot(): KeyRouterSnapshot[] {
		const now = Date.now();
		return Array.from(providerStates.values()).map((s) => {
			const current = s.keys[s.preferredIndex];
			return {
				provider: s.config.name,
				current: current?.name ?? "(none)",
				keys: s.keys.map((k) => ({
					name: k.name,
					uses: k.uses,
					failures: k.failures,
					lastStatus: k.lastStatus,
					cooldownRemainingMs:
						k.cooldownUntil > now ? k.cooldownUntil - now : 0,
				})),
			};
		});
	}

	function disable(): void {
		(globalThis as { fetch: typeof fetch }).fetch = originalFetch;
	}

	return { disable, getSnapshot };
}