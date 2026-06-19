// =============================================================================
// visual/style.ts — styling indirection so render logic stays testable
// =============================================================================
//
// Components style segment text through a ChromeStyler rather than touching a
// pi Theme directly. Production wraps the real Theme; tests pass `identityStyler`
// so assertions can compare exact, un-ANSI'd columns.
// =============================================================================

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ChromeColor } from "./colors.ts";

/** Minimal styling surface used by the chrome. */
export type ChromeStyler = {
	fg(color: ChromeColor, text: string): string;
	dim(text: string): string;
	bold(text: string): string;
};

/** Wrap a real pi Theme. ChromeColor is a subset of ThemeColor, so this is sound. */
export function themeStyler(theme: Theme): ChromeStyler {
	return {
		fg: (color, text) => theme.fg(color, text),
		dim: (text) => theme.fg("dim", text),
		bold: (text) => theme.bold(text),
	};
}

/** No-op styler for tests — returns text unchanged so widths are predictable. */
export const identityStyler: ChromeStyler = {
	fg: (_color, text) => text,
	dim: (text) => text,
	bold: (text) => text,
};
