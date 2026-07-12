// =============================================================================
// nudge.ts — Behavioral nudge for the soly extension
// =============================================================================
//
// Goal: gently push the agent toward "ask before acting on non-trivial
// tasks", "scout with soly's own read tools", and "route project work through
// the soly workflow — proactively, without making the user memorize verbs".
//
// Implementation is prompt-only (no UI blocking) — the model reads the nudge
// in its system prompt and follows it. Heuristics on the user prompt tell the
// model WHY this prompt triggers the nudge, so it can decide whether to ask
// one short clarifying question or just go.
//
// The input event also surfaces a soft UI notify to the human, so they know
// the model was told to pause and ask — but it never blocks input.
//
// `buildSuggestionSection` is a separate, always-on (when a project exists)
// block that surfaces soly's computed "suggested next step" so the model can
// proactively offer it and call the `soly_workflow` tool on the user's
// confirmation — no external subagent plugin involved.
// =============================================================================

// Words that suggest the user is asking for non-trivial changes.
const NON_TRIVIAL_VERBS =
	/\b(add|create|build|implement|refactor|migrate|rewrite|redesign|port|convert|integrate|introduce|extract|split|merge|restructure|optimize|generate|scaffold|set up|wire up)\b/i;

// Words that suggest the user is asking the model to go look something up.
const RESEARCH_VERBS =
	/\b(find out|look up|check|verify|investigate|research|figure out|figure out how|discover|why does|how does|what is the best|compare|which library|which approach|benchmark|audit|review|trace|debug why)\b/i;

// Complaint patterns — the user is unhappy about code the agent wrote or a
// behavior it exhibits. Triggers the agent-coach skill (proposes a soly rule
// to prevent recurrence). RU + EN, case-insensitive. Word-boundary where
// possible; some RU forms don't use \b well so we anchor on the phrase.
const COMPLAINT_PATTERNS: RegExp[] = [
	// Russian — explicit dissatisfaction
	/меня напрягает/i,
	/мне не нравится/i,
	/не нравится/i,
	/переделай/i,
	/почему опять/i,
	/опять\s+(?:эт[оа]|этот|эта)/i,
	/не делай так/i,
	/убирай?/i,
	/кринж/i,
	/бесит/i,
	/заставь/i,
	/хватит (?:делать|писать|так)/i,
	/опять (?:делаешь|пишешь|создаёшь|создаешь)/i,
	// English
	/redo .*(?:differently|another way|other way)/i,
	/i don't like/i,
	/why (?:does|do) .*(?:keep|always)/i,
	/stop doing/i,
	/don't do that/i,
	/annoying/i,
	/make .* not/i,
];

/** Detect whether the user prompt is a complaint about agent behavior/coding.
 *  Used to inject the agent-coach skill directive so the LLM doesn't skip it. */
export function detectComplaint(prompt: string): boolean {
	return COMPLAINT_PATTERNS.some((rx) => rx.test(prompt));
}

const URL_PATTERN = /https?:\/\/\S+/;
// Library/version-ish reference (e.g. v1.2.3, @scope/pkg).
// NB: no leading `\b` — `@` is a non-word char so `\b` won't match before it.
// We use a negative lookbehind on word chars instead.
const VERSION_PATTERN = /(?<!\w)(v?\d+\.\d+(?:\.\d+)?|@[\w\-]+\/[\w\-]+)(?!\w)/;

export interface TaskHeuristics {
	nonTrivial: boolean;
	researchHeavy: boolean;
	/** True when the prompt reads as a complaint about agent-written code or
	 *  behavior — triggers the agent-coach skill directive. */
	complaint: boolean;
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
	const hasComplaint = detectComplaint(trimmed);

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

