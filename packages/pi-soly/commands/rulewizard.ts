import { emit } from "../visual/event-sink.ts";
// =============================================================================
// commands/rulewizard.ts — /rulewizard command (interactive guide)
// =============================================================================

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CommandsDeps } from "./_helpers.ts";

export function registerRulewizardCommand(pi: ExtensionAPI, deps: CommandsDeps): void {
	void deps; // rulewizard doesn't currently emit non-error events
	pi.registerCommand("rulewizard", {
		description:
			"interactive guide: decide whether a constraint should be a soly rule, an .editorconfig entry, or a linter config (eslint/biome/prettier). Use this BEFORE writing a new rule to avoid duplicating what linters already enforce.",
		handler: async (_args, ctx) => {
			emit(
				[
					"soly-rule-wizard:",
					"",
					"tell me what behavior or outcome you want to constrain. I'll help you",
					"decide whether it should be:",
					"  • a soly rule (.agents/rules/*.md) — for process, behavior, or project",
					"    conventions the LLM must follow",
					"  • an .editorconfig entry — for formatting (indent, line endings, EOL,",
					"    charset, trailing whitespace, max line length)",
					"  • a linter config (eslint / biome / prettier) — for code style that",
					"    a tool can check automatically",
					"  • or nothing — if an existing tool already covers it",
					"",
					"decide first:",
					"  1. is it about LLM behavior / process / project conventions?  → soly rule",
					"  2. is it about whitespace, indent, line endings?             → .editorconfig",
					"  3. is it about code style a linter can check?                → eslint/biome",
					"  4. is it already covered by an existing tool?                → don't duplicate",
					"",
					"useful commands first:",
					"  /rules           — see existing rules (so we don't duplicate)",
					"  /rules analytics — see file sizes, missing descriptions, duplicates",
					"",
					"when you've decided:",
					"  /rules new       — scaffold a new rule from the soly template",
				].join("\n"),
				"info",
			);
		},
	});
}
