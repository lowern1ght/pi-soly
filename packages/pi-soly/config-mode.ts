// =============================================================================
// config-mode.ts — soly mode system (plans vs phases) config loader
// =============================================================================
//
// New in v3.0.0. A repo can be in either "plans" mode (LLM-driven, lightweight,
// local-first) or "phases" mode (STATE.md + ROADMAP.md + shared phase dirs).
//
// The mode is resolved from a 3-level chain, then auto-detect as a fallback:
//
//   1.  ~/.pi/soly.user.json          — global, per-user (all repos)
//   2.  .agents/soly.local.json       — per-repo, per-user (gitignored)
//   3.  .agents/soly.config.json      — per-repo, team default (committed)
//   4.  Auto-detect: STATE.md present → phases, else plans
//
// Each layer overrides the previous. The first three are JSON files; the
// fourth is a heuristic. If (4) can't decide (no config, no STATE.md, fresh
// repo) the caller should show a first-run picker and let the user pick.
//
// Schema versioning: the file's `version` must match MODE_CONFIG_VERSION.
// Mismatches fall back to auto-detect (the safest behavior — we never
// silently apply a config we don't understand).
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Bump when the schema changes in a breaking way. */
export const MODE_CONFIG_VERSION = 1 as const;

/** Two soly workflows. Plans = LLM-driven, local, lightweight.
 *  Phases = STATE.md/ROADMAP.md, shared, multi-contributor. */
export type SolyMode = "plans" | "phases";

/** Mode configuration as stored in any of the three config files. */
export interface ModeConfig {
	version: typeof MODE_CONFIG_VERSION;
	mode: SolyMode;
	/** Where plans live in plans mode. Default ".pi/plans" (local, gitignored). */
	plansDir?: string;
}

/** Result of resolving mode for a given repo. */
export interface ResolvedMode {
	/** Final mode after chain + detect. */
	mode: SolyMode;
	/** Where plans live (only relevant in plans mode). */
	plansDir: string;
	/** Which layer provided the answer — for diagnostics. */
	source: "user-global" | "user-repo" | "repo-default" | "auto-detect" | "default";
	/** Any warnings collected during resolution. */
	warnings: string[];
	/** When source is auto-detect, this is true if the picker should run. */
	needsPicker: boolean;
}

/** Resolve the plans dir default based on mode. */
export function defaultPlansDir(mode: SolyMode): string {
	return mode === "plans" ? ".pi/plans" : ".agents/plans";
}

/** Parse a single config file. Returns the parsed config + warnings, or
 *  null if the file is missing/unreadable. Returns `null` with a warning for
 *  invalid input (bad JSON, wrong version, invalid mode) so the resolver
 *  falls through to the next layer — better than silently applying a
 *  broken config's default. */
function readConfigFile(filePath: string): { config: ModeConfig; warnings: string[] } | null {
	if (!fs.existsSync(filePath)) return null;
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return null; // + warning surfaced via the caller's warning accumulator
	}
	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}
	const obj = parsed as Record<string, unknown>;
	const version = obj["version"];
	const mode = obj["mode"];
	const plansDir = obj["plansDir"];
	if (version !== MODE_CONFIG_VERSION) {
		// Caller needs the warning — we'll pass it through
		return null;
	}
	if (mode !== "plans" && mode !== "phases") {
		return null;
	}
	const warnings: string[] = [];
	if (plansDir !== undefined && typeof plansDir !== "string") {
		warnings.push(`${filePath}: plansDir must be a string, got ${typeof plansDir}`);
	}
	return {
		config: {
			version: MODE_CONFIG_VERSION,
			mode,
			plansDir: typeof plansDir === "string" ? plansDir : undefined,
		},
		warnings,
	};
}

/** Same as readConfigFile but also reports warnings for invalid files
 *  (so the user can see WHY a layer was rejected). The result tuple is
 *  `[config | null, warnings]` — null means the layer was rejected. */
function readConfigLayer(filePath: string): { config: ModeConfig | null; warnings: string[] } {
	if (!fs.existsSync(filePath)) return { config: null, warnings: [] };
	const result = readConfigFile(filePath);
	if (result) return { config: result.config, warnings: result.warnings };
	// File exists but was rejected — try to read it to surface a warning
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		// Attempt to identify the failure mode
		try {
			JSON.parse(raw);
		} catch (e) {
			return { config: null, warnings: [`${filePath}: invalid JSON (${e instanceof Error ? e.message : String(e)})`] };
		}
		const obj = JSON.parse(raw);
		const version = (obj as Record<string, unknown>)["version"];
		const mode = (obj as Record<string, unknown>)["mode"];
		if (version !== MODE_CONFIG_VERSION) {
			return { config: null, warnings: [`${filePath}: version mismatch (got ${String(version)}, expected ${MODE_CONFIG_VERSION})`] };
		}
		if (mode !== "plans" && mode !== "phases") {
			return { config: null, warnings: [`${filePath}: invalid mode '${String(mode)}' (expected "plans" or "phases")`] };
		}
	} catch (e) {
		return { config: null, warnings: [`${filePath}: ${e instanceof Error ? e.message : String(e)}`] };
	}
	return { config: null, warnings: [`${filePath}: rejected (unknown reason)`] };
}

