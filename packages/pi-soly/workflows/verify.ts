// =============================================================================
// workflows/verify.ts — self-review loop ("fresh eyes") for `soly verify`
// =============================================================================
//
// Repeatedly asks the model to review its own work until it reports nothing
// left to fix, or a max-iteration cap is hit. Driven by the `agent_end` event:
// after each turn we read the assistant's last message, decide exit vs. loop,
// and (if looping) re-inject the review prompt via sendUserMessage.
//
// Optional fresh-context mode strips prior review iterations from the model's
// view through the shared context-manager — the agent re-reviews with genuinely
// fresh eyes instead of through the lens of its earlier passes. We only ever
// drop real messages (slice), never fabricate; the "re-read the plan" nudge
// lives in the review prompt text, so no synthetic messages are needed.
//
// Pure helpers (exit detection, message slicing) are exported for unit tests.
// =============================================================================

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMessageLike, ContextManager, ContextRewriter } from "../context-manager.ts";

/** Resolved verify settings (from soly config `verify`). */
export type VerifyConfig = {
	maxIterations: number;
	freshContext: boolean;
	prompt: string;
	exitPatterns: string[];
	issuesFixedPatterns: string[];
};

export type VerifyState = { active: boolean; iteration: number; max: number; fresh: boolean };

export type VerifyDeps = {
	contextManager: ContextManager;
	getConfig: () => VerifyConfig;
	/** Notified whenever the loop state changes (drives the chrome top bar). */
	onState: (state: VerifyState) => void;
};

export type VerifyStartOpts = { max?: number; fresh?: boolean };

export type VerifyLoop = {
	isActive: () => boolean;
	start: (ctx: ExtensionContext, opts?: VerifyStartOpts) => void;
	stop: (ctx: ExtensionContext | undefined, reason: string) => void;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Extract plain text from a message's content (string or text-block array). */
export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
			const t = (block as { text?: unknown }).text;
			if (typeof t === "string") parts.push(t);
		}
	}
	return parts.join("\n");
}

/** Compile pattern strings into case-insensitive RegExps, skipping invalid ones. */
export function compilePatterns(patterns: string[]): RegExp[] {
	const out: RegExp[] = [];
	for (const p of patterns) {
		try {
			out.push(new RegExp(p, "i"));
		} catch {
			/* skip malformed pattern */
		}
	}
	return out;
}

/**
 * Exit only when the text signals "done" AND does NOT also signal that issues
 * were fixed — so "Fixed 3 issues. No issues found." keeps looping (the fix
 * may have introduced new problems), but a clean "No issues found." exits.
 */
export function shouldExit(text: string, exit: RegExp[], fixed: RegExp[]): boolean {
	const matched = (res: RegExp[]) => res.some((r) => r.test(text));
	return matched(exit) && !matched(fixed);
}

/** Index of the last user message, or -1. */
export function lastUserIndex(messages: AgentMessageLike[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "user") return i;
	}
	return -1;
}

/**
 * Fresh-eyes view: keep the conversation before the loop began (`boundary` =
 * index of the first review prompt) plus the current review prompt onward,
 * dropping the in-between prior iterations. Returns the input unchanged on the
 * first pass (boundary === last user message).
 */
export function freshContextMessages<T extends AgentMessageLike>(messages: T[], boundary: number): T[] {
	if (boundary < 0 || boundary >= messages.length) return messages;
	const current = lastUserIndex(messages);
	if (current <= boundary) return messages;
	return [...messages.slice(0, boundary), ...messages.slice(current)];
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

/** Create the verify loop and register its `agent_end` + `input` handlers. */
export function createVerifyLoop(pi: ExtensionAPI, deps: VerifyDeps): VerifyLoop {
	let active = false;
	let iteration = 0;
	let max = 0;
	let fresh = false;
	let boundary = -1;
	let exitRes: RegExp[] = [];
	let fixedRes: RegExp[] = [];

	const emit = () => deps.onState({ active, iteration, max, fresh });

	// Captures the boundary on the first call, then strips prior iterations.
	const rewriter: ContextRewriter = (messages) => {
		if (boundary < 0) {
			boundary = lastUserIndex(messages);
			return messages;
		}
		return freshContextMessages(messages, boundary);
	};

	const stop = (ctx: ExtensionContext | undefined, reason: string): void => {
		if (!active) return;
		active = false;
		boundary = -1;
		deps.contextManager.setRewriter(null);
		emit();
		ctx?.ui.notify(`soly verify: ${reason}`, "info");
	};

	pi.on("agent_end", async (event, ctx) => {
		if (!active) return;
		const last = [...event.messages].reverse().find((m) => m.role === "assistant");
		const text = extractText((last as { content?: unknown } | undefined)?.content);
		iteration++;
		if (!text.trim()) {
			stop(ctx, iteration === 1 ? "nothing to review" : "done");
			return;
		}
		if (shouldExit(text, exitRes, fixedRes)) {
			stop(ctx, "no issues found");
			return;
		}
		if (iteration >= max) {
			stop(ctx, `stopped after ${max} iterations`);
			return;
		}
		emit();
		pi.sendUserMessage(deps.getConfig().prompt, { deliverAs: "followUp" });
	});

	// Any interactive input (other than re-invoking verify) breaks the loop.
	pi.on("input", async (event, ctx) => {
		if (!active || event.source !== "interactive") return;
		if (event.text.trim().toLowerCase().startsWith("soly verify")) return;
		stop(ctx, "interrupted");
	});

	return {
		isActive: () => active,
		start(ctx, opts = {}): void {
			if (active) {
				ctx.ui.notify("soly verify: already running", "info");
				return;
			}
			const cfg = deps.getConfig();
			active = true;
			iteration = 0;
			boundary = -1;
			max = Math.max(1, opts.max ?? cfg.maxIterations);
			fresh = opts.fresh ?? cfg.freshContext;
			exitRes = compilePatterns(cfg.exitPatterns);
			fixedRes = compilePatterns(cfg.issuesFixedPatterns);
			if (fresh) deps.contextManager.setRewriter(rewriter);
			emit();
			ctx.ui.notify(`soly verify: review mode on (max ${max}${fresh ? ", fresh context" : ""})`, "info");
			pi.sendUserMessage(cfg.prompt);
		},
		stop,
	};
}
