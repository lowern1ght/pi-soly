// =============================================================================
// quota/registry.ts — provider registry
// =============================================================================
//
// A simple Map<id, QuotaProvider>. Providers register themselves at module
// load (index.ts calls registerQuotaProvider for each built-in adapter).
// The poller calls resolveQuotaProvider(providerId) which tries an exact
// match first, then falls back to the base id before the first "-" (so
// "minimax-cn" resolves to a "minimax" adapter).
//
// External extensions could also register providers by importing this
// module — but pi-soly has no runtime deps, so in practice the built-in
// adapters (minimax) are all that ship today.
// =============================================================================

import type { QuotaProvider } from "./types.ts";

const providers = new Map<string, QuotaProvider>();

/** Register a quota provider. Idempotent — re-registering overwrites. */
export function registerQuotaProvider(provider: QuotaProvider): void {
	providers.set(provider.id, provider);
}

/** Exact-match lookup. */
export function getQuotaProvider(id: string): QuotaProvider | undefined {
	return providers.get(id);
}

/** Resolve a provider id to its adapter. Tries exact match first, then
 *  the base id before the first "-" (region-suffix fallback:
 *  "minimax-cn" → "minimax"). Returns undefined if nothing matches. */
export function resolveQuotaProvider(id: string): QuotaProvider | undefined {
	const exact = providers.get(id);
	if (exact) return exact;
	const base = id.split("-")[0];
	if (base !== id) return providers.get(base);
	return undefined;
}
