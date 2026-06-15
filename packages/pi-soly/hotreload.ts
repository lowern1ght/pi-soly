// =============================================================================
// hotreload.ts — Live file watcher for soly rules
// =============================================================================
//
// Watches all rule source directories (project-soly, global-soly) for
// changes. When a .md file in any of them is created, modified, or
// deleted, the extension reloads its rule set and re-renders the status
// bar — all within the same session, no /reload.
//
// Why this matters: editing rules is a tight feedback loop. Without hot
// reload, you have to wait for the next turn_end (or restart) to see
// effects. With it, saving a rule file is instantly reflected in the
// "rules N" counter in the status bar.
//
// Two reload strategies in parallel:
//   1. fs.watch with debounce 100ms — fast, but unreliable on Windows
//      (recursive watch is buggy, some editor save patterns miss events).
//   2. Polling fallback every `pollMs` ms — checks mtime of every rule
//      file. Slower (constant disk I/O) but reliable everywhere.
// Both feed into the same debounced onChange callback. If fs.watch
// fires, it preempts the next poll tick (no double reload).
//
// Watchers are cleaned up on session_shutdown.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceSpec } from "./core.js";

export interface HotReloadOptions {
	/** Called when any watched file changes (debounced). The `reason` argument
	 *  carries a human-readable description of what triggered the reload
	 *  (e.g. `poll:soly/code-style.md`). */
	onChange: (reason: string) => void;
	/** Debounce window in ms — coalesce burst writes from editors. */
	debounceMs?: number;
	/** Polling interval in ms — fallback when fs.watch is unreliable. */
	pollMs?: number;
}

/** Set of FSWatchers + cleanup helper. */
export interface HotReloadHandle {
	stop: () => void;
	/** Manually trigger a refresh (e.g. from turn_end fallback). */
	tick: (reason: string) => void;
	/** Install a user-facing notifier that gets coalesced rapid-fire
	 *  changes into a single message. Optional — the raw onChange still
	 *  fires per-change for status updates. */
	setNotifyHandler: (handler: (reason: string) => void) => void;
}

/** Walk a source dir and return every .md file with its mtime. */
function snapshotMtimes(dir: string): Map<string, number> {
	const out = new Map<string, number>();
	if (!fs.existsSync(dir)) return out;
	const walk = (d: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".")) continue;
			if (e.name === "node_modules") continue;
			const full = path.join(d, e.name);
			if (e.isDirectory()) {
				walk(full);
			} else if (e.isFile() && e.name.endsWith(".md")) {
				try {
					const stat = fs.statSync(full);
					out.set(full, stat.mtimeMs);
				} catch {
					// skip unreadable
				}
			}
		}
	};
	walk(dir);
	return out;
}

export function startHotReload(
	sources: SourceSpec[],
	opts: HotReloadOptions,
): HotReloadHandle {
	const debounceMs = opts.debounceMs ?? 100;
	const pollMs = opts.pollMs ?? 2000;

	const watchers: fs.FSWatcher[] = [];
	let pendingTimer: NodeJS.Timeout | null = null;
	let pollTimer: NodeJS.Timeout | null = null;
	let stopped = false;

	// Notification coalescer — editors often save in 2–3 quick bursts
	// (write to .tmp, rename, touch), which would each fire onChange.
	// We batch them into a single user-visible notify by accumulating the
	// most recent reason until the debounce window expires.
	let pendingNotify: { reasons: string[]; timer: NodeJS.Timeout | null } = {
		reasons: [],
		timer: null,
	};
	const NOTIFY_COALESCE_MS = 500;
	let notifyHandler: ((reason: string) => void) | null = null;

	// Wrap user's onChange so that the actual callback still fires per-change
	// (we can't break that contract — index.ts updates status synchronously),
	// but a user-facing notify is coalesced. The wrapper just buffers reasons.
	const wrappedOnChange = (reason: string) => {
		opts.onChange(reason);
		if (notifyHandler) {
			pendingNotify.reasons.push(reason);
			if (pendingNotify.timer) clearTimeout(pendingNotify.timer);
			pendingNotify.timer = setTimeout(() => {
				const reasons = pendingNotify.reasons;
				pendingNotify = { reasons: [], timer: null };
				if (reasons.length === 1) {
					notifyHandler!(reasons[0]!);
				} else if (reasons.length > 1) {
					notifyHandler!(
						`${reasons.length} rapid change(s) (last: ${reasons[reasons.length - 1]})`,
					);
				}
			}, NOTIFY_COALESCE_MS);
		}
	};

	const schedule = (reason: string) => {
		if (stopped) return;
		if (pendingTimer) clearTimeout(pendingTimer);
		pendingTimer = setTimeout(() => {
			pendingTimer = null;
			if (stopped) return;
			try {
				wrappedOnChange(reason);
				// After reload, update snapshot so polling doesn't re-fire
				// on the same state until files change again.
				lastMtimes = new Map();
				for (const spec of sources) {
					for (const [p, t] of snapshotMtimes(spec.dir)) {
						lastMtimes.set(p, t);
					}
				}
			} catch {
				// Swallow — the consumer's onChange is best-effort
			}
		}, debounceMs);
	};

	// Snapshot of file mtimes for polling. Resets after each reload so we
	// don't repeatedly fire on the same state.
	let lastMtimes: Map<string, number> = new Map();
	for (const spec of sources) {
		for (const [p, t] of snapshotMtimes(spec.dir)) {
			lastMtimes.set(p, t);
		}
	}

	for (const spec of sources) {
		if (!fs.existsSync(spec.dir)) continue;
		try {
			// recursive: true walks subdirs so nested rule directories work
			const watcher = fs.watch(
				spec.dir,
				{ recursive: true },
				(_event, filename) => {
					if (!filename) return;
					// Ignore non-markdown noise (.swp, .tmp, lock files)
					const name = String(filename);
					if (!name.endsWith(".md")) return;
					schedule(`${spec.sourceLabel}:${name}`);
				},
			);
			watchers.push(watcher);
		} catch {
			// Some filesystems don't support recursive watch — polling
			// fallback below still catches changes.
		}
	}

	// Polling fallback — reliable on Windows / network mounts / editors
	// that don't trigger fs.watch. Coalesces into the same debounce.
	pollTimer = setInterval(() => {
		if (stopped) return;
		let changed: string | null = null;
		const current = new Map<string, number>();
		for (const spec of sources) {
			const snap = snapshotMtimes(spec.dir);
			for (const [p, t] of snap) {
				current.set(p, t);
				const prev = lastMtimes.get(p);
				if (prev !== t) {
					changed = `${spec.sourceLabel}:${path.basename(p)}`;
				}
			}
		}
		// Detect deletions (file present in lastMtimes but missing in current)
		if (!changed) {
			for (const p of lastMtimes.keys()) {
				if (!current.has(p)) {
					changed = `${path.basename(p)}:deleted`;
					break;
				}
			}
		}
		if (changed) schedule(`poll:${changed}`);
	}, pollMs);

	return {
		stop: () => {
			stopped = true;
			if (pendingTimer) {
				clearTimeout(pendingTimer);
				pendingTimer = null;
			}
			if (pendingNotify.timer) {
				clearTimeout(pendingNotify.timer);
				pendingNotify = { reasons: [], timer: null };
			}
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
			for (const w of watchers) {
				try {
					w.close();
				} catch {
					// best effort
				}
			}
		},
		tick: (reason) => schedule(reason),
		/** Install a user-facing notifier that gets coalesced rapid-fire
		 *  changes into a single message. Call once from the consumer. */
		setNotifyHandler: (handler) => {
			notifyHandler = handler;
		},
	};
}
