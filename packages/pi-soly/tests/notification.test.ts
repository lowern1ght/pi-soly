// =============================================================================
// tests/notification.test.ts — Tests for the notification module
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach } from "bun:test";
import { formatFramed, notifyFramed, notifyNudge, notifyDeprecation } from "../notification.js";

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
		expect(lines.length).toBe(5); // top + 3 body + bottom
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
		// All body lines should be the same width
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

describe("notifyFramed", () => {
	test("calls ui.notify with framed text + level", () => {
		const calls: Array<{ text: string; level: string }> = [];
		const ui = {
			notify: (text: string, level: "info" | "warning" | "error") => {
				calls.push({ text, level });
			},
		} as never;
		notifyFramed(ui, "test", ["line 1", "line 2"], { level: "warning" });
		expect(calls.length).toBe(1);
		expect(calls[0]?.text).toContain("test");
		expect(calls[0]?.text).toContain("line 1");
		expect(calls[0]?.text).toContain("line 2");
		expect(calls[0]?.level).toBe("warning");
	});

	test("defaults to info level", () => {
		const calls: Array<{ text: string; level: string }> = [];
		const ui = {
			notify: (text: string, level: string) => {
				calls.push({ text, level });
			},
		} as never;
		notifyFramed(ui, "t", ["x"]);
		expect(calls[0]?.level).toBe("info");
	});
});

describe("notifyNudge", () => {
	test("nonTrivial variant", () => {
		const calls: Array<{ text: string; level: string }> = [];
		const ui = { notify: (t: string, l: string) => calls.push({ text: t, level: l }) } as never;
		notifyNudge(ui, "nonTrivial", "deadline, scope, style?");
		expect(calls[0]?.text).toContain("non-trivial");
		expect(calls[0]?.text).toContain("deadline, scope, style?");
	});

	test("research variant", () => {
		const calls: Array<{ text: string; level: string }> = [];
		const ui = { notify: (t: string, l: string) => calls.push({ text: t, level: l }) } as never;
		notifyNudge(ui, "research", "what's the latest X?");
		expect(calls[0]?.text).toContain("research");
		expect(calls[0]?.text).toContain("look-up");
	});
});

describe("notifyDeprecation", () => {
	test("frames old + new + optional hint", () => {
		const calls: Array<{ text: string; level: string }> = [];
		const ui = { notify: (t: string, l: string) => calls.push({ text: t, level: l }) } as never;
		notifyDeprecation(ui, ".soly/", ".agents/", "run mv .soly .agents");
		expect(calls[0]?.text).toContain(".soly/");
		expect(calls[0]?.text).toContain(".agents/");
		expect(calls[0]?.text).toContain("mv .soly .agents");
		expect(calls[0]?.level).toBe("warning");
	});

	test("works without hint", () => {
		const calls: Array<{ text: string; level: string }> = [];
		const ui = { notify: (t: string, l: string) => calls.push({ text: t, level: l }) } as never;
		notifyDeprecation(ui, "old", "new");
		expect(calls[0]?.text).toContain("old");
		expect(calls[0]?.text).toContain("new");
	});
});
