// =============================================================================
// commands/docs.ts — /docs command (list, stats)
// =============================================================================

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatTok, solyDirFor } from "../core.ts";
import { buildIntentStats, formatIntentStats, loadInlineIntentBodies, type IntentInlineDoc } from "../intent.ts";
import { openListPanel, type CommandUI, type CommandsDeps } from "./_helpers.ts";

type DocsDeps = Pick<CommandsDeps, "getIntentDocs">;

export function registerDocsCommand(pi: ExtensionAPI, deps: DocsDeps): void {
	const { getIntentDocs } = deps;

	pi.registerCommand("docs", {
		description: "manage soly intent docs (stats — show context breakdown)",
		handler: async (args, ctx) => {
			const ui: CommandUI = {
				notify: (t, k) => ctx.ui.notify(t, k ?? "info"),
				select: async (label, options) => {
					const result = await ctx.ui.select(label, options);
					return result === undefined ? null : options.indexOf(result);
				},
				confirm: (title, message) => ctx.ui.confirm(title, message),
			};
			const parts = args.trim().split(/\s+/);
			// Bare `/docs` opens the modal; an explicit subcommand (e.g. stats) does not.
			const sub = parts[0] || "list";

			if (sub === "list") {
				const docs = getIntentDocs();
				if (docs.length === 0) {
					ui.notify("no intent docs found in .agents/docs/ — drop your vision/domain docs there", "info");
					return;
				}
				if (ctx.mode === "tui") {
					const total = docs.reduce((s, d) => s + d.tokens, 0);
					await openListPanel(ctx, {
						title: "soly · docs",
						headerRight: `${docs.length} docs · ${formatTok(total)}`,
						build: () => [
							{
								id: "docs",
								title: "Docs",
								icon: "☖",
								items: getIntentDocs().map((d) => ({
									id: d.relPath,
									marker: "○",
									label: d.title || d.relPath,
									meta: `${d.kind} · ${formatTok(d.tokens)} tok${d.oversized ? " · oversized" : ""}`,
									body: d.preview,
								})),
							},
						],
					});
					return;
				}
				ui.notify(docs.map((d) => `○ ${d.title || d.relPath} (${formatTok(d.tokens)} tok)`).join("\n"), "info");
				return;
			}

			if (sub === "stats") {
				const docs = getIntentDocs();
				const inlineBodies: IntentInlineDoc[] = loadInlineIntentBodies(docs);
				const stats = buildIntentStats(docs, inlineBodies);
				ui.notify(formatIntentStats(stats), "info");
				return;
			}

			ui.notify("Usage: /docs <list|stats>", "error");
			void solyDirFor; // kept available for future subcommands
		},
	});
}
