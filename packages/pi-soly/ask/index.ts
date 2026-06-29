// =============================================================================
// index.ts — pi-ask extension entry point
// =============================================================================
//
// Registers one LLM tool: `ask_pro`. Lets the LLM ask the user a list of
// questions at once via a tabbed picker (tabs, numbered
// options, ⭐ recommended answer, optional multi-select). All answers
// returned in a single call.
//
// Usage from another extension / LLM:
//   ask_pro({
//     questions: [
//       { header: "Auth", question: "Which auth?", options: [...], multiSelect: false },
//       { header: "Tokens", question: "Token storage?", options: [...] },
//     ]
//   })
// → { answers: { 0: 1, 1: 0 } }   or   { cancelled: true }
//
// Generic — not soly-specific. Any pi extension that needs multi-question
// Q&A can use this.
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { highlightCode } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AskProComponent, type AskProResult } from "./picker.ts";

type ToolError = {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
};

type BoundsCheck = {
	header: string;
	multiSelect?: boolean;
	minSelect?: number;
	maxSelect?: number;
	allowOther?: boolean;
	options: unknown[];
};

/** Validate multi-select min/max bounds. Returns a tool error, or null if OK.
 *  No-op for single-select questions. */
function validateSelectBounds(q: BoundsCheck, i: number): ToolError | null {
	if (!q.multiSelect) return null;
	const max = q.options.length + (q.allowOther ? 1 : 0);
	const err = (text: string, error: string): ToolError => ({
		content: [{ type: "text", text: `ask_pro: Q${i + 1} ("${q.header}") ${text}` }],
		details: { error, questionIdx: i },
	});
	if (q.minSelect !== undefined && (q.minSelect < 1 || q.minSelect > max)) {
		return err(`minSelect ${q.minSelect} out of range (1-${max}).`, "bad_min_select");
	}
	if (q.maxSelect !== undefined && (q.maxSelect < 1 || q.maxSelect > max)) {
		return err(`maxSelect ${q.maxSelect} out of range (1-${max}).`, "bad_max_select");
	}
	if (
		q.minSelect !== undefined &&
		q.maxSelect !== undefined &&
		q.minSelect > q.maxSelect
	) {
		return err(`minSelect ${q.minSelect} > maxSelect ${q.maxSelect}.`, "min_gt_max");
	}
	return null;
}

