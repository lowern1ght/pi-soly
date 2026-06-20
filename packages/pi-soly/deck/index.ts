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
import { buildDeckSection } from "./prompt.ts";

export default function piDeckExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		return { systemPrompt: event.systemPrompt + buildDeckSection() };
	});

	pi.registerTool({
		name: "decision_deck",
		label: "soly · decision_deck",
		description:
			"Present ONE design/architecture decision as a full-screen deck of cards — one option per card — that the user flips through (←/→ or 1-N) and picks with Enter. Each option takes `{ title, summary?, code?, lang?, pros?, cons?, recommended? }`. Use it (instead of ask_pro) when the decision hinges on comparing the concrete code shape / structure of each option and a thin side-panel isn't enough. 2-6 options. Native TUI — no browser. Returns the chosen option.",
		parameters: Type.Object({
			title: Type.Optional(
				Type.String({ description: "Short decision title (e.g. 'State management')." }),
			),
			prompt: Type.Optional(
				Type.String({ description: "The question being decided, shown above the cards." }),
			),
			options: Type.Array(
				Type.Object({
					title: Type.String({ description: "Card title (1-4 words)." }),
					summary: Type.Optional(
						Type.String({ description: "1-3 sentence explanation of this option." }),
					),
					code: Type.Optional(
						Type.String({
							description:
								"Code snippet showing the shape of this option (no fences — pass raw code; set `lang` for highlighting).",
						}),
					),
					lang: Type.Optional(
						Type.String({ description: "Language for syntax highlighting (e.g. 'ts', 'py')." }),
					),
					pros: Type.Optional(
						Type.Array(Type.String(), { description: "Upsides, shown as green '+' lines." }),
					),
					cons: Type.Optional(
						Type.Array(Type.String(), { description: "Downsides, shown as '−' lines." }),
					),
					recommended: Type.Optional(
						Type.Boolean({ description: "Mark the ⭐ recommended option (cursor starts here)." }),
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
			return {
				content: [
					{
						type: "text",
						text: `User chose option ${chosen + 1}: "${opt?.title ?? "?"}".`,
					},
				],
				details: { chosen, title: opt?.title },
			};
		},
	});
}
