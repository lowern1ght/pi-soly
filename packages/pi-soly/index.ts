// =============================================================================
// index.ts — Main soly extension entry point
// =============================================================================
//
// Loads .soly/rules/ and .soly/ project state into the agent's system
// prompt, and registers:
//   - slash commands  /rules /soly /rulewizard /why
//   - LLM tools       soly_read soly_log_decision soly_list_phases
//   - input hooks     nudge (soft UI hint) + workflow verbs ("soly ...")
//
// All heavy logic lives in submodules:
//   - core.ts        data types, loaders, builders
//   - nudge.ts       behavioral nudge (pre-action gate + subagent preference)
//   - commands.ts    /rules /soly /rulewizard /why
//   - tools.ts       soly_read soly_log_decision soly_list_phases
//   - workflows/     soly execute / pause / compact (plain-text input only)
//
// To add a new workflow verb: edit workflows/parser.ts + workflows/<verb>.ts,
// then re-export the handler in workflows/index.ts. No changes needed here.
// =============================================================================

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	analyzeRules,
	buildProjectStateSection,
	buildRulesSection,
	buildStatusLine,
	CONTEXT_WINDOW_TOKENS,
	DEFAULT_PROGRESS,
	extractFilePathsFromPrompt,
	formatTok,
	loadAllRules,
	loadPhaseRules,
	loadProjectState,
	STATUS_ID,
	solyDirFor,
	buildNextHint,
	buildDriftReminder,
	type RuleFile,
	type SolyState,
	type SourceSpec,
} from "./core.ts";
import { buildIntegrationsSection } from "./integrations.ts";
import { installSolyAgents } from "./agents-install.ts";
import {
	DEFAULT_CONFIG,
	loadConfig,
	pruneOldIterations,
	type SolyConfig,
} from "./config.ts";
import { classifyTaskHeuristics, buildNudgeSection } from "./nudge.ts";
import { registerCommands, type CommandUI } from "./commands.ts";
import { registerTools } from "./tools.ts";
import { registerWorkflows } from "./workflows/index.ts";
import { readGitContext, buildGitSection, type GitContext } from "./git.ts";
import { startHotReload, type HotReloadHandle } from "./hotreload.ts";
import { detectEnv, buildEnvSection, type EnvSummary } from "./env.ts";
import { buildCodeMap, buildCodeMapSection, type CodeMap } from "./codemap.ts";
import { loadIntentDocs, buildIntentSection, loadInlineIntentBodies, type IntentDoc } from "./intent.ts";

// Built-in sub-features (merged from former pi-asked, pi-agented packages):
import piAskExtension from "./ask/index.ts";
import piSwitchExtension from "./switch/index.ts";

