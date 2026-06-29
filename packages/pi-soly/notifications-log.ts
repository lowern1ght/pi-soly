// =============================================================================
// notifications-log.ts — Persistent record of soly notifications
// =============================================================================
//
// Appends every nudge/deprecation to a JSONL file at .agents/notifications.log
// (inside the project dir; safe to commit if the user wants a public audit
// trail, or .gitignore if not). One line per notification, JSON-encoded.
//
// Reading: `/soly-log notifications [N]` shows the last N entries (default 20).
//
// Why: transient Box widgets auto-clear. If the user missed a nudge or wants
// to see what nudges fired in past turns/sessions, the log is the source of
// truth.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SOLY_DIRNAME } from "./core.js";

/** Notification kinds we log. */
export type NotificationKind = "nudge" | "deprecation" | "info" | "warning" | "error";

export interface NotificationEntry {
	ts: string;            // ISO timestamp
	kind: NotificationKind;
	title: string;         // e.g. "soly · non-trivial"
	body: string[];        // message lines
	/** Free-form metadata (e.g. "variant": "research") */
	meta?: Record<string, unknown>;
}

/** Where the log file lives. Respects HOME for tests. */
export function logFilePath(cwd: string, home?: string): string {
	const h = home ?? process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
	return path.join(cwd, SOLY_DIRNAME, "notifications.log");
}

/** Append a single entry to the log. Creates parent dirs as needed. */
export function appendNotification(cwd: string, entry: Omit<NotificationEntry, "ts">): void {
	const file = logFilePath(cwd);
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
	} catch { /* ignore */ }
	const full: NotificationEntry = { ts: new Date().toISOString(), ...entry };
	try {
		fs.appendFileSync(file, JSON.stringify(full) + "\n", "utf-8");
	} catch { /* best-effort — don't fail the notification itself */ }
}

/** Read the last N entries (newest first). */
export function readNotifications(cwd: string, limit: number = 20, home?: string): NotificationEntry[] {
	const file = logFilePath(cwd, home);
	if (!fs.existsSync(file)) return [];
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf-8");
	} catch {
		return [];
	}
	const lines = raw.split("\n").filter((l) => l.length > 0);
	const entries: NotificationEntry[] = [];
	for (const line of lines) {
		try {
			entries.push(JSON.parse(line) as NotificationEntry);
		} catch { /* skip malformed */ }
	}
	// Newest first
	return entries.reverse().slice(0, limit);
}

/** Format entries for display in the TUI. */
export function formatNotifications(entries: readonly NotificationEntry[]): string {
	if (entries.length === 0) return "(no notifications recorded)";
	const lines: string[] = [];
	for (const e of entries) {
		const date = e.ts.slice(0, 16).replace("T", " ");
		lines.push(`[${date}] ${e.title}`);
		for (const b of e.body) lines.push(`    ${b}`);
		lines.push("");
	}
	return lines.join("\n");
}
