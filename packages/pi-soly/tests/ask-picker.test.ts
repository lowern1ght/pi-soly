// =============================================================================
// tests/ask-picker.test.ts — ask_pro picker (C/D/E/A features)
// =============================================================================
//
// Drives the AskProComponent headlessly via its public handleInput()/render()
// and asserts behavior through the done() result and state accessors:
//   C — multi-select min/max bounds (answered gate + max cap)
//   D — skip a question (s key, skipped reported, omitted from answers)
//   E — fenced code in option previews is syntax-highlighted
//   A — free-text questions (typed answer; blank = optional/skipped)
// =============================================================================

import { describe, expect, test } from "bun:test";
import type { KeybindingsManager } from "@earendil-works/pi-tui";
import {
	AskProComponent,
	type AskProResult,
	type AskQuestion,
	type AskProTheme,
} from "../ask/picker.ts";

// Raw key sequences (mirror picker.ts constants).
const ENTER = "\n";
const TAB = "\t";
const SPACE = " ";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

const theme: AskProTheme = { fg: (_c, t) => t, bold: (t) => t };
// matches() returns false → we drive with raw escape sequences instead.
const keybindings = { matches: () => false } as unknown as KeybindingsManager;

function mk(
	questions: AskQuestion[],
	opts: { highlight?: (code: string, lang?: string) => string[] } = {},
): { c: AskProComponent; result: () => AskProResult | null } {
	let captured: AskProResult | null = null;
	const c = new AskProComponent({
		questions,
		theme,
		keybindings,
		done: (r) => {
			captured = r;
		},
		highlight: opts.highlight,
	});
	return { c, result: () => captured };
}

const opt = (label: string) => ({ label });

describe("ask_pro picker — C: multi-select min/max", () => {
	test("min not met → cannot submit; max caps toggles", () => {
		const { c, result } = mk([
			{
				header: "Pick",
				question: "Choose 2",
				options: [opt("A"), opt("B"), opt("C")],
				multiSelect: true,
				minSelect: 2,
				maxSelect: 2,
			},
		]);

		// One selection: below min → Enter must NOT submit.
		c.handleInput(SPACE); // toggle option 0
		expect(c.getAnswers().get(0)).toEqual([0]);
		c.handleInput(ENTER);
		expect(result()).toBeNull();

		// Second selection reaches min=2.
		c.handleInput(DOWN);
		c.handleInput(SPACE); // toggle option 1
		expect(c.getAnswers().get(0)).toEqual([0, 1]);

		// Third toggle would exceed max=2 → ignored.
		c.handleInput(DOWN);
		c.handleInput(SPACE); // attempt option 2
		expect(c.getAnswers().get(0)).toEqual([0, 1]);

		// Now within bounds → Enter submits.
		c.handleInput(ENTER);
		expect(result()?.answers?.[0]).toEqual([0, 1]);
	});
});

describe("ask_pro picker — D: skip", () => {
	test("s skips a question; reported as skipped, omitted from answers", () => {
		const { c, result } = mk([
			{ header: "Q1", question: "first?", options: [opt("A"), opt("B")] },
			{ header: "Q2", question: "second?", options: [opt("A"), opt("B")] },
		]);

		c.handleInput("s"); // skip Q1 → advances to Q2
		expect(c.getCurrentIndex()).toBe(1);

		c.handleInput("1"); // pick option 0 on Q2 (last) → submit
		const r = result();
		expect(r?.skipped).toEqual([0]);
		expect(r?.answers?.[0]).toBeUndefined();
		expect(r?.answers?.[1]).toBe(0);
	});

	test("s toggles back (un-skip lets you answer)", () => {
		const { c } = mk([
			{ header: "Q1", question: "first?", options: [opt("A"), opt("B")] },
			{ header: "Q2", question: "second?", options: [opt("A"), opt("B")] },
		]);
		c.handleInput("s"); // skip Q1 → now on Q2
		expect(c.getCurrentIndex()).toBe(1);
		c.handleInput("\x1b[D"); // left → back to Q1 (still skipped)
		expect(c.getCurrentIndex()).toBe(0);
		c.handleInput("s"); // un-skip
		c.handleInput("1"); // can answer again
		expect(c.getAnswers().get(0)).toBe(0);
	});
});

describe("ask_pro picker — A: free-text", () => {
	test("typed answer is captured", () => {
		const { c, result } = mk([
			{ header: "Name", question: "Project name?", options: [], freeText: true },
		]);
		for (const ch of "hello") c.handleInput(ch);
		expect(c.getAnswers().get(0)).toBe("hello");
		c.handleInput(ENTER); // last → submit
		expect(result()?.answers?.[0]).toBe("hello");
	});

	test("blank free-text is optional → skipped, not an answer", () => {
		const { c, result } = mk([
			{ header: "Name", question: "Project name?", options: [], freeText: true },
		]);
		c.handleInput(ENTER); // nothing typed → submit
		const r = result();
		expect(r?.answers?.[0]).toBeUndefined();
		expect(r?.skipped).toEqual([0]);
	});

	test("Tab navigates away from a free-text question without typing it", () => {
		const { c } = mk([
			{ header: "Name", question: "name?", options: [], freeText: true },
			{ header: "Q2", question: "pick?", options: [opt("A"), opt("B")] },
		]);
		c.handleInput("a"); // typed into the free-text field
		c.handleInput(TAB); // move to Q2
		expect(c.getCurrentIndex()).toBe(1);
		expect(c.getAnswers().get(0)).toBe("a"); // committed on tab
	});
});

describe("ask_pro picker — E: preview code highlighting", () => {
	const preview = "Intro line\n```ts\nconst x = 1\n```";

	test("fenced code is routed through the highlighter", () => {
		const highlight = (code: string): string[] =>
			code.split("\n").map((l) => `HL:${l}`);
		const { c } = mk(
			[
				{
					header: "Shape",
					question: "which?",
					options: [{ label: "A", preview }, { label: "B" }],
				},
			],
			{ highlight },
		);
		const out = c.render(100).join("\n");
		expect(out).toContain("HL:const x = 1"); // code highlighted
		expect(out).toContain("Intro line"); // prose untouched
		expect(out).not.toContain("HL:Intro line"); // prose not highlighted
		expect(out).not.toContain("```"); // fence markers stripped
	});

	test("no highlighter → code still renders (dimmed fallback)", () => {
		const { c } = mk([
			{
				header: "Shape",
				question: "which?",
				options: [{ label: "A", preview }, { label: "B" }],
			},
		]);
		const out = c.render(100).join("\n");
		expect(out).toContain("const x = 1");
		expect(out).not.toContain("```");
	});
});
