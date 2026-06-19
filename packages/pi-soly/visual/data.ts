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
	};
}
