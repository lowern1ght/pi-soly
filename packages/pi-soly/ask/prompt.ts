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
- Open-ended questions ("what do you want?") — free text is better
- More than 6 questions — tab-switching fatigue
- When the user already gave a clear answer — don't second-guess
- Trivial clarifications — use plain text first, escalate to \`ask_pro\` only if the answer matters

Keyboard in the picker: \`↑↓\` navigate, \`1-N\` instant-pick, \`Tab\` next question, \`Space\` toggle (multi-select only), \`Enter\` confirm/advance/submit, \`Esc\` cancel.

Schema reminder: \`questions: [{ header, question, options: [{label, description?, recommended?}], multiSelect? }]\`. Mark exactly one option \`recommended: true\` per question when you have a default.
`;
}
