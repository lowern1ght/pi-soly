// =============================================================================
// tests/tool-hints.test.ts — per-turn interactive-tool affordance hints
// =============================================================================

import { describe, expect, test } from "bun:test";
import { detectToolHints, buildToolHintSection } from "../tool-hints.ts";

describe("detectToolHints", () => {
	test("examples / visual words → artifact", () => {
		expect(detectToolHints("покажи примеры использования").artifact).toBe(true);
		expect(detectToolHints("make a cheat sheet table").artifact).toBe(true);
		expect(detectToolHints("собери галерею компонентов").artifact).toBe(true);
		expect(detectToolHints("just fix the bug").artifact).toBe(false);
	});

	test("options / compare words → deck", () => {
		expect(detectToolHints("какие есть варианты архитектуры?").deck).toBe(true);
		expect(detectToolHints("сравни Redis vs Postgres").deck).toBe(true);
		expect(detectToolHints("compare the options").deck).toBe(true);
		expect(detectToolHints("rename this function").deck).toBe(false);
	});

	test("clarify words → ask", () => {
		expect(detectToolHints("уточни детали перед началом").ask).toBe(true);
		expect(detectToolHints("a few questions first").ask).toBe(true);
		expect(detectToolHints("write the test").ask).toBe(false);
	});
});

describe("buildToolHintSection", () => {
	test("null when nothing matched", () => {
		expect(buildToolHintSection({ artifact: false, deck: false, ask: false })).toBeNull();
	});

	test("artifact branch still asks browser-vs-text (heavy vs light output)", () => {
		const s = buildToolHintSection({ artifact: true, deck: false, ask: false });
		expect(s).toContain("html_artifact");
		expect(s?.toLowerCase()).toContain("ask the user first");
		expect(s?.toLowerCase()).toContain("as text");
		expect(s).not.toContain("decision_deck");
		expect(s).not.toContain("ask_pro");
	});

	test("deck branch contrasts deck vs ask_pro so LLM doesn't reach for deck for multi-question", () => {
		const s = buildToolHintSection({ artifact: false, deck: true, ask: false });
		expect(s).toContain("decision_deck");
		// ask_pro MUST appear here even when ask=false — it's the contrast that
		// disambiguates single-question code/trade-off (deck) from simple choice
		// or multi-question (ask_pro).
		expect(s).toContain("ask_pro");
		expect(s?.toLowerCase()).toContain("default to");
		// Hard rule: never use decision_deck for 2+ questions.
		expect(s?.toLowerCase()).toContain("never use `decision_deck` for 2+ questions");
	});

	test("ask branch names deck as the wrong tool so LLM doesn't use it for multi-question", () => {
		const s = buildToolHintSection({ artifact: false, deck: false, ask: true });
		expect(s).toContain("ask_pro");
		expect(s).toContain("decision_deck");
		expect(s?.toLowerCase()).toContain("does not support multi-question");
	});
});
