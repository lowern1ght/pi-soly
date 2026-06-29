// =============================================================================
// nudge.ts — Behavioral nudge for the soly extension
// =============================================================================
//
// Goal: gently push the agent toward "ask before acting on non-trivial
// tasks" and "use background subagents with fresh context for research".
//
// Implementation is prompt-only (no UI blocking) — the model reads the nudge
// in its system prompt and follows it. Heuristics on the user prompt tell the
// model WHY this prompt triggers the nudge, so it can decide whether to ask
// one short clarifying question or just go.
//
// The input event also surfaces a soft UI notify to the human, so they know
// the model was told to pause and ask — but it never blocks input.
// =============================================================================

// Words that suggest the user is asking for non-trivial changes.
const NON_TRIVIAL_VERBS =
	/\b(add|create|build|implement|refactor|migrate|rewrite|redesign|port|convert|integrate|introduce|extract|split|merge|restructure|optimize|generate|scaffold|set up|wire up)\b/i;

// Words that suggest the user is asking the model to go look something up.
const RESEARCH_VERBS =
	/\b(find out|look up|check|verify|investigate|research|figure out|figure out how|discover|why does|how does|what is the best|compare|which library|which approach|benchmark|audit|review|trace|debug why)\b/i;

const URL_PATTERN = /https?:\/\/\S+/;
// Library/version-ish reference (e.g. v1.2.3, @scope/pkg).
// NB: no leading `\b` — `@` is a non-word char so `\b` won't match before it.
// We use a negative lookbehind on word chars instead.
const VERSION_PATTERN = /(?<!\w)(v?\d+\.\d+(?:\.\d+)?|@[\w\-]+\/[\w\-]+)(?!\w)/;

export interface TaskHeuristics {
	nonTrivial: boolean;
	researchHeavy: boolean;
	mentions: string[];
	suggestedAngles: string[];
}

export function classifyTaskHeuristics(prompt: string): TaskHeuristics {
	const trimmed = prompt.trim();
	const long = trimmed.length > 80;
	const hasVerb = NON_TRIVIAL_VERBS.test(trimmed);
	const hasResearch = RESEARCH_VERBS.test(trimmed);
	const hasUrl = URL_PATTERN.test(trimmed);
	const hasVersion = VERSION_PATTERN.test(trimmed);

	// Extract file-ish mentions from the prompt. We don't import core's
	// extractFilePathsFromPrompt to keep nudge.ts self-contained.
	const fileLike =
		trimmed.match(/(?:\.{0,2}\/)?(?:[A-Za-z0-9_\-]+\/)+[A-Za-z0-9_\-.]+\.[A-Za-z0-9]{1,5}/g) ||
		trimmed.match(/[A-Za-z0-9_\-.]+\.[a-z]{1,5}/g) ||
		[];
	const mentions: string[] = [];
	if (fileLike.length >= 2) mentions.push(`${fileLike.length} file references`);
	if (hasUrl) mentions.push("external URL");
	if (hasVersion) mentions.push("version/library ref");

	// nonTrivial = enough complexity that assumptions matter
	const nonTrivial =
		long || hasVerb || fileLike.length >= 2 || mentions.length > 0;

	// researchHeavy = model can't answer from rules/code alone
	const researchHeavy = hasResearch || hasUrl || hasVersion;

	// Suggested clarification angles — only what the heuristic actually
	// detected, no over-eager prompting.
	const suggestedAngles: string[] = [];
	if (fileLike.length >= 2) {
		suggestedAngles.push("which files are in scope vs out of scope?");
	}
	if (hasVerb && !hasUrl && !hasVersion) {
		suggestedAngles.push("what does \"done\" look like for this task?");
	}
	if (researchHeavy) {
		suggestedAngles.push(
			"is there a specific source/result you trust, or should I dig?",
		);
	}
	if (mentions.length === 0 && nonTrivial) {
		suggestedAngles.push("any constraints (deadline, scope, style) I should know?");
	}

	return { nonTrivial, researchHeavy, mentions, suggestedAngles };
}

// ---------------------------------------------------------------------------
// Confirm-before-coding gate
// ---------------------------------------------------------------------------

/** How hard soly pushes the LLM to clarify before writing code.
 *   - "scope" — batch the substantive decisions (placement, pattern, scope,
 *               interface) via ask_pro, then wait. Strongest.
 *   - "ask"   — lighter: one "ready to implement, or discuss?" question.
 *   - "off"   — no gate. */
export type ConfirmLevel = "off" | "ask" | "scope";

/** Normalize the config value (boolean back-compat) to a confirm level.
 *  `true` → "scope" (strongest), `false` / absent → "off". */
export function confirmLevelOf(v: boolean | ConfirmLevel | undefined): ConfirmLevel {
	if (v === true) return "scope";
	if (v === "ask" || v === "scope") return v;
	return "off";
}

