// =============================================================================
// visual/gradient.ts — truecolor gradient helpers for the banner ("переливы")
// =============================================================================
//
// Pure RGB math + ANSI emission, mode-aware:
//   - truecolor → 24-bit `\x1b[38;2;r;g;bm`
//   - 256color  → nearest xterm-256 `\x1b[38;5;Nm`
//   - none      → no codes (plain text; used in tests / NO_COLOR / ASCII)
//
// Used by welcome.ts to paint the full-width wave band and the "soly" wordmark
// with a multi-stop color sweep. No pi imports → trivially unit-testable.
// =============================================================================

import { visibleWidth } from "@earendil-works/pi-tui";

export type RGB = { r: number; g: number; b: number };
export type ColorMode = "truecolor" | "256color" | "none";

export const RESET = "\x1b[0m";

/** Parse `#rgb` / `#rrggbb` → RGB, or null when malformed. */
export function hexToRgb(hex: string): RGB | null {
	const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
	if (!m?.[1]) return null;
	const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
	return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Linear interpolate between two colors. `t` in [0,1]. */
export function lerp(a: RGB, b: RGB, t: number): RGB {
	return { r: clamp255(a.r + (b.r - a.r) * t), g: clamp255(a.g + (b.g - a.g) * t), b: clamp255(a.b + (b.b - a.b) * t) };
}

/** Produce `n` colors evenly sampled across a multi-stop gradient. */
export function gradient(stops: RGB[], n: number): RGB[] {
	if (n <= 0 || stops.length === 0) return [];
	if (stops.length === 1 || n === 1) return Array.from({ length: n }, () => stops[0] as RGB);
	const out: RGB[] = [];
	for (let i = 0; i < n; i++) {
		const pos = (i / (n - 1)) * (stops.length - 1);
		const idx = Math.min(stops.length - 2, Math.floor(pos));
		out.push(lerp(stops[idx] as RGB, stops[idx + 1] as RGB, pos - idx));
	}
	return out;
}

/** Nearest xterm-256 index for an RGB color (6×6×6 cube + grayscale ramp). */
export function rgbTo256(c: RGB): number {
	if (Math.abs(c.r - c.g) < 8 && Math.abs(c.g - c.b) < 8) {
		if (c.r < 8) return 16;
		if (c.r > 248) return 231;
		return 232 + Math.round(((c.r - 8) / 247) * 24);
	}
	const q = (v: number): number => Math.round((v / 255) * 5);
	return 16 + 36 * q(c.r) + 6 * q(c.g) + q(c.b);
}

const CUBE = [0, 95, 135, 175, 215, 255];
const BASIC16: RGB[] = [
	{ r: 0, g: 0, b: 0 }, { r: 128, g: 0, b: 0 }, { r: 0, g: 128, b: 0 }, { r: 128, g: 128, b: 0 },
	{ r: 0, g: 0, b: 128 }, { r: 128, g: 0, b: 128 }, { r: 0, g: 128, b: 128 }, { r: 192, g: 192, b: 192 },
	{ r: 128, g: 128, b: 128 }, { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 255, g: 255, b: 0 },
	{ r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 255, b: 255 },
];

/** Convert an xterm-256 index back to approximate RGB (inverse of rgbTo256). */
export function xterm256ToRgb(n: number): RGB {
	if (n < 16) return BASIC16[n] ?? { r: 0, g: 0, b: 0 };
	if (n >= 232) {
		const v = clamp255(8 + (n - 232) * 10);
		return { r: v, g: v, b: v };
	}
	const i = n - 16;
	return {
		r: CUBE[Math.floor(i / 36) % 6] ?? 0,
		g: CUBE[Math.floor(i / 6) % 6] ?? 0,
		b: CUBE[i % 6] ?? 0,
	};
}

/** Extract an RGB from a theme fg ANSI string (`38;2;r;g;b` or `38;5;n`). */
export function parseAnsiColor(ansi: string): RGB | null {
	const tc = /38;2;(\d{1,3});(\d{1,3});(\d{1,3})/.exec(ansi);
	if (tc) return { r: clamp255(+(tc[1] ?? 0)), g: clamp255(+(tc[2] ?? 0)), b: clamp255(+(tc[3] ?? 0)) };
	const idx = /38;5;(\d{1,3})/.exec(ansi);
	if (idx) return xterm256ToRgb(+(idx[1] ?? 0));
	return null;
}

/** Variations around a base color: darker → base → lighter. Used for accent-derived banners. */
export function variations(base: RGB): RGB[] {
	return [lerp(base, { r: 0, g: 0, b: 0 }, 0.45), base, lerp(base, { r: 255, g: 255, b: 255 }, 0.5)];
}

/** Foreground ANSI for a color in the given mode (empty string when none). */
export function fgAnsi(c: RGB, mode: ColorMode): string {
	if (mode === "truecolor") return `\x1b[38;2;${c.r};${c.g};${c.b}m`;
	if (mode === "256color") return `\x1b[38;5;${rgbTo256(c)}m`;
	return "";
}

/**
 * Color `text` column-by-column from `colors` (indexed by visible column).
 * Spaces are left unstyled. Returns text unchanged when mode is "none".
 */
export function colorizeColumns(text: string, colors: RGB[], mode: ColorMode): string {
	if (mode === "none" || colors.length === 0) return text;
	let out = "";
	let col = 0;
	for (const ch of Array.from(text)) {
		if (ch === " ") {
			out += ch;
		} else {
			const color = colors[Math.min(colors.length - 1, col)] as RGB;
			out += fgAnsi(color, mode) + ch;
		}
		col += visibleWidth(ch);
	}
	return out + RESET;
}
