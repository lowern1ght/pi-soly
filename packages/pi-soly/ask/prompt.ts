// =============================================================================
// prompt.ts — System-prompt section for the pi-ask extension
// =============================================================================
//
// Injected into the agent's system prompt via `before_agent_start` so the
// LLM knows `ask_pro` is available, when to use it, and when NOT to
// (anti-patterns matter more than use-cases here — the tool is easy to
// overuse for trivial questions).
//
// Kept short (~600 chars) so it doesn't bloat every turn's prompt. The
// tool's own `description` and parameter schema still carry the detailed
// contract; this section is the "when to reach for it" trigger.
// =============================================================================

/** Build the "when to use ask_pro" section. Pure function, easily testable. */
export function buildAskProSection(): string {
	return `

## pi-ask — when to use \`ask_pro\`

\`ask_pro\` is a multi-question picker (tabbed, numbered, ⭐ recommended). Use it when:
- You need a focused choice between 2–4 options and a free-text question would be slower
- You have 2–6 related questions to ask in one batch (e.g. \`soly discuss\` scoping flow)
- The user must pick a single concrete answer to move forward

DON'T use it for:
- Simple yes/no — just ask in text
- A purely open-ended prompt with no structured choices alongside it — plain text is fine (but a \`freeText\` question is good for mixing typed input into a batch of choices)
- More than 6 questions — tab-switching fatigue
- When the user already gave a clear answer — don't second-guess
- Trivial clarifications — use plain text first, escalate to \`ask_pro\` only if the answer matters

Keyboard in the picker: \`↑↓\` navigate, \`1-N\` instant-pick, \`Tab\` next question, \`Space\` toggle (multi-select only), \`Enter\` confirm/advance/submit, \`n\` add a free-text note, \`s\` skip the current question, \`Esc\` cancel.

Schema reminder: \`questions: [{ header, question, options: [{label, description?, recommended?, preview?}], multiSelect?, allowOther?, minSelect?, maxSelect?, freeText? }]\`. Mark exactly one option \`recommended: true\` per question when you have a default. Set \`allowOther: true\` when the listed options may not be exhaustive. For multi-select, \`minSelect\`/\`maxSelect\` bound how many can be chosen (e.g. "pick 2–3"). Set \`freeText: true\` (with empty \`options\`) for an open-ended typed answer — it's optional, so don't rely on it for required input. Any question can be skipped by the user (returned as \`(skipped)\`).

**Option previews:** \`option.preview\` (markdown/plain string) shows in a side panel next to the option list while that option is focused. Use it when the question is about a code structure, API shape, or concrete example — show a small snippet of what each option entails so the user can decide without asking follow-ups. Example: when asking "how should we model auth?", each option's preview can show the relevant type signature.

**Notes:** the user can press \`n\` after picking an answer to attach a free-text note (edge cases, constraints, reasoning). The note is returned to you as \`// note: \"...\"\` next to the chosen answer. Treat it as a hard constraint.
`;
}
