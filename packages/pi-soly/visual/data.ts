// =============================================================================
// visual/data.ts — shared mutable snapshot read by the chrome components
// =============================================================================
//
// index.ts owns one ChromeData object and mutates its fields on lifecycle
// events (session_start, before_agent_start, turn_end, message_update,
// model_select). The footer/top-bar components read it live at render time
// (the same "read fresh each render" pattern pi's own FooterComponent uses),
// so there is no per-render allocation and no stale closure over `ctx`.
// =============================================================================

/** Live values the chrome renders from. All optional/nullable → segment hidden. */
import type { SolyMode } from "../config-mode.ts";

export type ChromeData = {
	/** Current working directory. */
	cwd: string;
	/** Home dir for `~` substitution (os.homedir()). */
	home: string | undefined;
	/** Active model id (e.g. "claude-opus-4-8"), null if none. */
	modelId: string | null;
	/** Active model provider (e.g. "anthropic"). */
	modelProvider: string | null;
	/** Whether the model supports extended thinking. */
	reasoning: boolean;
	/** Current thinking level, e.g. "high"; null/"off" hides it. */
	thinkingLevel: string | null;
	/** Context usage percent (0–100), or null when unknown (post-compaction). */
	ctxPercent: number | null;
	/** Estimated context tokens, or null when unknown. */
	ctxTokens: number | null;
	/** Cumulative context window size in tokens. */
	contextWindow: number | null;
	/** Dirty file count from soly's git context (footerData only exposes branch). */
	gitDirty: number;
	/** Number of active soly rules (always-on + glob), 0 = no segment. */
	rulesActive: number;
	/** Compact phase label, e.g. "plan 2/5"; null when no active project. */
	phaseLabel: string | null;
	/** Active workflow verb, e.g. "execute"; null when idle. */
	verbLabel: string | null;
	/** html_artifacts created this session (0 = no segment). */
	artifactCount: number;
	/** Most recent non-error soly event (e.g. "reloaded 47 rules"). Rendered
	 *  as a sub-line under the Working indicator; auto-cleared by the next
	 *  agent_start. null = no recent event. */
	recentEvent: string | null;
	/** Level of the recent event (used for glyph/color). */
	recentEventLevel: "info" | "warning" | "error" | null;
	/** Remaining quota percent (0–100) for the active provider, polled in
	 *  the background by quota/poller.ts. null = no adapter / not polled.
	 *  Semantic: **used** (inverted from API's remaining) — grows as you
	 *  spend, matching the MiniMax dashboard. */
	quotaPercent: number | null;
	/** Human-readable reset time label (e.g. "in 20m"), or null. */
	quotaResetsLabel: string | null;
	/** Raw ms until the quota window resets, or null. Used by the footer to
	 *  color the time yellow when < 30 minutes remain. */
	quotaResetsMs: number | null;
	/** Soly mode for the current repo (plans vs phases). Set in session_start
	 *  by the mode resolver. Drives system-prompt section selection and
	 *  command gating. */
	solyMode: SolyMode;
	/** Plans dir for the current mode (resolved at session_start). In plans
	 *  mode this is where new plans live; in phases mode it's the shared
	 *  .agents/phases/ dir. */
	plansDir: string;
};

/** A fresh ChromeData with everything empty/idle. */
export function emptyChromeData(): ChromeData {
	return {
		cwd: "",
		home: undefined,
		modelId: null,
		modelProvider: null,
		reasoning: false,
		thinkingLevel: null,
		ctxPercent: null,
		ctxTokens: null,
		contextWindow: null,
		gitDirty: 0,
		rulesActive: 0,
		phaseLabel: null,
		verbLabel: null,
		artifactCount: 0,
		recentEvent: null,
		recentEventLevel: null,
		quotaPercent: null,
		quotaResetsLabel: null,
		quotaResetsMs: null,
		solyMode: "plans",
		plansDir: ".pi/plans",
	};
}
