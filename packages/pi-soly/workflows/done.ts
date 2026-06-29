// =============================================================================
// workflows/done.ts — `soly done <type>/<name>` handler
// =============================================================================
//
// Direct workflow (no LLM transform): wraps up a plan on its branch.
//  1. Validates we're on the plan's branch (or any soly plan branch if
//     `<type>/<name>` is omitted — see "implicit mode" below).
//  2. Commits any uncommitted changes (with a sensible Conventional
//     Commits message if the user hasn't staged anything).
//  3. `git push -u origin <branch>` (or warn if no remote).
//  4. Tries `gh pr create --draft --fill` (or warns if `gh` not on PATH).
//
// STATE.md global sync (in main) is deferred to W4 — that's a separate
// concern about merge coordination.
// =============================================================================

import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parsePlanName, type SolyCommand } from "./parser.ts";
import type { SolyState } from "../core.js";

export interface DoneResult {
	handled: boolean;
	transformedText?: string;
	completed?: {
		branch: string;
		commit: string;
		pushed: boolean;
		prUrl: string | null;
	};
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
		const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
		const stderr = e.stderr ? e.stderr.toString().trim() : "";
		throw new Error(`git ${args.join(" ")} failed: ${stderr || e.message || "unknown error"}`);
	}
}

/** Try `gh` and return stdout. Throws on failure. */
function gh(args: string[], opts: { cwd: string; ghPath?: string }): string {
	const cmd = opts.ghPath ?? "gh";
	try {
		return execFileSync(cmd, args, {
			cwd: opts.cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch (err) {
		const e = err as { stderr?: Buffer | string; message?: string };
		const stderr = e.stderr ? e.stderr.toString().trim() : "";
		throw new Error(`gh ${args[0]} failed: ${stderr || e.message || "unknown error"}`);
	}
}

/** ENOENT-style "command not found" -> throws a specific error. */
function ghAvailable(ghPath?: string): boolean {
	const cmd = ghPath ?? "gh";
	try {
		execFileSync(cmd, ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function reply(text: string): DoneResult {
	return { handled: true, transformedText: text };
}

export function buildDoneTransform(
	cmd: SolyCommand,
	state: SolyState,
	ui: Notifier,
	projectRoot: string,
	opts: { ghPath?: string } = {},
): DoneResult {
	if (!state.exists) {
		return reply(`soly done: no .agents/ directory in cwd — run /soly init first.`);
	}

	const raw = cmd.args.join(" ").trim();
	const parsed = parsePlanName(raw);
	if ("error" in parsed) {
		return reply(`soly done: ${parsed.error}\n\nUsage: soly done <type>/<name>`);
	}
	const { type, name } = parsed;
	const branchName = `${type}/${name}`;

	// 1. Preconditions
	const currentBranch = git(["branch", "--show-current"], { cwd: projectRoot });
	if (currentBranch !== branchName) {
		return reply(
			`soly done: currently on "${currentBranch}", not the plan branch "${branchName}".\n` +
				`Switch first with \`git checkout ${branchName}\`.`,
		);
	}

	// Check there's a remote
	let hasRemote = false;
	try {
		git(["remote", "get-url", "origin"], { cwd: projectRoot });
		hasRemote = true;
	} catch {
		// No remote — we'll skip push but still commit
	}

	// 2. Commit any pending changes (if anything to commit)
	const statusBefore = git(["status", "--short"], { cwd: projectRoot });
	let commitHash = git(["rev-parse", "HEAD"], { cwd: projectRoot });
	if (statusBefore) {
		// Auto-stage everything not under .agents/ (project files only)
		try {
			git(["add", "-A", "--", ":!.agents/"], { cwd: projectRoot });
			// Re-check after add
			const statusAfter = git(["status", "--short"], { cwd: projectRoot });
			if (statusAfter) {
				git(["commit", "-m", `${type}(${name}): wip`], { cwd: projectRoot });
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return reply(`soly done: commit failed — ${msg}`);
		}
		commitHash = git(["rev-parse", "HEAD"], { cwd: projectRoot });
	}

	// 3. Push
	let pushed = false;
	if (hasRemote) {
		try {
			git(["push", "-u", "origin", branchName], { cwd: projectRoot });
			pushed = true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ui.notify(`soly done: push failed — ${msg}\nPlan was committed but not pushed. Push manually with \`git push -u origin ${branchName}\`.`, "warning");
			return {
				handled: true,
				transformedText: `Plan ${branchName} committed locally (${commitHash.slice(0, 7)}), but push failed.\n${msg}`,
				completed: { branch: branchName, commit: commitHash, pushed: false, prUrl: null },
			};
		}
	} else {
		ui.notify(`soly done: no 'origin' remote — committed locally only. Add a remote and \`git push\` when ready.`, "warning");
	}

	// 4. Draft PR via gh
	let prUrl: string | null = null;
	if (pushed && ghAvailable(opts.ghPath)) {
		try {
			prUrl = gh(
				[
					"pr",
					"create",
					"--draft",
					"--fill",
					"--head",
					branchName,
				],
				{ cwd: projectRoot, ghPath: opts.ghPath },
			);
		} catch (err) {
			// gh failed (maybe not authenticated, or PR already exists, etc.)
			// Don't fail the whole workflow — just report.
			const msg = err instanceof Error ? err.message : String(err);
			ui.notify(
				`soly done: pushed OK, but draft PR creation failed — ${msg}\n` +
					`Run \`gh pr create --draft --fill\` manually.`,
				"warning",
			);
		}
	} else if (pushed) {
		ui.notify(
			`soly done: pushed OK, but \`gh\` CLI not found — draft PR not created.\n` +
				`Install \`gh\` (https://cli.github.com) and run \`gh pr create --draft --fill\` manually.`,
			"info",
		);
	}

	// 5. Done — summarize
	const prLine = prUrl ? `Draft PR: ${prUrl}` : "No draft PR (push or gh step skipped / failed).";
	const notice =
		`Plan ${branchName} done.\n` +
		`  Commit:   ${commitHash.slice(0, 7)}\n` +
		`  Pushed:   ${pushed ? "yes" : "no (no origin remote)"}\n` +
		`  ${prLine}`;
	ui.notify(notice, "info");
	return {
		handled: true,
		transformedText: notice,
		completed: { branch: branchName, commit: commitHash, pushed, prUrl },
	};
}
