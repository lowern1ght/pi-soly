// =============================================================================
// visual/segments.ts — width-aware segment composition for the soly chrome
// =============================================================================
//
// A bar is two ordered lists of segments (left + right). Each segment carries
// a `priority` (lower = dropped first when the terminal is too narrow). The
// composer drops the lowest-priority segments until the bar fits, then joins
// left/right with a separator and fills the gap with a rule (e.g. `─`).
//
// Segment `text` may already contain ANSI color codes; all width math uses
// pi's `visibleWidth`/`truncateToWidth`, which ignore ANSI and handle wide
// glyphs, so coloring never breaks the layout (same approach as pi's native
// footer). The composer itself is pure: pass an identity `styleFill` in tests
// to assert exact column widths.
// =============================================================================

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** One unit of a bar. `text` is the final (possibly ANSI-styled) string. */
export type Segment = {
	/** Stable id (for debugging / future per-segment config). */
	id: string;
	/** Rendered text, may contain ANSI codes. */
	text: string;
	/** Lower priority is dropped first when space runs out. */
	priority: number;
};

export type ComposeOptions = {
	left: Segment[];
	right: Segment[];
	width: number;
	/** Separator between segments on the same side. Default `" · "`. */
	sep?: string;
	/** Fill character for the gap between left and right. Default `"─"`. */
	fillChar?: string;
	/** Styles the gap fill (e.g. dim). Identity by default. */
	styleFill?: (s: string) => string;
};

/** Sum of segment widths joined by `sep`. */
function barWidth(segs: Segment[], sep: string): number {
	if (segs.length === 0) return 0;
	const sepW = visibleWidth(sep) * (segs.length - 1);
	return segs.reduce((w, s) => w + visibleWidth(s.text), 0) + sepW;
}

/** Min columns between the left group and a non-empty right group. */
const MIN_GAP = 2;

function joinSide(segs: Segment[], sep: string): string {
	return segs.map((s) => s.text).join(sep);
}

/**
 * Drop the lowest-priority segments (from either side) until the bar fits
 * `width`. Ties break toward dropping right-side segments first, so the
 * left identity/context stays put longest. Returns the surviving lists.
 */
function dropToFit(left: Segment[], right: Segment[], width: number, sep: string): {
	left: Segment[];
	right: Segment[];
} {
	let l = [...left];
	let r = [...right];
	const fits = () => {
		const gap = r.length > 0 ? MIN_GAP : 0;
		return barWidth(l, sep) + barWidth(r, sep) + gap <= width;
	};
	while (!fits() && l.length + r.length > 0) {
		const lowL = l.reduce<Segment | null>((m, s) => (m && m.priority <= s.priority ? m : s), null);
		const lowR = r.reduce<Segment | null>((m, s) => (m && m.priority <= s.priority ? m : s), null);
		// Prefer dropping the right side on ties (keep left identity).
		if (lowR && (!lowL || lowR.priority <= lowL.priority)) {
			r = r.filter((s) => s.id !== lowR.id);
		} else if (lowL) {
			l = l.filter((s) => s.id !== lowL.id);
		} else {
			break;
		}
	}
	return { left: l, right: r };
}

/**
 * Compose a single full-width bar line. Drops by priority to fit, joins each
 * side with `sep`, and fills the middle gap with a styled rule. When the two
 * sides still don't fit after dropping (single dominant segment), the right
 * side is truncated, then the left, mirroring pi's native footer.
 */
export function composeBar(opts: ComposeOptions): string {
	const sep = opts.sep ?? " · ";
	const fillChar = opts.fillChar ?? "─";
	const styleFill = opts.styleFill ?? ((s) => s);
	const width = Math.max(0, opts.width);

	const kept = dropToFit(opts.left, opts.right, width, sep);
	let leftStr = joinSide(kept.left, sep);
	let rightStr = joinSide(kept.right, sep);
	let wl = visibleWidth(leftStr);
	let wr = visibleWidth(rightStr);

	if (rightStr.length === 0) {
		return wl > width ? truncateToWidth(leftStr, width, "…") : leftStr;
	}

	if (wl + MIN_GAP + wr > width) {
		// Truncate right, then left, to guarantee a single line.
		const availRight = width - wl - MIN_GAP;
		rightStr = availRight > 0 ? truncateToWidth(rightStr, availRight, "") : "";
		if (rightStr.length === 0) return truncateToWidth(leftStr, width, "…");
		wr = visibleWidth(rightStr);
		const pad = Math.max(0, width - wl - wr);
		return leftStr + " ".repeat(pad) + rightStr;
	}

	const gap = width - wl - wr;
	const fill = gap >= MIN_GAP ? styleFill(` ${fillChar.repeat(gap - MIN_GAP)} `) : " ".repeat(gap);
	return leftStr + fill + rightStr;
}

/**
 * Join a flat list of prioritized parts into a single string no wider than
 * `width`, dropping the lowest-priority parts first. Used for the working
 * indicator message. Pure; no fill, no padding.
 */
export function fitParts(parts: Segment[], width: number, sep = " · "): string {
	let kept = [...parts];
	const total = () => barWidth(kept, sep);
	while (total() > width && kept.length > 1) {
		const low = kept.reduce((m, s) => (m.priority <= s.priority ? m : s));
		kept = kept.filter((s) => s.id !== low.id);
	}
	const joined = joinSide(kept, sep);
	return visibleWidth(joined) > width ? truncateToWidth(joined, width, "…") : joined;
}
