// =============================================================================
// tests/verify.test.ts — self-review loop + context manager
// =============================================================================
//
// Pure helpers (exit detection, fresh-context slicing, text extraction) plus a
// mock-pi integration that drives the loop through start → loop → exit, max
// cap, interrupt, and fresh-context rewriter install/teardown.
// =============================================================================

import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createContextManager, type ContextRewriter } from "../context-manager.ts";
import {
	compilePatterns,
	createVerifyLoop,
	extractText,
	freshContextMessages,
	lastUserIndex,
	shouldExit,
	type VerifyConfig,
	type VerifyState,
} from "../workflows/verify.ts";
import { parseSolyCommand } from "../workflows/parser.ts";

const CFG: VerifyConfig = {
	maxIterations: 3,
	freshContext: false,
	prompt: "REVIEW",
	exitPatterns: ["no issues found", "nothing to fix"],
	issuesFixedPatterns: ["fixed \\d+ issue", "ready for another review"],
};

describe("verify pure helpers", () => {
	test("extractText handles strings and text blocks", () => {
		expect(extractText("hello")).toBe("hello");
		expect(extractText([{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }])).toBe("a\nb");
		expect(extractText(undefined)).toBe("");
	});

	test("compilePatterns skips invalid regex", () => {
		expect(compilePatterns(["ok", "(unclosed"]).length).toBe(1);
	});

	test("shouldExit: exit phrase wins only without a fix signal", () => {
		const exit = compilePatterns(CFG.exitPatterns);
		const fixed = compilePatterns(CFG.issuesFixedPatterns);
		expect(shouldExit("No issues found.", exit, fixed)).toBe(true);
		expect(shouldExit("Fixed 3 issues. No issues found.", exit, fixed)).toBe(false);
		expect(shouldExit("Still working on it.", exit, fixed)).toBe(false);
	});

	test("lastUserIndex / freshContextMessages", () => {
		const msgs = [{ role: "user" }, { role: "assistant" }, { role: "user" }, { role: "assistant" }, { role: "user" }];
		expect(lastUserIndex(msgs)).toBe(4);
		// boundary = first review prompt at index 2; pass keeps 0..1 + 4..end
		expect(freshContextMessages(msgs, 2)).toEqual([{ role: "user" }, { role: "assistant" }, { role: "user" }]);
		// first pass (boundary === last user) → unchanged
		expect(freshContextMessages(msgs, 4)).toEqual(msgs);
	});
});

describe("context manager", () => {
	function mockPi() {
		const handlers: Array<(e: unknown) => unknown> = [];
		const pi = { on: (_ev: string, h: (e: unknown) => unknown) => handlers.push(h) } as unknown as ExtensionAPI;
		return { pi, fire: (messages: unknown[]) => handlers[0]?.({ messages }) };
	}

	test("applies rewriter, passes through when none, swallows throws", () => {
		const { pi, fire } = mockPi();
		const cm = createContextManager(pi);
		expect(fire([{ role: "user" }])).toBeUndefined(); // no rewriter → pass-through

		const rev: ContextRewriter = (m) => m.slice(0, 1);
		cm.setRewriter(rev);
		expect(fire([{ role: "user" }, { role: "assistant" }])).toEqual({ messages: [{ role: "user" }] });

		cm.setRewriter(() => {
			throw new Error("boom");
		});
		expect(fire([{ role: "user" }])).toBeUndefined(); // throw → untouched turn

		cm.setRewriter(null);
		expect(cm.hasRewriter()).toBe(false);
	});
});

describe("verify loop (mock pi)", () => {
	type Handler = (event: unknown, ctx: unknown) => unknown;

	function harness(cfg: VerifyConfig = CFG) {
		const handlers = new Map<string, Handler[]>();
		const sent: string[] = [];
		const states: VerifyState[] = [];
		let rewriter: ContextRewriter | null = null;
		const pi = {
			on: (ev: string, h: Handler) => handlers.set(ev, [...(handlers.get(ev) ?? []), h]),
			sendUserMessage: (text: string) => sent.push(text),
		} as unknown as ExtensionAPI;
		const loop = createVerifyLoop(pi, {
			contextManager: { setRewriter: (r) => (rewriter = r), hasRewriter: () => rewriter !== null },
			getConfig: () => cfg,
			onState: (s) => states.push(s),
		});
		const ctx = { ui: { notify: () => {} } } as unknown as ExtensionContext;
		const endTurn = (text: string) =>
			Promise.all((handlers.get("agent_end") ?? []).map((h) => h({ messages: [{ role: "assistant", content: text }] }, ctx)));
		const input = (text: string) =>
			Promise.all((handlers.get("input") ?? []).map((h) => h({ source: "interactive", text }, ctx)));
		return { loop, ctx, sent, states, endTurn, input, getRewriter: () => rewriter };
	}

	test("start sends the prompt, loops on non-exit, exits on 'no issues'", async () => {
		const h = harness();
		h.loop.start(h.ctx);
		expect(h.loop.isActive()).toBe(true);
		expect(h.sent).toEqual(["REVIEW"]);

		await h.endTurn("Fixed 2 issues. Ready for another review."); // exit phrase absent → loop
		expect(h.loop.isActive()).toBe(true);
		expect(h.sent.length).toBe(2);

		await h.endTurn("No issues found."); // clean → stop
		expect(h.loop.isActive()).toBe(false);
	});

	test("stops at maxIterations", async () => {
		const h = harness();
		h.loop.start(h.ctx);
		await h.endTurn("still working"); // iter 1
		await h.endTurn("still working"); // iter 2
		expect(h.loop.isActive()).toBe(true);
		await h.endTurn("still working"); // iter 3 === max → stop
		expect(h.loop.isActive()).toBe(false);
	});

	test("interactive input interrupts; re-invoking verify does not", async () => {
		const h = harness();
		h.loop.start(h.ctx);
		await h.input("soly verify"); // guard: must NOT stop
		expect(h.loop.isActive()).toBe(true);
		await h.input("do something else"); // interrupt
		expect(h.loop.isActive()).toBe(false);
	});

	test("fresh-context installs a rewriter and clears it on stop", async () => {
		const h = harness({ ...CFG, freshContext: true });
		h.loop.start(h.ctx);
		expect(typeof h.getRewriter()).toBe("function");
		await h.endTurn("No issues found.");
		expect(h.getRewriter()).toBeNull();
	});
});

describe("parser: verify verb", () => {
	test("parses verify with args", () => {
		expect(parseSolyCommand("soly verify")?.verb).toBe("verify");
		expect(parseSolyCommand("soly verify 5 fresh")?.args).toEqual(["5", "fresh"]);
		expect(parseSolyCommand("soly verify stop")?.args).toEqual(["stop"]);
	});
});
