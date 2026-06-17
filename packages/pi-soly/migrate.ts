// =============================================================================
// migrate.ts — Atomic .soly/ → .agents/ migration
// =============================================================================
//
// Moves the legacy `.soly/` project state dir to the new vendor-neutral
// `.agents/` location. The move tries fs.rename first (atomic on the same
// filesystem). On Windows, rename often fails with EPERM because soly's
// hot-reload watcher (or an editor) holds open handles on .soly/ files.
// We retry the rename a few times, then fall back to recursive copy +
// delete if the handle won't release. Validates after move that key files
// made it.
//
// What gets moved (everything in `.soly/`):
//   - ROADMAP.md
//   - STATE.md
//   - docs/         (intent docs)
//   - rules/        (project rules)
//   - phases/       (PLAN.md / SUMMARY.md / CONTEXT.md / RESEARCH.md)
//   - iterations/   (per-execution context)
//   - HANDOFF.json  (pause snapshot)
//   - .continue-here.md
//   - config.json   (per-project config — note: kept for backward compat
//                     reading; new writes go to .agents/config.json too)
//
// What does NOT get moved:
//   - rotor persistence (no longer used in 1.4.0)
//   - git history — `git mv` would preserve; fs.rename loses history. We
//     suggest the user commit beforehand.
//
// Usage:
//   /soly-migrate              # confirm before doing
//   /soly-migrate --yes        # skip confirmation
//   /soly-migrate --dry-run    # show what would happen
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { LEGACY_SOLY_DIRNAME, SOLY_DIRNAME } from "./core.js";

const renameAsync = promisify(fs.rename);
const rmAsync = promisify(fs.rm);

/**
 * Cross-platform directory move.
 *
 * `fs.rename` is atomic on POSIX but on Windows it fails with EPERM if any
 * file inside the source dir has an open handle (soly hot-reload watcher,
 * editor, antivirus, the cwd itself). We:
 *
 *   1. Retry rename up to 5 times with 200ms backoff — most EPERM are
 *      transient (OS releasing a handle).
 *   2. Fall back to recursive copy-then-delete if rename keeps failing.
 *      Slower but works when a handle is genuinely held for the duration.
 */
async function moveDir(from: string, to: string): Promise<void> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			await renameAsync(from, to);
			return;
		} catch (err) {
			lastErr = err;
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw err;
			await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
		}
	}
	// Rename exhausted — fall back to copy + delete.
	// This works even when handles are held because we open files read-only
	// for the copy and the source is removed last.
	await copyDirRecursive(from, to);
	try {
		await rmAsync(from, { recursive: true, force: true });
	} catch (err) {
		// Source dir couldn't be removed (handle still held). The migration
		// itself succeeded — .agents/ has everything. Throw a soft warning so
		// the caller can tell the user to delete .soly/ manually.
		throw new Error(
			`migrated to ${to} but could not remove ${from}: ${(err as Error).message}. ` +
				`Delete ${from} manually after closing editors/pi.`,
		);
	}
}

function copyDirRecursive(src: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		fs.mkdirSync(dest, { recursive: true });
		const entries = fs.readdirSync(src, { withFileTypes: true });
		let pending = entries.length;
		if (pending === 0) return resolve();
		let rejected = false;
		const done = (err?: Error) => {
			if (rejected) return;
			if (err) {
				rejected = true;
				reject(err);
				return;
			}
			pending -= 1;
			if (pending === 0) resolve();
		};
		for (const entry of entries) {
			const s = path.join(src, entry.name);
			const d = path.join(dest, entry.name);
			if (entry.isDirectory()) {
				copyDirRecursive(s, d).then(() => done(), done);
			} else if (entry.isSymbolicLink()) {
				try {
					fs.symlinkSync(fs.readlinkSync(s), d);
					done();
				} catch (e) {
					done(e as Error);
				}
			} else {
				fs.copyFile(s, d, (e) => done(e ? new Error(e.message) : undefined));
			}
		}
	});
}

/** UI primitives needed by the migration. */
export interface MigrateUI {
	notify: (text: string, level?: "info" | "warning" | "error") => void;
	confirm: (title: string, message: string) => Promise<boolean>;
}

export interface MigrateOptions {
	/** Skip the confirmation dialog. */
	autoYes?: boolean;
	/** Don't actually move; just report. */
	dryRun?: boolean;
}

