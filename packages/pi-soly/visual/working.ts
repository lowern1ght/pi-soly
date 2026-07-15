// =============================================================================
// visual/working.ts — working-indicator message (pure builder)
// =============================================================================
//
// pi animates the working spinner natively (ctx.ui.setWorkingIndicator with
// our snowflake frames). This module builds the *text* shown next to it
// via ctx.ui.setWorkingMessage.
//
// v2.6.2: telemetry numbers removed per user request. Now shows only
// elapsed time + a rotating fun verb that changes every ~5 seconds:
//
//   ⠉ Working · 8s · thinking...
//   ⠉ Working · 23m · crunching...
//
// The verb rotates on each call (renderWorking fires every 1s via the
// timer). A simple counter picks the next verb — deterministic, no random.
// =============================================================================

import { fitParts, type Segment } from "./segments.ts";
import { formatElapsed } from "./format.ts";

/** Default spinner frames + interval (user-chosen): braille "breathing"
 *  (grow→shrink) → a quadrant arrow sweep → breathing again, slowed down. */
export const SPINNER_FRAMES = [
	"⠁", "⠉", "⠙", "⠹", "⠽", "⠿", "⠾", "⠼", "⠶", "⠦", "⠆", "⠂",
	"◴", "◷", "◶", "◵",
	"⠁", "⠉", "⠙", "⠹", "⠽", "⠿", "⠾", "⠼", "⠶", "⠦", "⠆", "⠂",
] as const;
export const SPINNER_INTERVAL_MS = 150;

/** Rotating fun verbs shown next to the elapsed time. Changes every ~5s. */
const WORKING_VERBS = [
	"thinking",
	"crunching",
	"brewing",
	"cooking",
	"weaving",
	"crafting",
	"pondering",
	"shaping",
	"distilling",
	"polishing",
] as const;

/** Pick a verb based on elapsed time — rotates every 5 seconds. */
function pickVerb(elapsedMs: number): string {
	const idx = Math.floor(elapsedMs / 5000) % WORKING_VERBS.length;
	return WORKING_VERBS[idx]!;
}

export type WorkingTelemetry = {
	/** Leading word, e.g. "Working". */
	label: string;
	/** Elapsed time since the turn started, in ms. */
	elapsedMs: number;
	/** Context tokens sent with the request (↑). Kept in the type for
	 *  back-compat with callers, but NOT rendered (removed in v2.6.2). */
	inputTokens: number;
	/** Tokens generated so far this turn (↓). Kept in the type but NOT rendered. */
	outputTokens: number;
};

/**
 * Build the working message, fitted to `maxWidth` visible columns.
 *
 * v2.6.2: only elapsed time + rotating verb. Token telemetry (↑↓ tok/s)
 * removed per user request — the spinner + verb is enough visual signal.
 * Fields drop by priority on narrow terminals: verb → time → label.
 */
export function buildWorkingMessage(t: WorkingTelemetry, maxWidth: number): string {
	const parts: Segment[] = [
		{ id: "label", text: t.label, priority: 5 },
		{ id: "time", text: formatElapsed(t.elapsedMs), priority: 4 },
		{ id: "verb", text: `${pickVerb(t.elapsedMs)}…`, priority: 3 },
	];
	return fitParts(parts, Math.max(0, maxWidth));
}
