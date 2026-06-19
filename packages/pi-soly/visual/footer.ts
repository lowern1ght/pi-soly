// =============================================================================
// visual/footer.ts — soly's custom footer (the bottom "polosa")
// =============================================================================
//
// Installed via ctx.ui.setFooter, this replaces pi's built-in footer. It is a
// single width-aware bar:
//
//   ◐ 34% · ⎇ master *3 ───────────  ~/…/pi-soly · ↑12.4k · ↵ send
//   └─ left: context% · git · foreign ext statuses
//                              right: [model] · pwd · tokens · keys ─┘
//
// `model` appears here only when the top bar is hidden (no active phase/verb),
// so it is always visible somewhere but never duplicated. Foreign extension
// statuses (e.g. the MCP icons) are folded in; our own legacy "soly" status
// key is excluded to avoid echoing it. Layout/drop logic lives in segments.ts.
// =============================================================================

import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { composeBar, type Segment } from "./segments.ts";
import { ctxColor } from "./colors.ts";
import { fitPath, formatTokens } from "./format.ts";
import { withGlyph } from "./glyphs.ts";
import type { ChromeData } from "./data.ts";
import { themeStyler, type ChromeStyler } from "./style.ts";

/** Structural subset of pi's ReadonlyFooterDataProvider we consume. */
export type FooterData = {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
};

export type FooterOpts = {
	ascii: boolean;
	styler: ChromeStyler;
	/** Override the keys hint segment; defaults to "↵ send". */
	keysHint?: string;
};

/** Max columns a pwd segment may occupy before it elides (see fitPath tiers). */
const PWD_MAX = 28;

/** Glyph for the active-rules count (Unicode form; ASCII falls back to "N rules"). */
const RULES_GLYPH = "≡";

/** Model id (+ thinking level when supported), prefixed with the model glyph. */
export function modelText(data: ChromeData, ascii: boolean): string {
	const id = data.modelId ?? "no-model";
	const showThink = data.reasoning && data.thinkingLevel !== null && data.thinkingLevel !== "off";
	const label = showThink ? `${id} · ${data.thinkingLevel}` : id;
	return withGlyph("model", label, ascii);
}

/** Build the full-width footer line. Pure given a styler (identity in tests). */
export function buildFooterLine(data: ChromeData, fd: FooterData, width: number, opts: FooterOpts): string {
	const { ascii, styler } = opts;
	const left: Segment[] = [];
	const right: Segment[] = [];

	// Phase leads the footer (monochrome — ctx% keeps the only functional color).
	if (data.phaseLabel) left.push({ id: "phase", text: styler.fg("muted", data.phaseLabel), priority: 8 });

	const pct = data.ctxPercent;
	const ctxText = withGlyph("ctx", pct === null ? "?" : `${Math.round(pct)}%`, ascii);
	left.push({ id: "ctx", text: styler.fg(ctxColor(pct), ctxText), priority: 9 });

	const branch = fd.getGitBranch();
	if (branch) {
		const dirty = data.gitDirty > 0 ? ` *${data.gitDirty}` : "";
		left.push({ id: "git", text: styler.fg("muted", withGlyph("git", `${branch}${dirty}`, ascii)), priority: 7 });
	}

	if (data.rulesActive > 0) {
		const word = data.rulesActive === 1 ? "rule" : "rules";
		const rulesText = ascii ? `${data.rulesActive} ${word}` : `${RULES_GLYPH} ${data.rulesActive}`;
		left.push({ id: "rules", text: styler.dim(rulesText), priority: 5 });
	}

	const exts = [...fd.getExtensionStatuses().entries()]
		.filter(([key]) => key !== "soly")
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, value]) => value.replace(/[\r\n\t]+/g, " ").trim())
		.filter((value) => value.length > 0);
	if (exts.length > 0) left.push({ id: "ext", text: styler.dim(exts.join(" · ")), priority: 3 });

	// The top bar now carries only the active verb; phase lives here. So the
	// model belongs in the footer whenever no verb is active (top bar hidden).
	const topbarHidden = data.verbLabel === null;
	if (topbarHidden && data.modelId) {
		right.push({ id: "model", text: styler.fg("muted", modelText(data, ascii)), priority: 6 });
	}

	const pwd = fitPath(data.cwd, data.home, PWD_MAX);
	if (pwd) right.push({ id: "pwd", text: styler.dim(pwd), priority: 4 });

	if (data.ctxTokens !== null && data.ctxTokens > 0) {
		right.push({ id: "tokens", text: styler.dim(`↑${formatTokens(data.ctxTokens)}`), priority: 5 });
	}

	right.push({ id: "keys", text: styler.dim(opts.keysHint ?? withGlyph("enter", "send", ascii)), priority: 2 });

	return composeBar({ left, right, width, styleFill: styler.dim });
}

/** pi Component wrapping the footer line; reads live ChromeData each render. */
export class SolyFooter implements Component {
	constructor(
		private readonly data: ChromeData,
		private readonly fd: FooterData,
		private readonly theme: Theme,
		private readonly getAscii: () => boolean,
	) {}

	invalidate(): void {
		/* stateless — render() always reads fresh data */
	}

	render(width: number): string[] {
		return [buildFooterLine(this.data, this.fd, width, { ascii: this.getAscii(), styler: themeStyler(this.theme) })];
	}
}
