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

export function buildNudgeSection(
	heuristics: TaskHeuristics,
	opts: { hasProject?: boolean; confirmBeforeCode?: boolean } = {},
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
			? `\n\n4. **Route project work through the soly workflow.** For phase/task work in \`.soly/\`, prefer the lifecycle over ad-hoc edits: \`soly discuss <N>\` (scope) → \`soly plan <N>\` (write tasks) → \`soly execute <N>\` (do them) → \`soly verify\` (review). Run \`soly status\` to see where you are. Skip only for a genuine one-off.`
			: "";

	// Confirm-before-coding gate: for non-trivial implementation, don't start
	// editing files until the user has greenlit the approach.
	const confirmBlock =
		opts.confirmBeforeCode && heuristics.nonTrivial
			? `\n\n   **Confirm before coding.** Don't jump straight into writing/editing code. First state your understanding and intended approach in 1–3 sentences, list anything still open or worth deciding, then explicitly ask the user whether to proceed — e.g. "ready for me to implement this, or is there more to discuss/plan first?" Wait for a go-ahead before touching files. Skip only for trivial fixes, or when the user already said to proceed ("just do it", "go", "yes").`
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
