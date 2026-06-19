// =============================================================================
// visual/welcome.ts — soly startup header (replaces pi's built-in banner)
// =============================================================================
//
// Installed via ctx.ui.setHeader, shown once at startup above the chat:
//
//   ████  block "soly" wordmark (accent) ...
//   the project framework · running on pi, the coding engine
//
//   soly adds   plans · state · rules · workflows · ask_pro picker
//   project     v1.12 · plan 2/5 — auth refactor · ≡ 4 rules · 2 docs
//   next        → /execute
//   start here  /soly-init · /plan · /soly · /why · /rules stats
//   recent      1.11.2  …  ·  1.10.0  …
//
// pi is explicitly credited (engine) with soly as the framework on top. The
// builder is pure; fs access (version + CHANGELOG) is isolated in
// readWelcomeMeta so the layout is unit-testable.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { themeStyler, type ChromeStyler } from "./style.ts";
import { type ColorMode, type RGB, colorizeColumns, gradient, hexToRgb, parseAnsiColor, variations } from "./gradient.ts";

/** Letter-fill texture (dense, with a lighter weave) — readable but detailed. */
const LETTER_TEX = ["█", "▓", "█", "▒"];
/** Particle ramp for the right-side field: sparse/light → dense/full. */
const PARTICLE = ["·", "░", "▒", "▓", "█"];
/** Left margin before the wordmark. */
const LEFT_PAD = 2;

/** Stable, well-distributed [0,1) hash of a cell (murmur3 finalizer). `salt`
 *  yields independent streams for placement vs. glyph weight. No flicker. */
