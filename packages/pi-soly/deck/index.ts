// =============================================================================
// index.ts — pi-deck extension entry point
// =============================================================================
//
// Registers one LLM tool: `decision_deck`. Presents a single design/architecture
// decision as a full-screen stack of cards (one per option) that the user flips
// through and picks from. Each card carries a title, summary, optional code
// snippet, and pros/cons — so the user compares concrete shapes, not just labels.
//
// When to reach for it over ask_pro: the choice hinges on seeing the code/structure
// of each option side-by-side, and a thin preview column isn't enough. Native TUI
// (no browser, no server). Returns the chosen option index in one call.
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { highlightCode } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DeckComponent, type DeckResult } from "./deck.ts";

export default function piDeckExtension(pi: ExtensionAPI) {
	// Usage guidance lives in the soly-framework skill + the main soly prompt
	// pointer — not injected here.
	pi.registerTool({
		name: "decision_deck",
		label: "soly · decision_deck",
		description:
			"Present ONE design/architecture decision as a full-screen deck of cards (one per option) the user flips through (←/→ or 1-N) and picks with Enter. Use when comparing global architectural forks (architecture, API shape, data model) where each option needs its own card with code + pros/cons to be properly weighed against its counterweight — trade-offs that genuinely pull in different directions (e.g. consistency vs availability, sync vs async). STRICTLY ONE question per call — for 2+ related questions in one batch, use `ask_pro` instead. For local sub-questions inside an already-decided theme, or simple label-vs-label «или/или», `ask_pro` is lighter. Default to `ask_pro` unless the stakes are global. The user can attach a free-text note (rationale, caveats) via `n`; it's returned in the result. Native TUI. Returns the chosen option.",
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "Decision title." })),
			prompt: Type.Optional(Type.String({ description: "Question shown above the cards." })),
			options: Type.Array(
				Type.Object({
					title: Type.String({ description: "Card title." }),
					summary: Type.Optional(Type.String({ description: "1-3 sentence explanation." })),
					code: Type.Optional(
						Type.String({ description: "Raw code snippet (no fences); set `lang` to highlight." }),
					),
					lang: Type.Optional(Type.String({ description: "Highlight language (e.g. 'ts')." })),
					pros: Type.Optional(Type.Array(Type.String(), { description: "Upsides (+)." })),
					cons: Type.Optional(Type.Array(Type.String(), { description: "Downsides (−)." })),
					recommended: Type.Optional(
						Type.Boolean({ description: "⭐ recommended (cursor starts here, at most one)." }),
					),
				}),
				{ description: "2-6 options to compare." },
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "decision_deck requires a UI-capable session (TUI). Run from the interactive pi TUI.",
						},
					],
					details: { error: "no_ui", mode: ctx.mode },
				};
			}
			if (params.options.length < 2 || params.options.length > 6) {
				return {
					content: [
						{
							type: "text",
							text: `decision_deck: ${params.options.length} options, need 2-6.`,
						},
					],
					details: { error: "bad_option_count", count: params.options.length },
				};
			}
			const recommended = params.options.filter((o) => o.recommended).length;
			if (recommended > 1) {
				return {
					content: [
						{ type: "text", text: `decision_deck: ${recommended} recommended, at most 1 allowed.` },
					],
					details: { error: "multiple_recommended" },
				};
			}

			const result = await ctx.ui.custom<DeckResult>((_tui, theme, keybindings, done) => {
				const deckTheme = theme as unknown as ConstructorParameters<typeof DeckComponent>[0]["theme"];
				return new DeckComponent({
					options: params.options,
					theme: deckTheme,
					keybindings,
					done,
					title: params.title ?? "decision",
					prompt: params.prompt,
					highlight: highlightCode,
				});
			});

			if (result.cancelled || result.chosen === undefined) {
				return {
					content: [{ type: "text", text: "(user cancelled the deck — no choice made)" }],
					details: { cancelled: true },
				};
			}

			const chosen = result.chosen;
			const opt = params.options[chosen];
			const note = result.note?.trim() ?? "";
			const text = note
				? `User chose option ${chosen + 1}: "${opt?.title ?? "?"}".  // note: "${note}"`
				: `User chose option ${chosen + 1}: "${opt?.title ?? "?"}".`;
			return {
				content: [{ type: "text", text }],
				details: { chosen, title: opt?.title, note: note || undefined },
			};
		},
	});
}
