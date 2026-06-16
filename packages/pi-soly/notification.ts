// =============================================================================
// notification.ts — Styled, framed messages for soly
// =============================================================================
//
// pi's `ui.notify()` is plain text. For soly we want framed messages
// (rounded box around the content) so they stand out from generic
// extension toasts. This module provides:
//
//   - `formatFramed(title, lines)` — pure function: text → framed text
//   - `notifyFramed(ui, title, lines, level)` — sends via ui.notify
//   - `notifyNudge(ui, isResearch, angle)` — specific frame for prompt nudges
//   - `notifyDeprecation(ui, oldThing, newThing)` — for the .soly/ → .agents/
//     migration
//
// All frames use Unicode box-drawing chars. Width adapts to the longest
// content line. We use single-line ASCII fallback if the terminal reports
// ASCII-only (future: read pi's `getTerminalCapabilities()` when exposed).
// =============================================================================

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** Box-drawing chars (rounded). */
const CHARS = {
	topLeft: "╭",
	topRight: "╮",
	bottomLeft: "╰",
	bottomRight: "╯",
	horizontal: "─",
	vertical: "│",
} as const;

export interface FramedOptions {
	/** "info" (default) | "warning" | "error" — passed through to pi.notify */
	level?: "info" | "warning" | "error";
	/** Width override. Default: max line length + 4 (padding). Min 30. */
	minWidth?: number;
}

/** Format an array of body lines as a framed message. */
export function formatFramed(
	title: string,
	lines: readonly string[],
	options: { minWidth?: number } = {},
): string {
	const minWidth = options.minWidth ?? 30;
	const titleWithSep = ` ${title} `;
	const bodyWidths = lines.map((l) => stripAnsi(l).length);
	// Total line width = 2 (vertical bars) + 2 (inner padding) + max content
	const naturalWidth = Math.max(
		titleWithSep.length + 2, // +2 for the corner chars
		...bodyWidths.map((w) => w + 4),
		minWidth,
	);
	// Top rule: pad the title with `─` on both sides so it matches body width
	const titlePadTotal = naturalWidth - titleWithSep.length - 2;
	const titlePadLeft = Math.floor(titlePadTotal / 2);
	const titlePadRight = titlePadTotal - titlePadLeft;
	const horizontalRule =
		CHARS.topLeft +
		CHARS.horizontal.repeat(titlePadLeft) +
		titleWithSep +
		CHARS.horizontal.repeat(titlePadRight) +
		CHARS.topRight;
	const bottomRule =
		CHARS.bottomLeft + CHARS.horizontal.repeat(naturalWidth - 2) + CHARS.bottomRight;

	const bodyLines = lines.map((line) => {
		// naturalWidth is the total line width including the 2 vertical chars.
		// Body formula: │ + space + content + padding + space + │ = naturalWidth
		// => padding = naturalWidth - 4 - line.length
		const pad = naturalWidth - 4 - stripAnsi(line).length;
		return CHARS.vertical + " " + line + " ".repeat(Math.max(0, pad)) + " " + CHARS.vertical;
	});

	return [horizontalRule, ...bodyLines, bottomRule].join("\n");
}

/** Send a framed message via pi's notify. Multi-line. */
export function notifyFramed(
	ui: ExtensionUIContext,
	title: string,
	lines: readonly string[],
	options: FramedOptions = {},
): void {
	const framed = formatFramed(title, lines, options);
	// pi's notify accepts multi-line strings — render the frame in each line.
	// (Many TUI toasts strip newlines; the receiver is responsible for display.)
	ui.notify(framed, options.level ?? "info");
}

// ---------------------------------------------------------------------------
// High-level helpers — one per use case
// ---------------------------------------------------------------------------

/** Nudge: "I should clarify before acting on this non-trivial prompt". */
export function notifyNudge(
	ui: ExtensionUIContext,
	variant: "nonTrivial" | "research",
	angle: string,
): void {
	const title = variant === "research" ? "soly · research-heavy" : "soly · non-trivial";
	const body: string[] = variant === "research"
		? [
				"Prompt looks like a research / look-up task.",
				`Consider clarifying: ${angle}`,
			]
		: [
				"Prompt looks like a non-trivial change.",
				`Consider asking for: ${angle}`,
			];
	notifyFramed(ui, title, body, { level: "info" });
}

/** Deprecation: warn when an old path/convention is used. */
export function notifyDeprecation(
	ui: ExtensionUIContext,
	oldThing: string,
	newThing: string,
	hint?: string,
): void {
	const body: string[] = [
		`Using: ${oldThing}`,
		`Preferred: ${newThing}`,
	];
	if (hint) body.push(hint);
	notifyFramed(ui, "soly · deprecation", body, { level: "warning" });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes for length calculation. Most TUI tags
 *  (bold/color) are not present in our output, but be safe. */
function stripAnsi(s: string): string {
	return s.replace(/\u001b\[[0-9;]*m/g, "");
}
