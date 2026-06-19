// =============================================================================
// notify.ts — MCP-specific notification wrappers
// =============================================================================
//
// Thin layer over soly's notifyFramed() that:
// - Falls back gracefully if the UI doesn't have setWidget (print mode)
// - Adds MCP-specific keys so multiple MCP notifications don't clobber each other
//   or soly's other widgets
// - Provides typed helpers for the most common MCP events: reconnect fail,
//   session auto-recovery (UE5 bug workaround), tool errors
//
// Keys are namespaced (mcp-reconnect-<name>, mcp-session-recover-<name>) so
// they don't collide with soly's default "soly-notif" key.

import { notifyFramed, type NotifBg } from "../notification.ts";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const MCP_KEY_PREFIX = "mcp-";

function notifyBox(
	ui: ExtensionUIContext,
	key: string,
	title: string,
	lines: readonly string[],
	bg: NotifBg,
	autoClearMs = 8000,
): void {
	try {
		notifyFramed(ui, title, lines, {
			key: MCP_KEY_PREFIX + key,
			bg,
			autoClearMs,
		});
	} catch {
		// Fallback: setWidget may fail in print mode / RPC. Use plain notify
		// with a short title-only message. Don't crash the MCP handler.
		const plain = lines.length > 0 ? `${title} — ${lines.join(" ")}` : title;
		try {
			ui.notify(plain, bg === "toolErrorBg" ? "error" : bg === "toolPendingBg" ? "warning" : "info");
		} catch {
			// no UI at all — silent
		}
	}
}

/** Reconnect failed — red box. Auto-clears after 10s (longer for errors). */
export function notifyReconnectFailed(
	ui: ExtensionUIContext,
	serverName: string,
	error: string,
): void {
	notifyBox(
		ui,
		`reconnect-${serverName}`,
		`🔌 MCP: ${serverName} reconnect failed`,
		[error.length > 200 ? `${error.slice(0, 200)}…` : error],
		"toolErrorBg",
		10_000,
	);
}

/** Session auto-recovery succeeded (UE5 workaround worked). Green box. */
export function notifySessionRecovered(
	ui: ExtensionUIContext,
	serverName: string,
	fromMethod: string,
): void {
	notifyBox(
		ui,
		`session-recover-${serverName}`,
		`🔄 MCP: ${serverName} session auto-recovered`,
		[
			`${fromMethod} hit "Unknown session id"`,
			`Reconnected silently — retry succeeded`,
		],
		"toolSuccessBg",
		6_000,
	);
}

/** Session auto-recovery failed after retry. Red box. */
export function notifySessionRecoveryFailed(
	ui: ExtensionUIContext,
	serverName: string,
	error: string,
): void {
	notifyBox(
		ui,
		`session-recover-${serverName}`,
		`🔄 MCP: ${serverName} session recovery failed`,
		[error.length > 200 ? `${error.slice(0, 200)}…` : error],
		"toolErrorBg",
		10_000,
	);
}

/** Generic MCP info/warning (yellow) — for status updates like connecting. */
export function notifyMcpStatus(
	ui: ExtensionUIContext,
	serverName: string,
	message: string,
): void {
	notifyBox(
		ui,
		`status-${serverName}`,
		`🔌 MCP: ${serverName}`,
		[message],
		"toolPendingBg",
		5_000,
	);
}