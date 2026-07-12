// =============================================================================
// tests/border.test.ts — shared border renderer unit tests
// =============================================================================

import { describe, test, expect } from "bun:test";
import { borderTop, borderBottom, borderDivider, borderLabelledDivider, borderRow, borderEmpty, type BorderStyler } from "../visual/border.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const id: BorderStyler = (s) => s;
// Marker styler: wraps in <> so we can assert styled vs unstyled parts.
const mark: BorderStyler = (s) => `<${s}>`;

describe("borderTop", () => {
	test("centers the title with rounded corners", () => {
		const line = borderTop("Hi", 10, id);
		expect(line).toBe("╭────Hi────╮");
	});

	test("centers with odd split (left gets floor)", () => {
		const line = borderTop("Hi", 9, id);
		expect(line).toBe("╭───Hi────╮");
	});

	test("empty title = full dash top", () => {
		expect(borderTop("", 5, id)).toBe("╭─────╮");
	});

	test("title exactly fills width", () => {
		expect(borderTop("ABCDE", 5, id)).toBe("╭ABCDE╮");
	});

	test("applies styler to border segments", () => {
		// styler wraps each contiguous border chunk: <╭────>Hi<────╮>
		const line = borderTop("Hi", 10, mark, id);
		expect(line).toBe("<╭────>Hi<────╮>");
	});

	test("uses titleStyler for title when provided", () => {
		const line = borderTop("Hi", 10, id, mark);
		expect(line).toBe("╭────<Hi>────╮");
	});
});

describe("borderBottom", () => {
	test("full dash bottom with rounded corners", () => {
		expect(borderBottom(5, id)).toBe("╰─────╯");
	});
	test("applies styler to whole border", () => {
		expect(borderBottom(3, mark)).toBe("<╰───╯>");
	});
});

describe("borderDivider", () => {
	test("mid-panel divider", () => {
		expect(borderDivider(5, id)).toBe("├─────┤");
	});
	test("applies styler", () => {
		expect(borderDivider(3, mark)).toBe("<├───┤>");
	});
});

describe("borderLabelledDivider", () => {
	test("labelled divider with dashes after label", () => {
		// head = "─ preview " (10 chars), innerW=15, dashN = 15 - 10 - 1 = 4
		const line = borderLabelledDivider("preview", 15, id);
		expect(line).toBe("├ ─ preview ────┤");
	});
	test("uses labelStyler when provided", () => {
		const line = borderLabelledDivider("x", 10, id, mark);
		// head = "─ x ", styled by mark → <─ x >
		expect(line).toContain("<─ x >");
	});
});

describe("borderRow", () => {
	test("pads short content to fill width", () => {
		// borderRow: "│ " + content + pad + " │"
		// innerW=10, "Hi" → pad = 10-2 = 8
		const line = borderRow("Hi", 10, id);
		expect(visibleWidth(line)).toBe(10 + 4); // innerW + borders
		expect(line.startsWith("│ Hi")).toBe(true);
		expect(line.endsWith("│")).toBe(true);
	});

	test("truncates long content with ellipsis", () => {
		const line = borderRow("Hello World", 8, id);
		expect(line).toContain("…");
		expect(visibleWidth(line)).toBe(8 + 4);
	});

	test("content exactly fits", () => {
		const line = borderRow("ABC", 3, id);
		expect(visibleWidth(line)).toBe(3 + 4);
		expect(line.startsWith("│ ABC")).toBe(true);
	});

	test("applies styler to border chars, not content", () => {
		const line = borderRow("Hi", 10, mark);
		// "│ " styled, "Hi" not styled, pad not styled, " │" styled
		expect(line).toBe("<│ >Hi        < │>");
	});
});

describe("borderEmpty", () => {
	test("all spaces between borders", () => {
		const line = borderEmpty(5, id);
		expect(line).toBe("│     │");
	});
	test("applies styler to border chars only", () => {
		const line = borderEmpty(3, mark);
		// styler("│") + spaces + styler("│")
		expect(line).toBe("<│>   <│>");
	});
});
