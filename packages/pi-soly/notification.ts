// =============================================================================
// notification.ts — Styled, framed notifications for soly (pi-themed)
// =============================================================================
//
// Uses pi's `ui.setWidget()` with a Box container and `theme.bg()` for a
// soft background — the same pattern pi itself uses for branch summaries
// and compaction messages (see pi-coding-agent's BranchSummaryMessage).
//
// Why a widget, not `ui.notify()`?
//   - `notify()` is plain text, no background, no styled box
//   - `setWidget(key, factory, opts)` accepts a factory returning a
//     `Box` / `Text` component, which gives full theme support
//   - The widget lives in the editor area (above/below the prompt),
//     so the user actually sees it before sending the next message
//
// Lifecycle:
//   - Each notification uses a unique key (or shared "soly-nudge" for nudges)
//   - New notification with the same key REPLACES the previous
//   - `autoClearMs` (default 5s) removes the widget via setWidget(undefined)
//
// API:
//   - formatFramed(title, lines) — pure text → framed text (no styling)
//   - notifyFramed(ui, title, lines, opts) — boxed widget with theme bg
//   - notifyNudge(ui, variant, angle) — specific for prompt nudges
//   - notifyDeprecation(ui, old, new, hint?) — for migration warnings
//   - clearNotification(ui, key) — manual clear
// =============================================================================

import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import type { ExtensionUIContext, Theme, TUI } from "@earendil-works/pi-coding-agent";
import { appendNotification } from "./notifications-log.ts";

/** Theme background color names (subset of ThemeBg). */
export type NotifBg =
	| "customMessageBg"   // soft, neutral (default — matches branch summary)
	| "selectedBg"        // for emphasis
	| "toolPendingBg"     // warning yellow
	| "toolSuccessBg"     // green
	| "toolErrorBg";      // red

export interface NotifOptions {
	/** Auto-clear after N ms. Default 5000. 0 = no auto-clear. */
	autoClearMs?: number;
	/** "aboveEditor" (default) or "belowEditor". */
	placement?: "aboveEditor" | "belowEditor";
	/** Widget key for replacement/clearing. Default: "soly-notif". */
	key?: string;
	/** Background color name. Default "customMessageBg". */
	bg?: NotifBg;
	/** Bold the title. Default true. */
	boldTitle?: boolean;
}

const DEFAULT_KEY = "soly-notif";

/** Build a Box with the given title + body lines, themed with bg. */
function buildNotifBox(
	theme: Theme,
	title: string,
	lines: readonly string[],
	bg: NotifBg,
	boldTitle: boolean,
): Box {
	const box = new Box(1, 0, (t) => theme.bg(bg, t));
	const titleStyled = boldTitle
		? theme.bold(theme.fg("accent", title))
		: theme.fg("accent", title);
	box.addChild(new Text(titleStyled, 1, 0));
	if (lines.length > 0) {
		box.addChild(new Spacer(1));
		for (const line of lines) {
			box.addChild(new Text(line, 1, 0));
		}
	}
	return box;
}

/**
 * Show a framed, themed notification as a widget above/below the editor.
 * Replaces any prior notification with the same key. Auto-clears after
 * `autoClearMs` (default 5s) unless 0.
 */
export function notifyFramed(
	ui: ExtensionUIContext,
	title: string,
	lines: readonly string[],
	options: NotifOptions = {},
): void {
	const key = options.key ?? DEFAULT_KEY;
	const bg: NotifBg = options.bg ?? "customMessageBg";
	const placement = options.placement ?? "aboveEditor";
	const autoClearMs = options.autoClearMs ?? 5000;
	const boldTitle = options.boldTitle ?? true;
	ui.setWidget(
		key,
		(_tui: TUI, theme: Theme) => buildNotifBox(theme, title, lines, bg, boldTitle),
		{ placement },
	);
	if (autoClearMs > 0) {
		setTimeout(() => {
			try { ui.setWidget(key, undefined); } catch { /* session may have ended */ }
		}, autoClearMs);
	}
}

/** Manually clear a notification by key. */
export function clearNotification(ui: ExtensionUIContext, key: string = DEFAULT_KEY): void {
	try { ui.setWidget(key, undefined); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------

/** Nudge: "I should clarify before acting on this non-trivial prompt". */
export function notifyNudge(
	ui: ExtensionUIContext,
	variant: "nonTrivial" | "research",
	angle: string,
	cwd?: string,
): void {
	const title = variant === "research" ? "soly · research-heavy" : "soly · non-trivial";
	const body = variant === "research"
		? [
				"Prompt looks like a research / look-up task.",
				`Consider clarifying: ${angle}`,
			]
		: [
				"Prompt looks like a non-trivial change.",
				`Consider asking for: ${angle}`,
			];
	notifyFramed(ui, title, body, {
		key: "soly-nudge",
		bg: "customMessageBg",
		autoClearMs: 4000, // nudge is transient — clears before next user input
	});
	if (cwd) {
		appendNotification(cwd, { kind: "nudge", title, body, meta: { variant } });
	}
}

/** Deprecation: warn when an old path/convention is used. */
export function notifyDeprecation(
	ui: ExtensionUIContext,
	oldThing: string,
	newThing: string,
	hint?: string,
	cwd?: string,
): void {
	const body: string[] = [
		`Using:     ${oldThing}`,
		`Preferred: ${newThing}`,
	];
	if (hint) body.push(hint);
	notifyFramed(ui, "soly · deprecation", body, {
		key: "soly-deprecation",
		bg: "toolPendingBg", // warning yellow tint
		autoClearMs: 12000,  // stays longer — user needs to see it
	});
	if (cwd) {
		appendNotification(cwd, {
			kind: "deprecation",
			title: "soly · deprecation",
			body,
		});
	}
}

// ---------------------------------------------------------------------------
// Plain-text fallback (no widget, just framed Unicode text via notify).
// Used for the .soly/ migration banner and other places that don't have
// access to a UI context yet (CLI startup, print mode, etc.)
// ---------------------------------------------------------------------------

const CHARS = {
	topLeft: "╭",
	topRight: "╮",
	bottomLeft: "╰",
	bottomRight: "╯",
	horizontal: "─",
	vertical: "│",
} as const;

/** Format lines as a rounded Unicode frame. Pure text, no ANSI. */
export function formatFramed(
	title: string,
	lines: readonly string[],
	options: { minWidth?: number } = {},
): string {
	const minWidth = options.minWidth ?? 30;
	const titleWithSep = ` ${title} `;
	const bodyWidths = lines.map((l) => stripAnsi(l).length);
	const naturalWidth = Math.max(
		titleWithSep.length + 2,
		...bodyWidths.map((w) => w + 4),
		minWidth,
	);
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
		const pad = naturalWidth - 4 - stripAnsi(line).length;
		return CHARS.vertical + " " + line + " ".repeat(Math.max(0, pad)) + " " + CHARS.vertical;
	});
	return [horizontalRule, ...bodyLines, bottomRule].join("\n");
}

function stripAnsi(s: string): string {
	return s.replace(/\u001b\[[0-9;]*m/g, "");
}
