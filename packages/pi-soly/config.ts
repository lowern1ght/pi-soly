// =============================================================================
// config.ts — soly config loader (per-project + global)
// =============================================================================
//
// Per-project: `.soly/config.json` (version-controlled, repo-specific).
// Global:     `~/.soly/config.json` (per-user, applies to all projects).
//
// Lookup order: per-project overrides global overrides defaults. Missing
// files are silently ignored (defaults apply). Malformed JSON returns a
// "fallback to defaults" warning via the return value's `warnings` array.
//
// Schema versioning: if the file's `version` doesn't match SOLY_CONFIG_VERSION,
// we still try to merge what we can and add a warning.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const SOLY_CONFIG_VERSION = 1 as const;

/** Defaults — also the "schema" (all keys optional, merged with user overrides). */
export interface SolyConfig {
	version: typeof SOLY_CONFIG_VERSION;
	iteration: {
		/** Auto-prune iteration files older than N days on session_start. 0 = keep forever. */
		retentionDays: number;
		/** Include RESEARCH.md sections in the per-iteration context bundle. */
		includeResearch: boolean;
		/** Include Anti-Patterns table from .continue-here.md in the bundle. */
		includeAntiPatterns: boolean;
	};
	agent: {
		/** When ask_pro tool is available, prefer it over soly_ask_user in discuss flow. */
		preferAskPro: boolean;
		/** When soly pause is invoked, also auto-save HANDOFF.json (currently always true; knob for future). */
		autoCheckpointOnPause: boolean;
		/** Opt-in: install soly-manager agent config to
		 *  ~/.pi/agent/agents/ on session_start. The single soly subagent
		 *  is mode-switching (worker/debugger/tester/reviewer/etc. based on
		 *  the task brief). Off by default — most users don't need a soly-
		 *  specialized subagent since the workflow template already
		 *  contains soly instructions. */
		useSolyWorkerSubagents: boolean;
	};
	display: {
		/** Always show the recommended (⭐) option as the first row. */
		defaultRecommendedFirst: boolean;
		/** Cap on how many phases appear in /soly status / soly status. */
		maxPhasesInStatus: number;
		/** Cap on how many decisions appear in soly log default. */
		maxDecisionsInLog: number;
	};
	paths: {
		/** Globs to exclude from code-map / project scans. */
		excludeGlobs: string[];
	};
	hotReload: {
		/** Hot-reload poll interval (ms). Default 2000. */
		pollMs: number;
		/** Show a notify when rules change. */
		notifyOnRuleChange: boolean;
	};
	editor: {
		/** $EDITOR command for opening files (e.g. "code", "vim", "cursor"). */
		command: string;
	};
}

