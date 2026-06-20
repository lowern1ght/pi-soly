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
import { buildAskProSection } from "./prompt.ts";

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
	// Inject a "when to use ask_pro" section into the system prompt so the
	// LLM reaches for the picker at the right times (and avoids overusing
	// it for trivial yes/no or open-ended questions).
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: event.systemPrompt + buildAskProSection(),
		};
	});

	pi.registerTool({
		name: "ask_pro",
		label: "soly · ask_pro",
		description:
			"Ask the user multiple questions at once via a tabbed picker. Each question is a tab at the top. Options are numbered (1-N instant-pick), the recommended answer is marked ⭐. Supports single-select (default, auto-advance on pick), multi-select (Space toggles; `minSelect`/`maxSelect` bound the count), and `freeText: true` questions (no options — the user types an answer). Per option, `preview` shows a side-panel snippet while focused (fenced ```code is syntax-highlighted); per question, `allowOther: true` adds a free-text 'Other…' choice. The user can press `n` to attach a note or `s` to skip a question (returned as skipped). All answers returned in one call. Use for progressive Q&A flows like `soly discuss`.",
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					header: Type.String({
						description: "Short label for the tab (1-2 words, max 12 chars).",
					}),
					question: Type.String({
						description: "The full question to ask.",
					}),
					options: Type.Array(
						Type.Object({
							label: Type.String({
								description: "Short label (1-5 words).",
							}),
							description: Type.Optional(
								Type.String({
									description: "1-2 sentence explanation. Shown below the label.",
								}),
							),
							recommended: Type.Optional(
								Type.Boolean({
									description: "Mark as ⭐ recommended answer.",
								}),
							),
							preview: Type.Optional(
								Type.String({
									description:
										"Markdown/plain snippet shown in a side panel while this option is focused (e.g. a code shape, API signature, config sample) so the user can compare options without follow-ups.",
								}),
							),
						}),
						{
							description:
								"2-4 concrete options. Leave empty ([]) when freeText is true.",
						},
					),
					multiSelect: Type.Optional(
						Type.Boolean({
							description:
								"If true, user can pick multiple (checkboxes, Enter toggles). If false (default), single-select with auto-advance.",
						}),
					),
					allowOther: Type.Optional(
						Type.Boolean({
							description:
								"If true, append a synthetic 'Other…' option that opens a free-text input, so the user isn't boxed into the listed choices.",
						}),
					),
					minSelect: Type.Optional(
						Type.Number({
							description:
								"Multi-select only: minimum options the user must choose (default 1).",
						}),
					),
					maxSelect: Type.Optional(
						Type.Number({
							description:
								"Multi-select only: maximum options the user may choose (default: no limit).",
						}),
					),
					freeText: Type.Optional(
						Type.Boolean({
							description:
								"If true, the question has no options — the user types a free-text answer. Leave options empty. Use for open-ended input (names, descriptions); the answer is optional (blank allowed).",
						}),
					),
				}),
				{
					description:
						"Questions to ask, in tab order. Max ~5 recommended (more hurts UX).",
				},
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
