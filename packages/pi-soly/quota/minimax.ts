// =============================================================================
// quota/minimax.ts — MiniMax quota provider (via mmx CLI)
// =============================================================================
//
// Shells out to `mmx quota show --output json --quiet` every poll cycle.
// Uses mmx (mmx-cli) because it already handles auth (~/.mmx/config.json),
// region detection (global vs cn), and the billing endpoint. Reimplementing
// that as direct HTTP would duplicate mmx's logic for no gain.
//
// The response shape (confirmed against a live MiniMax-M3 key):
//   {
//     "model_remains": [
//       {
//         "model_name": "general",          ← chat models (MiniMax-M3)
//         "current_interval_remaining_percent": 53,
//         "remains_time": 1639649,          ← ms until interval resets
//         ...
//       },
//       { "model_name": "video", ... }
//     ],
//     "base_resp": { "status_code": 0, ... }
//   }
//
// We pick the "general" entry — that's the quota bucket MiniMax-M3 (and all
// text/chat models) draw from. Video/music have separate buckets.
// =============================================================================

import { execFile } from "node:child_process";
import type { QuotaProvider, QuotaSnapshot } from "./types.ts";

/** Minimal shape we read from `mmx quota show --output json`. */
type MinimaxQuotaResponse = {
	model_remains?: Array<{
		model_name?: string;
		current_interval_remaining_percent?: number;
		remains_time?: number;
	}>;
	base_resp?: { status_code?: number };
};

/** Run mmx and capture stdout. Resolves to null on any failure
 *  (mmx missing, non-zero exit, timeout, bad JSON). Never throws. */
function runMmx(args: string[], timeoutMs: number): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("mmx", args, { encoding: "utf-8", timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
			if (err) resolve(null);
			else resolve(stdout ?? "");
		});
	});
}

/** Parse the mmx quota response, returning the "general" model snapshot. */
function parseGeneralQuota(raw: string): QuotaSnapshot | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null; // not valid JSON — mmx printed an error to stdout
	}
	// Cast at the boundary (single documented place, per code-style rules).
	const data = parsed as MinimaxQuotaResponse;
	if (data.base_resp?.status_code !== 0) return null;
	const general = data.model_remains?.find((m) => m.model_name === "general");
	if (!general) return null;
	const pct = general.current_interval_remaining_percent;
	if (typeof pct !== "number") return null;
	return {
		remainingPercent: pct,
		resetsInMs: typeof general.remains_time === "number" ? general.remains_time : null,
	};
}

/** MiniMax quota provider. Polls `mmx quota show`. */
export const minimaxProvider: QuotaProvider = {
	id: "minimax",
	async fetch(): Promise<QuotaSnapshot | null> {
		const stdout = await runMmx(["quota", "show", "--output", "json", "--quiet"], 15_000);
		if (stdout === null) return null;
		return parseGeneralQuota(stdout);
	},
};
