// =============================================================================
// scratchpad.ts — Working memory tool support
// =============================================================================
//
// Reads the recent conversation history (filtered to current branch) and
// produces a compact "scratchpad" summary: each turn's user prompt + first
// line of the assistant response. Used by soly_scratchpad tool to give the
// model (or a sibling context) cheap access to "what we just discussed".
//
// Pure: this module has no I/O and no state. It operates on the session
// branch that the LLM tool handler passes in.
// =============================================================================

const SCRATCHPAD_MAX_TURNS = 50;

export interface ScratchpadEntry {
	turn: number;
	role: "user" | "assistant" | "tool";
	summary: string;
	/** Tokens estimated for this entry. */
	tokens: number;
}

export interface Scratchpad {
	branchLength: number;
	turnCount: number;
	entries: ScratchpadEntry[];
	fromTurn: number;
}

/** Extract a short, useful summary from a message's text content. */
function summarizeMessage(role: string, text: string, maxLen = 200): string {
	if (!text) return "";
	const trimmed = text.trim();
	if (!trimmed) return "";
	if (role === "tool") {
		// Tool results: just first non-empty line
		const first = trimmed.split(/\r?\n/).find((l) => l.trim());
		return (first ?? "").slice(0, maxLen);
	}
	// For user/assistant: take the first paragraph or first maxLen chars
	const firstPara = trimmed.split(/\r?\n\s*\r?\n/)[0] ?? trimmed;
	return firstPara.length > maxLen
		? firstPara.slice(0, maxLen) + "…"
		: firstPara;
}

/** Extract plain text from a message's content array. */
function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (
				block &&
				typeof block === "object" &&
				"type" in block &&
				(block as { type: string }).type === "text" &&
				"text" in block &&
				typeof (block as { text: unknown }).text === "string"
			) {
				parts.push((block as { text: string }).text);
			}
		}
		return parts.join("\n");
	}
	return "";
}

/** Build a scratchpad of recent conversation turns. */
export function buildScratchpad(
	entries: readonly { type: string; message?: { role?: string; content?: unknown } }[],
	limit = 20,
): Scratchpad {
	// Walk backwards, collect messages, stop at limit turns (user prompts)
	const collected: ScratchpadEntry[] = [];
	let userTurnCount = 0;
	const startIdx = entries.length;

	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type !== "message" || !e.message) continue;
		const role = e.message.role ?? "user";
		const text = messageText(e.message.content);
		const summary = summarizeMessage(role, text);
		if (!summary) continue;
		collected.unshift({
			turn: startIdx - i,
			role: role as ScratchpadEntry["role"],
			summary,
			tokens: Math.ceil(summary.length / 4),
		});
		if (role === "user") {
			userTurnCount++;
			if (userTurnCount >= limit) {
				return {
					branchLength: entries.length,
					turnCount: userTurnCount,
					entries: collected,
					fromTurn: startIdx - i,
				};
			}
		}
	}

	return {
		branchLength: entries.length,
		turnCount: userTurnCount,
		entries: collected,
		fromTurn: 1,
	};
}

export const SCRATCHPAD_LIMITS = {
	default: 20,
	max: SCRATCHPAD_MAX_TURNS,
} as const;
