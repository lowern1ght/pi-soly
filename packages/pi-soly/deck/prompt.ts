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

\`decision_deck\` shows one design/architecture decision as full-screen cards (each with a highlighted code snippet + pros/cons). Reach for it when the choice hinges on the concrete code/structure of each option, not a label, and there are 2–6 alternatives worth comparing side-by-side. Prefer \`ask_pro\` for short-label choices or batched unrelated questions; don't use it for trivial/yes-no. (Schema is in the tool definition.)`;
}
