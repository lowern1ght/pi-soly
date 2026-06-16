// =============================================================================
// agents-install.ts — Idempotent install of soly-aware subagent configs
// =============================================================================
//
// Soly ships ONE subagent: `soly-manager`. It's a workflow executor that
// switches modes (worker / debugger / tester / reviewer / refactor /
// documenter / oracle / planner) based on the task brief the parent passes.
// One agent, one system prompt, all roles.
//
// pi-subagents discovers agents from `~/.pi/agent/agents/`, so on first
// session_start we copy our `soly-manager.md` there.
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

/** Where pi-subagents looks for user agents. Respects HOME/USERPROFILE
 *  for testability (otherwise we'd always write to the real user home). */
function userAgentsDir(): string {
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
	return path.join(home, ".pi", "agent", "agents");
}

/** Where this soly extension's `agents/` directory lives. */
function shippedDir(extensionRoot: string): string {
	return path.join(extensionRoot, "agents");
}

export interface InstallResult {
	installed: string[];
	skipped: string[];
	errors: string[];
}

/** Install shipped soly agents to `~/.pi/agent/agents/`. Idempotent. */
export function installSolyAgents(extensionRoot: string): InstallResult {
	const result: InstallResult = { installed: [], skipped: [], errors: [] };
	const src = shippedDir(extensionRoot);
	const dst = userAgentsDir();

	if (!fs.existsSync(src)) {
		// Development mode or partial install — silently no-op
		return result;
	}

	try {
		fs.mkdirSync(dst, { recursive: true });
	} catch (err) {
		result.errors.push(`mkdir ${dst}: ${(err as Error).message}`);
		return result;
	}

	for (const name of SHIPPED_AGENTS) {
		const from = path.join(src, name);
		const to = path.join(dst, name);
		if (!fs.existsSync(from)) {
			result.errors.push(`missing source: ${from}`);
			continue;
		}
		if (fs.existsSync(to)) {
			// User already has this file (possibly customized) — respect it
			result.skipped.push(name);
			continue;
		}
		try {
			fs.copyFileSync(from, to);
			result.installed.push(name);
		} catch (err) {
			result.errors.push(`copy ${name}: ${(err as Error).message}`);
		}
	}

	return result;
}

/** Check which shipped soly agents are present in the user dir. Used by doctor. */
export function checkSolyAgentsInstalled(extensionRoot: string): {
	installed: string[];
	missing: string[];
} {
	const dst = userAgentsDir();
	const installed: string[] = [];
	const missing: string[] = [];
	for (const name of SHIPPED_AGENTS) {
		if (fs.existsSync(path.join(dst, name))) {
			installed.push(name);
		} else {
			missing.push(name);
		}
	}
	return { installed, missing };
}
