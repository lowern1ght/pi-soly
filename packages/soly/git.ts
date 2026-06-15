// =============================================================================
// git.ts — Git context provider for the soly extension
// =============================================================================
//
// Reads current git state (branch, status, last 5 commits) and renders a
// short section to inject into the system prompt. The model gets immediate
// awareness of what's changed recently and what's uncommitted.
//
// All git calls go through `git ...` with a 2s timeout. Failures are silent
// (no git, not a repo, no network) — the section just doesn't render.
// =============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 2000;

interface GitResult {
	ok: boolean;
	stdout: string;
}

async function safeGit(args: string[], cwd: string): Promise<GitResult> {
	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd,
			timeout: TIMEOUT_MS,
			maxBuffer: 64 * 1024,
			encoding: "utf-8",
		});
		return { ok: true, stdout: stdout.trim() };
	} catch {
		return { ok: false, stdout: "" };
	}
}

export interface GitContext {
	available: boolean;
	branch: string | null;
	statusShort: string | null;
	lastCommits: string[];
}

/** Read git state. Returns `available: false` if git is missing / not a repo. */
export async function readGitContext(cwd: string): Promise<GitContext> {
	const branch = await safeGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	if (!branch.ok) {
		return { available: false, branch: null, statusShort: null, lastCommits: [] };
	}
	const [status, log] = await Promise.all([
		safeGit(["status", "--short"], cwd),
		safeGit(["log", "--oneline", "-5", "--no-decorate"], cwd),
	]);
	return {
		available: true,
		branch: branch.stdout || null,
		statusShort: status.ok ? status.stdout : null,
		lastCommits: log.ok && log.stdout ? log.stdout.split(/\r?\n/).filter(Boolean) : [],
	};
}

/** Render a short git section to inject into the system prompt. */
export function buildGitSection(ctx: GitContext): string {
	if (!ctx.available) return "";

	const lines: string[] = ["", "## current git state", ""];
	lines.push(`- **branch**: ${ctx.branch ?? "(detached)"}`);

	if (ctx.statusShort !== null) {
		if (ctx.statusShort === "") {
			lines.push("- **working tree**: clean");
		} else {
			const changed = ctx.statusShort.split(/\r?\n/).filter(Boolean);
			lines.push(`- **working tree**: ${changed.length} changed file(s)`);
			// Inline first 10 for visibility — full list available via `soly diff`
			for (const c of changed.slice(0, 10)) {
				lines.push(`  - ${c}`);
			}
			if (changed.length > 10) {
				lines.push(`  - ... and ${changed.length - 10} more (run \`soly diff\` for full)`);
			}
		}
	}

	if (ctx.lastCommits.length > 0) {
		lines.push("- **recent commits**:");
		for (const c of ctx.lastCommits.slice(0, 5)) {
			lines.push(`  - ${c}`);
		}
	}

	return lines.join("\n");
}
