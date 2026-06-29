// =============================================================================
// workflows/migrate.ts — `soly migrate phases-to-plans`
// =============================================================================
//
// One-shot migration from the legacy phase layout to the new plan layout.
// Reads each phase under `.agents/phases/<NN>-<slug>/`, creates a branch
// `migrate/legacy-<NN>-<slug>`, copies `plans/PLAN.md` to
// `.agents/plans/legacy-<NN>-<slug>/PLAN.md`, and commits.
//
// The user is responsible for merging the migration branch into main.
// We don't auto-push.
//
// Phases whose branch already exists are skipped (re-running is a no-op
// for them). Phases without `plans/PLAN.md` are also skipped.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { SolyState } from "../core.js";

export interface MigrateResult {
	handled: boolean;
	transformedText?: string;
	migrated: { phase: string; branch: string; planPath: string }[];
	skipped: { phase: string; reason: string }[];
}

type Notifier = {
	notify: (text: string, level?: "info" | "warning" | "error") => void;
};

function git(args: string[], opts: { cwd: string }): string {
	try {
		return execFileSync("git", args, {
			cwd: opts.cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch (err) {
		const e = err as { stderr?: Buffer | string; message?: string };
		const stderr = e.stderr ? e.stderr.toString().trim() : "";
		throw new Error(`git ${args.join(" ")} failed: ${stderr || e.message || "unknown error"}`);
	}
}

/** List phase dirs under `<solyDir>/phases/` (any NN-prefix). */
function listPhaseDirs(solyDir: string): string[] {
	const phasesRoot = path.join(solyDir, "phases");
	if (!fs.existsSync(phasesRoot)) return [];
	return fs
		.readdirSync(phasesRoot, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
}

/** Derive `<NN>-<slug>` from a phase dir name. Returns number as string to
 *  preserve the leading zero (`03` → `"03"`, not `3`). */
function parsePhaseName(dirName: string): { number: string; slug: string } | null {
	const m = dirName.match(/^(\d+)-(.+)$/);
	if (!m) return null;
	return { number: m[1], slug: m[2] };
}

export function buildMigrateTransform(
	state: SolyState,
	ui: Notifier,
	projectRoot: string,
): MigrateResult {
	if (!state.exists) {
		return {
			handled: true,
			transformedText: "soly migrate: no .agents/ directory in cwd — run /soly init first.",
			migrated: [],
			skipped: [],
		};
	}

	const phaseDirs = listPhaseDirs(state.solyDir);
	if (phaseDirs.length === 0) {
		return {
			handled: true,
			transformedText: "soly migrate: no phases found in .agents/phases/. Nothing to migrate.",
			migrated: [],
			skipped: [],
		};
	}

	// Make sure we're on master (migration creates new branches, not from here)
	let currentBranch = git(["branch", "--show-current"], { cwd: projectRoot }) || "master";
	if (currentBranch === "HEAD") currentBranch = "master"; // detached HEAD
	if (currentBranch !== "master" && currentBranch !== "main") {
		// Auto-stash + checkout master. We could just refuse, but that's annoying.
		try {
			git(["checkout", "master"], { cwd: projectRoot });
		} catch {
			try {
				git(["checkout", "main"], { cwd: projectRoot });
			} catch {
				return {
					handled: true,
					transformedText: `soly migrate: current branch is "${currentBranch}". Switch to master/main first.`,
					migrated: [],
					skipped: [],
				};
			}
		}
	}

	const migrated: MigrateResult["migrated"] = [];
	const skipped: MigrateResult["skipped"] = [];

	for (const dirName of phaseDirs) {
		const parsed = parsePhaseName(dirName);
		if (!parsed) {
			skipped.push({ phase: dirName, reason: "doesn't match NN-name pattern" });
			continue;
		}
		const branchName = `migrate/legacy-${parsed.number}-${parsed.slug}`;
		const planSource = path.join(state.solyDir, "phases", dirName, "plans", "PLAN.md");
		const planTarget = path.join(state.solyDir, "plans", `legacy-${parsed.number}-${parsed.slug}`, "PLAN.md");

		// Skip if no PLAN.md
		if (!fs.existsSync(planSource)) {
			skipped.push({ phase: dirName, reason: "no PLAN.md under plans/" });
			continue;
		}

		// Skip if branch already exists
		let branchExists = false;
		try {
			git(["rev-parse", "--verify", branchName], { cwd: projectRoot });
			branchExists = true;
		} catch {
			// not found — we'll create
		}
		if (branchExists) {
			skipped.push({ phase: dirName, reason: `branch ${branchName} already exists` });
			continue;
		}

		// Create branch and copy file
		try {
			git(["checkout", "-b", branchName], { cwd: projectRoot });
			fs.mkdirSync(path.dirname(planTarget), { recursive: true });
			fs.copyFileSync(planSource, planTarget);
			const planTargetRel = `.agents/plans/legacy-${parsed.number}-${parsed.slug}/PLAN.md`;
			git(["add", planTargetRel], { cwd: projectRoot });
			git(["commit", "-m", `migrate: import phase ${dirName} as plan`], { cwd: projectRoot });
			migrated.push({ phase: dirName, branch: branchName, planPath: planTarget });
		} catch (err) {
			skipped.push({ phase: dirName, reason: `git error: ${err instanceof Error ? err.message : String(err)}` });
		}
	}

	// Stay on the last migration branch so the user can inspect the result.
	// (We used to checkout back to master, but that removes the new PLAN.md
	// files from the working tree since they only exist on the migration
	// branch. The user can `git checkout master` when ready.)

	const notice =
		`soly migrate: ${migrated.length} migrated, ${skipped.length} skipped.\n` +
		(migrated.length > 0
			? migrated.map((m) => `  + ${m.phase} → ${m.branch}`).join("\n") + "\n"
			: "") +
		(skipped.length > 0
			? skipped.map((s) => `  ! ${s.phase}: ${s.reason}`).join("\n") + "\n"
			: "") +
		`\nPush and PR the migration branches manually: \`git push origin <branch>\`.`;
	ui.notify(`soly migrate: ${migrated.length} migrated, ${skipped.length} skipped`, "info");
	return { handled: true, transformedText: notice, migrated, skipped };
}
