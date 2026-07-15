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
//
// The API returns `current_interval_remaining_percent` (what's left). We
// invert it to **used** (100 - remaining) to match the MiniMax web dashboard
// semantics — "used" grows as you spend, which reads more intuitively in a
// status bar than "remaining" which shrinks.
// =============================================================================

import { execFile } from "node:child_process";
import type { QuotaProvider, QuotaSnapshot } from "./types.ts";

// Minimal shape we read from `mmx quota show --output json`. We track
// `remaining` (what the API calls `current_interval_remaining_percent`) and
// invert it to `used` for display.
type MinimaxQuotaResponse = {
	model_remains?: Array<{
		model_name?: string;
		current_interval_remaining_percent?: number;
		remains_time?: number;
	}>;
	base_resp?: { status_code?: number };
};

/** Detect Windows (where npm-installed CLIs are `.cmd` shims that execFile
 *  can't spawn directly without a shell). */
const IS_WIN = process.platform === "win32";

/** Strip common ANSI/OSC escape sequences (CSI + OSC) from a string.
 *  Idempotent — safe to apply to already-clean output. Used to defang
 *  pollution from Windows shells that inject their title sequence into
 *  subprocess pipes (e.g. `]0;C:\WINDOWS\system32\cmd.exe` from cmd.exe when
 *  `shell: true` is enabled). */
function stripAnsiShellNoise(s: string): string {
	return s
		// OSC: ESC ] ... BEL  (or ESC ] ... ESC \)
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
		// CSI: ESC [ ... letter  (covers colors, cursor moves, mode changes)
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		// Bare CR
		.replace(/\r/g, "");
}

/** Run mmx and capture stdout. Resolves to null on any failure
 *  (mmx missing, non-zero exit, timeout, bad JSON). Never throws.
 *
 *  On Windows, npm-global CLIs are `.cmd` shims (e.g. `mmx.cmd`). Node's
 *  `execFile` spawns the executable directly without a shell, so it can't
 *  resolve `mmx` → `mmx.cmd` and fails with ENOENT. `shell: true` lets the
 *  shell do that resolution. Safe here: args are fixed (no user input).
 *
 *  Side note: when shell=true the wrapping cmd.exe sometimes emits its
 *  title sequence (`]0;...\x07`) into the pipe. We strip ANSI/OSC noise
 *  before returning so it never reaches the JSON parser or the chrome. */
function runMmx(args: string[], timeoutMs: number): Promise<string | null> {
	return new Promise((resolve) => {
		const opts = {
			encoding: "utf-8" as const,
			timeout: timeoutMs,
			maxBuffer: 1024 * 1024,
			shell: IS_WIN, // resolve .cmd shims on Windows
			windowsHide: true, // give cmd.exe its own hidden console
		};
		execFile("mmx", args, opts, (err, stdout) => {
			if (err) resolve(null);
			else resolve(stripAnsiShellNoise(stdout ?? ""));
		});
	});
}

/** Parse the mmx quota response, returning the "general" model snapshot
 *  with `remainingPercent` expressed as **used** (100 - remaining). */
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
	const remaining = general.current_interval_remaining_percent;
	if (typeof remaining !== "number") return null;
	return {
		remainingPercent: Math.max(0, Math.min(100, 100 - remaining)),
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
