// =============================================================================
// notification.ts — user-facing notifications for key-router events
// =============================================================================
//
// Compact, theme-friendly notifications via `ui.notify(message, severity)`.
// We do NOT paint raw ANSI backgrounds and we do NOT stack a Box widget
// over the editor — both were too loud. Rotations and overloads are
// informational; a single warning-level line that the TUI can theme
// (background tint per severity) reads cleanly in light and dark mode.
//
// Severity map:
//   rotation   -> "warning"  (we just swapped a key, not a failure)
//   overload   -> "warning"  (provider-wide, no key change)
//   exhaustion -> "error"    (all keys failed; pi will surface the real error)

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { RotationEvent } from "./types.ts";

const ROTATION_WIDGET_KEY = "keyrouter-rotation";

/**
 * Show a one-line notification for a key rotation event.
 *
 * Format: "🔑 keyrouter: <provider> <fromKey> → <toKey> (HTTP <status>, <reason>)"
 */
export function notifyRotation(ui: ExtensionUIContext, event: RotationEvent): void {
	const text =
		`🔑 keyrouter: ${event.provider} ${event.fromKey} → ${event.toKey} ` +
		`(HTTP ${event.status}, ${event.reason})`;
	try {
		ui.notify(text, "warning");
	} catch {
		// no UI available (print mode, headless) — silent
	}
}

/**
 * Show a one-line notification for a provider-wide overload event.
 * No rotation occurred — just a heads-up that the provider is busy.
 *
 * Format: "🔑 keyrouter: <provider> overloaded — retrying in <N>s (no key change)"
 */
export function notifyOverloaded(
	ui: ExtensionUIContext,
	provider: string,
	cooldownMs: number,
): void {
	const seconds = Math.max(1, Math.ceil(cooldownMs / 1000));
	const text =
		`🔑 keyrouter: ${provider} overloaded — retrying in ${seconds}s (no key change)`;
	try {
		ui.notify(text, "warning");
	} catch {
		// silent
	}
}

/**
 * Notify that all keys of a provider have been exhausted.
 * Kept on the same path as the other notifications so the user sees
 * one consistent surface.
 */
export function notifyExhausted(
	ui: ExtensionUIContext,
	provider: string,
	failedKeys: ReadonlyArray<string>,
): void {
	const list = failedKeys.length > 0 ? failedKeys.join(", ") : "(none)";
	const text = `🔑 keyrouter: ${provider} — all keys exhausted (${list}). Surfacing original error.`;
	try {
		ui.notify(text, "error");
	} catch {
		// silent
	}
}

/**
 * Clear the rotation widget if it exists. Kept as a no-op for backward
 * compatibility with callers that previously expected a Box widget
 * here. New code should not rely on a widget — use ui.notify instead.
 */
export function clearRotationWidget(_ui: ExtensionUIContext): void {
	try {
		_ui.setWidget(ROTATION_WIDGET_KEY, undefined);
	} catch {
		// ignore — session may have ended, or setWidget may not exist on
		// this ExtensionUIContext variant
	}
}
