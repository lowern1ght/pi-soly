// =============================================================================
// visual/glyphs.ts — Nerd-Font glyphs with ASCII fallbacks
// =============================================================================
//
// Each glyph has a Nerd-Font form and a plain-ASCII form. The chrome picks
// per-glyph based on a single `ascii` flag (from soly config). Kept tiny and
// pure so the components stay declarative.
// =============================================================================

export type GlyphName = "ctx" | "git" | "model" | "enter";

const NERD: Record<GlyphName, string> = {
	ctx: "◐",
	git: "⎇",
	model: "⊙",
	enter: "↵",
};

const ASCII: Record<GlyphName, string> = {
	ctx: "",
	git: "git:",
	model: "",
	enter: "enter",
};

/** Return the glyph for `name`, using the ASCII form when `ascii` is true. */
export function glyph(name: GlyphName, ascii: boolean): string {
	return ascii ? ASCII[name] : NERD[name];
}

/** Prefix `text` with a glyph + space, omitting the space when the glyph is empty. */
export function withGlyph(name: GlyphName, text: string, ascii: boolean): string {
	const g = glyph(name, ascii);
	return g ? `${g} ${text}` : text;
}
