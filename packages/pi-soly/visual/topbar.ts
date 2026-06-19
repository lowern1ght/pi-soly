// =============================================================================
// visual/topbar.ts — soly's top "polosa" (aboveEditor widget)
// =============================================================================
//
//   execute ───────────────────────────────────────────  ⊙ opus-4.8 · high
//   └─ left: verb                   right: model (+ thinking level) ─┘
//
// Carries soly's active *workflow verb* only (phase moved to the footer).
// Hidden entirely (renders []) when no verb is active — so ordinary sessions
// show no extra line. The model is shown here when the bar is visible, and in
// the footer otherwise (see footer.ts), so it never appears twice.
// =============================================================================

import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { composeBar, type Segment } from "./segments.ts";
import type { ChromeData } from "./data.ts";
import { modelText } from "./footer.ts";
import { themeStyler, type ChromeStyler } from "./style.ts";

export type TopBarOpts = { ascii: boolean; styler: ChromeStyler };

/**
 * Build the top-bar lines. Returns `[]` (hidden) when there is no verb and no
 * phase. Pure given a styler.
 */
export function buildTopBarLines(data: ChromeData, width: number, opts: TopBarOpts): string[] {
	const { ascii, styler } = opts;
	const left: Segment[] = [];
	// Phase now lives in the footer; the top bar appears only for an active verb.
	if (data.verbLabel) left.push({ id: "verb", text: styler.fg("accent", data.verbLabel), priority: 8 });
	if (left.length === 0) return [];

	const right: Segment[] = [];
	if (data.modelId) right.push({ id: "model", text: styler.fg("muted", modelText(data, ascii)), priority: 6 });

	return [composeBar({ left, right, width, styleFill: styler.dim })];
}

/** pi Component wrapping the top bar; reads live ChromeData each render. */
export class SolyTopBar implements Component {
	constructor(
		private readonly data: ChromeData,
		private readonly theme: Theme,
		private readonly getAscii: () => boolean,
	) {}

	invalidate(): void {
		/* stateless — render() always reads fresh data */
	}

	render(width: number): string[] {
		return buildTopBarLines(this.data, width, { ascii: this.getAscii(), styler: themeStyler(this.theme) });
	}
}