export default function solyExtension(pi: ExtensionAPI) {
	// ============================================================================
	// State (module-local, lives for the duration of one extension instance)
	// ============================================================================

	// Rules
	let rules: RuleFile[] = [];
	let rulesLoaded: string[] = [];
	let lastRulesTokens = 0;
	let ruleSources: SourceSpec[] = [];
	let overriddenRulePaths: string[] = [];
	let sessionCwd = "";

	// ============================================================================
	// Agent switcher (Shift+Tab cycles through available subagents)
	// ============================================================================

	// ============================================================================
	// Agent switcher: REMOVED. The agent cycler is now owned by the
	// separate `pi-switch` extension (footer pill + Ctrl+Tab + /agent slash).
	// Soly owns a single subagent (soly-manager.md) and the auto-install on
	// opt-in. Workflows read the current agent from
	// globalThis.__PI_SWITCH_AGENT__ (set by pi-switch).
	// ============================================================================

	// Config (per-project + global + defaults). Refreshed on session_start
	// and on each session_start (the LLM can call /soly config to view).
	let activeConfig: SolyConfig = DEFAULT_CONFIG;
	const getActiveConfig = (): SolyConfig => activeConfig;

	// Drift counter — tracks how many non-soly turns the user has spent
	// before invoking a soly verb. After the threshold, a reminder is
	// injected into the next system prompt so the LLM can suggest a sync
	// (status, pause, etc.). Resets on every parsed soly verb.
	let solyDrift = {
		turnsSinceLastSolyVerb: 0,
		lastReminderAt: 0,
		REMINDER_THRESHOLD: 5,
	};
	function resetSolyDrift() {
		solyDrift.turnsSinceLastSolyVerb = 0;
		solyDrift.lastReminderAt = 0;
	}

	// Project state
	let state: SolyState = {
		solyDir: "",
		exists: false,
		milestone: "—",
		milestoneName: "",
		status: "unknown",
		lastUpdated: "",
		progress: { ...DEFAULT_PROGRESS },
		position: null,
		currentPhase: null,
		currentPlanPath: null,
		stateBody: "",
		roadmapBody: "",
		phases: [],
		features: [],
		tasks: [],
	};

	// Status line cache (anti-flicker)
	let lastStatusLine = "";

	// Behavioral nudge state
	let nudgeActiveForTask = false;
	let lastNudgePromptKey = "";

	// Git context (cached, refreshed on hot reload + before_agent_start)
	let gitContext: GitContext = { available: false, branch: null, statusShort: null, lastCommits: [] };
	let lastGitSection = "";

	// Hot reload watcher for rules
	let hotReload: HotReloadHandle | null = null;

	// Session stats (computed on demand)
	let sessionStats: { turns: number; tokensEstimate: number } = { turns: 0, tokensEstimate: 0 };

	// Env summary (detected once at session_start, cheap to re-detect)
	let envSummary: EnvSummary | null = null;
	let lastEnvSection = "";

	// Code map (built once at session_start)
	let codeMap: CodeMap | null = null;
	let lastCodeMapSection = "";

	// Project intent (zero-point docs from .soly/docs/) — always loaded
	let intentDocs: IntentDoc[] = [];
	let lastIntentSection = "";

	// ============================================================================
	// Loaders
	// ============================================================================

	const refreshRules = () => {
		const result = loadAllRules(ruleSources);
		alwaysOnRules = result.rules;
		overriddenRulePaths = result.overridden;
		// Also refresh phase rules — they may have changed
		reloadPhaseRules();
	};

	const refreshState = () => {
		if (!state.solyDir) return;
		state = loadProjectState(state.solyDir);
	};

	const refreshIntent = () => {
		intentDocs = loadIntentDocs(sessionCwd, state.currentPhase?.number);
		const { section } = buildIntentSection(intentDocs);
		lastIntentSection = section;
	};

	// ============================================================================
	// Phase rules + last-session mtime tracking
	// ============================================================================

	/** Always-on rules (no phase) — reloaded by refreshRules + hot reload. */
	let alwaysOnRules: RuleFile[] = [];
	/** Phase-scoped rules for the currently active phase. */
	let phaseRules: RuleFile[] = [];

	/** Combined view consumed by buildRulesSection / status. */
	const combinedRules = (): RuleFile[] => [...alwaysOnRules, ...phaseRules];

	/** Reload phase rules for the current state's currentPhase. */
	const reloadPhaseRules = () => {
		const phase = state.currentPhase;
		if (!phase) {
			phaseRules = [];
			return;
		}
		phaseRules = loadPhaseRules(phase.dir, phase.number);
	};

	/**
	 * Persistent storage of rule mtimes from the previous session, so we can
	 * show a "rules changed since last session" diff at startup.
	 * Stored in <solyDir>/.soly-rule-mtimes.json (project) or
	 * <homedir>/.soly/rule-mtimes.json (global fallback).
	 */
	let lastSessionMtimes: Record<string, number> = {};
	const mtimeStorePath = (): string => {
		const base = state.solyDir && fs.existsSync(state.solyDir)
			? state.solyDir
			: path.join(os.homedir(), ".soly");
		try {
			fs.mkdirSync(base, { recursive: true });
		} catch {}
		return path.join(base, "rule-mtimes.json");
	};
	const captureLastSessionRuleMtimes = () => {
		const filePath = mtimeStorePath();
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			lastSessionMtimes = JSON.parse(raw);
		} catch {
			lastSessionMtimes = {};
		}
	};
	const persistRuleMtimes = () => {
		const mtimes: Record<string, number> = {};
		for (const r of alwaysOnRules) mtimes[`${r.source}::${r.absPath}`] = r.mtimeMs;
		try {
			fs.writeFileSync(mtimeStorePath(), JSON.stringify(mtimes, null, 2));
		} catch {
			// best effort
		}
	};

	// ============================================================================
	// Status
	// ============================================================================

	const updateStatus = (ui: CommandUI | { ui: { setStatus: (id: string, text: string | undefined) => void } }) => {
		const setStatus = (ui as { ui: { setStatus: (id: string, text: string | undefined) => void } }).ui.setStatus;
		const line = buildStatusLine(
			combinedRules().length,
			rulesLoaded.length,
			lastRulesTokens,
			state,
		);
		// Append session stats if non-zero (cheap; one short group)
		const sessionGroup =
			sessionStats.turns > 0
				? `${"\x1b[2m"}session ${sessionStats.turns}t${sessionStats.tokensEstimate > 0 ? ` ${formatTok(sessionStats.tokensEstimate)}` : ""}${"\x1b[0m"}`
				: "";
		// Smart "next:" hint from project state (e.g. "→ next: soly execute 10")
		const hint = buildNextHint(state);
		const hintGroup = hint ? `${"\x1b[2m"}${hint}${"\x1b[0m"}` : "";

		// Agent badge — owned by pi-switch extension (header bar + status line).
		// Soly doesn't render the agent badge itself.
		const agentGroup = "";

		// Cross-extension: show pi-todo progress if either .soly/todos.json
		// (soly-integration mode) OR .pi-todos.json (standalone mode) exists.
		// Cheap (one stat + one small JSON read); cached only for the
		// lifetime of one updateStatus call.
		let todoGroup = "";
		if (state.exists) {
			const todoCandidates = [
				path.join(state.solyDir, "todos.json"),
				path.join(state.solyDir, ".pi-todos.json"),
			];
			for (const todoFile of todoCandidates) {
				try {
					if (!fs.existsSync(todoFile)) continue;
					const raw = fs.readFileSync(todoFile, "utf-8");
					const parsed = JSON.parse(raw) as { todos?: Array<{ status: string; activeForm?: string }> };
					if (!Array.isArray(parsed.todos) || parsed.todos.length === 0) continue;
					const total = parsed.todos.length;
					const done = parsed.todos.filter((t) => t.status === "completed").length;
					const inProgress = parsed.todos.find((t) => t.status === "in_progress");
					if (inProgress?.activeForm) {
						todoGroup = `${"\x1b[2m"}todos ${done}/${total} \u22ef ${inProgress.activeForm}${"\x1b[0m"}`;
					} else {
						todoGroup = `${"\x1b[2m"}todos ${done}/${total}${"\x1b[0m"}`;
					}
					break; // first match wins
				} catch {
					/* corrupt file — silently skip; pi-todo will rewrite on next update */
				}
			}
		}

		const groups = [line, sessionGroup, todoGroup, agentGroup, hintGroup].filter((g) => g.length > 0);
		const fullLine = groups.join("   ");
		if (fullLine !== lastStatusLine) {
			setStatus(STATUS_ID, fullLine || undefined);
			lastStatusLine = fullLine;
		}
	};

	// ============================================================================
	// Register sub-features
	// ============================================================================

	registerCommands(pi, {
		getRules: () => combinedRules(),
		getOverridden: () => overriddenRulePaths,
		refreshRules: () => refreshRules(),
		getState: () => state,
		refreshState: () => refreshState(),
		updateStatus: (ui) => updateStatus(ui),
		getConfig: getActiveConfig,
	});

	registerTools(pi, {
		getState: () => state,
		refreshState: () => refreshState(),
		getConfig: getActiveConfig,
	});

	// ============================================================================
	// Agent switcher: Ctrl+Shift+A cycles through available subagents.
	// (Shift+Tab is taken by pi's thinking-level cycler; Ctrl+Shift+A is unused
	// and mnemonic for "A"gent.)
	// ============================================================================
	// Agent switcher REMOVED — moved to the separate `pi-switch` extension.
	// Soly no longer owns Ctrl+Tab, the footer pill, or /agent slash.
	// The current agent is read by soly workflows from
	// globalThis.__PI_SWITCH_AGENT__ (set by pi-switch), with a fallback
	// to "worker" if pi-switch isn't installed.
	// ============================================================================

	registerWorkflows(pi, {
		getState: () => state,
		getInteractiveRules: () =>
			combinedRules()
				.filter((r) => r.interactiveOnly)
				.map((r) => r.relPath),
		getActiveTools: () => pi.getActiveTools(),
		getConfig: getActiveConfig,
		onWorkflowUsed: resetSolyDrift,
	});

	// ============================================================================
	// Events
	// ============================================================================

	pi.on("session_start", async (event, ctx) => {
		// Rules sources (priority order, higher wins on relPath collision).
		// Project rules always beat global rules. .soly/rules.local/ is
		// gitignored — for personal overrides on top of the project's rules.
		ruleSources = [
			{ dir: path.join(ctx.cwd, ".soly", "rules.local"), source: "project-soly", sourceLabel: "local", priority: 5 },
			{ dir: path.join(ctx.cwd, ".soly", "rules"), source: "project-soly", sourceLabel: "soly", priority: 4 },
			{ dir: path.join(os.homedir(), ".soly", "rules"), source: "global-soly", sourceLabel: "soly", priority: 2 },
		];
		refreshRules();

		// Project state — soly owns .soly/ at the project root
		state.solyDir = solyDirFor(ctx.cwd);
		refreshState();

		// Config: per-project overrides global overrides defaults
		const cfgResult = loadConfig(ctx.cwd);
		activeConfig = cfgResult.config;
		for (const w of cfgResult.warnings) {
			ctx.ui.notify(`soly config: ${w}`, "warning");
		}
		if (cfgResult.sources.global || cfgResult.sources.project) {
			const sources = [
				cfgResult.sources.global ? `global: ${cfgResult.sources.global}` : null,
				cfgResult.sources.project ? `project: ${cfgResult.sources.project}` : null,
			].filter(Boolean).join(", ");
			ctx.ui.notify(`soly config loaded (${sources})`, "info");
		}
		// Auto-prune old iteration files per retention config
		if (state.exists) {
			const r = pruneOldIterations(state.solyDir, activeConfig.iteration.retentionDays);
			if (r.pruned > 0) {
				ctx.ui.notify(
					`soly: pruned ${r.pruned} old iteration file(s) (retention ${activeConfig.iteration.retentionDays}d)`,
					"info",
				);
			}
		}

		// Auto-install soly-manager subagent config to ~/.pi/agent/agents/
		// on first run. Opt-in via config `agent.useSolyWorkerSubagents`
		// (default false). Idempotent — respects any existing user-
		// customized copies.
		if (activeConfig.agent.useSolyWorkerSubagents) {
			const extRoot = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
			const installResult = installSolyAgents(extRoot);
			if (installResult.installed.length > 0) {
				ctx.ui.notify(
					`soly: installed subagent config (${installResult.installed.join(", ")}) — run \`/subagents-doctor\` to verify`,
					"info",
				);
			}
			for (const e of installResult.errors) {
				ctx.ui.notify(`soly: agent install error — ${e}`, "warning");
			}
		}

		// Phase-scoped rules: if a phase is currently active, load its
		// per-phase rules on top of the always-on rule set.
		reloadPhaseRules();

		// Restore agent from .soly/agent (if present) — survives session restart
		if (state.exists) {
			const agentFile = path.join(state.solyDir, "agent");
			try {
				if (fs.existsSync(agentFile)) {
					const raw = fs.readFileSync(agentFile, "utf-8").trim();
					if (raw && /^[a-zA-Z0-9_-]{1,64}$/.test(raw)) {
						(globalThis as { __PI_SWITCH_AGENT__?: string }).__PI_SWITCH_AGENT__ = raw;
					}
				}
			} catch { /* best-effort */ }
		}

		// Capture rule mtimes for the "rules changed since last session" diff
		captureLastSessionRuleMtimes();

		// Reset derived state
		sessionCwd = ctx.cwd;
		rulesLoaded = [];
		lastRulesTokens = 0;
		nudgeActiveForTask = false;
		lastNudgePromptKey = "";
		sessionStats = { turns: 0, tokensEstimate: 0 };

		// Read git context (best-effort, silent on failure)
		gitContext = await readGitContext(ctx.cwd);
		lastGitSection = buildGitSection(gitContext);

		// Detect project env (cheap; ~5 fs reads)
		envSummary = detectEnv(ctx.cwd);
		lastEnvSection = buildEnvSection(envSummary);

		// Build code map (walk cwd once; cap at 2 levels deep)
		try {
			codeMap = buildCodeMap(ctx.cwd);
			lastCodeMapSection = buildCodeMapSection(codeMap);
		} catch {
			codeMap = null;
			lastCodeMapSection = "";
		}

		// Load project intent (zero-point docs from .soly/docs/) — always
		refreshIntent();

		// Start hot-reload watcher on rules dirs
		if (hotReload) hotReload.stop();
		hotReload = startHotReload(ruleSources, {
			onChange: (reason) => {
				refreshRules();
				updateStatus({
					ui: { setStatus: (id, text) => ctx.ui.setStatus(id, text) },
				});
			},
		});
		// Editors save in bursts (write to .tmp, rename, touch). Coalesce
		// those rapid reload events into a single user-visible notify.
		hotReload.setNotifyHandler((reason) => {
			ctx.ui.notify(`soly: rules reloaded (${reason})`, "info");
		});

		// Notifications (one-shot at startup)
		if (alwaysOnRules.length > 0) {
			const bySource = alwaysOnRules.reduce<Record<string, number>>((acc, r) => {
				acc[r.sourceLabel] = (acc[r.sourceLabel] ?? 0) + 1;
				return acc;
			}, {});
			const breakdown = Object.entries(bySource)
				.map(([k, v]) => `${v} ${k}`)
				.join(" + ");
			let summary = `soly rules: ${alwaysOnRules.length} (${breakdown})`;
			if (phaseRules.length > 0) {
				summary += ` + ${phaseRules.length} phase-${state.currentPhase?.number}`;
			}
			ctx.ui.notify(summary, "info");

			if (overriddenRulePaths.length > 0) {
				ctx.ui.notify(
					`soly: ${overriddenRulePaths.length} rule(s) overridden by project (${overriddenRulePaths.join(", ")})`,
					"info",
				);
			}

			// Rules diff vs last session
			const currentMtimes: Record<string, number> = {};
			for (const r of alwaysOnRules) currentMtimes[`${r.source}::${r.absPath}`] = r.mtimeMs;
			const lastKeys = new Set(Object.keys(lastSessionMtimes));
			const currentKeys = new Set(Object.keys(currentMtimes));
			const added = [...currentKeys].filter((k) => !lastKeys.has(k));
			const removed = [...lastKeys].filter((k) => !currentKeys.has(k));
			const changed: string[] = [];
			for (const k of currentKeys) {
				if (lastKeys.has(k) && lastSessionMtimes[k] !== currentMtimes[k]) {
					changed.push(k);
				}
			}
			if (added.length || removed.length || changed.length) {
				const parts: string[] = [];
				if (added.length) parts.push(`+${added.length}`);
				if (removed.length) parts.push(`-${removed.length}`);
				if (changed.length) parts.push(`~${changed.length}`);
				ctx.ui.notify(`soly: rules changed since last session (${parts.join(" ")})`, "info");
			}

			// Rule budget analytics
			const analytics = analyzeRules(alwaysOnRules, CONTEXT_WINDOW_TOKENS);
			if (analytics.contextBudgetPct > 5) {
				ctx.ui.notify(
					`soly: rules use ${analytics.contextBudgetPct.toFixed(1)}% of context window (${formatTok(analytics.totalTokens)} across ${analytics.fileCount} files)`,
					"info",
				);
			}
		} else {
			ctx.ui.notify("soly rules: none found in .soly/rules.local, .soly/rules, or ~/.soly/rules", "info");
		}

		if (state.exists) {
			ctx.ui.notify(`soly state: ${state.milestone} (${state.phases.length} phases)`, "info");
		}

		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		// Stop hot-reload watcher — fs.watch handles hold OS resources
		if (hotReload) {
			hotReload.stop();
			hotReload = null;
		}
		// Persist rule mtimes so the next session can show the diff
		persistRuleMtimes();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const sections: string[] = [];
		let totalRulesTokens = 0;

		// pi's own resource paths (AGENTS.md / CLAUDE.md it already loaded)
		// — used to inform rule globs, not to dedup context (soly doesn't
		// load context files).
		const piPaths = (event.systemPromptOptions.contextFiles ?? []).map((c) => c.path);

		// 1. Rules section
		const allRules = combinedRules();
		if (allRules.length > 0) {
			const promptFiles = extractFilePathsFromPrompt(event.prompt);
			const activeGlobs = [...new Set([...promptFiles, ...piPaths])];

			const hasPhase = phaseRules.length > 0;
			const { section, loaded } = buildRulesSection(allRules, activeGlobs, {
				phaseNumber: state.currentPhase?.number,
				groupByPhase: hasPhase,
			});
			rulesLoaded = loaded;
			if (section) {
				sections.push(section);
				totalRulesTokens = Math.ceil(section.length / 4);
			}
		} else {
			rulesLoaded = [];
		}
		lastRulesTokens = totalRulesTokens;

		// 2. Project state section
		if (state.exists) {
			const section = buildProjectStateSection(state);
			if (section) sections.push(section);
		}

		// 2.5. Cross-extension integrations: dynamically mention only the
		// sibling pi-extensions that are actually loaded. Driven by
		// `integrations.ts` registry — add new entries there.
		const integrationSection = buildIntegrationsSection(pi.getActiveTools());
		if (integrationSection) {
			sections.push(integrationSection);
		}

		// 3.5. Project intent (zero-point docs) — always injected when present
		if (lastIntentSection) {
			sections.push(lastIntentSection);
		}

		// 3.6. Inline intent bodies (opt-in via frontmatter `inline: true`)
		const inlineBodies = loadInlineIntentBodies(intentDocs);
		for (const ib of inlineBodies) {
			sections.push(`\n### intent: ${ib.relPath}\n\n${ib.body}`);
		}

		// 4. Git context section (always injected when available — cheap, high signal)
		if (lastGitSection) {
			sections.push(lastGitSection);
		}

		// 5. Project env section (cheap; high signal for tool/script choice)
		if (lastEnvSection) {
			sections.push(lastEnvSection);
		}

		// 6. Project layout (code map) — always injected when available
		if (lastCodeMapSection) {
			sections.push(lastCodeMapSection);
		}

		// 7. Behavioral nudge
		const heuristics = classifyTaskHeuristics(event.prompt);
		sections.push(buildNudgeSection(heuristics));

		// 7.5 Soly drift reminder — injected when the user has been doing
		// non-soly work for several turns. Throttled: at most once per
		// REMINDER_THRESHOLD turns. Resets when a soly verb is parsed.
		if (
			solyDrift.turnsSinceLastSolyVerb >= solyDrift.REMINDER_THRESHOLD &&
			solyDrift.turnsSinceLastSolyVerb - solyDrift.lastReminderAt >= solyDrift.REMINDER_THRESHOLD
		) {
			const reminder = buildDriftReminder(solyDrift.turnsSinceLastSolyVerb);
			if (reminder) {
				sections.push(`\n## soly drift\n\n${reminder}\n`);
				solyDrift.lastReminderAt = solyDrift.turnsSinceLastSolyVerb;
			}
		}
		if (heuristics.nonTrivial || heuristics.researchHeavy) {
			nudgeActiveForTask = true;
			lastNudgePromptKey = event.prompt.slice(0, 200);
		}

		// 7. Update status bar
		updateStatus(ctx);

		if (sections.length === 0) return;
		return {
			systemPrompt: event.systemPrompt + sections.join("\n"),
		};
	});

	pi.on("input", async (event, ctx) => {
		// Nudge notify — runs BEFORE workflows/* (which may transform).
		// Soft UI hint, never blocks the input.
		if (event.source !== "interactive") return;
		const text = event.text.trim();
		if (!text || text.startsWith("/")) return;
		if (text.startsWith("soly ")) return; // workflow verb — let workflows handle it
		if (text.slice(0, 200) === lastNudgePromptKey && nudgeActiveForTask) return;

		const heuristics = classifyTaskHeuristics(text);
		if (!heuristics.nonTrivial && !heuristics.researchHeavy) return;

		const angle =
			heuristics.suggestedAngles[0] ?? "want me to confirm assumptions before I start?";

		const label = heuristics.researchHeavy
			? "soly: research-heavy prompt — clarifying question?"
			: "soly: non-trivial prompt — clarifying question?";

		ctx.ui.notify(`${label} ${angle}`, "info");
		nudgeActiveForTask = true;
		lastNudgePromptKey = text.slice(0, 200);

		// Drift counter — non-soly, non-slash, non-trivial prompt.
		// Workflow verbs reset this via onWorkflowUsed callback.
		solyDrift.turnsSinceLastSolyVerb += 1;
	});

	pi.on("turn_end", async (_event, ctx) => {
		const beforeRules = rules.map((r) => `${r.source}:${r.relPath}:${r.mtimeMs}`).join(",");
		const beforeStateUpdated = state.lastUpdated;

		refreshRules();
		refreshState();

		const afterRules = rules.map((r) => `${r.source}:${r.relPath}:${r.mtimeMs}`).join(",");
		const rulesChanged = beforeRules !== afterRules;
		const stateChanged = beforeStateUpdated !== state.lastUpdated;

		// Update session stats — count assistant turns + rough token estimate
		const entries = ctx.sessionManager.getBranch();
		let turns = 0;
		let tokens = 0;
		for (const entry of entries) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				turns++;
			}
		}
		const usage = ctx.getContextUsage();
		if (usage) tokens = usage.tokens ?? 0;
		sessionStats = { turns, tokensEstimate: tokens };

		// Refresh git context (cheap; debounced naturally by turn cadence)
		if (sessionCwd) {
			const newGit = await readGitContext(sessionCwd);
			if (
				newGit.branch !== gitContext.branch ||
				newGit.statusShort !== gitContext.statusShort
			) {
				gitContext = newGit;
				lastGitSection = buildGitSection(gitContext);
			}
		}

		// Refresh intent (zero-point docs) — cheap, but skip if last was recent
		const beforeIntentCount = intentDocs.length;
		refreshIntent();
		if (intentDocs.length !== beforeIntentCount) {
			// re-render status (intentionally don't push a section — system
			// prompt regenerates next turn)
		}

		if (rulesChanged || stateChanged) {
			updateStatus(ctx);
		}
	});

	// Mount built-in sub-features
	piAskExtension(pi);
	piSwitchExtension(pi);
}
