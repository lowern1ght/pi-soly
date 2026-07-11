// =============================================================================
// quota/poller.ts — background quota polling loop
// =============================================================================
//
// startQuotaPoller() reads the active model's provider id from ChromeData,
// resolves it to a registered QuotaProvider, and calls fetch() on a timer.
// The result is written back into ChromeData (quotaPercent / quotaResetsLabel)
// which the footer reads live at render time.
//
// Design notes:
// - setTimeout recursion (not setInterval) so a slow fetch can't pile up
//   overlapping ticks. The next tick is scheduled only after the current
//   fetch resolves.
// - On fetch failure (null), the previous snapshot is kept — stale data is
//   more useful than a flashing segment. The percent naturally drifts as
//   the user consumes quota between successful polls.
// - When the active provider has no registered adapter, the quota fields
//   are cleared (no segment shown) — self-disabling for providers we don't
//   support yet.
// - The poller is started in session_start and stopped in session_shutdown.
//   It only runs while a session is active.
// =============================================================================

import type { ChromeData } from "../visual/data.ts";
import { resolveQuotaProvider } from "./registry.ts";
import { formatReset } from "./format.ts";

/** Default poll interval: 60 seconds. */
const POLL_INTERVAL_MS = 60_000;

/** A running poller handle. Call stop() to cancel the timer. */
export type QuotaPoller = {
	/** Cancel the timer. Idempotent. */
	stop(): void;
};

/** Start the quota poller. Reads `data.modelProvider` each tick to pick the
 *  right adapter. Returns a handle to stop the loop on session_shutdown.
 *
 *  @param data - the shared ChromeData (mutated in place with quota fields)
 *  @param isEnabled - gate; return false to skip polling (e.g. chrome disabled)
 *  @param intervalMs - override poll interval (default 60_000); for tests */
export function startQuotaPoller(
	data: ChromeData,
	isEnabled: () => boolean,
	intervalMs: number = POLL_INTERVAL_MS,
): QuotaPoller {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const scheduleNext = (): void => {
		if (stopped) return;
		timer = setTimeout(tick, intervalMs);
	};

	const tick = async (): Promise<void> => {
		if (stopped) return;
		if (!isEnabled()) {
			scheduleNext();
			return;
		}

		const providerId = data.modelProvider;
		if (!providerId) {
			scheduleNext();
			return;
		}

		const provider = resolveQuotaProvider(providerId);
		if (!provider) {
			// No adapter for this provider — clear and skip.
			data.quotaPercent = null;
			data.quotaResetsLabel = null;
			scheduleNext();
			return;
		}

		const snapshot = await provider.fetch();
		if (snapshot) {
			data.quotaPercent = snapshot.remainingPercent;
			data.quotaResetsLabel = snapshot.resetsInMs !== null ? formatReset(snapshot.resetsInMs) : null;
		}
		// On null (fetch failed), keep the previous snapshot — don't clear.
		scheduleNext();
	};

	// Fire immediately so the segment appears without waiting 60s.
	tick();

	return {
		stop(): void {
			stopped = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}
