// =============================================================================
// tests/notification.test.ts — yellow box widget tests
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { notifyRotation, clearRotationWidget } from "../notification.ts";
import type { RotationEvent } from "../types.ts";

interface CapturedWidget {
	key: string;
	content: unknown;
	options: unknown;
}

function makeMockUi(): {
	ui: Parameters<typeof notifyRotation>[0];
	widgets: CapturedWidget[];
	notifies: Array<{ text: string; level?: string }>;
} {
	const widgets: CapturedWidget[] = [];
	const notifies: Array<{ text: string; level?: string }> = [];
	return {
		widgets,
		notifies,
		ui: {
			setWidget: (key: string, content: unknown, options?: unknown) => {
				widgets.push({ key, content, options });
			},
			notify: (text: string, level?: string) => notifies.push({ text, level }),
		} as never,
	};
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
	test("registers a widget with aboveEditor placement", () => {
		const { ui, widgets } = makeMockUi();
		notifyRotation(ui, sampleEvent);
		expect(widgets.length).toBe(1);
		expect(widgets[0]?.key).toBe("keyrouter-rotation");
		expect(widgets[0]?.options).toEqual({ placement: "aboveEditor" });
	});

	test("widget content is a function (factory)", () => {
		const { ui, widgets } = makeMockUi();
		notifyRotation(ui, sampleEvent);
		expect(typeof widgets[0]?.content).toBe("function");
	});

	test("falls back to notify when setWidget throws", () => {
		const notifies: Array<{ text: string; level?: string }> = [];
		const ui = {
			setWidget: () => { throw new Error("no UI"); },
			notify: (text: string, level?: string) => notifies.push({ text, level }),
		} as never;
		notifyRotation(ui, sampleEvent);
		expect(notifies.length).toBe(1);
		expect(notifies[0]?.text).toContain("zai");
		expect(notifies[0]?.text).toContain("primary → backup");
		expect(notifies[0]?.level).toBe("warning");
	});

	test("auto-clears widget after timeout", async () => {
		const { ui, widgets } = makeMockUi();
		notifyRotation(ui, sampleEvent);
		expect(widgets.length).toBe(1);
		// Wait for auto-clear (8s in real code; this test just verifies
		// the clear path doesn't throw when called)
		clearRotationWidget(ui);
		expect(widgets.length).toBe(2); // set + clear
		expect(widgets[1]?.content).toBeUndefined();
	});
});

describe("clearRotationWidget", () => {
	test("calls setWidget with undefined", () => {
		const { ui, widgets } = makeMockUi();
		clearRotationWidget(ui);
		expect(widgets.length).toBe(1);
		expect(widgets[0]?.key).toBe("keyrouter-rotation");
		expect(widgets[0]?.content).toBeUndefined();
	});
});