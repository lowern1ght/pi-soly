// =============================================================================
// visual/tool-render.ts — custom renderCall for soly tools
// =============================================================================
//
// pi lets tools customize how their call/result appears in the chat via
// `renderCall` / `renderResult` on the ToolDefinition. Without these, pi
// falls back to its default box (┌─ toolname ─┐ with JSON args inside).
//
// Soly tools use a distinctive compact style instead:
//
//   ◈ soly_config · get "mode"
//   ◈ soly_snippet · core.ts:50-80
//   ◈ soly_doc_search · "quota" (3 hits)
//
// One line, no box. The ◈ glyph (U+25C8) is our signature — monochrome,
// BMP-safe, visually distinct from pi's native tools which use bold names
// inside boxes.
//
// For results, we return a Text with the first few lines of output (pi
// handles expand/collapse natively via `expanded` in ToolRenderResultOptions).
// =============================================================================

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

/** Signature glyph for all soly tools. */
const SOLY_GLYPH = "◈";

/** Build a compact one-line call display for a soly tool.
 *  `detail` is a short summary of the key args (e.g. `get "mode"`). */
export function renderSolyCall(
	theme: Theme,
	toolName: string,
	detail: string,
	lastComponent?: unknown,
): Text {
	const text = (lastComponent as Text | undefined) ?? new Text("", 0, 0);
	const label = theme.fg("accent", theme.bold(`${SOLY_GLYPH} ${toolName}`));
	const sep = theme.fg("dim", " · ");
	const args = theme.fg("toolOutput", detail);
	text.setText(`${label}${sep}${args}`);
	return text;
}

/** Build a compact result display for a soly tool.
 *  `summary` is a short one-liner (e.g. `mode = "phases"`).
 *  `extra` is optional additional lines. */
export function renderSolyResult(
	theme: Theme,
	summary: string,
	extra: string[] | undefined,
	lastComponent?: unknown,
): Text {
	const text = (lastComponent as Text | undefined) ?? new Text("", 0, 0);
	const lines = [theme.fg("toolOutput", summary)];
	if (extra && extra.length > 0) {
		lines.push(...extra.map((l) => theme.fg("muted", l)));
	}
	text.setText(lines.join("\n"));
	return text;
}

// ---------------------------------------------------------------------------
// Per-tool call detail extractors — pull the most useful arg for the one-liner.
// ---------------------------------------------------------------------------

/** Format args for the call line. Returns a short string like `get "mode"`. */
export function callDetail(toolName: string, args: Record<string, unknown>): string {
	switch (toolName) {
		case "soly-config":
			return `${args.action ?? "?"}${args.key ? ` "${args.key}"` : ""}`;
		case "soly-settings-set": {
			const changes = args.changes as Record<string, unknown> | undefined;
			if (!changes) return "?";
			const keys = Object.keys(changes);
			if (keys.length === 1) {
				return `${keys[0]} → ${JSON.stringify(changes[keys[0]])}`;
			}
			return `${keys.length} changes`;
		}
		case "soly-doc-search":
			return `"${args.query ?? ""}"${args.limit ? ` (limit ${args.limit})` : ""}`;
		case "soly-snippet": {
			const p = String(args.path ?? "");
			const off = args.offset ? `:${args.offset}` : "";
			const lim = args.limit ? `-${args.limit}` : "";
			return `${p}${off}${lim}`;
		}
		case "soly-read": {
			const a = String(args.artifact ?? "");
			return `${a}${args.phase ? ` · phase ${args.phase}` : ""}`;
		}
		case "soly-log-decision": {
			const d = String(args.decision ?? "");
			return d.length > 60 ? `${d.slice(0, 57)}…` : d;
		}
		case "soly-list-tasks":
			return "";
		case "soly-list-phases":
			return "";
		default:
			return "";
	}
}