/** Auto-detect: if STATE.md or ROADMAP.md is present, the project was set up
 *  for phase mode. Default to plans mode for new/empty repos. */
export function autoDetectMode(cwd: string): SolyMode {
	const statePath = path.join(cwd, ".agents", "STATE.md");
	const roadmapPath = path.join(cwd, ".agents", "ROADMAP.md");
	if (fs.existsSync(statePath) || fs.existsSync(roadmapPath)) return "phases";
	return "plans";
}

/** Resolve mode for a given repo. Pure function — given the same inputs,
 *  always returns the same result. Used at session_start and in tests. */
export function resolveMode(cwd: string, opts: { homeDir?: string } = {}): ResolvedMode {
	const home = opts.homeDir ?? os.homedir();
	const warnings: string[] = [];

	// 1. Global: ~/.pi/soly.user.json
	const globalPath = path.join(home, ".pi", "soly.user.json");
	const globalResult = readConfigLayer(globalPath);
	warnings.push(...globalResult.warnings);
	if (globalResult.config) {
		return {
			mode: globalResult.config.mode,
			plansDir: globalResult.config.plansDir ?? defaultPlansDir(globalResult.config.mode),
			source: "user-global",
			warnings,
			needsPicker: false,
		};
	}

	// 2. Per-repo user override: .agents/soly.local.json (gitignored)
	const localPath = path.join(cwd, ".agents", "soly.local.json");
	const localResult = readConfigLayer(localPath);
	warnings.push(...localResult.warnings);
	if (localResult.config) {
		return {
			mode: localResult.config.mode,
			plansDir: localResult.config.plansDir ?? defaultPlansDir(localResult.config.mode),
			source: "user-repo",
			warnings,
			needsPicker: false,
		};
	}

	// 3. Repo default: .agents/soly.config.json (committed)
	const repoPath = path.join(cwd, ".agents", "soly.config.json");
	const repoResult = readConfigLayer(repoPath);
	warnings.push(...repoResult.warnings);
	if (repoResult.config) {
		return {
			mode: repoResult.config.mode,
			plansDir: repoResult.config.plansDir ?? defaultPlansDir(repoResult.config.mode),
			source: "repo-default",
			warnings,
			needsPicker: false,
		};
	}

	// 4. Auto-detect fallback.
	//
	// Picker semantics (v3.0.0):
	//   - auto-detected "phases" (STATE.md / ROADMAP.md exists) — confident,
	//     no picker. Callers should silently write this to .agents/soly.config.json
	//     so the next session doesn't re-detect (and so the team default is
	//     pinned in version control). Picking through UI for an existing
	//     phase-mode project is friction.
	//   - auto-detected "plans" (no state files) — empty repo / new project.
	//     Show the picker so the user can opt into phases mode from day one.
	//   - auto-detected "plans" but the repo has plans (existing plans-mode
	//     project) — picker is unhelpful, just default to plans silently.
	const detected = autoDetectMode(cwd);
	const hasStateFiles = fs.existsSync(path.join(cwd, ".agents", "STATE.md"))
		|| fs.existsSync(path.join(cwd, ".agents", "ROADMAP.md"));
	const needsPicker = detected === "plans" && !hasStateFiles;
	return {
		mode: detected,
		plansDir: defaultPlansDir(detected),
		source: "auto-detect",
		warnings,
		needsPicker,
	};
}

/** Write a mode config to one of the three config locations. Used by the
 *  first-run picker to save the user's choice. */
export function writeModeConfig(
	layer: "user-global" | "user-repo" | "repo-default",
	cwd: string,
	config: { mode: SolyMode; plansDir?: string },
	opts: { homeDir?: string } = {},
): { path: string; warnings: string[] } {
	const home = opts.homeDir ?? os.homedir();
	const warnings: string[] = [];
	let filePath: string;
	if (layer === "user-global") {
		const dir = path.join(home, ".pi");
		fs.mkdirSync(dir, { recursive: true });
		filePath = path.join(dir, "soly.user.json");
	} else if (layer === "user-repo") {
		const dir = path.join(cwd, ".agents");
		fs.mkdirSync(dir, { recursive: true });
		filePath = path.join(dir, "soly.local.json");
		// Ensure .gitignore covers it (best-effort, non-fatal).
		const gitignore = path.join(cwd, ".gitignore");
		try {
			let gi = "";
			if (fs.existsSync(gitignore)) gi = fs.readFileSync(gitignore, "utf-8");
			if (!gi.split("\n").some((l) => l.trim() === ".agents/soly.local.json")) {
				fs.appendFileSync(gitignore, (gi.endsWith("\n") ? "" : "\n") + ".agents/soly.local.json\n");
			}
		} catch (e) {
			warnings.push(`could not update .gitignore: ${e instanceof Error ? e.message : String(e)}`);
		}
	} else {
		const dir = path.join(cwd, ".agents");
		fs.mkdirSync(dir, { recursive: true });
		filePath = path.join(dir, "soly.config.json");
	}
	const body: ModeConfig = {
		version: MODE_CONFIG_VERSION,
		mode: config.mode,
		plansDir: config.plansDir,
	};
	try {
		fs.writeFileSync(filePath, JSON.stringify(body, null, 2) + "\n", "utf-8");
	} catch (e) {
		warnings.push(`could not write ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
	}
	return { path: filePath, warnings };
}
