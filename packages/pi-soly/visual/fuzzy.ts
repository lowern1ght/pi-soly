// =============================================================================
// visual/fuzzy.ts — shared subsequence fuzzy match scorer
// =============================================================================
//
// Extracted from list-panel.ts (where it was duplicated in mcp-panel.ts).
// Pure function, no deps — trivially testable.
//
// Scoring:
//   - exact substring match: 100 + (queryLen / textLen) — highest
//   - in-order subsequence:  1 — match but not contiguous
//   - no match:              0
// =============================================================================

/** Subsequence fuzzy match: substring scores highest, then in-order chars.
 *  Returns 0 for no match, >0 for a match. */
export function fuzzyScore(query: string, text: string): number {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (!q) return 1;
	if (t.includes(q)) return 100 + q.length / t.length;
	let qi = 0;
	for (let i = 0; i < t.length && qi < q.length; i++) {
		if (t[i] === q[qi]) qi++;
	}
	return qi === q.length ? 1 : 0;
}