function hash01(x: number, y: number, salt = 0): number {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/** Block wordmark for "soly" (accent + bold). Falls back to plain text in ASCII mode. */
export const SOLY_ART: readonly string[] = [
	"█████ █████ █     █   █",
	"█     █   █ █     █   █",
	"█████ █   █ █     █████",
	"    █ █   █ █         █",
	"█████ █████ █████ █████",
];

const TAGLINE = "the project framework · running on pi, the coding engine";
const SOLY_ADDS = "plans · state · rules · workflows · ask_pro picker";
const START_HERE: ReadonlyArray<[string, string]> = [
	["/soly-init", "scaffold .agents/ in a new project"],
	["/plan", "plan the current phase"],
	["/soly", "state picker  ·  /why  ·  /rules stats"],
];
const LABEL_WIDTH = 11;

/** Live values for the welcome header. */
export type WelcomeInput = {
	version: string;
	hasProject: boolean;
	phaseLabel: string | null;
	nextHint: string | null;
	rulesActive: number;
	docsCount: number;
	/** Up to N "version  summary" strings parsed from CHANGELOG.md. */
	recent: string[];
};

export type WelcomeOpts = {
	ascii: boolean;
	styler: ChromeStyler;
	width: number;
	/** Terminal color depth; "none" (default) disables the gradient. */
	colorMode?: ColorMode;
	/** Explicit gradient stops (hex); when empty the accent is used instead. */
	colorStops?: string[];
	/** Theme accent in RGB — the default gradient is variations of this. */
	accent?: RGB | null;
};

/** Indented `label  value` row with a fixed label column. */
function row(label: string, value: string, styler: ChromeStyler): string {
	return `  ${styler.dim(label.padEnd(LABEL_WIDTH))}${value}`;
}

/**
 * One field cell to the right of the wordmark — a particle spray that fades
 * outward. Placement uses one cell hash (so it scatters, no vertical bands);
 * the glyph weight uses a second, independent hash mixed with the falloff, so
 * dense near the letters and sparse sparkles toward the edge — never solid bands.
 */
function fieldCell(row: number, col: number, start: number, width: number): string {
	const span = Math.max(12, width - start);
	const fall = Math.max(0, 1 - (col - start) / span) ** 1.8; // bright near letters → faint outward
	const density = Math.max(fall, 0.05); // faint starfield floor so sparks reach the full width
	if (hash01(col, row) > density) return " ";
	const weight = hash01(col, row, 101);
	const idx = Math.min(PARTICLE.length - 1, Math.floor(fall * (0.55 + 0.5 * weight) * PARTICLE.length));
	return PARTICLE[idx] ?? "·";
}

/** Build one banner row: textured letters (left) + dissolving particle field (right). */
function bannerRow(row: number, width: number): string {
	const mask = SOLY_ART[row] ?? "";
	const artW = visibleWidth(SOLY_ART[0] ?? "");
	let line = " ".repeat(LEFT_PAD);
	for (let c = LEFT_PAD; c < width; c++) {
		const ac = c - LEFT_PAD;
		if (ac < artW) {
			const cell = mask[ac];
			line += cell && cell !== " " ? (LETTER_TEX[(row + ac) % LETTER_TEX.length] ?? "█") : " ";
		} else {
			line += fieldCell(row, c, LEFT_PAD + artW, width);
		}
	}
	return line;
}

/**
 * The banner: a "soly" wordmark drawn with mixed block glyphs that dissolves
 * into a generative particle field on the right, swept by a gradient derived
 * from the theme accent (or explicit stops). Falls back to a plain accent
 * wordmark in ASCII / no-color / very narrow terminals.
 */
function bannerLines(opts: WelcomeOpts): string[] {
	const { ascii, styler, width, colorMode = "none", colorStops = [], accent = null } = opts;
	const artW = visibleWidth(SOLY_ART[0] ?? "");
	if (ascii || width < artW + LEFT_PAD) return [styler.bold(styler.fg("accent", "soly"))];

	const rows = SOLY_ART.map((_, r) => bannerRow(r, width));
	const explicit = colorStops.map(hexToRgb).filter((c): c is RGB => c !== null);
	const stops = explicit.length > 0 ? explicit : accent ? variations(accent) : [];
	if (colorMode === "none" || stops.length === 0) return rows.map((row) => styler.fg("accent", row));

	const colors = gradient(stops, width);
	return rows.map((row) => colorizeColumns(row, colors, colorMode));
}

/** The "project" row value, depending on whether a soly project exists. */
function projectValue(input: WelcomeInput, styler: ChromeStyler): string {
	if (!input.hasProject) return styler.dim("no soly project here  →  /soly-init to scaffold");
	const bits = [styler.fg("accent", `v${input.version}`)];
	if (input.phaseLabel) bits.push(input.phaseLabel);
	if (input.rulesActive > 0) bits.push(`≡ ${input.rulesActive}`);
	if (input.docsCount > 0) bits.push(`${input.docsCount} docs`);
	return bits.join(styler.dim(" · "));
}

/**
 * Build the full welcome header. Pure given a styler (identity in tests).
 * Width is used only to choose the banner form; rows are not hard-wrapped.
 */
export function buildWelcomeLines(input: WelcomeInput, opts: WelcomeOpts): string[] {
	const { styler } = opts;
	const lines: string[] = [...bannerLines(opts), "", `  ${styler.dim(TAGLINE)}`, ""];

	lines.push(row("soly adds", styler.dim(SOLY_ADDS), styler));
	lines.push(row("project", projectValue(input, styler), styler));
	if (input.hasProject && input.nextHint) lines.push(row("next", styler.fg("accent", input.nextHint), styler));

	lines.push("");
	START_HERE.forEach(([cmd, desc], i) => {
		const label = i === 0 ? "start here" : "";
		lines.push(row(label, `${styler.fg("accent", cmd.padEnd(11))} ${styler.dim(desc)}`, styler));
	});

	if (input.recent.length > 0) {
		lines.push("");
		input.recent.forEach((entry, i) => lines.push(row(i === 0 ? "recent" : "", styler.dim(entry), styler)));
	}

	return lines;
}

// ---------------------------------------------------------------------------
// Metadata (fs) — version from package.json, recent entries from CHANGELOG.md
// ---------------------------------------------------------------------------

function readChangelogText(extRoot: string): string | null {
	for (const p of [path.join(extRoot, "CHANGELOG.md"), path.join(extRoot, "..", "..", "CHANGELOG.md")]) {
		try {
			return fs.readFileSync(p, "utf-8");
		} catch {
			/* try next */
		}
	}
	return null;
}

/** Strip markdown emphasis/links from a bullet and trim to a one-liner. */
function changelogTitle(bullet: string): string {
	const bold = bullet.match(/\*\*(.+?)\*\*/);
	const raw = (bold ? bold[1] : bullet).replace(/[`*_]/g, "").replace(/\[(.+?)\]\(.*?\)/g, "$1").trim();
	return raw.length > 46 ? `${raw.slice(0, 45)}…` : raw;
}

/** Parse the top `n` "version  summary" lines from CHANGELOG.md. */
export function parseRecentChanges(text: string, n: number): string[] {
	const out: string[] = [];
	let version: string | null = null;
	for (const line of text.split(/\r?\n/)) {
		const head = line.match(/^#{2,}\s*\[?v?(\d+\.\d+\.\d+)\]?/);
		if (head?.[1]) {
			version = head[1];
			continue;
		}
		const bullet = line.match(/^\s*-\s+(.*\S)\s*$/);
		if (version && bullet?.[1]) {
			out.push(`${version}  ${changelogTitle(bullet[1])}`);
			version = null;
			if (out.length >= n) break;
		}
	}
	return out;
}

/** Read version + recent changelog entries from the installed package. */
export function readWelcomeMeta(extRoot: string, recentCount = 2): { version: string; recent: string[] } {
	let version = "0.0.0";
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(extRoot, "package.json"), "utf-8")) as { version?: string };
		if (typeof pkg.version === "string") version = pkg.version;
	} catch {
		/* keep default */
	}
	const text = readChangelogText(extRoot);
	return { version, recent: text ? parseRecentChanges(text, recentCount) : [] };
}

/** pi Component for the startup header. Reads the welcome snapshot live. */
export class SolyHeader implements Component {
	constructor(
		private readonly getWelcome: () => WelcomeInput | null,
		private readonly theme: Theme,
		private readonly getAscii: () => boolean,
		private readonly getBannerColors: () => string[],
	) {}

	invalidate(): void {
		/* stateless */
	}

	render(width: number): string[] {
		const input = this.getWelcome();
		if (!input) return [];
		const ascii = this.getAscii();
		const colorMode: ColorMode = ascii ? "none" : this.theme.getColorMode();
		const lines = buildWelcomeLines(input, {
			ascii,
			styler: themeStyler(this.theme),
			width,
			colorMode,
			colorStops: this.getBannerColors(),
			accent: parseAnsiColor(this.theme.getFgAnsi("accent")),
		});
		// Never let a line overflow the viewport.
		return lines.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
	}
}
