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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ChromeData } from "../visual/data.ts";
import { resolveQuotaProvider } from "./registry.ts";
import { formatReset } from "./format.ts";

/** TEMP DEBUG — append a line to the quota debug log. Remove after diagnosis. */
const DEBUG_LOG = path.join(os.tmpdir(), "pi-soly-quota-debug.log");
function dbg(msg: string): void {
	try {
		fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
	} catch { /* best effort */ }
}

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
 *  @param onUpdate - called after each successful write to ChromeData, so the
 *    caller can trigger a footer re-render (pi doesn't auto-render when a
 *    background timer mutates data — only on token ticks / user input).
 *  @param intervalMs - override poll interval (default 60_000); for tests */
export function startQuotaPoller(
	data: ChromeData,
	isEnabled: () => boolean,
	onUpdate: () => void,
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
		dbg(`tick: enabled=${isEnabled()} provider=${data.modelProvider}`);
		if (!isEnabled()) {
			dbg("disabled, skipping");
			scheduleNext();
			return;
		}

		const providerId = data.modelProvider;
		if (!providerId) {
			dbg("no modelProvider");
			scheduleNext();
			return;
		}

		const provider = resolveQuotaProvider(providerId);
		if (!provider) {
			dbg(`no adapter for ${providerId}`);
			data.quotaPercent = null;
			data.quotaResetsLabel = null;
			scheduleNext();
			return;
		}

		let snapshot;
		try {
			snapshot = await provider.fetch();
			dbg(`fetch result: ${JSON.stringify(snapshot)}`);
		} catch (e) {
			dbg(`fetch threw: ${e instanceof Error ? e.message : String(e)}`);
			snapshot = null;
		}
		if (snapshot) {
			data.quotaPercent = snapshot.remainingPercent;
			data.quotaResetsLabel = snapshot.resetsInMs !== null ? formatReset(snapshot.resetsInMs) : null;
			dbg(`wrote data: pct=${data.quotaPercent} label=${data.quotaResetsLabel}`);
			onUpdate();
			dbg("called onUpdate (poke)");
		}
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