	return { nonTrivial, researchHeavy, complaint: hasComplaint, mentions, suggestedAngles };
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
	opts: {
		hasProject?: boolean;
		confirmBeforeCode?: boolean | ConfirmLevel;
		defaultBranchPrefix?: string;
	} = {},
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
	if (heuristics.complaint) {
		triggers.push("user complaint about code/behavior (agent-coach eligible)");
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
	// model toward the workflow lifecycle instead of ad-hoc edits. This block
	// also tells the model it may *itself* scaffold a new plan after asking the
	// user — the user explicitly opted into this in 1.16.0.
	const prefix = opts.defaultBranchPrefix ?? "";
	const branchLine = prefix
		? `Branches look like \`${prefix}/<slug>\` (the project default is **\`"${prefix}"\`**). Plan dir: \`.agents/plans/${prefix}-<slug>/\`.`
		: `Branches look like \`<slug>\` (no project default prefix is set). Plan dir: \`.agents/plans/<slug>/\`.`;
	const workflowPoint =
		opts.hasProject && heuristics.nonTrivial
			? `\n\n4. **Route project work through the soly plan workflow.** Each plan is a git branch with \`.agents/plans/<slug>/PLAN.md\` on it. Two parallel plans don't collide.

   **Read the user's intent and act on it — don't make them memorize verbs.** When the user expresses a workflow intent in plain language — even loosely ("давай план", "let's plan this", "go", "start executing", "wrap it up") — call the \`soly_workflow\` tool with the matching action (\`new\` / \`plan\` / \`discuss\` / \`execute\` / \`done\`) instead of asking them to type a command. You propose the next step, they say what they want, you run it. Everything runs INLINE in this session — there is no external worker or subagent.

   **Branch naming convention for THIS project:** ${branchLine}
   \`soly_workflow({action:"new", target:"<slug>"})\` applies the project prefix automatically. A \`<prefix>/<slug>\` target overrides it (use this when the work isn't a "feature" — e.g. \`fix/login-redirect-bug\`).

   Lifecycle — call \`soly_workflow({action, target})\`, or the user can type the equivalent \`soly <verb>\` text:
      - \`new\`      — scaffold: branch + plan dir + stub PLAN.md + commit
      - \`discuss\`  — interactive discussion of the plan (uses ask_pro)
      - \`plan\`     — flesh out PLAN.md via ask_pro
      - \`execute\`  — execute the plan inline in THIS session
      - \`done\`     — commit + push + open draft PR via gh
      - \`soly verify\`  — self-review loop until clean (type this verb; it's a stateful loop)
      - \`soly status\`  — current position + progress (no LLM round-trip)

   **You may scaffold a new plan yourself** when the user asks for a new piece of work and the scope is clear (or the user just confirmed). Propose the slug AND the full branch name first via ask_pro — offer the default \`${prefix ? prefix + "/" : ""}<slug>\` plus the alternatives \`fix/<slug>\`, \`chore/<slug>\`, or just \`<slug>\` (no prefix). Pick whatever fits the work, then type \`soly new …\` in your next output. Don't ask for trivial one-liners or when the user already said "go". Skip only for a genuine one-off that doesn't deserve a plan branch.

   **STUDY THE REPO before scaffolding or fleshing out a plan.** Before you write or edit any plan, use the available tools to understand the area you're about to touch:
   - \`soly_snippet(path, offset, limit)\` and \`soly_doc_search(query)\` for bounded reads of the relevant files (don't \`read\` the whole tree — that's why these tools exist).
   - The \`## project layout\` section in this system prompt for a directory overview.
   - \`.agents/docs/\` (intent) for *why* the project is the way it is.
   - \`git log --oneline -20\` for recent context (existing patterns, prior decisions).

   What to extract: where similar features live, the naming/file-layout conventions, how errors are handled, how tests are written, and any constraints you missed in the prompt. Surface ambiguities as \`ask_pro\` questions BEFORE writing the plan — a plan that knows "the tests go in __tests__/" beats a plan that picks an arbitrary location and rewrites.

   **Corporate reviewer — gap-hunt the plan before coding.** Even when PLAN.md already exists and looks approved, BEFORE you touch any code (a phase, a task, or an arbitrary edit):
      1. Re-read the entire PLAN.md end-to-end. Read adjacent code (one similar feature) with \`soly_snippet\`.
      2. List concrete gaps the plan doesn't address, in priority order. Examples to look for:
         - **Placement** — which file(s) does the new code live in? If the plan names them, read them; if not, decide and ask.
         - **Naming** — function/class/variable names that match existing conventions? (camelCase vs snake_case, verb vs noun, get/set prefix)
         - **Boundary cases** — empty inputs, large inputs, concurrent access, missing files, malformed data. Did the plan mention any? Will the implementation handle them?
         - **Errors** — what does this code do when X fails? Does the plan say? Does the codebase have an existing error pattern to follow?
         - **Existing instances** — if the pattern already exists in the codebase (e.g. another route, another component, another handler), what happens to them? Migration? Coexistence?
         - **Tests** — does the plan name the test file? The fixture data? The assertion style?
         - **Rollout / risk** — is this safe to merge? Does anything need a feature flag, a config gate, or a deprecation window?
      3. If you find ANY material gap, ask the user via \`ask_pro\` BEFORE writing a single line of code. Phrase each question with a recommended default + 2-3 alternatives. Don't pick for the user.
      4. If the plan is genuinely complete and you find no gaps, say so explicitly ("No gaps found in PLAN.md, proceeding") and proceed.
      5. This is independent of \`confirmBeforeCode\` (\`scope\` / \`ask\` / \`off\`). The reviewer runs even when the user said "go" — it's the last filter, not the first.

   Why this exists: plans that look complete often aren't. Asking 4 sharp questions with defaults saves a 40-minute rebuild when an assumption turns out to be wrong. Don't rush.`
			: "";

	// Confirm-before-coding gate: for non-trivial implementation, pull the
	// open decisions out of the user before editing files. Strength is config-
	// driven ("scope" = batch the substantive questions; "ask" = one go/discuss).
	const confirmLevel = confirmLevelOf(opts.confirmBeforeCode);
	const confirmBlock =
		confirmLevel !== "off" && heuristics.nonTrivial
			? `\n\n   ${confirmLevel === "scope" ? SCOPE_DIRECTIVE : ASK_DIRECTIVE}`
			: "";

	// Complaint directive: when the user is unhappy about code the agent wrote
	// or a behavior it exhibits, inject an explicit order to load the
	// agent-coach skill and follow its workflow. Passive skills (listed in
	// available_skills) are unreliable — the LLM often skips them and jumps
	// into the code. This directive lands in the system prompt right before
	// the turn, so it can't be missed.
	const complaintBlock =
		heuristics.complaint
			? `\n\n5. **⚠️ User complaint detected — use the agent-coach skill.** The user is unhappy about code behavior. DO NOT just fix this instance and move on. First read the **agent-coach** skill file (\`packages/pi-soly/skills/agent-coach/SKILL.md\`) and follow its workflow: analyze the complaint → extract the underlying pattern → check existing rules (dedup) → draft a soly rule (\`.agents/rules/[category]/[name].md\`) → propose via \`ask_pro\` → write only on confirmation. This closes the feedback loop so the mistake doesn't repeat. If a rule already covers it but was ignored, the rule is too vague — propose strengthening it instead of creating a duplicate.`
			: "";

	return `

## soly behavioral nudge (always on)

The following are user-set defaults, not project rules. They tell you how the user wants you to behave in this session.

1. **Pre-action gate.** Before starting non-trivial work, take a 10-second pause and decide: do I have enough to act, or should I ask? If the prompt has ambiguity, missing scope, or a hidden assumption, surface one short clarifying question (or a small set of multi-choice options) instead of starting to code. Skip the gate for trivial fixes ("rename X", "add log line", "fix typo") and for follow-up turns in an already-clarified task.${confirmBlock}
   ${triggerLine}${anglesBlock}

2. **Scout with soly's own read tools.** When you need to read unfamiliar code, map a directory, or gather context, use soly's read tools — \`soly_snippet(path, offset, limit)\`, \`soly_doc_search(query)\`, \`soly_read(...)\` — plus \`grep\` / \`find\`. Prefer bounded snippets over reading whole files. soly does the work INLINE in this session; there is no separate worker or \`subagent(...)\` tool to delegate to (and none is required).

3. **Reach for soly's interaction tools.** For structured questions use \`ask_pro\` (batched, multi-select, ⭐ recommended); for design/architecture forks where the choice hinges on the concrete code shape use \`decision_deck\`; for visual output (galleries, comparisons, diagrams) use \`html_artifact\`. Give each question a concrete recommended default + rationale — don't dump open-ended prompts.${workflowPoint}${complaintBlock}

Treat (1) and (2) as defaults, not laws. The user can always override per-task ("just do it", "ask me everything"). When overriding, briefly acknowledge it.
`;
}

// ---------------------------------------------------------------------------
// Proactive "suggested next step" section (pillar C)
// ---------------------------------------------------------------------------
//
// Always-on when a soly project exists (independent of the non-trivial
// heuristic). soly computes where the user is in the workflow and surfaces the
// single most useful next action so the model can OFFER it — and, on the
// user's confirmation, call the `soly_workflow` tool itself. The user never
// has to remember a verb.

/** Snapshot of where the user is in the plan-branch workflow. Computed by the
 *  caller (it needs git + fs); kept out of the pure section builder so the
 *  builder stays trivially testable. */
export interface WorkflowSituation {
	/** A soly project (`.agents/`) exists in cwd. */
	hasProject: boolean;
	/** Current git branch, or null if not resolvable. */
	branch: string | null;
	/** Branch is a plan branch (not master/main, not detached). */
	onPlanBranch: boolean;
	/** Plan slug derived from the branch (drops any `<prefix>/`). */
	planSlug: string | null;
	/** `.agents/plans/<slug>/PLAN.md` exists on this branch. */
	planExists: boolean;
	/** The PLAN.md is still the scaffold stub (not fleshed out). */
	planIsStub: boolean;
	/** Working tree has uncommitted changes. */
	dirty: boolean;
	/** Task ids that are `status: ready` with all deps satisfied. */
	readyTaskIds: string[];
}

/** Build the "suggested next step" system-prompt section. Pure. Returns "" when
 *  there's no project (nothing to suggest). */
export function buildSuggestionSection(sit: WorkflowSituation): string {
	if (!sit.hasProject) return "";

	// Decide the single best next action + how to invoke it.
	let suggestion: string;
	const slug = sit.planSlug ?? "<slug>";

	if (sit.onPlanBranch && sit.planExists && sit.planIsStub) {
		suggestion = `You're on plan branch \`${sit.branch}\` and its PLAN.md is still a scaffold stub. **Next:** flesh it out — \`soly_workflow({ action: "plan", target: "${slug}" })\` (or discuss first with \`action: "discuss"\`).`;
	} else if (sit.onPlanBranch && sit.planExists && !sit.planIsStub) {
		suggestion = sit.dirty
			? `You're on plan branch \`${sit.branch}\` with a fleshed-out PLAN.md and uncommitted changes. **Next:** finish the work, then \`soly_workflow({ action: "done", target: "${slug}" })\` to commit + push + open the PR.`
			: `You're on plan branch \`${sit.branch}\` with a ready PLAN.md. **Next:** execute it — \`soly_workflow({ action: "execute", target: "${slug}" })\`.`;
	} else if (sit.onPlanBranch && !sit.planExists) {
		suggestion = `You're on plan branch \`${sit.branch}\` but there's no \`.agents/plans/${slug}/PLAN.md\`. **Next:** scaffold it — \`soly_workflow({ action: "new", target: "${slug}" })\`.`;
	} else if (sit.readyTaskIds.length > 0) {
		const ids = sit.readyTaskIds.slice(0, 5).join(", ");
		suggestion = `There ${sit.readyTaskIds.length === 1 ? "is 1 ready task" : `are ${sit.readyTaskIds.length} ready tasks`} (${ids}${sit.readyTaskIds.length > 5 ? ", …" : ""}). **Next:** execute one — \`soly_workflow({ action: "execute", target: "<task-id>" })\` — or start fresh work with \`action: "new"\`.`;
	} else {
		suggestion = `On \`${sit.branch ?? "the current branch"}\`, no plan in flight. **Next:** when the user describes a piece of work, scaffold a plan — \`soly_workflow({ action: "new", target: "<slug>" })\` — instead of editing files ad-hoc.`;
	}

	return `

## soly — suggested next step

${suggestion}

**You propose; the user confirms; you run it.** When the user expresses intent in plain language — even loosely ("давай план", "let's build it", "go", "start", "wrap it up") — call the \`soly_workflow\` tool with the matching action yourself. Do NOT make the user type \`soly <verb>\` (that text form still works, but it's a fallback, not a requirement). Everything runs inline in this session — no external subagent.
`;
}
