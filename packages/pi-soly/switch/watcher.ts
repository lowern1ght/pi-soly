// =============================================================================
// watcher.ts — Hot-reload the rotor cycle when rotor .md files change
// =============================================================================
//
// Watches all known rotor home dirs (project + user) and triggers a cycle
// refresh + brief notify when a .md file is added/removed/changed. The
// watcher is debounced (editors save in bursts) and stops cleanly on
// extension reload.
//
// Why: previously, adding a new rotor .md to `.agents/` only took effect on
// the next Ctrl+Tab. With this watcher, the new rotor appears in the next
// pill render — no user action required.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { rotorHomeDirs } from "./core.js";

/** Debounce window for file events (editors save in bursts). */
const DEBOUNCE_MS = 200;
/** Coalesce window for the "rotors reloaded" notify. */
const NOTIFY_COALESCE_MS = 500;

export interface WatcherOptions {
	/** Called when rotors change (debounced). */
	onChange: () => void;
	/** Called with a debounced message about what changed. */
	onNotify?: (message: string) => void;
	/** Override HOME for tests. */
	home?: string;
}

export interface WatcherHandle {
	stop: () => void;
}

/** Watch all rotor home dirs for *.md add/remove/change. */
export function watchRotors(cwd: string | undefined, opts: WatcherOptions): WatcherHandle {
	const home = opts.home ?? process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
	const dirs = rotorHomeDirs(cwd).map((d) => d.replace(/^~/, home));

	const watchers: fs.FSWatcher[] = [];
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let notifyTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingReasons: string[] = [];
	let stopped = false;

	const fire = () => {
		if (stopped) return;
		opts.onChange();
	};

	const scheduleNotify = (reason: string) => {
		pendingReasons.push(reason);
		if (notifyTimer) clearTimeout(notifyTimer);
		notifyTimer = setTimeout(() => {
			const reasons = [...new Set(pendingReasons)];
			pendingReasons = [];
			notifyTimer = null;
			if (opts.onNotify) {
				const summary =
					reasons.length === 1
						? reasons[0]!
						: `${reasons.length} changes (${reasons.slice(0, 3).join(", ")}${reasons.length > 3 ? "…" : ""})`;
				opts.onNotify(`rotors reloaded (${summary})`);
			}
		}, NOTIFY_COALESCE_MS);
	};

	const onEvent = (event: "add" | "change" | "unlink", filename: string | null) => {
		if (stopped) return;
		if (!filename || !filename.endsWith(".md")) return;
		// Skip dotfiles (frontmatter dumps, etc.)
		if (filename.startsWith(".")) return;
		// Coalesce
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			scheduleNotify(event);
			fire();
		}, DEBOUNCE_MS);
	};

	for (const dir of dirs) {
		// Ensure dir exists before watching (fs.watch errors on non-existent)
		try {
			fs.mkdirSync(dir, { recursive: true });
		} catch { /* ignore */ }
		try {
			const w = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
				onEvent(_eventType as "add" | "change" | "unlink", filename);
			});
			watchers.push(w);
		} catch (err) {
			// Some dirs may not exist or be unwatchable. Skip silently.
			// eslint-disable-next-line no-console
			console.error(`[pi-soly] cannot watch ${dir}: ${(err as Error).message}`);
		}
	}

	return {
		stop: () => {
			stopped = true;
			if (debounceTimer) clearTimeout(debounceTimer);
			if (notifyTimer) clearTimeout(notifyTimer);
			for (const w of watchers) {
				try { w.close(); } catch { /* ignore */ }
			}
		},
	};
}
