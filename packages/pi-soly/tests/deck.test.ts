// =============================================================================
// tests/deck.test.ts — decision_deck TUI component
// =============================================================================
//
// Drives DeckComponent headlessly: starting card (recommended), navigation
// (←/→ clamp, number jump), choose/cancel, and the render contract (content
// present + every line within width).
// =============================================================================

import { describe, expect, test } from "bun:test";
import { visibleWidth, type KeybindingsManager } from "@earendil-works/pi-tui";
import {
	DeckComponent,
	type DeckOption,
	type DeckResult,
	type DeckTheme,
} from "../deck/deck.ts";

const ENTER = "\n";
const ESC = "\x1b";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";

const theme: DeckTheme = { fg: (_c, t) => t, bold: (t) => t };
const keybindings = { matches: () => false } as unknown as KeybindingsManager;

function mk(
	options: DeckOption[],
	opts: { highlight?: (code: string, lang?: string) => string[]; title?: string; prompt?: string } = {},
): { c: DeckComponent; result: () => DeckResult | null } {
	let captured: DeckResult | null = null;
	const c = new DeckComponent({
		options,
		theme,
		keybindings,
		done: (r) => {
			captured = r;
		},
		title: opts.title,
		prompt: opts.prompt,
		highlight: opts.highlight,
	});
	return { c, result: () => captured };
}

const OPTS: DeckOption[] = [
	{ title: "Direct calls", summary: "Call modules directly.", pros: ["simple"], cons: ["coupling"] },
	{
		title: "Event bus",
		summary: "Decouple via events.",
		code: "const bus = new Bus()\nbus.emit('x')",
		lang: "ts",
		pros: ["decoupled"],
		cons: ["harder to trace"],
		recommended: true,
	},
	{ title: "Queue", summary: "Push to a queue." },
];

describe("decision_deck — navigation & selection", () => {
	test("starts on the recommended card", () => {
		const { c } = mk(OPTS);
		expect(c.getIndex()).toBe(1);
	});

	test("←/→ move and clamp at the ends", () => {
		const { c } = mk(OPTS);
		c.handleInput(LEFT); // 1 → 0
		expect(c.getIndex()).toBe(0);
		c.handleInput(LEFT); // clamp at 0
		expect(c.getIndex()).toBe(0);
		c.handleInput(RIGHT); // 0 → 1
		c.handleInput(RIGHT); // 1 → 2
		c.handleInput(RIGHT); // clamp at 2
		expect(c.getIndex()).toBe(2);
	});

	test("number keys jump to a card", () => {
		const { c } = mk(OPTS);
		c.handleInput("3");
		expect(c.getIndex()).toBe(2);
	});

	test("Enter chooses the current card", () => {
		const { c, result } = mk(OPTS);
		c.handleInput(LEFT); // → index 0
		c.handleInput(ENTER);
		expect(result()).toEqual({ chosen: 0 });
	});

	test("Esc cancels", () => {
		const { c, result } = mk(OPTS);
		c.handleInput(ESC);
		expect(result()).toEqual({ cancelled: true });
	});

	test("input after completion is ignored", () => {
		const { c, result } = mk(OPTS);
		c.handleInput(ENTER);
		c.handleInput(RIGHT);
		expect(result()).toEqual({ chosen: 1 }); // unchanged
	});
});

describe("decision_deck — notes (n key)", () => {
	/** Type `text` into the active note field, mirroring real char-by-char dispatch. */
	function type(c: DeckComponent, text: string): void {
		for (const ch of text) c.handleInput(ch);
	}

	test("`n` opens the note field without choosing or cancelling", () => {
		const { c, result } = mk(OPTS);
		expect(() => c.handleInput("n")).not.toThrow();
		expect(c.getIndex()).toBe(1); // unchanged
		expect(result()).toBeNull(); // not done
		expect(c.getNote()).toBe("");
	});

	test("typed note is stored on Enter and included in the chosen result", () => {
		const { c, result } = mk(OPTS);
		c.handleInput("n");
		type(c, "avoid lock contention");
		c.handleInput(ENTER); // commit note
		expect(c.getNote()).toBe("avoid lock contention");
		c.handleInput(ENTER); // choose the current (recommended) card
		expect(result()).toEqual({ chosen: 1, note: "avoid lock contention" });
	});

	test("Esc cancels the note field, leaving no note", () => {
		const { c, result } = mk(OPTS);
		c.handleInput("n");
		type(c, "ignored");
		c.handleInput(ESC); // cancel note (NOT the deck)
		expect(c.getNote()).toBe("");
		expect(result()).toBeNull(); // deck still active
		c.handleInput(ENTER); // choose → submit
		expect(result()).toEqual({ chosen: 1 }); // no `note` key
	});

	test("committing an empty note clears any existing note", () => {
		const { c, result } = mk(OPTS);
		c.handleInput("n");
		type(c, "first");
		c.handleInput(ENTER); // commit "first"
		expect(c.getNote()).toBe("first");
		c.handleInput("n"); // re-open, then clear
		c.handleInput("\x15"); // ^U — delete to line start (Input default)
		c.handleInput(ENTER); // commit empty → note cleared
		expect(c.getNote()).toBe("");
		c.handleInput(ENTER); // choose
		expect(result()).toEqual({ chosen: 1 }); // no `note`
	});

	test("note is never attached to a cancellation", () => {
		const { c, result } = mk(OPTS);
		c.handleInput("n");
		type(c, "won't ship");
		c.handleInput(ENTER); // commit note
		c.handleInput(ESC); // cancel the DECK
		expect(result()).toEqual({ cancelled: true }); // no `note`
	});

	test("opening the note field does not break render", () => {
		const { c } = mk(OPTS);
		c.handleInput("n");
		const lines = c.render(80);
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.join("\n")).toContain("Note:");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
	});
});

describe("decision_deck — render", () => {
	test("shows title, current card, pager, pros/cons", () => {
		const { c } = mk(OPTS, { title: "State", prompt: "How to wire modules?" });
		const out = c.render(80).join("\n");
		expect(out).toContain("State"); // deck title
		expect(out).toContain("How to wire modules?"); // prompt
		expect(out).toContain("Event bus"); // current (recommended) card
		expect(out).toContain("2/3"); // pager counter
		expect(out).toContain("+ decoupled"); // pro
		expect(out).toContain("− harder to trace"); // con
	});

	test("code is routed through the highlighter", () => {
		const highlight = (code: string): string[] => code.split("\n").map((l) => `HL:${l}`);
		const { c } = mk(OPTS, { highlight });
		const out = c.render(80).join("\n");
		expect(out).toContain("HL:const bus = new Bus()");
	});

	test("every rendered line stays within width", () => {
		const { c } = mk(OPTS, { title: "State", prompt: "A fairly long prompt ".repeat(8) });
		for (const w of [20, 40, 80, 120]) {
			for (const line of c.render(w)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(w);
			}
		}
	});
});
