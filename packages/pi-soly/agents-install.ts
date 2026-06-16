// =============================================================================
// assets-install.ts — Idempotent install of soly-managed user assets
// =============================================================================
//
// Soly ships one kind of user-scope asset:
//
//   Skills → `~/.pi/agent/skills/<name>/`
//      The `soly-framework` skill — framework documentation the LLM
//      loads on demand via the read tool. This is the LLM's only
//      "helper" for soly — pi doesn't need a separate subagent layer
//      for plan execution (the LLM in the main session does it).
//
// pi discovers the skill from `~/.pi/agent/`, so on first session_start
// we copy our shipped file there.
//
// IDEMPOTENT: if the target file already exists (user may have customized
// it), we do NOT overwrite. This is one-way "first install wins".
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** soly skills bundled with the extension. Each entry is a directory
 *  under `skills/` containing a SKILL.md. */
const SHIPPED_SKILLS = [
	"soly-framework",
] as const;

/** Where pi looks for user skills. Respects HOME/USERPROFILE for
 *  testability (otherwise we'd always write to the real user home). */
function userSkillsDir(): string {
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
	return path.join(home, ".pi", "agent", "skills");
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

/** Copy a directory tree if destination doesn't exist. Idempotent. */
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

/** Install all soly assets (skills only — agents are not shipped). */
export function installSolyAssets(extensionRoot: string): {
	skills: InstallResult;
} {
	return {
		skills: installSolySkills(extensionRoot),
	};
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
