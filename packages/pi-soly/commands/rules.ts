// =============================================================================
// commands/rules.ts — /rules command (list, show, stats, analytics, reload, enable, disable)
// =============================================================================

import * as path from "node:path";
import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONTEXT_WINDOW_TOKENS, formatTok, analyzeRules, buildRulesContextStats, formatAnalyticsFull, formatRulesContextStats, readIfExists, type RuleFile } from "../core.ts";
import type { ListItem } from "../visual/list-panel.ts";
import { openListPanel, type CommandUI, type CommandsDeps } from "./_helpers.ts";

/** Status marker for a rule: ● always-on · ◐ glob-matched · ○ disabled. */
function ruleMarker(r: RuleFile): string {
	if (!r.enabled) return "○";
	return r.meta.always || !(r.meta.globs && r.meta.globs.length) ? "●" : "◐";
}

/** Map a rule to a panel row (token estimate + globs + description preview). */
function ruleItem(r: RuleFile): ListItem {
	const tokens = Math.ceil(r.body.length / 4);
	const bits = [`${formatTok(tokens)} tok`];
	if (r.meta.globs && r.meta.globs.length) bits.push(r.meta.globs.join(","));
	if (!r.enabled) bits.push("off");
	return {
		id: r.relPath,
		marker: ruleMarker(r),
		label: r.relPath,
		meta: bits.join(" · "),
		body: r.meta.description ? `${r.meta.description}\n\n${r.body}` : r.body,
	};
}

type RulesDeps = Pick<CommandsDeps, "getRules" | "getOverridden" | "refreshRules" | "updateStatus" | "recordEvent">;

export function registerRulesCommand(pi: ExtensionAPI, deps: RulesDeps): void {
	const { getRules, getOverridden, refreshRules, updateStatus, recordEvent } = deps;

	pi.registerCommand("rules", {
		description: "manage soly rules (list, show, stats, analytics, reload, enable, disable)",
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
			// Bare `/rules` (empty args) opens the modal; an explicit subcommand does not.
			const sub = parts[0] || "list";
			const target = parts[1];

			if (sub === "list") {
				const rules = getRules();
				const overridden = getOverridden();
				if (rules.length === 0 && overridden.length === 0) {
					recordEvent("no rules loaded — check `.agents/rules/` or `~/.agents/rules/`", "warning");
					return;
				}
				// Rich modal in the TUI; plain select elsewhere (RPC/print).
				if (ctx.mode === "tui") {
					const analytics = analyzeRules(getRules(), CONTEXT_WINDOW_TOKENS);
					await openListPanel(ctx, {
						title: "soly · rules",
						headerRight: `${getRules().length} rules · ${formatTok(analytics.totalTokens)} · ${analytics.contextBudgetPct.toFixed(1)}%`,
						build: () => [
							{ id: "rules", title: "Rules", icon: "▤", items: getRules().map(ruleItem) },
						],
						actions: [
							{ key: "e", hint: "enable", run: (it) => { const r = getRules().find((x) => x.relPath === it.id); if (r) r.enabled = true; } },
							{ key: "d", hint: "disable", run: (it) => { const r = getRules().find((x) => x.relPath === it.id); if (r) r.enabled = false; } },
							{ key: "r", hint: "reload", run: () => refreshRules() },
						],
					});
					updateStatus(ui);
					return;
				}
				const lines: string[] = [];
				for (const r of rules) {
					const status = r.enabled ? "●" : "○";
					const desc = r.meta.description ? ` — ${r.meta.description}` : "";
					lines.push(`${status} [${r.sourceLabel}] ${r.relPath}${desc}`);
				}
				for (const p of overridden) {
					lines.push(`⊘ [overridden] ${p}`);
				}
				recordEvent(lines.join("\n"));
				return;
			}

			if (sub === "show") {
				if (!target) {
					ui.notify("Usage: /rules show <relPath>", "error");
					return;
				}
				const r = getRules().find((x) => x.relPath === target);
				if (!r) {
					ui.notify(`Rule not found: ${target}`, "error");
					return;
				}
				const text = `---\n${r.meta.description ? `description: ${r.meta.description}\n` : ""}source: ${r.sourceLabel}\nenabled: ${r.enabled}\n---\n\n${r.body}`;
				recordEvent(text);
				return;
			}

			if (sub === "stats") {
				const analytics = analyzeRules(getRules(), CONTEXT_WINDOW_TOKENS);
				recordEvent(formatAnalyticsFull(analytics));
				return;
			}

			if (sub === "analytics") {
				const rules = getRules();
				const stats = buildRulesContextStats(rules, CONTEXT_WINDOW_TOKENS);
				recordEvent(formatRulesContextStats(stats));
				return;
			}

			if (sub === "enable" || sub === "disable") {
				if (!target) {
					ui.notify(`Usage: /rules ${sub} <relPath>`, "error");
					return;
				}
				const r = getRules().find((x) => x.relPath === target);
				if (!r) {
					ui.notify(`Rule not found: ${target}`, "error");
					return;
				}
				r.enabled = sub === "enable";
				updateStatus(ui);
				recordEvent(`Rule ${target}: ${sub}d`);
				return;
			}

			if (sub === "reload") {
				refreshRules();
				updateStatus(ui);
				recordEvent(`Reloaded ${getRules().length} rules`);
				return;
			}

			if (sub === "add") {
				ui.notify(
					"Use /rulewizard add <url> (or /rules add for the rule-creation guide).",
					"info",
				);
				return;
			}

			if (sub === "new") {
				ui.notify(
					"Use /rulewizard to scaffold a new rule (it guides the rule-vs-editorconfig-vs-linter decision).",
					"info",
				);
				return;
			}

			if (sub === "path") {
				const cwd = process.cwd();
				const dirs = [
					path.join(cwd, ".agents", "rules.local"),
					path.join(cwd, ".agents", "rules"),
					path.join(cwd, ".pi", "rules"),
					path.join(require("node:os").homedir(), ".agents", "rules"),
				];
				const found = dirs.filter((d) => fs.existsSync(d));
				ui.notify(
					"Rules sources (existing first):\n" +
						(found.length ? found.map((d) => `  ✓ ${d}`).join("\n") : "  (none)") +
						"\n" +
						dirs
							.filter((d) => !found.includes(d))
							.map((d) => `  - ${d}`)
							.join("\n"),
					"info",
				);
				return;
			}

			ui.notify(
				`Usage: /rules <list|show|stats|analytics|enable|disable|reload|add|new|path> [target]`,
				"error",
			);
		},
	});
}