export default function piAskExtension(pi: ExtensionAPI) {
	// Usage guidance lives in the soly-framework skill (loaded on demand) +
	// a one-line pointer in the main soly system prompt — not injected here.
	pi.registerTool({
		name: "ask_pro",
		label: "soly · ask_pro",
		description:
			"Ask the user one or more questions at once via a tabbed picker (≤6 questions); returns all answers in one call. USE WHEN: (a) you have 2+ related questions to gather in one batch, OR (b) the choice is local — a sub-question inside an already-decided theme, or a simple label-vs-label «или/или» that doesn't justify a full-screen deck. Each option is a short label + 1-2 sentence description (no per-option code, no pros/cons). For a global architectural fork with real counterweight between options, use `decision_deck` instead. Per question: single-select (default), `multiSelect` (+ `minSelect`/`maxSelect`), or `freeText` (typed answer, no options). **Every options question automatically includes a free-text 'Other…' choice — the user can always answer in their own words, so never add a manual «other/custom» option yourself.** Per option: `recommended` (⭐) and `preview` (side panel, fenced code highlighted). User can skip (`s`) or note (`n`). Prefer this over one-by-one questions.",
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					header: Type.String({ description: "Tab label (1-2 words)." }),
					question: Type.String({ description: "The question." }),
					options: Type.Array(
						Type.Object({
							label: Type.String({ description: "Short label." }),
							description: Type.Optional(
								Type.String({ description: "1-2 sentence explanation, shown below the label." }),
							),
							recommended: Type.Optional(
								Type.Boolean({ description: "Mark ⭐ recommended (at most one)." }),
							),
							preview: Type.Optional(
								Type.String({
									description:
										"Snippet shown in a side panel when focused (code shape, signature, sample). Fenced ```code is highlighted.",
								}),
							),
						}),
						{ description: "2-4 options. Empty ([]) when freeText is true." },
					),
					multiSelect: Type.Optional(
						Type.Boolean({ description: "Allow multiple picks (default single-select)." }),
					),
					allowOther: Type.Optional(
						Type.Boolean({
							description:
								"Ignored — a free-text 'Other…' choice is always added to every options question automatically. Kept for backward compatibility.",
						}),
					),
					minSelect: Type.Optional(
						Type.Number({ description: "Multi-select: min picks (default 1)." }),
					),
					maxSelect: Type.Optional(
						Type.Number({ description: "Multi-select: max picks (default: no limit)." }),
					),
					freeText: Type.Optional(
						Type.Boolean({
							description: "No options — user types an answer (optional, blank allowed).",
						}),
					),
				}),
				{ description: "Questions in tab order (≤5 recommended)." },
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			// --- safety: UI required ---
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "ask_pro requires a UI-capable session (TUI or RPC mode). Run from the interactive pi TUI.",
						},
					],
					details: { error: "no_ui", mode: ctx.mode },
				};
			}

			// --- validation ---
			if (params.questions.length === 0) {
				return {
					content: [
						{ type: "text", text: "ask_pro: at least one question is required" },
					],
					details: { error: "no_questions" },
				};
			}
			if (params.questions.length > 6) {
				return {
					content: [
						{
							type: "text",
							text: `ask_pro: ${params.questions.length} questions is a lot; max 6 recommended for UX (more = more tab-switching fatigue).`,
						},
					],
					details: { error: "too_many_questions", count: params.questions.length },
				};
			}

			// Always offer a free-text "Other…" on every options question, so the
			// user can answer in their own words even when no option fits. This is
			// enforced here (not left to the model) so the escape hatch is
			// guaranteed on every question. `freeText` questions are already
			// free-form, so leave them untouched. Done before validation so the
			// synthetic "Other…" slot is counted in multi-select bounds.
			for (const q of params.questions) {
				if (q && !q.freeText) q.allowOther = true;
			}

			for (let i = 0; i < params.questions.length; i++) {
				const q = params.questions[i];
				if (!q) continue;
				// Free-text questions carry no options — skip the option checks.
				if (q.freeText) {
					if (q.multiSelect) {
						return {
							content: [
								{
									type: "text",
									text: `ask_pro: Q${i + 1} ("${q.header}") can't be both freeText and multiSelect.`,
								},
							],
							details: { error: "freetext_multiselect", questionIdx: i },
						};
					}
					continue;
				}
				if (q.options.length < 2 || q.options.length > 4) {
					return {
						content: [
							{
								type: "text",
								text: `ask_pro: Q${i + 1} ("${q.header}") has ${q.options.length} options, need 2-4 (or set freeText:true).`,
							},
						],
						details: {
							error: "bad_option_count",
							questionIdx: i,
							count: q.options.length,
						},
					};
				}
				// Recommend at most one ⭐ per question
				const recommendedCount = q.options.filter((o) => o.recommended).length;
				if (recommendedCount > 1) {
					return {
						content: [
							{
								type: "text",
								text: `ask_pro: Q${i + 1} ("${q.header}") has ${recommendedCount} recommended options, at most 1 allowed.`,
							},
						],
						details: { error: "multiple_recommended", questionIdx: i },
					};
				}
				// Validate multi-select min/max bounds when provided.
				const bounds = validateSelectBounds(q, i);
				if (bounds) return bounds;
			}

			// --- show the picker ---
			const result = await ctx.ui.custom<AskProResult>(
				(tui, theme, keybindings, done) => {
					// pi-coding-agent's Theme is structurally compatible with our
					// AskProTheme (same fg/bold signatures); the color type is
					// just stricter on the agent's side. Cast to satisfy TS.
					const askTheme = theme as unknown as ConstructorParameters<typeof AskProComponent>[0]["theme"];
					return new AskProComponent({
						questions: params.questions,
						theme: askTheme,
						keybindings,
						done,
						title: `soly · ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
						highlight: highlightCode,
					});
				},
			);

			// --- handle the result ---
			if (result.cancelled) {
				return {
					content: [
						{
							type: "text",
							text: "(user cancelled the picker — no answers captured)",
						},
					],
					details: { cancelled: true },
				};
			}

			const answers = result.answers ?? {};
			const notes = result.notes ?? {};
			const skipped = new Set(result.skipped ?? []);
			// Pretty-print for the LLM
			const out: string[] = ["User answers:"];
			for (let i = 0; i < params.questions.length; i++) {
				const q = params.questions[i];
				if (!q) continue;
				const a = answers[i];
				let line: string;
				if (skipped.has(i)) {
					line = `  Q${i + 1} (${q.header}): (skipped)`;
				} else if (a === undefined) {
					line = `  Q${i + 1} (${q.header}): (no answer)`;
				} else if (Array.isArray(a)) {
					const parts: string[] = [];
					for (const item of a) {
						if (typeof item === "number") {
							parts.push(q.options[item]?.label ?? `?${item}`);
						} else {
							parts.push(`"${item}"`);
						}
					}
					line = `  Q${i + 1} (${q.header}) [multi]: ${parts.join(", ")}`;
				} else if (typeof a === "number") {
					line = `  Q${i + 1} (${q.header}): ${q.options[a]?.label ?? `?${a}`}`;
				} else if (q.freeText) {
					line = `  Q${i + 1} (${q.header}): "${a}"`;
				} else {
					line = `  Q${i + 1} (${q.header}) [Other]: "${a}"`;
				}
				// Append note if present
				if (notes[i]) {
					line += `  // note: "${notes[i]}"`;
				}
				out.push(line);
			}

			return {
				content: [{ type: "text", text: out.join("\n") }],
				details: {
					answers,
					notes: Object.keys(notes).length > 0 ? notes : undefined,
					skipped: skipped.size > 0 ? [...skipped] : undefined,
				},
			};
		},
	});
}
