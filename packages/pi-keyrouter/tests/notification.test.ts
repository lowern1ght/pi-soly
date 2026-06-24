// =============================================================================
// tests/notification.test.ts — user-facing notification helpers
// =============================================================================
//
// Contract: notifications go through `ui.notify(message, severity)`.
// No Box widget, no setWidget, no raw ANSI. We verify the exact text
// and severity so the user sees consistent one-liners.

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import {
	notifyRotation,
	notifyOverloaded,
	notifyExhausted,
	clearRotationWidget,
} from "../notification.ts";
import type { RotationEvent } from "../types.ts";

interface MockUi {
	setWidget: (key: string, content: unknown, options?: unknown) => void;
	notify: (text: string, severity?: string) => void;
}

function makeMockUi(): { ui: MockUi; notifies: Array<{ text: string; severity?: string }> } {
	const notifies: Array<{ text: string; severity?: string }> = [];
	const ui: MockUi = {
		setWidget: () => {
			// Should NOT be called by notifyRotation/notifyOverloaded/notifyExhausted.
			// clearRotationWidget may call it as a no-op compat shim.
			throw new Error("setWidget should not be used in normal notify path");
		},
		notify: (text: string, severity?: string) => {
			notifies.push({ text, severity });
		},
	};
	return { ui, notifies };
}

const sampleEvent: RotationEvent = {
	provider: "zai",
	fromKey: "primary",
	toKey: "backup",
	reason: "rate-limited",
	status: 429,
	attempt: 1,
};

describe("notifyRotation", () => {
	test("emits a single one-line warning notify", () => {
		const { ui, notifies } = makeMockUi();
		notifyRotation(ui as never, sampleEvent);
		expect(notifies.length).toBe(1);
		expect(notifies[0]?.severity).toBe("warning");
		const text = notifies[0]?.text ?? "";
		expect(text).toContain("keyrouter");
		expect(text).toContain("zai");
		expect(text).toContain("primary");
		expect(text).toContain("backup");
		expect(text).toContain("429");
		expect(text).toContain("rate-limited");
		// One line — no embedded newlines.
		expect(text.includes("\n")).toBe(false);
	});

	test("handles unauthorized reason", () => {
		const { ui, notifies } = makeMockUi();
		notifyRotation(ui as never, { ...sampleEvent, reason: "unauthorized", status: 401 });
		expect(notifies[0]?.text).toContain("401");
		expect(notifies[0]?.text).toContain("unauthorized");
	});

	test("is silent when ui.notify throws (headless)", () => {
		const ui = {
			setWidget: () => {},
			notify: () => {
				throw new Error("no UI");
			},
		};
		expect(() => notifyRotation(ui as never, sampleEvent)).not.toThrow();
	});
});

describe("notifyOverloaded", () => {
	test("emits a warning notify with provider and cooldown seconds", () => {
		const { ui, notifies } = makeMockUi();
		notifyOverloaded(ui as never, "zai", 30_000);
		expect(notifies.length).toBe(1);
		expect(notifies[0]?.severity).toBe("warning");
		const text = notifies[0]?.text ?? "";
		expect(text).toContain("zai");
		expect(text).toContain("overloaded");
		expect(text).toContain("30s");
		expect(text).toContain("no key change");
	});

	test("rounds cooldown up to whole seconds", () => {
		const { ui, notifies } = makeMockUi();
		notifyOverloaded(ui as never, "anthropic", 12_500); // 12.5s -> 13s
		expect(notifies[0]?.text).toContain("13s");
	});

	test("never reports less than 1s", () => {
		const { ui, notifies } = makeMockUi();
		notifyOverloaded(ui as never, "anthropic", 250); // 0.25s -> 1s
		expect(notifies[0]?.text).toContain("1s");
	});
});

describe("notifyExhausted", () => {
	test("emits an error notify with provider and failed key list", () => {
		const { ui, notifies } = makeMockUi();
		notifyExhausted(ui as never, "zai", ["primary", "backup"]);
		expect(notifies.length).toBe(1);
		expect(notifies[0]?.severity).toBe("error");
		const text = notifies[0]?.text ?? "";
		expect(text).toContain("zai");
		expect(text).toContain("exhausted");
		expect(text).toContain("primary");
		expect(text).toContain("backup");
	});

	test("handles empty failed-key list", () => {
		const { ui, notifies } = makeMockUi();
		notifyExhausted(ui as never, "zai", []);
		expect(notifies[0]?.text).toContain("(none)");
	});
});

describe("clearRotationWidget (compat shim)", () => {
	test("does not throw when ui.setWidget is absent", () => {
		const ui: MockUi = {
			setWidget: () => {
				throw new Error("not supported");
			},
			notify: () => {},
		};
		expect(() => clearRotationWidget(ui as never)).not.toThrow();
	});

	test("clears the legacy widget key when setWidget is available", () => {
		const cleared: Array<{ key: string; content: unknown }> = [];
		const ui: MockUi = {
			setWidget: (key, content) => cleared.push({ key, content }),
			notify: () => {},
		};
		clearRotationWidget(ui as never);
		expect(cleared.length).toBe(1);
		expect(cleared[0]?.key).toBe("keyrouter-rotation");
		expect(cleared[0]?.content).toBeUndefined();
	});
});
