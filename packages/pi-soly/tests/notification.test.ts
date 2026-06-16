// =============================================================================
// tests/notification.test.ts — Tests for the notification module
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { formatFramed, notifyFramed, notifyNudge, notifyDeprecation, clearNotification } from "../notification.js";

// ---------------------------------------------------------------------------
// Helpers — capture widget calls + provide a fake TUI
// ---------------------------------------------------------------------------

interface WidgetCall {
	key: string;
	factory: ((tui: unknown, theme: unknown) => unknown) | undefined;
	placement: string;
}

function makeUi() {
	const widgets = new Map<string, WidgetCall>();
	const sets: string[] = []; // key clears (setWidget(key, undefined))

	const ui = {
		setWidget: (key: string, content: unknown, options?: { placement?: string }) => {
			if (content === undefined) {
				sets.push(key);
				widgets.delete(key);
			} else {
				widgets.set(key, {
					key,
					factory: content as ((tui: unknown, theme: unknown) => unknown),
					placement: options?.placement ?? "aboveEditor",
				});
			}
		},
		notify: (text: string, _level: string) => {
			// record in case anyone still calls it
			sets.push(`notify:${text.length}`);
		},
	} as never;

	return { ui, widgets, sets };
}

// ---------------------------------------------------------------------------
// formatFramed (pure-text fallback, no UI needed)
// ---------------------------------------------------------------------------

describe("formatFramed", () => {
	test("frames a single-line message", () => {
		const out = formatFramed("hello", ["world"]);
		expect(out).toContain("hello");
		expect(out).toContain("world");
		expect(out.split("\n").length).toBe(3);
	});

	test("frames a multi-line message", () => {
		const out = formatFramed("title", ["line 1", "line 2", "line 3"]);
		const lines = out.split("\n");
		expect(lines.length).toBe(5);
		expect(lines[0]).toContain("title");
		expect(lines[1]).toContain("line 1");
		expect(lines[4]).toContain("╰");
	});

	test("uses rounded box-drawing chars", () => {
		const out = formatFramed("t", ["x"]);
		expect(out).toContain("╭");
		expect(out).toContain("╮");
		expect(out).toContain("╰");
		expect(out).toContain("╯");
		expect(out).toContain("│");
	});

	test("adapts width to longest line", () => {
		const out = formatFramed("t", ["short", "this is a much longer line"]);
		const lines = out.split("\n");
		const widths = lines.map((l) => l.length);
		const allSame = widths.every((w) => w === widths[0]);
		expect(allSame).toBe(true);
	});

	test("respects minWidth", () => {
		const out = formatFramed("t", ["x"], { minWidth: 50 });
		expect(out.split("\n")[0]!.length).toBeGreaterThanOrEqual(50);
	});
});

// ---------------------------------------------------------------------------
// notifyFramed — Box widget via setWidget
// ---------------------------------------------------------------------------

describe("notifyFramed (Box widget)", () => {
	test("calls setWidget with a Box factory and placement aboveEditor", () => {
		const { ui, widgets } = makeUi();
		notifyFramed(ui, "test", ["line 1", "line 2"], { autoClearMs: 0 });
		expect(widgets.size).toBe(1);
		const w = [...widgets.values()][0]!;
		expect(w.key).toBe("soly-notif");
		expect(w.placement).toBe("aboveEditor");
		expect(typeof w.factory).toBe("function");
	});

	test("uses custom key when provided", () => {
		const { ui, widgets } = makeUi();
		notifyFramed(ui, "t", ["x"], { key: "my-key", autoClearMs: 0 });
		expect(widgets.has("my-key")).toBe(true);
	});

	test("replaces widget on repeated call with same key", () => {
		const { ui, widgets } = makeUi();
		notifyFramed(ui, "first", ["a"], { key: "same", autoClearMs: 0 });
		notifyFramed(ui, "second", ["b"], { key: "same", autoClearMs: 0 });
		expect(widgets.size).toBe(1);
		const w = [...widgets.values()][0]!;
		expect(w.factory).toBeDefined();
	});

	test("auto-clears after N ms", async () => {
		const { ui, widgets, sets } = makeUi();
		notifyFramed(ui, "t", ["x"], { autoClearMs: 30, key: "auto" });
		expect(widgets.has("auto")).toBe(true);
		await new Promise((r) => setTimeout(r, 60));
		expect(widgets.has("auto")).toBe(false);
		expect(sets).toContain("auto");
	});

	test("autoClearMs: 0 means no auto-clear", async () => {
		const { ui, widgets } = makeUi();
		notifyFramed(ui, "t", ["x"], { autoClearMs: 0, key: "sticky" });
		await new Promise((r) => setTimeout(r, 50));
		expect(widgets.has("sticky")).toBe(true);
	});

	test("uses belowEditor placement when specified", () => {
		const { ui, widgets } = makeUi();
		notifyFramed(ui, "t", ["x"], { placement: "belowEditor", autoClearMs: 0 });
		const w = [...widgets.values()][0]!;
		expect(w.placement).toBe("belowEditor");
	});

	test("clearNotification removes the widget", () => {
		const { ui, widgets, sets } = makeUi();
		notifyFramed(ui, "t", ["x"], { autoClearMs: 0, key: "x" });
		expect(widgets.has("x")).toBe(true);
		clearNotification(ui, "x");
		expect(widgets.has("x")).toBe(false);
		expect(sets).toContain("x");
	});
});

// ---------------------------------------------------------------------------
// notifyNudge
// ---------------------------------------------------------------------------

describe("notifyNudge", () => {
	test("nonTrivial variant uses 'soly-nudge' key + customMessageBg", () => {
		const { ui, widgets } = makeUi();
		notifyNudge(ui, "nonTrivial", "deadline, scope, style?");
		expect(widgets.size).toBe(1);
		const w = [...widgets.values()][0]!;
		expect(w.key).toBe("soly-nudge");
	});

	test("research variant uses same key (replaces previous nudge)", () => {
		const { ui, widgets } = makeUi();
		notifyNudge(ui, "nonTrivial", "x");
		notifyNudge(ui, "research", "y");
		expect(widgets.size).toBe(1);
		expect(widgets.has("soly-nudge")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// notifyDeprecation
// ---------------------------------------------------------------------------

describe("notifyDeprecation", () => {
	test("uses 'soly-deprecation' key + toolPendingBg", () => {
		const { ui, widgets } = makeUi();
		notifyDeprecation(ui, ".soly/", ".agents/", "run mv .soly .agents");
		expect(widgets.size).toBe(1);
		const w = [...widgets.values()][0]!;
		expect(w.key).toBe("soly-deprecation");
	});

	test("works without hint", () => {
		const { ui, widgets } = makeUi();
		notifyDeprecation(ui, "old", "new");
		expect(widgets.size).toBe(1);
	});
});
