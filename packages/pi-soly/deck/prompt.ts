// =============================================================================
// prompt.ts — System-prompt section for the pi-deck extension
// =============================================================================
//
// Injected via before_agent_start so the LLM knows decision_deck exists and,
// crucially, when to reach for it over ask_pro (the trap is overusing a heavy
// card deck for a choice that a one-line option list would handle fine).
// =============================================================================

/** Build the "when to use decision_deck" section. Pure, testable. */
export function buildDeckSection(): string {
	return `

## pi-deck — when to use \`decision_deck\`

\`decision_deck\` shows one decision as a full-screen deck of cards (←/→ flip, 1-N jump, Enter choose). Each card has a title, summary, an optional **syntax-highlighted code snippet**, and pros/cons. Reach for it when:
- The choice hinges on seeing the **concrete code/structure** of each option (API shape, schema, control flow), not just a label
- There are 2–6 substantive alternatives worth a side-by-side comparison
- A design/architecture fork where trade-offs matter (e.g. "event bus vs direct calls vs queue")

Prefer \`ask_pro\` instead when: the options are short labels, you have several unrelated questions to batch, or no code/structure needs showing. Don't use \`decision_deck\` for trivial or yes/no choices.

Schema: \`{ title?, prompt?, options: [{ title, summary?, code?, lang?, pros?, cons?, recommended? }] }\`. Pass \`code\` as raw source (no \`\`\` fences) with a \`lang\` so it highlights. Mark exactly one option \`recommended: true\` when you have a lead. The result tells you which option the user chose.`;
}
