// =============================================================================
// tool-hints.ts — per-turn affordance hints for soly's interactive tools
// =============================================================================
//
// Scans the user's prompt for trigger words (bilingual RU/EN) and, when matched,
// returns a small system-prompt section nudging the LLM to consider the right
// interactive tool: html_artifact (examples / visual output), decision_deck
// (comparing options), or ask_pro (clarifying questions).
//
// Soft + dynamic: the hint is only injected on turns that actually mention these
// things (zero token cost otherwise) and explicitly says "only if it helps", so
// it steers without forcing. Pure: prompt string in, hint string out.
// =============================================================================

export type ToolHint = { artifact: boolean; deck: boolean; ask: boolean };

// Trigger words. Stems chosen to catch RU inflections (вариант/варианты/…) and
// common EN forms. Kept narrow enough to avoid firing on every prompt.
const TRIGGERS = {
	artifact: [
		/пример/i, /образец/i, /галере/i, /шпаргалк/i, /таблиц/i, /диаграмм/i,
		/визуализ/i, /макет/i, /дашборд/i,
		/\bexamples?\b/i, /\bsamples?\b/i, /\bdemo\b/i, /\bgallery\b/i,
		/cheat\s*sheet/i, /\btables?\b/i, /\bdiagram/i, /\bvisuali[sz]/i,
		/\bmock\s?up/i, /\bdashboard\b/i,
	],
	deck: [
		/вариант/i, /сравн/i, /альтернатив/i, /\bлибо\b/i, /какой подход/i,
		/что лучше/i, /выбрать (?:между|из)/i,
		/\boptions?\b/i, /\bcompare\b/i, /\bcomparison\b/i, /\bvs\.?\b/i,
		/\btrade-?offs?\b/i, /which approach/i, /\bpros and cons\b/i,
	],
	ask: [
		/уточн/i, /несколько вопрос/i, /опросник/i,
		/\bclarif/i, /\ba few questions\b/i,
	],
};

/** Which interactive tools the prompt's wording hints at. */
export function detectToolHints(prompt: string): ToolHint {
	const has = (res: RegExp[]): boolean => res.some((r) => r.test(prompt));
	return {
		artifact: has(TRIGGERS.artifact),
		deck: has(TRIGGERS.deck),
		ask: has(TRIGGERS.ask),
	};
}

/** Build the affordance section, or null when nothing matched. */
export function buildToolHintSection(h: ToolHint): string | null {
	const bits: string[] = [];
	if (h.deck)
		bits.push("- Weighing options/alternatives → consider `decision_deck` (full-screen cards with each option's code + pros/cons).");
	if (h.artifact)
		bits.push("- Examples / a table / a visual result → consider `html_artifact` (a rendered page in the session gallery).");
	if (h.ask)
		bits.push("- Several things to clarify → consider `ask_pro` (one batched picker).");
	if (bits.length === 0) return null;
	return `\n## soly — tool affordances for this turn\n\n${bits.join("\n")}\n(Only if it genuinely helps — otherwise answer normally.)`;
}
