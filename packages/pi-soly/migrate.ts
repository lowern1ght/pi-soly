// =============================================================================
// migrate.ts — Atomic .soly/ → .agents/ migration
// =============================================================================
//
// Moves the legacy `.soly/` project state dir to the new vendor-neutral
// `.agents/` location. The move is atomic via fs.renameSync (which is atomic
// on the same filesystem). Validates after move that key files made it.
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
//   - .soly/.soly/agent (rotor persistence) — handled by pi-switch separately
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
import { LEGACY_SOLY_DIRNAME, SOLY_DIRNAME } from "./core.js";

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

	// Do the move
	try {
		fs.renameSync(from, to);
	} catch (err) {
		ui.notify(
			`soly-migrate: rename failed: ${(err as Error).message}. ` +
				`Original .soly/ untouched.`,
			"error",
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
