// =============================================================================
// visual/working.ts — working-indicator telemetry message (pure builder)
// =============================================================================
//
// pi animates the working spinner natively (ctx.ui.setWorkingIndicator with
// our snowflake frames). This module only builds the *text* shown next to it
// via ctx.ui.setWorkingMessage — a live telemetry line:
//
//   Working · 8s · ↑12.4k ↓1.2k · 148 tok/s
//
//   ↑ = context tokens sent with the request (from getContextUsage at start)
//   ↓ = tokens generated so far this turn (grows via message_update)
//   tok/s = ↓ / elapsed seconds
//
// Fields drop by priority on narrow terminals (tok/s → tokens → time → label),
// via segments.fitParts. Pure: pass an explicit maxWidth in tests.
// =============================================================================

import { fitParts, type Segment } from "./segments.ts";
import { formatElapsed, formatTokens } from "./format.ts";

/** Default snowflake spinner frames + interval (user-chosen). */
export const SPINNER_FRAMES = ["▁", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃"] as const;
export const SPINNER_INTERVAL_MS = 180;

export type WorkingTelemetry = {
	/** Leading word, e.g. "Working". */
	label: string;
	/** Elapsed time since the turn started, in ms. */
	elapsedMs: number;
	/** Context tokens sent with the request (↑). */
	inputTokens: number;
	/** Tokens generated so far this turn (↓). */
	outputTokens: number;
};

/**
 * Build the working telemetry line, fitted to `maxWidth` visible columns.
 * Drops low-priority fields first: tok/s, then tokens, then elapsed; the
 * label is kept last. Text is plain (no ANSI) — the caller may style it.
 */
export function buildWorkingMessage(t: WorkingTelemetry, maxWidth: number): string {
	const elapsedSec = Math.floor(t.elapsedMs / 1000);
	const parts: Segment[] = [{ id: "label", text: t.label, priority: 5 }];

	parts.push({ id: "time", text: formatElapsed(t.elapsedMs), priority: 4 });

	const tokenBits: string[] = [];
	if (t.inputTokens > 0) tokenBits.push(`↑${formatTokens(t.inputTokens)}`);
	if (t.outputTokens > 0) tokenBits.push(`↓${formatTokens(t.outputTokens)}`);
	if (tokenBits.length > 0) {
		parts.push({ id: "tokens", text: tokenBits.join(" "), priority: 3 });
	}

	if (t.outputTokens > 0 && elapsedSec > 0) {
		const rate = Math.round(t.outputTokens / elapsedSec);
		parts.push({ id: "rate", text: `${rate} tok/s`, priority: 2 });
	}

	return fitParts(parts, Math.max(0, maxWidth));
}
