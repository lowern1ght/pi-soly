// =============================================================================
// quota/format.ts — human-readable reset time
// =============================================================================
//
// Turns a millisecond duration into a compact English label for the toolbar:
//   1_200_000  → "in 20m"
//   9_000_000  → "in 2h30m"
//   3_600_000  → "in 1h"
//   0          → "now"
//
// Kept pure (no DOM, no Date) so it's trivially testable.
// =============================================================================

/** Format a millisecond duration as a compact "in Nm" / "in Nh" / "in NhMm". */
export function formatReset(ms: number): string {
	const totalMin = Math.round(ms / 60_000);
	if (totalMin <= 0) return "now";
	if (totalMin < 60) return `in ${totalMin}m`;
	const hours = Math.floor(totalMin / 60);
	const mins = totalMin % 60;
	if (mins === 0) return `in ${hours}h`;
	return `in ${hours}h${mins}m`;
}
