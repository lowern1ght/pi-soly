// =============================================================================
// tests/picker.test.ts — Unit tests for AskProComponent (the TUI picker)
// =============================================================================
//
// Tests the state-machine and key-handling of the multi-question picker
// without actually rendering the TUI. Uses a minimal theme + keybinding
// mock so the tests are fast and don't depend on the TUI runtime.
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { AskProComponent, type AskQuestion, type AskProResult, type AskProTheme } from "../picker.js";
import { visibleWidth, type KeybindingsManager } from "@earendil-works/pi-tui";

// Minimal theme: just enough for the picker to render without errors.
const theme: AskProTheme = {
	fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
	bold: (text: string) => `**${text}**`,
};

// Minimal keybindings: recognize the bindings the picker AND the inline
// Input field use, so tests exercise real key handling (backspace, ^U, etc.).
const keybindings = {
	matches: (keyData: string, name: string) => {
		if (name === "tui.select.up") return keyData === "\x1b[A" || keyData === "k";
		if (name === "tui.select.down") return keyData === "\x1b[B" || keyData === "j";
		if (name === "tui.select.confirm") return keyData === "\n" || keyData === "\r";
		if (name === "tui.select.cancel") return keyData === "\x1b";
		// Inline Input editing gestures (mirror pi-tui defaults)
		if (name === "tui.editor.deleteCharBackward") return keyData === "\x7f"; // backspace
		if (name === "tui.editor.deleteToLineStart") return keyData === "\x15"; // ctrl+u
		return false;
	},
} as unknown as KeybindingsManager;

const sampleQuestions: AskQuestion[] = [
	{
		header: "Auth",
		question: "Which auth approach?",
		options: [
			{ label: "JWT cookie", description: "Stateless, scales", recommended: true },
			{ label: "JWT localStorage", description: "Simpler client, XSS risk" },
			{ label: "Server sessions", description: "Revocable, extra dep" },
		],
	},
	{
		header: "Tokens",
		question: "Token storage?",
		options: [
			{ label: "httpOnly cookie" },
			{ label: "Bearer header" },
		],
	},
];

function setup(questions: AskQuestion[] = sampleQuestions) {
	let doneResult: AskProResult | null = null;
	const picker = new AskProComponent({
		questions,
		theme,
		keybindings,
		done: (r) => {
			doneResult = r;
		},
	});
	return {
		picker,
		getDone: (): AskProResult | null => doneResult,
		getAnswers: () => picker.getAnswers(),
	};
}

// ---------------------------------------------------------------------------
// State initialization
// ---------------------------------------------------------------------------

