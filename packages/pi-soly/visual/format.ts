// =============================================================================
// visual/format.ts — pure formatting helpers for the soly chrome
// =============================================================================
//
// Small, dependency-free, fully testable string helpers used by the footer,
// top bar and working indicator. No ANSI, no pi imports — just text in / out.
// Width-aware rendering (visibleWidth/truncateToWidth) lives in segments.ts.
// =============================================================================

import * as path from "node:path";

/**
 * Format a token count for compact display, mirroring pi's native footer:
 * `<1000` exact, `<10k` one decimal, `<1M` rounded k, then M.
 */
export function formatTokens(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "0";
	if (count < 1000) return String(Math.round(count));
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

/**
 * Replace the home prefix with `~`. Mirrors pi's `formatCwdForFooter` so our
 * footer matches the native one when the path is short.
 */
export function formatCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const rel = path.relative(path.resolve(home), path.resolve(cwd));
	const insideHome = rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
	if (!insideHome) return cwd;
	return rel === "" ? "~" : `~${path.sep}${rel}`;
}

/**
 * Shrink a path to fit `maxWidth` visible columns through three tiers:
 *   1. full          `~/src/stbl/pi-soly.framework`
 *   2. elided middle `~/…/pi-soly.framework`
 *   3. basename      `pi-soly.framework`
 * Returns the widest tier that fits, or the basename truncated if even that
 * is too wide. `maxWidth <= 0` returns an empty string (caller drops it).
 */
export function fitPath(cwd: string, home: string | undefined, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	const full = formatCwd(cwd, home);
	if (full.length <= maxWidth) return full;

	const base = path.basename(cwd) || cwd;
	const head = full.startsWith("~") ? "~" : path.parse(full).root.replace(/[\\/]+$/, "");
	const elided = `${head}${path.sep}…${path.sep}${base}`;
	if (elided.length <= maxWidth) return elided;

	if (base.length <= maxWidth) return base;
	return base.slice(0, Math.max(1, maxWidth - 1)) + "…";
}

/**
 * Compact elapsed label: `8s` under a minute, `9m 50s` under an hour, `1h 02m`
 * beyond. Components are space-separated so the digits don't run together.
 * Seconds/minutes are zero-padded to two digits so the right edge doesn't
 * jump each tick on a live-updating counter. Clamped at 0.
 */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return `${total}s`;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
	return `${m}m ${String(s).padStart(2, "0")}s`;
}
