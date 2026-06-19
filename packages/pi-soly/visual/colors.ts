// =============================================================================
// visual/colors.ts — theme color-role helpers for the soly chrome
// =============================================================================
//
// We only use a small subset of pi's ThemeColor union. Declaring it locally
// (a) avoids importing pi's internal type and (b) keeps the literals narrow
// so `theme.fg(role, text)` type-checks (the subset is assignable to
// ThemeColor). Pure: maps data → color-role name, no ANSI here.
// =============================================================================

/** Subset of pi's ThemeColor used by the chrome. Assignable to ThemeColor. */
export type ChromeColor = "text" | "muted" | "dim" | "accent" | "warning" | "error" | "success";

/**
 * Context-usage color by percentage, matching pi's native footer thresholds:
 * `> 90%` error, `> 70%` warning, otherwise muted. `null` (unknown, e.g. just
 * after compaction) is muted.
 */
export function ctxColor(percent: number | null): ChromeColor {
	if (percent === null || !Number.isFinite(percent)) return "muted";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "muted";
}
