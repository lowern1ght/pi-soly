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
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { QuotaProvider, QuotaSnapshot } from "./types.ts";

/** TEMP DEBUG. */
const DEBUG_LOG = path.join(os.tmpdir(), "pi-soly-quota-debug.log");
function dbg(msg: string): void {
	try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [minimax] ${msg}\n`); } catch { /* best effort */ }
}

/** Detect Windows (where npm-installed CLIs are `.cmd` shims that execFile
 *  can't spawn directly without a shell). */
const IS_WIN = process.platform === "win32";

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
 *  (mmx missing, non-zero exit, timeout, bad JSON). Never throws.
 *
 *  On Windows, npm-global CLIs are `.cmd` shims (e.g. `mmx.cmd`). Node's
 *  `execFile` spawns the executable directly without a shell, so it can't
 *  resolve `mmx` → `mmx.cmd` and fails with ENOENT. `shell: true` lets the
 *  shell do that resolution. Safe here: args are fixed (no user input). */
function runMmx(args: string[], timeoutMs: number): Promise<string | null> {
	return new Promise((resolve) => {
		const opts = {
			encoding: "utf-8" as const,
			timeout: timeoutMs,
			maxBuffer: 1024 * 1024,
			shell: IS_WIN, // resolve .cmd shims on Windows
		};
		execFile("mmx", args, opts, (err, stdout, stderr) => {
			if (err) {
				dbg(`runMmx error: ${err instanceof Error ? err.message : String(err)} (code=${(err as { code?: string }).code ?? "?"}) stderr=${(stderr ?? "").slice(0, 200)}`);
				resolve(null);
			} else {
				dbg(`runMmx ok: ${String(stdout).length} bytes`);
				resolve(stdout ?? "");
			}
		});
	});
}

/** Parse the mmx quota response, returning the "general" model snapshot. */
function parseGeneralQuota(raw: string): QuotaSnapshot | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		dbg(`parse: JSON.parse failed: ${e instanceof Error ? e.message : String(e)}; raw[0..100]=${raw.slice(0, 100)}`);
		return null; // not valid JSON — mmx printed an error to stdout
	}
	// Cast at the boundary (single documented place, per code-style rules).
	const data = parsed as MinimaxQuotaResponse;
	if (data.base_resp?.status_code !== 0) {
		dbg(`parse: status_code=${data.base_resp?.status_code} (expected 0)`);
		return null;
	}
	const general = data.model_remains?.find((m) => m.model_name === "general");
	if (!general) {
		dbg(`parse: no 'general' model entry; have: ${(data.model_remains ?? []).map((m) => m.model_name).join(",")}`);
		return null;
	}
	const pct = general.current_interval_remaining_percent;
	if (typeof pct !== "number") {
		dbg(`parse: pct is ${typeof pct}`);
		return null;
	}
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
