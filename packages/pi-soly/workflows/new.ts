// =============================================================================
// workflows/new.ts — `soly new <type>/<name>` handler
// =============================================================================
//
// Direct workflow (NOT a transform): creates a git branch of the form
// `<type>/<name>`, makes `.agents/plans/<name>/` on that branch, and writes
// a stub PLAN.md with TBD sections that the user fills in later via
// `soly plan <type>/<name>`. Plain `soly new ...` from chat just works.
//
// `<type>` is a Conventional Commits type (`feat`, `fix`, `chore`, ...).
// `<name>` is kebab-case. Branch name = `<type>/<name>`, plan directory is
// `.agents/plans/<name>/` (the type prefix is part of branch identity only).
// Returns `{ handled: false }` if the user typed something other than the
// prefix (e.g. `soly something-else`) so the regular handler can run.
// =============================================================================

import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parsePlanName, type SolyCommand } from "./parser.ts";
import type { SolyState } from "../core.js";

export interface NewResult {
	handled: boolean;
	transformedText?: string;
	/** On success: branch created, plan dir + stub PLAN.md written, committed. */
	scaffolded?: { branch: string; planPath: string };
}

/** We only call `notify` on the UI. Structural type so tests can fake it. */
export type Notifier = {
	notify: (text: string, level?: "info" | "warning" | "error") => void;
};

/** Run `git <args>` and capture stdout. Throws with stderr context on error. */
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

/** Stub PLAN.md body with TBD sections; `soly plan` fills these in later. */
function stubPlanMarkdown(branchName: string): string {
	return `# Plan: ${branchName}

_Stub — fill in via \`soly plan ${branchName}\` (uses ask_pro to gather goal / steps / acceptance criteria)._

## Goal

<!-- What does this plan deliver? 1-2 sentences. -->

## Steps

<!-- High-level breakdown. ~3-7 bullets. -->

## Acceptance

<!-- How will we know the plan is done? -->
`;
}

/**
 * Build an error/notification text (also returned as `handled: true,
 * transformedText` so the caller shows it; for direct execution the
 * workflow also calls `ui.notify` with the same string).
 */
function reply(text: string): NewResult {
	return { handled: true, transformedText: text };
}

export function buildNewTransform(
	cmd: SolyCommand,
	state: SolyState,
	ui: Notifier,
	projectRoot: string,
): NewResult {
	if (!state.exists) {
		return reply(`soly new: no .agents/ directory in cwd — run /soly init first.`);
	}

	const parsed = parsePlanName(cmd.args.join(" "));
	if ("error" in parsed) return reply(`soly new: ${parsed.error}`);

	const { name } = parsed;
	// Branch IS the slug (no <type>/ prefix). Convention chosen over
	// Conventional-Branches because `soly new` users tend to give a full
	// descriptive name already; the type prefix adds noise without info.
	const branchName = name;
	// Path used by `git add`/`commit` — relative to projectRoot (where `.git/` is).
	// The plan lives at `<root>/.agents/plans/<name>/`, so the repo-relative path
	// is `.agents/plans/<name>`.
	const planDirRel = `.agents/plans/${name}`;
	const planDirAbs = `${state.solyDir}/plans/${name}`;
	const planFile = `${planDirAbs}/PLAN.md`;

	// 1. Preconditions
	try {
		git(["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot });
	} catch {
		return reply(`soly new: not in a git repository (cwd: ${projectRoot}). Run \`git init\` first.`);
	}

	const statusOut = git(["status", "--short"], { cwd: projectRoot });
	// Ignore our own planned files if they're present but untracked — that
	// can happen if a previous `soly new` died mid-flight. Anything else
	// (untracked or modified tracked files) is the user's responsibility.
	if (statusOut) {
		return reply(
			`soly new: working tree has uncommitted changes:\n\n${statusOut}\n\n` +
				`Commit or stash them first.`,
		);
	}

	const currentBranch = git(["branch", "--show-current"], { cwd: projectRoot }) || "HEAD (detached)";
	// A plan branch is a kebab-case slug (no `<type>/` prefix after 1.15.x).
	// The branch can also be the long-lived integration branches `master`
	// or `main`. Anything else (release tags, weird suffixes) → user must
	// checkout first.
	if (
		currentBranch !== "master" &&
		currentBranch !== "main" &&
		!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(currentBranch)
	) {
		return reply(
			`soly new: currently on "${currentBranch}" (not master/main, not a soly plan branch). ` +
				`Switch back to master first with \`git checkout master\`.`,
		);
	}

	let branchExisted = false;
	try {
		git(["rev-parse", "--verify", branchName], { cwd: projectRoot });
		// Branch already exists — switch to it instead of creating
		branchExisted = true;
		git(["checkout", branchName], { cwd: projectRoot });
	} catch {
		// Branch doesn't exist — create it
		git(["checkout", "-b", branchName], { cwd: projectRoot });
	}

	try {
		// 2. Scaffold plan dir + stub PLAN.md
		fs.mkdirSync(planDirAbs, { recursive: true });
		fs.writeFileSync(planFile, stubPlanMarkdown(branchName), "utf-8");

		// 3. Commit (separate from working-tree check so the new files show)
		git(["add", planDirRel], { cwd: projectRoot });
		git(["commit", "-m", `plan: scaffold ${branchName}`], { cwd: projectRoot });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return reply(`soly new: scaffold failed — ${msg}\nYou may need to manually clean up branch ${branchName}.`);
	}

	const notice = branchExisted
		? `Plan '${name}' reused on existing branch ${branchName}.\nPLAN.md was ${planFile}.\nNext: \`soly plan ${branchName}\``
		: `Plan '${name}' scaffolded on new branch ${branchName}.\nPLAN.md: ${planFile}\nNext: \`soly plan ${branchName}\``;
	ui.notify(notice, "info");
	return {
		handled: true,
		transformedText: notice,
		scaffolded: { branch: branchName, planPath: planFile },
	};
}
