// =============================================================================
// index.ts — pi-ask extension entry point
// =============================================================================
//
// Registers one LLM tool: `ask_pro`. Lets the LLM ask the user a list of
// questions at once via a Claude Code-style tabbed picker (tabs, numbered
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
import { Type } from "typebox";
import { AskProComponent, type AskProResult } from "./picker.js";
import { buildAskProSection } from "./prompt.js";

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
		label: "pi-ask ask_pro",
		description:
			"Ask the user multiple questions at once via a Claude Code-style tabbed picker. Each question is a tab at the top. Options are numbered (1-N instant-pick), the recommended answer is marked ⭐. Supports single-select (default, auto-advance on pick) and multi-select (Enter toggles, last question shows Submit). All answers returned in one call. Use for progressive Q&A flows like `soly discuss`.",
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
						}),
						{ description: "2-4 concrete options." },
					),
					multiSelect: Type.Optional(
						Type.Boolean({
							description:
								"If true, user can pick multiple (checkboxes, Enter toggles). If false (default), single-select with auto-advance.",
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
				if (q.options.length < 2 || q.options.length > 4) {
					return {
						content: [
							{
								type: "text",
								text: `ask_pro: Q${i + 1} ("${q.header}") has ${q.options.length} options, need 2-4.`,
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
						// Bridge to the parent's UI for the "Other…" text input.
						// The picker stays decoupled from ExtensionContext.
						onRequestInput: async (req) => {
							if (!ctx.hasUI) return undefined;
							return (await ctx.ui.input(req.title, req.placeholder)) ?? undefined;
						},
						title: `pi-ask — ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
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
			// Pretty-print for the LLM
			const out: string[] = ["User answers:"];
			for (let i = 0; i < params.questions.length; i++) {
				const q = params.questions[i];
				if (!q) continue;
				const a = answers[i];
				if (a === undefined) {
					out.push(`  Q${i + 1} (${q.header}): (no answer)`);
				} else if (Array.isArray(a)) {
					const parts: string[] = [];
					for (const item of a) {
						if (typeof item === "number") {
							parts.push(q.options[item]?.label ?? `?${item}`);
						} else {
							parts.push(`"${item}"`);
						}
					}
					out.push(`  Q${i + 1} (${q.header}) [multi]: ${parts.join(", ")}`);
				} else if (typeof a === "number") {
					out.push(`  Q${i + 1} (${q.header}): ${q.options[a]?.label ?? `?${a}`}`);
				} else {
					out.push(`  Q${i + 1} (${q.header}) [Other]: "${a}"`);
				}
			}

			return {
				content: [{ type: "text", text: out.join("\n") }],
				details: { answers },
			};
		},
	});
}
