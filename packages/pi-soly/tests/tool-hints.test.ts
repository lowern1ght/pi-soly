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

	test("lists only the matched tools", () => {
		const s = buildToolHintSection({ artifact: true, deck: true, ask: false });
		expect(s).toContain("decision_deck");
		expect(s).toContain("html_artifact");
		expect(s).not.toContain("ask_pro");
		expect(s?.toLowerCase()).toContain("only if");
	});
});
