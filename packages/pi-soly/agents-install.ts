// =============================================================================
// assets-install.ts — Idempotent install of soly-managed user assets
// =============================================================================
//
// Soly ships two kinds of user-scope assets:
//
//   1. Subagent configs → `~/.pi/agent/agents/`
//      The single `soly-manager` subagent (mode-switching executor).
//
//   2. Skills → `~/.pi/agent/skills/<name>/`
//      The `soly-framework` skill — framework documentation the LLM
//      loads on demand via the read tool.
//
// pi discovers both from `~/.pi/agent/`, so on first session_start we
// copy our shipped files there.
//
// IDEMPOTENT: if the target file already exists (user may have customized
// it), we do NOT overwrite. This is one-way "first install wins".
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** soly agent files bundled with the extension. */
const SHIPPED_AGENTS = [
	"soly-manager.md",
] as const;

/** soly skills bundled with the extension. Each entry is a directory
 *  under `skills/` containing a SKILL.md. */
const SHIPPED_SKILLS = [
	"soly-framework",
] as const;

/** Where pi looks for user agents. Respects HOME/USERPROFILE for
 *  testability (otherwise we'd always write to the real user home). */
function userAgentsDirs(): string[] {
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
	return [
		path.join(home, ".agents"),                          // vendor-neutral (preferred)
		path.join(home, ".pi", "agent", "agents"),           // pi's native
	];
}

/** Where pi looks for user skills. */
function userSkillsDir(): string {
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
	return path.join(home, ".pi", "agent", "skills");
}

/** Where this soly extension's `agents/` directory lives. */
function shippedAgentsDir(extensionRoot: string): string {
	return path.join(extensionRoot, "agents");
}

/** Where this soly extension's `skills/` directory lives. */
function shippedSkillsDir(extensionRoot: string): string {
	return path.join(extensionRoot, "skills");
}

export interface InstallResult {
	installed: string[];
	skipped: string[];
	errors: string[];
}

/** Copy a single file if destination doesn't exist. Idempotent. */
function copyIfMissing(from: string, to: string): "installed" | "skipped" | "error" {
	if (!fs.existsSync(from)) return "error";
	if (fs.existsSync(to)) return "skipped";
	try {
		fs.copyFileSync(from, to);
		return "installed";
	} catch {
		return "error";
	}
}

/** Recursively copy a directory tree if destination doesn't exist. Idempotent. */
function copyDirIfMissing(from: string, to: string): "installed" | "skipped" | "error" {
	if (!fs.existsSync(from)) return "error";
	if (fs.existsSync(to)) return "skipped";
	try {
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.cpSync(from, to, { recursive: true });
		return "installed";
	} catch {
		return "error";
	}
}

/** Install shipped soly agents to `~/.agents/` (vendor-neutral,
 *  preferred). Legacy `~/.pi/agent/agents/` copies are left alone —
 *  `discoverUserAgents` reads both, so old installs still work. */
export function installSolyAgents(extensionRoot: string): InstallResult {
	const result: InstallResult = { installed: [], skipped: [], errors: [] };
	const src = shippedAgentsDir(extensionRoot);

	if (!fs.existsSync(src)) return result; // dev mode no-op

	// Try vendor-neutral first, then fall back to pi's native dir.
	let dst: string | null = null;
	for (const candidate of userAgentsDirs()) {
		try {
			fs.mkdirSync(candidate, { recursive: true });
			dst = candidate;
			break;
		} catch (err) {
			result.errors.push(`mkdir ${candidate}: ${(err as Error).message}`);
		}
	}
	if (!dst) return result;

	for (const name of SHIPPED_AGENTS) {
		const from = path.join(src, name);
		const to = path.join(dst, name);
		const r = copyIfMissing(from, to);
		if (r === "installed") result.installed.push(name);
		else if (r === "skipped") result.skipped.push(name);
		else result.errors.push(`missing source: ${from}`);
	}

	return result;
}

/** Install shipped soly skills to `~/.pi/agent/skills/`. Idempotent. */
export function installSolySkills(extensionRoot: string): InstallResult {
	const result: InstallResult = { installed: [], skipped: [], errors: [] };
	const src = shippedSkillsDir(extensionRoot);
	const dst = userSkillsDir();

	if (!fs.existsSync(src)) return result; // dev mode no-op

	for (const name of SHIPPED_SKILLS) {
		const from = path.join(src, name);
		const to = path.join(dst, name);
		const r = copyDirIfMissing(from, to);
		if (r === "installed") result.installed.push(name);
		else if (r === "skipped") result.skipped.push(name);
		else result.errors.push(`missing source: ${from}`);
	}

	return result;
}

/** Install all soly assets (agents + skills). Combined for convenience. */
export function installSolyAssets(extensionRoot: string): {
	agents: InstallResult;
	skills: InstallResult;
} {
	return {
		agents: installSolyAgents(extensionRoot),
		skills: installSolySkills(extensionRoot),
	};
}

/** Check which shipped soly agents are present across all user agent
 *  homes. A file counts as "installed" if it's in ANY of the dirs. */
export function checkSolyAgentsInstalled(extensionRoot: string): {
	installed: string[];
	missing: string[];
} {
	const installed: string[] = [];
	const missing: string[] = [];
	for (const name of SHIPPED_AGENTS) {
		const present = userAgentsDirs().some((dir) => fs.existsSync(path.join(dir, name)));
		if (present) installed.push(name);
		else missing.push(name);
	}
	return { installed, missing };
}

/** Check which shipped soly skills are present in the user dir. */
export function checkSolySkillsInstalled(extensionRoot: string): {
	installed: string[];
	missing: string[];
} {
	const dst = userSkillsDir();
	const installed: string[] = [];
	const missing: string[] = [];
	for (const name of SHIPPED_SKILLS) {
		if (fs.existsSync(path.join(dst, name, "SKILL.md"))) {
			installed.push(name);
		} else {
			missing.push(name);
		}
	}
	return { installed, missing };
}