// "scope": pull the decisions only the user can make BEFORE coding, as one
// batched ask_pro call — placement, pattern, scope, interface — instead of
// guessing and editing files on assumptions.
const SCOPE_DIRECTIVE = `**Scope it with me before you code.** For non-trivial work, do NOT start writing or editing files on assumptions about decisions only I can make. First surface them as a single \`ask_pro\` batch (2–5 questions in one call), covering the dimensions that actually matter for this task — typically:
   - **Placement** — where should this live? (which file / module / layer; extend an existing unit or add a new one)
   - **Architecture / pattern** — which approach? (follow an existing pattern in the codebase vs introduce a new one; reuse a dependency vs hand-roll)
   - **Scope** — what's in vs out for this change? (defer adjacent work to its own task)
   - **Interface** — the shape callers see (API / CLI / signature / return), when it's a genuine fork
   - **Data / state** — schema, storage, or state-shape decisions, when relevant
   Give each question 2–4 concrete options with a ⭐ recommended default + one-line rationale, and add \`allowOther\` so I can steer freely. Wait for my answers before touching files. Skip only for trivial fixes (typo / rename / one-liner) or when I've already decided ("just do it", "go", or a follow-up turn in an already-scoped task). Prefer 2–3 sharp questions over a long list — ask what changes the result, not ceremony.`;

// "ask": lighter — a single "ready, or discuss first?" confirmation.
const ASK_DIRECTIVE = `**Confirm before coding.** Don't jump straight into writing/editing code. First state your understanding and intended approach in 1–3 sentences and list anything still open, then ask via the \`ask_pro\` picker whether to proceed — one question with options like "Go — implement now", "Discuss / refine the approach", "Adjust scope first" (add an \`allowOther\` for a free-text steer). Wait for the choice before touching files. Skip only for trivial fixes, or when the user already said to proceed ("just do it", "go", "yes").`;

export function buildNudgeSection(
	heuristics: TaskHeuristics,
	opts: { hasProject?: boolean; confirmBeforeCode?: boolean | ConfirmLevel } = {},
): string {
	// Always-on rules (cheap to add, high signal):
	//   - Don't dive in on non-trivial tasks without a brief check
	//   - Prefer background subagents for research
	// Conditional guidance based on what the prompt actually looks like.
	const triggers: string[] = [];
	if (heuristics.nonTrivial) {
		triggers.push("non-trivial task (long prompt / action verb / multiple files)");
	}
	if (heuristics.researchHeavy) {
		triggers.push("research-heavy (web lookup / library decision / unknown behavior)");
	}

	const triggerLine = triggers.length
		? `Heuristics for this prompt: ${triggers.join("; ")}.`
		: "Heuristics for this prompt: looks routine.";

	const anglesBlock = heuristics.suggestedAngles.length
		? `\n\nPossible clarifying questions (pick at most 1–2 that actually unblock you, or skip if you can answer from the prompt):\n${heuristics.suggestedAngles
				.map((a, i) => `  ${i + 1}. ${a}`)
				.join("\n")}`
		: "";

	// When there's an active soly project and the task is non-trivial, steer the
	// model toward the workflow lifecycle instead of ad-hoc edits.
	const workflowPoint =
		opts.hasProject && heuristics.nonTrivial
			? `\n\n4. **Route project work through the soly workflow.** For phase/task work in \`.agents/\`, prefer the lifecycle over ad-hoc edits: \`soly discuss <N>\` (scope) → \`soly plan <N>\` (write tasks) → \`soly execute <N>\` (do them) → \`soly verify\` (review). Run \`soly status\` to see where you are. Skip only for a genuine one-off.`
			: "";

	// Confirm-before-coding gate: for non-trivial implementation, pull the
	// open decisions out of the user before editing files. Strength is config-
	// driven ("scope" = batch the substantive questions; "ask" = one go/discuss).
	const confirmLevel = confirmLevelOf(opts.confirmBeforeCode);
	const confirmBlock =
		confirmLevel !== "off" && heuristics.nonTrivial
			? `\n\n   ${confirmLevel === "scope" ? SCOPE_DIRECTIVE : ASK_DIRECTIVE}`
			: "";

	return `

## soly behavioral nudge (always on)

The following are user-set defaults, not project rules. They tell you how the user wants you to behave in this session.

1. **Pre-action gate.** Before starting non-trivial work, take a 10-second pause and decide: do I have enough to act, or should I ask? If the prompt has ambiguity, missing scope, or a hidden assumption, surface one short clarifying question (or a small set of multi-choice options) instead of starting to code. Skip the gate for trivial fixes ("rename X", "add log line", "fix typo") and for follow-up turns in an already-clarified task.${confirmBlock}
   ${triggerLine}${anglesBlock}

2. **Background subagents by default.** When you need to read unfamiliar code, scout a directory, gather external evidence, or run a multi-step review, prefer \`subagent(...)\` with \`async: true\` and \`context: "fresh"\` over doing it inline. Reserve your own context for the actual decision the user is paying you to make. If the work needs the parent conversation history, use \`context: "fork"\` instead. Do not silently block on long runs — launch async and continue with independent work.

3. **Subagent tool ergonomics.** When delegating: give the child a concrete role, scope, success criteria, hard constraints, and expected output. Do not pass vague instructions like "implement this" or "look into that". Async is the default; foreground is the explicit opt-out.${workflowPoint}

Treat (1) and (2) as defaults, not laws. The user can always override per-task ("just do it", "ask me everything", "no subagents"). When overriding, briefly acknowledge it.
`;
}