export interface MigrateResult {
	/** Whether the move happened (false if cancelled or skipped). */
	moved: boolean;
	/** What was moved (file/dir names relative to cwd). */
	relocated: string[];
	/** Warnings during validation. */
	warnings: string[];
}

/** What we expect to find in `.soly/`. Listed for dry-run reporting. */
const EXPECTED_ENTRIES = [
	"ROADMAP.md",
	"STATE.md",
	"docs",
	"rules",
	"phases",
	"iterations",
	"HANDOFF.json",
	".continue-here.md",
	"config.json",
] as const;

/** Top-level move function. Returns a result so tests can assert. */
export async function migrateSolyDir(
	cwd: string,
	ui: MigrateUI,
	options: MigrateOptions = {},
): Promise<MigrateResult> {
	const from = path.join(cwd, LEGACY_SOLY_DIRNAME);
	const to = path.join(cwd, SOLY_DIRNAME);
	const result: MigrateResult = { moved: false, relocated: [], warnings: [] };

	// Preconditions
	if (!fs.existsSync(from)) {
		ui.notify(`soly-migrate: no ${LEGACY_SOLY_DIRNAME}/ to migrate (already on ${SOLY_DIRNAME}/)`, "info");
		return result;
	}
	if (fs.existsSync(to)) {
		ui.notify(
			`soly-migrate: both ${LEGACY_SOLY_DIRNAME}/ and ${SOLY_DIRNAME}/ exist. ` +
				`Resolve manually before migrating.`,
			"error",
		);
		return result;
	}

	// Inventory what's in .soly/
	let entries: string[];
	try {
		entries = fs.readdirSync(from);
	} catch (err) {
		ui.notify(`soly-migrate: cannot read ${from}: ${(err as Error).message}`, "error");
		return result;
	}
	const inventory = entries.filter((e) => !e.startsWith("."));
	result.relocated = inventory;

	// Dry-run: report and exit
	if (options.dryRun) {
		ui.notify(
			`soly-migrate (dry run): would move ${inventory.length} entries from ` +
				`${LEGACY_SOLY_DIRNAME}/ to ${SOLY_DIRNAME}/:\n  - ${inventory.join("\n  - ")}`,
			"info",
		);
		return { ...result, relocated: inventory };
	}

	// Confirm with the user
	if (!options.autoYes) {
		const ok = await ui.confirm(
			`soly migrate ${LEGACY_SOLY_DIRNAME}/ → ${SOLY_DIRNAME}/`,
			`Move ${inventory.length} entries (${inventory.slice(0, 5).join(", ")}${inventory.length > 5 ? ", …" : ""})? ` +
				`This is atomic on the same filesystem but does NOT preserve git history. ` +
				`Recommend committing ${LEGACY_SOLY_DIRNAME}/ separately first if you care about history.`,
		);
		if (!ok) {
			ui.notify("soly-migrate: cancelled", "info");
			return result;
		}
	}

	// Do the move (with Windows EPERM retry + copy fallback)
	try {
		await moveDir(from, to);
	} catch (err) {
		const msg = (err as Error).message;
		const isPartial = msg.includes("Delete ") || msg.includes("could not remove");
		ui.notify(
			isPartial
				? `soly-migrate: ${msg}`
				: `soly-migrate: rename failed: ${msg}. Original .soly/ untouched.`,
			isPartial ? "warning" : "error",
		);
		return result;
	}

	// Validate the result
	if (!fs.existsSync(to)) {
		ui.notify(`soly-migrate: post-rename check failed — ${SOLY_DIRNAME}/ missing`, "error");
		return result;
	}
	for (const expected of EXPECTED_ENTRIES) {
		const src = path.join(from, expected);
		const dst = path.join(to, expected);
		// Only check items that existed before; some are optional
		if (fs.existsSync(src) && !fs.existsSync(dst)) {
			result.warnings.push(`missing after move: ${expected}`);
		}
	}

	result.moved = true;

	// Success message + git hint
	const warnPart = result.warnings.length > 0
		? `\n\nWarnings:\n  - ${result.warnings.join("\n  - ")}`
		: "";
	ui.notify(
		`soly-migrate: done. ${inventory.length} entries moved to ${SOLY_DIRNAME}/.${warnPart}\n\n` +
			`Recommended next:\n` +
			`  git add -A && git commit -m "migrate soly state to .agents/"`,
		"info",
	);
	return result;
}
