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

\`ask_pro\` is a multi-question picker (tabbed, ⭐ recommended). Use it for 1–6 related questions where the user picks concrete answers to move forward (e.g. \`soly discuss\` scoping). NOT for simple yes/no, a single open-ended prompt, questions already answered, or trivial clarifications — use plain text there.

- Per-option \`preview\` shows a side panel while focused — put a code/API/config snippet there so the user compares options without follow-ups (fenced \`\`\`code is highlighted).
- \`freeText\` (no options) = optional typed answer; \`allowOther\` = escape hatch when options aren't exhaustive; \`minSelect\`/\`maxSelect\` bound multi-select. The user can skip a question (returned \`(skipped)\`) or attach a note (returned \`// note: "…"\` — treat as a hard constraint).
`;
}
