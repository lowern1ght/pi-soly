// =============================================================================
// quota/types.ts — provider-agnostic quota snapshot
// =============================================================================
//
// A QuotaProvider knows how to fetch "how much quota is left" for one model
// provider (MiniMax, OpenAI, …). The poller (poller.ts) reads the active
// model's provider id from ChromeData, looks up the registered adapter, and
// polls it on a timer. Adding a new provider = implement this interface +
// registerQuotaProvider() — no changes to the poller or footer.
//
// This is intentionally minimal: just the two numbers the toolbar needs.
// Per-model breakdowns, weekly vs interval, cost in cents — none of that
// belongs in a status-bar segment. If a provider can't report a field, it
// returns null and the segment omits it.
// =============================================================================

/** What a provider reports about remaining quota. */
export type QuotaSnapshot = {
	/** Remaining quota as a percent (0–100). Drives the main number. */
	readonly remainingPercent: number;
	/** Milliseconds until the current quota window resets, or null if the
	 *  provider doesn't expose a reset time. Rendered as "in 20m". */
	readonly resetsInMs: number | null;
};

/** Adapter that fetches quota for one provider.
 *
 *  Implementations MUST NOT throw — return null on any failure (no
 *  credentials, provider down, CLI missing, parse error). The poller
 *  treats null as "no data" and leaves the previous snapshot in place. */
export interface QuotaProvider {
	/** Provider id matching `ctx.model.provider` (e.g. "minimax").
	 *  Region-suffixed ids ("minimax-cn") fall back to the base id. */
	readonly id: string;
	/** Fetch the current snapshot, or null if unavailable. */
	fetch(): Promise<QuotaSnapshot | null>;
}