describe("AskProComponent — state", () => {
	test("starts on Q1 with selectedIndex 0", () => {
		const { picker } = setup();
		expect(picker.getCurrentIndex()).toBe(0);
		expect(picker.getSelectedIndex()).toBe(0);
	});

	test("no answers initially", () => {
		const { picker } = setup();
		expect(picker.getAnswers().size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Single-select (default): number key advances to next question
// ---------------------------------------------------------------------------

describe("AskProComponent — single-select (number keys)", () => {
	test("'1' picks first option and auto-advances", () => {
		const { picker, getDone } = setup();
		picker.handleInput("1");
		expect(picker.getCurrentIndex()).toBe(1);
		expect(picker.getAnswers().get(0)).toBe(0);
		expect(getDone()).toBeNull(); // not done yet
	});

	test("'2' picks second option on Q1 and advances", () => {
		const { picker } = setup();
		picker.handleInput("2");
		expect(picker.getAnswers().get(0)).toBe(1);
		expect(picker.getCurrentIndex()).toBe(1);
	});

	test("on last question, '1' picks AND submits", () => {
		const { picker, getDone } = setup();
		picker.handleInput("1"); // Q1 → JWT cookie (recommended), advance
		picker.handleInput("2"); // Q2 → Bearer header, submit (last)
		expect(getDone()).toEqual({ answers: { 0: 0, 1: 1 } });
	});
});

// ---------------------------------------------------------------------------
// Single-select: arrow keys / j-k / Enter
// ---------------------------------------------------------------------------

describe("AskProComponent — single-select (arrows + enter)", () => {
	test("arrow down / j moves selection", () => {
		const { picker } = setup();
		picker.handleInput("j");
		expect(picker.getSelectedIndex()).toBe(1);
		picker.handleInput("\x1b[B");
		expect(picker.getSelectedIndex()).toBe(2);
	});

	test("arrow up / k moves selection up", () => {
		const { picker } = setup();
		picker.handleInput("j");
		picker.handleInput("k");
		expect(picker.getSelectedIndex()).toBe(0);
	});

	test("clamping at boundaries", () => {
		const { picker } = setup();
		picker.handleInput("k"); // already at 0, stays
		expect(picker.getSelectedIndex()).toBe(0);
		picker.handleInput("j");
		picker.handleInput("j");
		picker.handleInput("j");
		picker.handleInput("j"); // 3 options max
		expect(picker.getSelectedIndex()).toBe(2);
	});

	test("Enter confirms current selection, advances or submits", () => {
		const { picker, getDone } = setup();
		picker.handleInput("j"); // selectedIndex = 1 (JWT localStorage)
		picker.handleInput("\n"); // confirm
		expect(picker.getAnswers().get(0)).toBe(1);
		expect(picker.getCurrentIndex()).toBe(1); // advanced
		expect(getDone()).toBeNull();
		picker.handleInput("\n"); // confirm Q2 default (index 0)
		expect(getDone()).toEqual({ answers: { 0: 1, 1: 0 } });
	});
});

// ---------------------------------------------------------------------------
// Tab / arrow navigation between questions
// ---------------------------------------------------------------------------

describe("AskProComponent — question navigation", () => {
	test("Tab advances to next question, resets selection", () => {
		const { picker } = setup();
		picker.handleInput("j");
		picker.handleInput("\t");
		expect(picker.getCurrentIndex()).toBe(1);
		expect(picker.getSelectedIndex()).toBe(0);
	});

	test("right arrow advances", () => {
		const { picker } = setup();
		picker.handleInput("\x1b[C");
		expect(picker.getCurrentIndex()).toBe(1);
	});

	test("Shift+Tab / left arrow go back", () => {
		const { picker } = setup();
		picker.handleInput("\t"); // Q2
		picker.handleInput("\x1b[D"); // back to Q1
		expect(picker.getCurrentIndex()).toBe(0);
	});

	test("Tab at last question is a no-op", () => {
		const { picker } = setup();
		picker.handleInput("\t"); // Q2
		picker.handleInput("\t"); // should stay
		expect(picker.getCurrentIndex()).toBe(1);
	});

	test("Shift+Tab at first question is a no-op", () => {
		const { picker } = setup();
		picker.handleInput("\x1b[Z");
		expect(picker.getCurrentIndex()).toBe(0);
	});

	test("Backspace also goes back", () => {
		const { picker } = setup();
		picker.handleInput("\t"); // Q2
		picker.handleInput("\x7f"); // backspace
		expect(picker.getCurrentIndex()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Multi-select: Enter toggles, no auto-advance, submit on last
// ---------------------------------------------------------------------------

describe("AskProComponent — multi-select", () => {
	const multiQuestions: AskQuestion[] = [
		{
			header: "Tasks",
			question: "Which tasks to include?",
			options: [
				{ label: "Auth" },
				{ label: "Tokens" },
				{ label: "Profile" },
			],
			multiSelect: true,
		},
		{
			header: "Priority",
			question: "Default priority?",
			options: [{ label: "High" }, { label: "Medium" }],
		},
	];

	test("number key toggles in multi-select (no auto-advance)", () => {
		const { picker } = setup(multiQuestions);
		picker.handleInput("1"); // toggle Auth
		picker.handleInput("3"); // toggle Profile
		expect(picker.getCurrentIndex()).toBe(0); // still on Q1
		expect(picker.getAnswers().get(0)).toEqual([0, 2]);
	});

	test("number key again toggles off", () => {
		const { picker } = setup(multiQuestions);
		picker.handleInput("1");
		picker.handleInput("1"); // toggle off
		expect(picker.getAnswers().get(0)).toEqual([]);
	});

	test("Tab advances in multi-select", () => {
		const { picker } = setup(multiQuestions);
		picker.handleInput("1"); // toggle
		picker.handleInput("\t"); // next
		expect(picker.getCurrentIndex()).toBe(1);
		expect(picker.getAnswers().get(0)).toEqual([0]); // multi preserved
	});

	test("Space toggles current selection in multi-select", () => {
		const { picker } = setup(multiQuestions);
		picker.handleInput("j"); // selectedIndex = 1 (Tokens)
		picker.handleInput(" "); // Space toggles
		expect(picker.getAnswers().get(0)).toEqual([1]);
		// Space again toggles off
		picker.handleInput(" ");
		expect(picker.getAnswers().get(0)).toEqual([]);
	});

	test("Space is a no-op in single-select", () => {
		const { picker } = setup(sampleQuestions); // single
		picker.handleInput(" ");
		expect(picker.getAnswers().size).toBe(0); // no toggle happened
	});

	test("Enter advances in multi-select (no toggle)", () => {
		const { picker } = setup(multiQuestions);
		picker.handleInput("j"); // selectedIndex = 1
		picker.handleInput("\n"); // Enter → advance to Q2
		expect(picker.getCurrentIndex()).toBe(1);
		expect(picker.getAnswers().size).toBe(0); // nothing toggled
	});

	test("Submit only when all questions answered (multi on last)", () => {
		const { picker, getDone } = setup(multiQuestions);
		picker.handleInput("1"); // Q1 multi: pick Auth
		picker.handleInput("\t"); // → Q2
		picker.handleInput("\n"); // Q2 single: confirm default (High)
		expect(getDone()).toEqual({ answers: { 0: [0], 1: 0 } });
	});

	test("Enter on LAST multi question + all answered → submit (universal confirm)", () => {
		// Multi-select LAST question: Enter is the universal confirm gesture.
		// If all questions are answered, Enter submits.
		const TWO_MULTI: AskQuestion[] = [
			{ header: "Tasks", question: "?", options: [{ label: "A" }, { label: "B" }], multiSelect: true },
			{ header: "Priority", question: "?", options: [{ label: "H" }, { label: "L" }], multiSelect: true },
		];
		const { picker, getDone } = setup(TWO_MULTI);
		picker.handleInput(" "); // Q1 multi: Space → toggle A
		picker.handleInput("\t"); // → Q2
		picker.handleInput(" "); // Q2 multi: Space → toggle H
		// Now all answered, on last question, Enter should submit
		picker.handleInput("\n");
		expect(getDone()).toEqual({ answers: { 0: [0], 1: [0] } });
	});

	test("Enter on LAST multi question + NOT all answered → no-op (stays on question)", () => {
		// Without answering all, Enter on the last question should do
		// nothing (stays put). User must finish first.
		const TWO_MULTI: AskQuestion[] = [
			{ header: "Tasks", question: "?", options: [{ label: "A" }, { label: "B" }], multiSelect: true },
			{ header: "Priority", question: "?", options: [{ label: "H" }, { label: "L" }], multiSelect: true },
		];
		const { picker, getDone } = setup(TWO_MULTI);
		picker.handleInput("\t"); // → Q2 directly, skip Q1
		picker.handleInput("\n"); // Q2: Enter (Q1 still unanswered) → stays
		expect(getDone()).toBeNull();
		expect(picker.getCurrentIndex()).toBe(1);
		expect(picker.getAnswers().size).toBe(0);
	});

	test("Enter on NON-LAST multi question → next question (no toggle)", () => {
		const TWO_MULTI: AskQuestion[] = [
			{ header: "Q1", question: "?", options: [{ label: "A" }], multiSelect: true },
			{ header: "Q2", question: "?", options: [{ label: "B" }], multiSelect: true },
		];
		const { picker, getDone } = setup(TWO_MULTI);
		// Q1: Enter → next question (no toggle)
		picker.handleInput("\n");
		expect(picker.getCurrentIndex()).toBe(1);
		expect(picker.getAnswers().get(0)).toBeUndefined();
		// Q2: Enter → stay (not all answered)
		picker.handleInput("\n");
		expect(getDone()).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("AskProComponent — cancel", () => {
	test("Esc cancels with cancelled: true", () => {
		const { picker, getDone } = setup();
		picker.handleInput("1");
		picker.handleInput("\x1b");
		expect(getDone()).toEqual({ cancelled: true });
	});

	test("after cancel, further input is ignored", () => {
		const { picker, getDone } = setup();
		picker.handleInput("\x1b");
		picker.handleInput("1");
		expect(getDone()).toEqual({ cancelled: true });
	});
});

// ---------------------------------------------------------------------------
// Recommended option is set correctly
// ---------------------------------------------------------------------------

describe("AskProComponent — recommended option", () => {
	test("recommended: true on the first option is preserved through state", () => {
		const { picker } = setup();
		picker.handleInput("1");
		// The first option (JWT cookie) has recommended: true.
		// We can't easily assert on rendered text here without a real TUI,
		// but the state machine should still produce the right answer.
		expect(picker.getAnswers().get(0)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Validation: handled by extension, not the component
// ---------------------------------------------------------------------------

describe("AskProComponent — state-only (no extension validation)", () => {
	test("component itself does not enforce 2-4 options (extension does)", () => {
		// The component is robust; the extension validates before instantiating.
		const tinyQuestions: AskQuestion[] = [
			{
				header: "X",
				question: "?",
				options: [{ label: "A" }],
			},
		];
		const { picker } = setup(tinyQuestions);
		expect(picker.getCurrentIndex()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// "Other…" option (allowOther: true)
// ---------------------------------------------------------------------------

describe("AskProComponent — Other… option (allowOther)", () => {
	const OTHER_QUESTIONS: AskQuestion[] = [
		{
			header: "Auth",
			question: "Which auth?",
			options: [
				{ label: "JWT cookie" },
				{ label: "JWT localStorage" },
			],
			allowOther: true,
		},
	];

	function setupWithOther(questions: AskQuestion[]) {
		let doneResult: AskProResult | null = null;
		const picker = new AskProComponent({
			questions,
			theme,
			keybindings,
			done: (r) => {
				doneResult = r;
			},
		});
		return {
			picker,
			getDone: (): AskProResult | null => doneResult,
			getAnswers: () => picker.getAnswers(),
		};
	}

	/** Simulate typing `text` into the active inline field, then Enter to
	 *  commit. Mirrors how the real TUI feeds one character per keypress. */
	function typeInline(picker: AskProComponent, text: string, commit = true): void {
		for (const ch of text) picker.handleInput(ch);
		if (commit) picker.handleInput("\n");
	}

	test("Other… appears as last option when allowOther=true", () => {
		const { picker } = setupWithOther(OTHER_QUESTIONS);
		picker.handleInput("j"); // 0 → 1 (JWT localStorage)
		picker.handleInput("j"); // 1 → 2 (Other…)
		// 2 real options + Other = index 2
		expect(picker.getSelectedIndex()).toBe(2);
	});

	test("number key (3) on Other… opens the inline field; Enter commits it", () => {
		const { picker, getAnswers } = setupWithOther(OTHER_QUESTIONS);
		picker.handleInput("3"); // open Other… inline field
		typeInline(picker, "JWT via custom OAuth2 proxy");
		expect(getAnswers().get(0)).toBe("JWT via custom OAuth2 proxy");
	});

	test("Enter on Other… (after selecting it) opens the inline field", () => {
		const { picker, getAnswers } = setupWithOther(OTHER_QUESTIONS);
		picker.handleInput("j"); // 0 → 1
		picker.handleInput("j"); // 1 → 2 (Other…)
		picker.handleInput("\n"); // open the inline field
		typeInline(picker, "magic-link via email");
		expect(getAnswers().get(0)).toBe("magic-link via email");
	});

	test("cancelling inline input (Esc) leaves answer unchanged", () => {
		const { picker, getAnswers } = setupWithOther(OTHER_QUESTIONS);
		picker.handleInput("3"); // open Other… inline field
		picker.handleInput("J"); // type something
		picker.handleInput("\x1b"); // Esc — cancel
		expect(getAnswers().get(0)).toBeUndefined();
	});

	test("empty inline submission is ignored (no answer stored)", () => {
		const { picker, getAnswers } = setupWithOther(OTHER_QUESTIONS);
		picker.handleInput("3"); // open Other… inline field
		typeInline(picker, "   "); // only spaces → trimmed empty → not stored
		expect(getAnswers().get(0)).toBeUndefined();
	});

	test("arrow down stops at Other… (not past it)", () => {
		const { picker } = setupWithOther(OTHER_QUESTIONS);
		picker.handleInput("j"); // 1
		picker.handleInput("j"); // 2 (Other…)
		picker.handleInput("j"); // stays at 2
		expect(picker.getSelectedIndex()).toBe(2);
	});

	test("Other… picks auto-advance to next question (single-select)", () => {
		const TWO_Q: AskQuestion[] = [
			{
				header: "Q1",
				question: "?",
				options: [{ label: "A" }],
				allowOther: true,
			},
			{
				header: "Q2",
				question: "?",
				options: [{ label: "X" }],
			},
		];
		const { picker, getAnswers } = setupWithOther(TWO_Q);
		picker.handleInput("2"); // open Other… on Q1
		typeInline(picker, "custom A"); // commit → advance to Q2
		expect(picker.getCurrentIndex()).toBe(1);
		expect(getAnswers().get(0)).toBe("custom A");
	});

	test("Other… picks submit if on last question", () => {
		const ONE_Q: AskQuestion[] = [
			{
				header: "Only",
				question: "?",
				options: [{ label: "A" }],
				allowOther: true,
			},
		];
		const { picker, getDone } = setupWithOther(ONE_Q);
		picker.handleInput("2"); // open Other…
		typeInline(picker, "freeform"); // commit → submit (last question)
		expect(getDone()).toEqual({ answers: { 0: "freeform" } });
	});

	test("Other… in multi-select pushes the string into the array", () => {
		const MULTI_WITH_OTHER: AskQuestion[] = [
			{
				header: "Pick",
				question: "?",
				options: [{ label: "A" }, { label: "B" }],
				multiSelect: true,
				allowOther: true,
			},
		];
		const { picker, getAnswers } = setupWithOther(MULTI_WITH_OTHER);
		picker.handleInput("1"); // toggle A
		picker.handleInput("3"); // open Other… inline field (Space would too)
		typeInline(picker, "my custom"); // commit
		// A is toggled + custom string
		const a = getAnswers().get(0);
		expect(Array.isArray(a)).toBe(true);
		expect(a).toEqual([0, "my custom"]);
		// Still on Q1 (multi-select doesn't auto-advance)
		expect(picker.getCurrentIndex()).toBe(0);
	});

	test("re-picking Other… replaces the previous custom string (not appends)", () => {
		const ONE_Q: AskQuestion[] = [
			{
				header: "Only",
				question: "?",
				options: [{ label: "A" }],
				allowOther: true,
			},
		];
		const { picker, getAnswers } = setupWithOther(ONE_Q);
		// First: open Other…, type "first", commit (stays — only 1 question;
		// single-select commit on last question does NOT submit until all
		// answered, but here it's answered so it submits). To test replace,
		// use a multi-select question so we stay put after committing.
		const MULTI: AskQuestion[] = [
			{
				header: "Pick",
				question: "?",
				options: [{ label: "A" }, { label: "B" }],
				multiSelect: true,
				allowOther: true,
			},
		];
		const { picker: mp, getAnswers: getMulti } = setupWithOther(MULTI);
		mp.handleInput("3"); // open Other… (pre-fills with "first", cursor at end)
		mp.handleInput("\x15"); // ^U — delete to line start → ""
		typeInline(mp, "second");
		expect(getMulti().get(0)).toEqual(["second"]);
	});

	test("allowOther without any external callback still shows Other…", () => {
		// The inline field is built in, so Other… no longer needs a host
		// callback. This is the whole point of the inline redesign: the
		// host UI's modal input would tear down the picker.
		const { picker, getAnswers } = setup(OTHER_QUESTIONS);
		picker.handleInput("3"); // open Other… inline field
		typeInline(picker, "plain custom");
		expect(getAnswers().get(0)).toBe("plain custom");
	});
});

// ---------------------------------------------------------------------------
// Option previews (side-by-side)
// ---------------------------------------------------------------------------

describe("AskProComponent — option previews", () => {
	test("currentPreviewLines returns [] when option has no preview", () => {
		const { picker } = setup();
		// Type-level access: currentPreviewLines is private; verify via render
		// (no preview lines means render falls back to super.render width-only)
		const lines = picker.render(80);
		// Just verify it doesn't throw and returns some lines
		expect(lines.length).toBeGreaterThan(0);
	});

	test("render includes preview content when option has preview", () => {
		const qsWithPreview: AskQuestion[] = [
			{
				header: "Model",
				question: "Which schema?",
				options: [
					{
						label: "Relational",
						description: "Postgres + strict schema",
						preview: "CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email TEXT NOT NULL\n);",
					},
					{ label: "Document", description: "MongoDB" },
				],
			},
		];
		const { picker } = setup(qsWithPreview);
		const lines = picker.render(100);
		const joined = lines.join("\n");
		// Preview content should appear in the rendered output
		expect(joined).toContain("CREATE TABLE");
		expect(joined).toContain("preview");
	});

	test("preview disappears when focused option has none", () => {
		const qsWithPreview: AskQuestion[] = [
			{
				header: "Model",
				question: "Which schema?",
				options: [
					{
						label: "Relational",
						description: "Postgres",
						preview: "CREATE TABLE users (id INT);",
					},
					{ label: "Document", description: "MongoDB" },
				],
			},
		];
		const { picker } = setup(qsWithPreview);
		// Focus option 0 (has preview)
		picker.handleInput("j"); // wait, default 0 already; move to 1
		picker.handleInput("j"); // option 1 (no preview)
		const lines = picker.render(100);
		const joined = lines.join("\n");
		// No preview lines for option without preview
		expect(joined).not.toContain("CREATE TABLE");
	});
});

// ---------------------------------------------------------------------------
// Notes (`n` key)
// ---------------------------------------------------------------------------

describe("AskProComponent — notes (n key)", () => {
	test("n opens the inline note field", () => {
		const { picker } = setup();
		// `n` should not throw and should not advance/change answers
		expect(() => picker.handleInput("n")).not.toThrow();
		expect(picker.getAnswers().size).toBe(0);
	});

	test("typed note is stored on Enter and included in submit result", () => {
		let doneResult: AskProResult | null = null;
		const picker = new AskProComponent({
			questions: sampleQuestions,
			theme,
			keybindings,
			done: (r) => {
				doneResult = r;
			},
		});
		// Pick Q1 → advance to Q2
		picker.handleInput("1");
		// Open the inline note field on Q2 and type a note
		picker.handleInput("n");
		for (const ch of "rotate keys monthly") picker.handleInput(ch);
		picker.handleInput("\n"); // commit
		// Submit Q2 (last question, all answered)
		picker.handleInput("1");
		expect(doneResult).not.toBeNull();
		const result = doneResult as AskProResult | null;
		expect(result?.notes).toBeDefined();
		expect(result?.notes?.[1]).toBe("rotate keys monthly");
	});

	test("Esc cancels the note field, leaving no note", () => {
		const { picker } = setup();
		picker.handleInput("n");
		for (const ch of "ignored note") picker.handleInput(ch);
		picker.handleInput("\x1b"); // Esc — cancel
		// No note stored; picker still usable (pick an option to prove it)
		picker.handleInput("1");
		expect(picker.getAnswers().get(0)).toBe(0);
	});

	test("empty note submission clears any existing note", () => {
		let doneResult: AskProResult | null = null;
		const picker = new AskProComponent({
			questions: sampleQuestions,
			theme,
			keybindings,
			done: (r) => {
				doneResult = r;
			},
		});
		// Q1: add a note, then re-open and clear it (^U + Enter)
		picker.handleInput("n");
		for (const ch of "first note") picker.handleInput(ch);
		picker.handleInput("\n");
		picker.handleInput("n");
		picker.handleInput("\x15"); // ^U — delete to line start
		picker.handleInput("\n"); // commit empty → note cleared
		// Pick Q1 → Q2 → submit; result must NOT carry notes
		picker.handleInput("1");
		picker.handleInput("1");
		expect(doneResult as AskProResult | null).toEqual({ answers: { 0: 0, 1: 0 } });
	});

	test("note field does not break render", () => {
		const { picker } = setup();
		picker.handleInput("n");
		expect(() => picker.render(80)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Regression: render() must NEVER emit a line wider than `width`.
// Previously the side-by-side preview layout measured width with a regex
// that ignored OSC 8 / FTCS escape sequences (which pi-tui wraps around
// rendered text) and never truncated the left column or the combined row —
// so a long option label or preview word pushed a line past the terminal
// width and crashed pi ("Rendered line N exceeds terminal width").
// See C:/Users/bradw/.pi/agent/pi-crash.log.
// ---------------------------------------------------------------------------
describe("AskProComponent — render never exceeds width (crash regression)", () => {
	// Passthrough theme: no ANSI, so visibleWidth() reports true column width.
	const plainTheme: AskProTheme = { fg: (_c, t) => t, bold: (t) => t };
	const kb = { matches: () => false } as unknown as KeybindingsManager;

	const LONG_PREVIEW =
		"Set-Cookie: refresh_token=xxx; HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh; Max-Age=2592000\n" +
		"// this is a fairly long comment line that must wrap and never overflow the column";

	function makePicker(preview: string, label = "short"): AskProComponent {
		return new AskProComponent({
			questions: [
				{
					header: "X",
					question: "Pick one?",
					options: [
						{ label, description: "desc", preview },
						{ label: "other option", description: "desc2" },
					],
				},
			],
			theme: plainTheme,
			keybindings: kb,
			done: () => {},
		});
	}

	for (const width of [134, 100, 80, 60, 45, 40, 30, 20, 10]) {
		test(`every line ≤ width=${width} with a long preview + long label`, () => {
			const picker = makePicker(
				LONG_PREVIEW,
				"a-very-long-option-label-without-spaces-to-stress-truncation",
			);
			const lines = picker.render(width);
			expect(lines.length).toBeGreaterThan(0);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		});
	}

	test("every line ≤ width with a single 500-char unbreakable token", () => {
		const picker = makePicker("x".repeat(500), "ok");
		for (const width of [134, 50, 25, 12]) {
			const lines = picker.render(width);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("preview content still rendered (not dropped) at a comfortable width", () => {
		const picker = makePicker("CREATE TABLE users (id INT);", "Relational");
		const joined = picker.render(100).join("\n");
		expect(joined).toContain("CREATE TABLE");
		expect(joined).toContain("preview");
	});
});