export const DEFAULT_CONFIG: SolyConfig = {
	version: SOLY_CONFIG_VERSION,
	iteration: {
		retentionDays: 0, // 0 = keep forever
		includeResearch: true,
		includeAntiPatterns: true,
	},
	agent: {
		preferAskPro: true,
		autoCheckpointOnPause: true,
		useSolyWorkerSubagents: false,
	},
	display: {
		defaultRecommendedFirst: true,
		maxPhasesInStatus: 20,
		maxDecisionsInLog: 20,
	},
	paths: {
		excludeGlobs: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**", "**/.next/**", "**/.nuxt/**", "**/coverage/**"],
	},
	hotReload: {
		pollMs: 2000,
		notifyOnRuleChange: true,
	},
	editor: {
		command: "code",
	},
};

/** Raw parsed shape from a config.json — could be partial, could have wrong types. */
type RawConfig = Partial<SolyConfig> & { version?: number };

function readJsonIfExists(path: string): RawConfig | null {
	try {
		if (!fs.existsSync(path)) return null;
		const raw = fs.readFileSync(path, "utf-8");
		return JSON.parse(raw) as RawConfig;
	} catch {
		return null;
	}
}

export interface LoadConfigResult {
	config: SolyConfig;
	warnings: string[];
	sources: { global: string | null; project: string | null };
}

/** Deep-merge `over` into `base`, with the same shape. Used to apply user
 *  overrides on top of defaults. Only known keys are merged. */
function deepMerge(base: SolyConfig, over: RawConfig): SolyConfig {
	const merged: SolyConfig = JSON.parse(JSON.stringify(base));
	if (over.iteration) {
		if (typeof over.iteration.retentionDays === "number")
			merged.iteration.retentionDays = over.iteration.retentionDays;
		if (typeof over.iteration.includeResearch === "boolean")
			merged.iteration.includeResearch = over.iteration.includeResearch;
		if (typeof over.iteration.includeAntiPatterns === "boolean")
			merged.iteration.includeAntiPatterns = over.iteration.includeAntiPatterns;
	}
	if (over.agent) {
		if (typeof over.agent.preferAskPro === "boolean")
			merged.agent.preferAskPro = over.agent.preferAskPro;
		if (typeof over.agent.autoCheckpointOnPause === "boolean")
			merged.agent.autoCheckpointOnPause = over.agent.autoCheckpointOnPause;
		if (typeof over.agent.useSolyWorkerSubagents === "boolean")
			merged.agent.useSolyWorkerSubagents = over.agent.useSolyWorkerSubagents;
	}
	if (over.display) {
		if (typeof over.display.defaultRecommendedFirst === "boolean")
			merged.display.defaultRecommendedFirst = over.display.defaultRecommendedFirst;
		if (typeof over.display.maxPhasesInStatus === "number")
			merged.display.maxPhasesInStatus = over.display.maxPhasesInStatus;
		if (typeof over.display.maxDecisionsInLog === "number")
			merged.display.maxDecisionsInLog = over.display.maxDecisionsInLog;
	}
	if (over.paths && Array.isArray(over.paths.excludeGlobs)) {
		merged.paths.excludeGlobs = over.paths.excludeGlobs.filter((g) => typeof g === "string");
	}
	if (over.hotReload) {
		if (typeof over.hotReload.pollMs === "number")
			merged.hotReload.pollMs = over.hotReload.pollMs;
		if (typeof over.hotReload.notifyOnRuleChange === "boolean")
			merged.hotReload.notifyOnRuleChange = over.hotReload.notifyOnRuleChange;
	}
	if (over.editor && typeof over.editor.command === "string") {
		merged.editor.command = over.editor.command;
	}
	return merged;
}

/** Load soly config. Per-project overrides global overrides defaults.
 *  Returns merged config + warnings about any issues.
 *  Optional `homeDir` overrides `os.homedir()` — used by tests; production
 *  callers leave it unset. */
export function loadConfig(cwd: string, homeDir?: string): LoadConfigResult {
	const warnings: string[] = [];
	const sources = { global: null as string | null, project: null as string | null };

	const home = homeDir ?? os.homedir();
	const globalPath = path.join(home, ".soly", "config.json");
	const globalRaw = readJsonIfExists(globalPath);
	if (globalRaw) {
		sources.global = globalPath;
		if (typeof globalRaw.version === "number" && globalRaw.version !== SOLY_CONFIG_VERSION) {
			warnings.push(
				`global config at ${globalPath} has version ${globalRaw.version}, expected ${SOLY_CONFIG_VERSION} — using defaults for unknown fields`,
			);
		}
	}
	const projectSolyDir = path.join(cwd, ".soly");
	const projectPath = path.join(projectSolyDir, "config.json");
	const projectRaw = readJsonIfExists(projectPath);
	if (projectRaw) {
		sources.project = projectPath;
		if (typeof projectRaw.version === "number" && projectRaw.version !== SOLY_CONFIG_VERSION) {
			warnings.push(
				`project config at ${projectPath} has version ${projectRaw.version}, expected ${SOLY_CONFIG_VERSION} — using defaults for unknown fields`,
			);
		}
	}

	let config = deepMerge(DEFAULT_CONFIG, globalRaw ?? {});
	config = deepMerge(config, projectRaw ?? {});
	return { config, warnings, sources };
}

// ---------------------------------------------------------------------------
// Iteration retention
// ---------------------------------------------------------------------------

/** Delete iteration files older than `retentionDays` (0 = no deletion). */
export function pruneOldIterations(solyDir: string, retentionDays: number): {
	pruned: number;
	kept: number;
} {
	if (retentionDays <= 0) return { pruned: 0, kept: -1 };
	const iterDir = path.join(solyDir, "iterations");
	if (!fs.existsSync(iterDir)) return { pruned: 0, kept: 0 };

	const now = Date.now();
	const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
	let pruned = 0;
	let kept = 0;
	for (const entry of fs.readdirSync(iterDir)) {
		const full = path.join(iterDir, entry);
		try {
			const stat = fs.statSync(full);
			if (stat.isFile() && now - stat.mtimeMs > cutoffMs) {
				fs.unlinkSync(full);
				pruned++;
			} else {
				kept++;
			}
		} catch {
			// skip unreadable
		}
	}
	return { pruned, kept };
}
