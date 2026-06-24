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
	if (h.artifact)
		bits.push("- Examples / a table / a visual result: **ask the user first** — render it in the browser as an artifact (`html_artifact`), or just as text here? Then proceed accordingly.");
	if (h.deck)
		bits.push("- Comparing 2-6 options: if it's ONE question and each option needs code + pros/cons on its own card → use `decision_deck`. If it's 2+ related questions in one batch → use `ask_pro`. **Default to `ask_pro` unless you have explicit code or trade-offs per option.** Never use `decision_deck` for 2+ questions.");
	if (h.ask)
		bits.push("- Several things to clarify → use `ask_pro` (one batched picker). `decision_deck` does NOT support multi-question — never reach for it here.");
	if (bits.length === 0) return null;
	return `\n## soly — interactive output for this turn\n\n${bits.join(
		"\n",
	)}\nAsk once and briefly (a one-line question is fine). If the content is tiny or the format is obvious, just answer in text.`;
}
