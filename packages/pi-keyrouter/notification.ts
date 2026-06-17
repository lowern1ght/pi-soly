// =============================================================================
// notification.ts — yellow Box widget for key rotation events
// =============================================================================
//
// Uses the same pattern as pi-soly's notification.ts:
//   ui.setWidget(key, (tui, theme) => Component, { placement })
//
// Why yellow? Rotations are not errors (the request will succeed on the next
// key), so red toolErrorBg would be misleading. They're warnings, so we use
// yellow (\x1b[43m) which isn't in pi's ThemeBg palette but is universally
// supported across terminals (8-color ANSI, always available).
//
// Reset codes:
//   \x1b[49m — reset background
//   \x1b[39m — reset foreground (text color)

import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { RotationEvent } from "./types.ts";

const WIDGET_KEY = "keyrouter-rotation";
const AUTO_CLEAR_MS = 8000;

// Standard ANSI yellow background (works in all terminals — 8-color minimum).
// Truecolor would be nicer but detection is terminal-specific; 43m is safe.
const YELLOW_BG = "\x1b[43m";
const BLACK_FG = "\x1b[30m";
const RESET_BG = "\x1b[49m";
const RESET_FG = "\x1b[39m";
const BOLD = "\x1b[1m";

/** Wrap text in a yellow box (background + black text for contrast). */
function yellowBg(text: string): string {
	return `${YELLOW_BG}${BLACK_FG}${text}${RESET_BG}${RESET_FG}`;
}

/** Build the rotation widget. */
function buildRotationBox(event: RotationEvent): Box {
	const box = new Box(1, 0, (t) => yellowBg(t));

	// Title: 🔑 keyrouter: provider — fromKey → toKey
	const title = `${BOLD}🔑 keyrouter: ${event.provider} — ${event.fromKey} → ${event.toKey}${BOLD === "\x1b[1m" ? "\x1b[22m" : ""}`;
	box.addChild(new Text(title, 1, 0));
	box.addChild(new Spacer(1));

	// Body: reason + status
	const reasonText =
		event.reason === "rate-limited"
			? `Rate-limited (HTTP ${event.status}) — rotated to next key`
			: `Unauthorized (HTTP ${event.status}) — skipping bad key`;
	box.addChild(new Text(reasonText, 1, 0));

	// Retry hint
	box.addChild(new Text(`pi will retry with ${event.toKey}…`, 1, 0));

	return box;
}

/**
 * Show a yellow box widget for a key rotation event.
 * Auto-clears after 8s.
 */
export function notifyRotation(ui: ExtensionUIContext, event: RotationEvent): void {
	try {
		ui.setWidget(
			WIDGET_KEY,
			() => buildRotationBox(event),
			{ placement: "aboveEditor" },
		);
	} catch {
		// setWidget may fail if UI not available (print mode) — fall back to notify
		try {
			ui.notify(
				`🔑 keyrouter: ${event.provider} — ${event.fromKey} → ${event.toKey} (HTTP ${event.status}, ${event.reason})`,
				"warning",
			);
		} catch {
			// no UI at all — silent
		}
		return;
	}
	// Auto-clear after 8 seconds
	setTimeout(() => {
		try {
			ui.setWidget(WIDGET_KEY, undefined);
		} catch {
			// session may have ended — ignore
		}
	}, AUTO_CLEAR_MS);
}

/** Clear the rotation widget manually. */
export function clearRotationWidget(ui: ExtensionUIContext): void {
	try {
		ui.setWidget(WIDGET_KEY, undefined);
	} catch {
		// ignore
	}
}