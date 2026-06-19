// =============================================================================
// context-manager.ts — single owner of pi's `context` channel
// =============================================================================
//
// pi fires a `context` event before each LLM call; a handler may return
// `{ messages }` to replace what the model sees for that one call. Only ONE
// owner should do this, or rewriters fight. soly takes ownership here and
// exposes a single pluggable rewriter slot — workflows (e.g. `/verify`'s
// fresh-context mode) install/remove a rewriter through this manager instead
// of each registering their own `context` handler.
//
// The rewriter must return a subset/reordering of the SAME message objects it
// is given (never fabricate messages — their full shape is owned by pi). The
// handler is fail-safe: a throwing rewriter leaves the turn untouched.
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Minimal message shape the manager needs (pi's AgentMessage is a superset). */
export type AgentMessageLike = { role: string };

/** Transforms the message list for the next LLM call. Returns real messages. */
export type ContextRewriter = (messages: AgentMessageLike[]) => AgentMessageLike[];

export type ContextManager = {
	/** Install a rewriter, or pass null to restore pass-through. */
	setRewriter(rewriter: ContextRewriter | null): void;
	/** Whether a rewriter is currently active. */
	hasRewriter(): boolean;
};

/** Create the manager and register the single `context` handler. */
export function createContextManager(pi: ExtensionAPI): ContextManager {
	let rewriter: ContextRewriter | null = null;

	pi.on("context", (event) => {
		if (!rewriter) return;
		try {
			const messages = rewriter(event.messages) as typeof event.messages;
			return { messages };
		} catch {
			return; // never break a turn over a rewriter bug
		}
	});

	return {
		setRewriter(next): void {
			rewriter = next;
		},
		hasRewriter(): boolean {
			return rewriter !== null;
		},
	};
}
