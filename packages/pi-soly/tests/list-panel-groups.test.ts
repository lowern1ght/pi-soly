// =============================================================================
// tests/list-panel-groups.test.ts — ListPanel groups + settings UI helpers
// =============================================================================

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { ListPanel, type ListItem, type ListGroup } from "../visual/list-panel.ts";

const theme = {
	fg: (_c: string, t: string) => t,
	bold: (t: string) => t,
};
const tui = {
	requestRender: () => {},
};
const kb = { matches: () => false };

const mkItem = (id: string, label: string, meta = ""): ListItem => ({
	id,
	marker: "▸",
	label,
	meta,
	body: `${id} preview`,
});

describe("ListPanel — groups rendering", () => {
	test("groups render with a labelled separator for each group", () => {
		const groups: ListGroup[] = [
			{ id: "a", title: "Group A", icon: "▰", items: [mkItem("a1", "Item A1"), mkItem("a2", "Item A2")] },
			{ id: "b", title: "Group B", icon: "▤", items: [mkItem("b1", "Item B1")] },
		];
		let doneCalled = false;
		const panel = new ListPanel({
			tui: tui as never,
			theme: theme as never,
			keybindings: kb as never,
			done: () => { doneCalled = true; },
			title: "test",
			groups,
		});
		const out = panel.render(80);
		// Group separators present
		expect(out.some((l) => l.includes("Group A"))).toBe(true);
		expect(out.some((l) => l.includes("Group B"))).toBe(true);
		// Items present
		expect(out.some((l) => l.includes("Item A1"))).toBe(true);
		expect(out.some((l) => l.includes("Item A2"))).toBe(true);
		expect(out.some((l) => l.includes("Item B1"))).toBe(true);
		expect(doneCalled).toBe(false);
	});

	test("empty group collapses to nothing (no separator)", () => {
		const groups: ListGroup[] = [
			{ id: "a", title: "Group A", icon: "▰", items: [mkItem("a1", "Only A1")] },
			{ id: "empty", title: "Empty", icon: "▱", items: [] },
		];
		const panel = new ListPanel({
			tui: tui as never,
			theme: theme as never,
			keybindings: kb as never,
			done: () => {},
			title: "test",
			groups,
		});
		const out = panel.render(80);
		expect(out.some((l) => l.includes("Group A"))).toBe(true);
		// Empty group should not render a separator (avoids dead space).
		const outStr = out.join("\n");
		expect(outStr).not.toMatch(/Empty\s*─/);
	});

	test("cursor starts on the first item (not on a header)", () => {
		const groups: ListGroup[] = [
			{ id: "a", title: "Group A", icon: "▰", items: [mkItem("a1", "Only A1")] },
		];
		const panel = new ListPanel({
			tui: tui as never,
			theme: theme as never,
			keybindings: kb as never,
			done: () => {},
			title: "test",
			groups,
		});
		// After Up arrow, clamp should keep cursor on item, not header.
		panel.handleInput("↑");
		const out = panel.render(80);
		// The selected item is rendered with `❯ ` cursor; verify item is
		// the selected line (not the header that precedes it).
		const cursorLines = out.filter((l) => l.includes("❯"));
		expect(cursorLines.length).toBe(1);
		expect(cursorLines[0]).toContain("Only A1");
	});

	test("filter shrinks to groups that have at least one match", () => {
		const groups: ListGroup[] = [
			{ id: "a", title: "Alpha", icon: "▰", items: [mkItem("alpha-1", "Apple"), mkItem("beta-1", "Banana")] },
			{ id: "b", title: "Beta", icon: "▤", items: [mkItem("beta-2", "Cherry")] },
		];
		const panel = new ListPanel({
			tui: tui as never,
			theme: theme as never,
			keybindings: kb as never,
			done: () => {},
			title: "test",
			groups,
		});
		// Enter search by typing "/"; then type a query that matches "Cherry".
		panel.handleInput("/");
		for (const ch of "cher") panel.handleInput(ch);
		const out = panel.render(80);
		const outStr = out.join("\n");
		expect(outStr).toContain("Cherry");
		expect(outStr).not.toContain("Apple");
		// Beta group header still appears (because it has the match).
		expect(outStr).toContain("Beta");
		expect(outStr).not.toContain("Alpha");
	});
});

describe("ListPanel — onSelect integration with groups", () => {
	test("Enter on a non-header item fires onSelect with the item", () => {
		const captured: ListItem[] = [];
		const groups: ListGroup[] = [
			{ id: "a", title: "G", icon: "▰", items: [mkItem("a1", "Item A1"), mkItem("a2", "Item A2")] },
		];
		const panel = new ListPanel({
			tui: tui as never,
			theme: theme as never,
			keybindings: kb as never,
			done: () => {},
			title: "test",
			groups,
			onSelect: (it) => captured.push(it),
		});
		// Enter on the first item (default selection)
		panel.handleInput("\n");
		expect(captured.length).toBe(1);
		expect(captured[0]?.id).toBe("a1");
	});
});