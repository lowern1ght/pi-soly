// =============================================================================
// commands.ts — Slash commands for the soly extension
// =============================================================================
//
// Registers slash commands (via pi.registerCommand):
//   - /rules         manage soly rules (list/show/stats/analytics/reload/enable/disable/add/new)
//   - /docs          manage soly intent docs (stats — context breakdown)
//   - /soly          project state inspection (position/plan/phases/tasks/...)
//                    subcommands: position, state, plan, context, research, roadmap,
//                                 progress, phases, tasks, task <id>, features,
//                                 milestone, reload, help
//   - /artifacts     browse this session's html_artifact gallery (list/open/clear)
//   - /rulewizard    interactive guide for rule vs .editorconfig vs linter
//   - /why           show rules + project state that grounded the last turn
//
// All commands take their live state via CommandsDeps (rules, state, etc.)
// and a ui object for the handlers to call into.
// =============================================================================

import * as path from "node:path";
import * as fs from "node:fs";
import { platform } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	analyzeRules,
	buildProgressBar,
	buildRulesContextStats,
	CONTEXT_WINDOW_TOKENS,
	extractFilePathsFromPrompt,
	formatAnalyticsFull,
	formatRulesContextStats,
	formatTok,
	readIfExists,
	solyDirFor,
	type RuleFile,
	type SolyState,
} from "./core.ts";
import {
	buildIntentStats,
	formatIntentStats,
	loadInlineIntentBodies,
	type IntentDoc,
	type IntentInlineDoc,
} from "./intent.ts";
import type { SolyConfig } from "./config.ts";
import { migrateSolyDir } from "./migrate.js";
import { initSolyProject } from "./init.js";
import { ListPanel, type ListItem, type ListAction } from "./visual/list-panel.ts";
import { getArtifactServer, ensureArtifactServer, artifactDir } from "./artifact/session.ts";

/** Minimum ui surface the command handlers actually need. */
export interface CommandUI {
	notify: (text: string, kind?: "info" | "warning" | "error") => void;
	select: (label: string, options: string[]) => Promise<number | null>;
	confirm: (title: string, message: string) => Promise<boolean>;
	input?: (label: string, placeholder?: string) => Promise<string | undefined>;
}

export interface CommandsDeps {
	getRules: () => RuleFile[];
	getOverridden: () => string[];
	refreshRules: () => void;
	getState: () => SolyState;
	refreshState: () => void;
	updateStatus: (ui: CommandUI) => void;
	getConfig: () => SolyConfig;
	getIntentDocs: () => IntentDoc[];
}

/** Open a focused list modal (overlay) for the given items + actions. */
async function openListPanel(
	ctx: ExtensionCommandContext,
	spec: {
		title: string;
		headerRight?: string;
		build: () => ListItem[];
		actions?: ListAction[];
		onSelect?: (item: ListItem) => void;
	},
): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, theme, keybindings, done) =>
			new ListPanel({
				tui,
				theme,
				keybindings,
				done: () => done(),
				title: spec.title,
				headerRight: spec.headerRight,
				items: spec.build(),
				actions: spec.actions,
				refresh: spec.build,
				onSelect: spec.onSelect,
			}),
		{ overlay: true },
	);
}

/** Open a URL/file with the OS default handler (browser for http/.html). */
async function openExternally(pi: ExtensionAPI, target: string): Promise<void> {
	const o = platform();
	const r =
		o === "darwin"
			? await pi.exec("open", [target])
			: o === "win32"
				? await pi.exec("cmd", ["/c", "start", "", target])
				: await pi.exec("xdg-open", [target]);
	if (r.code !== 0) throw new Error(r.stderr || `open failed (exit ${r.code})`);
}

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

export function registerCommands(pi: ExtensionAPI, deps: CommandsDeps): void {
	const {
		getRules,
		getOverridden,
		refreshRules,
		getState,
		refreshState,
		updateStatus,
		getConfig,
		getIntentDocs,
	} = deps;

	// ============================================================================
	// /rules
	// ============================================================================

	pi.registerCommand("rules", {
		description:
			"manage soly rules (list, show, stats, analytics, reload, enable, disable)",
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
					ui.notify("no rules loaded from any source", "info");
					return;
				}
				// Rich modal in the TUI; plain select elsewhere (RPC/print).
				if (ctx.mode === "tui") {
					const analytics = analyzeRules(getRules(), CONTEXT_WINDOW_TOKENS);
					await openListPanel(ctx, {
						title: "soly · rules",
						headerRight: `${getRules().length} rules · ${formatTok(analytics.totalTokens)} · ${analytics.contextBudgetPct.toFixed(1)}%`,
						build: () => getRules().map(ruleItem),
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
				const total = rules.length + overridden.length;
				const choice = await ui.select(`soly rules (${total})`, lines);
				if (choice != null && typeof choice === "number") {
					if (choice < rules.length) {
						const rel = rules[choice];
						if (rel) {
							ui.notify(
								`[${rel.sourceLabel}] ${rel.relPath}\n\n${rel.body}`,
								"info",
							);
						}
					} else {
						const idx = choice - rules.length;
						ui.notify(
							`overridden: ${overridden[idx]} (skipped — a higher-priority source defines this rule)`,
							"info",
						);
					}
				}
				return;
			}

			if (sub === "analytics") {
				const rules = getRules();
				const analytics = analyzeRules(rules, CONTEXT_WINDOW_TOKENS);
				ui.notify(formatAnalyticsFull(analytics), "info");
				return;
			}

			if (sub === "stats") {
				// Claude-memory-style breakdown: shows which rules are always-on
				// (every turn) vs glob-matched (only when prompt has file paths).
				// Surfaces context bloat and verifies rules will actually fire.
				const rules = getRules();
				const stats = buildRulesContextStats(rules, CONTEXT_WINDOW_TOKENS);
				ui.notify(formatRulesContextStats(stats), "info");
				return;
			}

			if (sub === "show") {
				if (!target) {
					ui.notify("Usage: /rules show <path>", "error");
					return;
				}
				const rule = getRules().find(
					(r) => r.relPath === target || r.relPath.endsWith(target),
				);
				if (!rule) {
					ui.notify(`Rule not found: ${target}`, "error");
					return;
				}
				ui.notify(`[${rule.sourceLabel}] ${rule.relPath}\n\n${rule.body}`, "info");
				return;
			}

			if (sub === "reload") {
				refreshRules();
				ui.notify(`Reloaded ${getRules().length} rules`, "info");
				updateStatus(ui);
				return;
			}

			if (sub === "enable" || sub === "disable") {
				if (!target) {
					ui.notify(`Usage: /rules ${sub} <path>`, "error");
					return;
				}
				const rule = getRules().find(
					(r) => r.relPath === target || r.relPath.endsWith(target),
				);
				if (!rule) {
					ui.notify(`Rule not found: ${target}`, "error");
					return;
				}
				rule.enabled = sub === "enable";
				ui.notify(`${rule.relPath} ${sub}d`, "info");
				updateStatus(ui);
				return;
			}

			if (sub === "enable-all" || sub === "disable-all") {
				const enable = sub === "enable-all";
				const rules = getRules();
				let count = 0;
				for (const r of rules) {
					if (r.enabled !== enable) {
						r.enabled = enable;
						count++;
					}
				}
				ui.notify(
					`${count} rule(s) ${enable ? "enabled" : "disabled"} (${rules.length} total)`,
					enable ? "info" : "warning",
				);
				updateStatus(ui);
				return;
			}

			// /rules new — wizard for creating a rule
			if (sub === "new") {
			const cwd = process.cwd();
			const categories = [
				{ name: "architecture", description: "which patterns to use, when" },
				{ name: "code-style", description: "naming, formatting, structure" },
				{ name: "testing", description: "what to test, how, coverage" },
				{ name: "process", description: "git workflow, commit format, PR review" },
				{ name: "performance", description: "perf budgets, hot paths, caching" },
				{ name: "security", description: "auth, secrets, validation, OWASP" },
			];
			const choice = await ui.select(
				"soly rule — pick a category:",
				categories.map((c) => `${c.name} — ${c.description}`),
			);
			if (choice == null) {
				ui.notify("cancelled", "info");
				return;
			}
			const cat = categories[choice];
			if (!cat) return;
			const dir = path.join(solyDirFor(cwd), "rules", cat.name);
			try {
				fs.mkdirSync(dir, { recursive: true });
			} catch {}
			const slug = `${cat.name}-${Date.now().toString(36)}.md`;
			const filePath = path.join(dir, slug);
			const template = `---
description: TODO — what does this rule constrain or require?
globs: []
priority: medium
---

# ${cat.name} rule

> TODO: write the rule. Use imperative voice, give Good/Bad examples where
> useful. State what the LLM must do, not what it should avoid.

## Context

When does this rule apply?

## Rule

What must the LLM do?

## Examples

### Good

\`\`\`
<!-- concrete good example -->
\`\`\`

### Bad

\`\`\`
<!-- concrete bad example -->
\`\`\`
`;
			try {
				fs.writeFileSync(filePath, template, "utf-8");
				ui.notify(
					`soly: created ${path.relative(cwd, filePath)}\n\n` +
						`Next: edit the file (description, globs, body), then \`/rules reload\` to load it.`,
					"info",
				);
				refreshRules();
				updateStatus(ui);
			} catch (e) {
				ui.notify(`soly: failed to create rule: ${(e as Error).message}`, "error");
			}
			return;
		}

		// /rules add <url> — download a remote rule into .soly/rules/
		if (sub === "add") {
			const url = (target ?? "").trim();
			if (!url) {
				ui.notify("Usage: /rules add <url>", "error");
				return;
			}
			try {
				const parsed = new URL(url);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
					ui.notify(`soly: only http(s) URLs are supported (got ${parsed.protocol})`, "error");
					return;
				}
				ui.notify(`soly: downloading ${url}…`, "info");
				const res = await fetch(url, {
					signal: AbortSignal.timeout(10_000),
					headers: { "user-agent": "soly-extension/1.0" },
				});
				if (!res.ok) {
					ui.notify(`soly: HTTP ${res.status} ${res.statusText} from ${url}`, "error");
					return;
				}
				const text = await res.text();
				if (text.length === 0) {
					ui.notify(`soly: empty response from ${url}`, "error");
					return;
				}
				if (text.length > 200_000) {
					ui.notify(
						`soly: refusing to install rule > 200KB (got ${(text.length / 1024).toFixed(1)}KB). Inspect manually.`,
						"error",
					);
					return;
				}
				// Derive filename from URL (strip query, keep last path segment)
				const lastSeg = parsed.pathname.split("/").filter(Boolean).pop() ?? "rule.md";
				const safeName = lastSeg.replace(/[^A-Za-z0-9._-]/g, "_");
				const fileName = safeName.endsWith(".md") ? safeName : `${safeName}.md`;
				const rulesRoot = path.join(solyDirFor(process.cwd()), "rules");
				fs.mkdirSync(rulesRoot, { recursive: true });
				const targetFile = path.join(rulesRoot, fileName);
				// Refuse to overwrite without warning
				if (fs.existsSync(targetFile)) {
					const overwrite = await ui.confirm(
						"Overwrite?",
						`${fileName} already exists. Overwrite?`,
					);
					if (!overwrite) {
						ui.notify("soly: add cancelled", "info");
						return;
					}
				}
				fs.writeFileSync(targetFile, text, "utf-8");
				refreshRules();
				ui.notify(
					`soly: installed ${path.relative(process.cwd(), targetFile)} (${(text.length / 1024).toFixed(1)}KB)`,
					"info",
				);
				updateStatus(ui);
			} catch (e) {
				ui.notify(`soly: download failed: ${(e as Error).message}`, "error");
			}
			return;
		}

		ui.notify(
			`unknown subcommand: ${sub}\nUsage: /rules [list|show <path>|analytics|reload|enable <path>|disable <path>|enable-all|disable-all|add <url>|new]`,
			"error",
		);
	},
	});

	// ============================================================================
	// /docs — manage soly intent docs (stats subcommand shows context usage)
	// ============================================================================
	pi.registerCommand("docs", {
		description:
			"manage soly intent docs (stats — show context breakdown)",
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
					ui.notify("no intent docs found in .soly/docs/ — drop your vision/domain docs there", "info");
					return;
				}
				if (ctx.mode === "tui") {
					const total = docs.reduce((s, d) => s + d.tokens, 0);
					await openListPanel(ctx, {
						title: "soly · docs",
						headerRight: `${docs.length} docs · ${formatTok(total)}`,
						build: () =>
							getIntentDocs().map((d) => ({
								id: d.relPath,
								marker: "○",
								label: d.title || d.relPath,
								meta: `${d.kind} · ${formatTok(d.tokens)} tok${d.oversized ? " · oversized" : ""}`,
								body: d.preview,
							})),
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

			ui.notify(
				`Usage: /docs [list|stats] — open the docs panel, or show the context breakdown\n` +
				`Found ${getIntentDocs().length} doc(s) loaded.`,
				"info",
			);
		},
	});

	// ============================================================================
	// /soly migrate — move .soly/ → .agents/ atomically
	// ============================================================================
	pi.registerCommand("soly-migrate", {
		description:
			"migrate project state from .soly/ to .agents/ (atomic rename, validates result, suggests git commit)",
		handler: async (args, ctx) => {
			const ui: CommandUI = {
				notify: (t, k) => ctx.ui.notify(t, k ?? "info"),
				select: async (label, options) => {
					const result = await ctx.ui.select(label, options);
					return result === undefined ? null : options.indexOf(result);
				},
				confirm: (title, message) => ctx.ui.confirm(title, message),
			};
			await migrateSolyDir(ctx.cwd, ui, { autoYes: args.includes("--yes") });
		},
	});

	// /soly init — scaffold new project
	// ============================================================================
	pi.registerCommand("soly-init", {
		description:
			"scaffold a new soly project (interactive: pick template — minimal/web-app/library/cli)",
		handler: async (args, ctx) => {
			const ui: CommandUI = {
				notify: (t, k) => ctx.ui.notify(t, k ?? "info"),
				select: async (label, options) => {
					const result = await ctx.ui.select(label, options);
					return result === undefined ? null : options.indexOf(result);
				},
				confirm: (title, message) => ctx.ui.confirm(title, message),
				input: (label, placeholder) => ctx.ui.input(label, placeholder),
			};
			// Parse args: --template=X, --yes, --name=X
			const template = (args.match(/--template[= ](\S+)/)?.[1] as
				| "minimal" | "web-app" | "library" | "cli" | undefined) ?? undefined;
			const autoYes = args.includes("--yes");
			const projectName = args.match(/--name[= ](\S+)/)?.[1];
			const initUi = {
				notify: (t: string, k?: "info" | "warning" | "error") => ctx.ui.notify(t, k ?? "info"),
				select: async (label: string, options: string[]) => ctx.ui.select(label, options),
				confirm: (title: string, message: string) => ctx.ui.confirm(title, message),
				input: (label: string, placeholder?: string) => ctx.ui.input(label, placeholder),
			};
			await initSolyProject(ctx.cwd, initUi, { template, autoYes, projectName });
		},
	});

	// /soly
	// ============================================================================

	pi.registerCommand("soly", {
		description:
			"soly: project state inspection (position, plan, state, phases, etc.) — type 'help' for subcommand picker",
		handler: async (args, ctx) => {
			const ui: CommandUI = {
				notify: (t, k) => ctx.ui.notify(t, k ?? "info"),
				select: async (label, options) => {
					const result = await ctx.ui.select(label, options);
					return result === undefined ? null : options.indexOf(result);
				},
				confirm: (title, message) => ctx.ui.confirm(title, message),
			};
			const state = getState();
			if (!state.exists) {
				ui.notify("soly: no .soly/ directory in cwd", "error");
				return;
			}

			const showFile = (label: string, content: string | null) => {
				if (!content) {
					ui.notify(`${label}: not found`, "error");
					return;
				}
				const MAX = 4000;
				const truncated =
					content.length > MAX
						? `${content.slice(0, MAX)}\n\n[...truncated, file is ${content.length} chars]`
						: content;
				ui.notify(`${label}\n\n${truncated}`, "info");
			};

			type SolySub = {
				description: string;
				run: (parts: string[]) => void | Promise<void>;
			};
			const subcommands: Record<string, SolySub> = {
				// `agent` subcommand REMOVED — moved to the separate `pi-switch`
				// extension (rotor switcher removed in 1.4.0).
				// Soly no longer owns a rotor switcher.
				config: {
					description: "show merged config (per-project + global + defaults); edit .soly/config.json or ~/.soly/config.json",
					run: () => {
						const cfg = getConfig();
						const out: string[] = [];
						out.push("=== soly config (merged) ===");
						out.push("");
						out.push("```json");
						out.push(JSON.stringify(cfg, null, 2));
						out.push("```");
						out.push("");
						out.push("Sources:");
						out.push(`  global:  ~/.soly/config.json`);
						out.push(`  project: <cwd>/.soly/config.json`);
						out.push("");
						out.push("To edit:");
						out.push(`  - project: edit \`${state.solyDir}/config.json\` directly`);
						out.push(`  - global:  edit \`~/.soly/config.json\``);
						out.push("After editing, run /soly reload to re-pick up changes.");
						ui.notify(out.join("\n"), "info");
					},
				},
				position: {
					description: "one-screen position summary (default)",
					run: () => {
						const s = getState();
						if (s.position) {
							ui.notify(
								[
									`milestone: ${s.milestone}${s.milestoneName ? ` — ${s.milestoneName}` : ""}`,
									`phase:     ${s.position.phase}`,
									`plan:      ${s.position.plan}`,
									`status:    ${s.position.status}`,
									`progress:  ${buildProgressBar(s.progress.percent, 20)} ${s.progress.percent}% (${s.progress.completedPhases}/${s.progress.totalPhases} phases, ${s.progress.completedPlans}/${s.progress.totalPlans} plans)`,
								].join("\n"),
								"info",
							);
						} else {
							ui.notify(
								`milestone: ${s.milestone} — no position set in STATE.md`,
								"info",
							);
						}
					},
				},
				state: {
					description: "full STATE.md body",
					run: () => showFile("STATE.md", getState().stateBody),
				},
				plan: {
					description: "current PLAN.md body",
					run: () => {
						const s = getState();
						if (!s.currentPlanPath) {
							ui.notify("soly: no current plan", "error");
							return;
						}
						showFile(
							`PLAN: ${path.basename(s.currentPlanPath)}`,
							readIfExists(s.currentPlanPath),
						);
					},
				},
				context: {
					description: "current CONTEXT.md body",
					run: () => {
						const s = getState();
						if (!s.currentPhase) {
							ui.notify("soly: no current phase", "error");
							return;
						}
						const p = path.join(s.currentPhase.dir, `${s.currentPhase.slug}-CONTEXT.md`);
						showFile("CONTEXT.md", readIfExists(p));
					},
				},
				research: {
					description: "current RESEARCH.md body",
					run: () => {
						const s = getState();
						if (!s.currentPhase) {
							ui.notify("soly: no current phase", "error");
							return;
						}
						const p = path.join(s.currentPhase.dir, `${s.currentPhase.slug}-RESEARCH.md`);
						showFile("RESEARCH.md", readIfExists(p));
					},
				},
				roadmap: {
					description: "ROADMAP.md body",
					run: () => showFile("ROADMAP.md", getState().roadmapBody),
				},
				progress: {
					description: "progress bar + counts",
					run: () => {
						const s = getState();
						ui.notify(
							[
								`milestone: ${s.milestone}${s.milestoneName ? ` — ${s.milestoneName}` : ""}`,
								`status:    ${s.status}`,
								`progress:  ${buildProgressBar(s.progress.percent, 30)} ${s.progress.percent}%`,
								`phases:    ${s.progress.completedPhases}/${s.progress.totalPhases}`,
								`plans:     ${s.progress.completedPlans}/${s.progress.totalPlans}`,
							].join("\n"),
							"info",
						);
					},
				},
				phases: {
					description: "list all phases with plan counts and C/R markers",
					run: () => {
						const phases = getState().phases;
						if (phases.length === 0) {
							ui.notify("soly: no phases found", "info");
							return;
						}
						const current = getState().currentPhase?.number;
						const lines = phases.map((p) => {
							const marker = current === p.number ? "→" : " ";
							const cr = (p.contextExists ? "C" : "·") + (p.researchExists ? "R" : "·");
							return `${marker} ${String(p.number).padStart(2, "0")}. ${p.name}  [${cr}]  plans=${p.planCount}`;
						});
						ui.notify(`phases:\n\n${lines.join("\n")}`, "info");
					},
				},
				tasks: {
					description: "list all tasks grouped by feature (mirrors soly_list_tasks tool)",
					run: () => {
						const s = getState();
						if (s.tasks.length === 0) {
							ui.notify("soly: no tasks found in .soly/features/*/tasks/", "info");
							return;
						}
						const byFeature = new Map<string, typeof s.tasks>();
						for (const t of s.tasks) {
							const list = byFeature.get(t.feature) ?? [];
							list.push(t);
							byFeature.set(t.feature, list);
						}
						const out: string[] = [`tasks (${s.tasks.length} total):`, ""];
						for (const [feature, list] of [...byFeature.entries()].sort()) {
							out.push(`[${feature}]  ${list.length} task(s)`);
							for (const t of list) {
								const deps = t.dependsOn.length > 0 ? `  deps=[${t.dependsOn.join(",")}]` : "";
								const par = t.parallelizable ? "  ⚡" : "";
								out.push(`  ${t.id}  [${t.kind}]  status=${t.status}  prio=${t.priority}${par}${deps}`);
							}
							out.push("");
						}
						ui.notify(out.join("\n"), "info");
					},
				},
				task: {
					description: "show one task's PLAN.md + SUMMARY.md if present  (usage: /soly task <id>)",
					run: (parts) => {
						const id = (parts[1] ?? "").trim();
						if (!id) {
							ui.notify("Usage: /soly task <task-id>", "error");
							return;
						}
						const s = getState();
						const task = s.tasks.find((t) => t.id === id);
						if (!task) {
							ui.notify(
								`soly: task ${id} not found.\nKnown: ${s.tasks.map((t) => t.id).join(", ") || "(none)"}`,
								"error",
							);
							return;
						}
						const planPath = path.join(task.dir, "PLAN.md");
						const summaryPath = path.join(task.dir, "SUMMARY.md");
						const planBody = readIfExists(planPath);
						const summaryBody = readIfExists(summaryPath);
						const header = `task ${task.id}  [${task.feature}/${task.kind}]  status=${task.status}  prio=${task.priority}`;
						const deps = task.dependsOn.length > 0 ? `\ndepends-on: [${task.dependsOn.join(", ")}]` : "";
						const planLabel = planBody ? `PLAN.md  (${planBody.length} chars)` : `PLAN.md  (missing)`;
						showFile(`${header}${deps}\n${planLabel}`, planBody ?? "(no PLAN.md)");
						if (summaryBody) {
							showFile("SUMMARY.md", summaryBody);
						} else {
							ui.notify("SUMMARY.md: not found (task not yet executed)", "info");
						}
					},
				},
				features: {
					description: "list all features with task counts and README presence",
					run: () => {
						const features = getState().features;
						if (features.length === 0) {
							ui.notify("soly: no features found in .soly/features/", "info");
							return;
						}
						const lines = features.map((f) => {
							const rm = f.readmeExists ? "R" : "·";
							return `  ${f.name.padEnd(28)} tasks=${f.taskCount}  [${rm}]`;
						});
						ui.notify(`features (${features.length}):\n\n${lines.join("\n")}`, "info");
					},
				},
				milestone: {
					description: "show the active milestone document (.soly/milestones/<v>.md)",
					run: () => {
						const s = getState();
						if (!s.milestone || s.milestone === "—") {
							ui.notify("soly: no milestone set in STATE.md frontmatter", "info");
							return;
						}
						const candidates = [
							path.join(s.solyDir, "milestones", `${s.milestone}.md`),
							path.join(s.solyDir, "MILESTONES.md"),
						];
						for (const c of candidates) {
							const body = readIfExists(c);
							if (body) {
								showFile(`MILESTONE ${s.milestone}  (${path.relative(process.cwd(), c)})`, body);
								return;
							}
						}
						ui.notify(
							`soly: no milestone file found. tried:\n  ${candidates.map((c) => path.relative(process.cwd(), c)).join("\n  ")}`,
							"error",
						);
					},
				},
				reload: {
					description: "re-read project state from disk",
					run: () => {
						refreshState();
						updateStatus(ui);
						const s = getState();
						ui.notify(
							`soly: reloaded — ${s.milestone} · ${s.phases.length} phases`,
							"info",
						);
					},
				},
			};

			const ICONS: Record<string, string> = {
				position: "📍", state: "📄", plan: "📋", context: "💡",
				research: "🔬", roadmap: "🗺️", progress: "📊",
				phases: "📁", tasks: "✅", task: "🔎",
				features: "⭐", milestone: "🎯", reload: "🔄", config: "⚙️",
			};

			// Short live preview shown in the modal's preview pane per subcommand.
			const previewFor = (name: string): string => {
				const s = getState();
				const teaser = (p: string | null): string => (p ?? "").replace(/\s+/g, " ").slice(0, 240);
				const phaseFile = (suffix: string) =>
					s.currentPhase ? readIfExists(path.join(s.currentPhase.dir, `${s.currentPhase.slug}-${suffix}.md`)) : null;
				switch (name) {
					case "position": return s.position ? `${s.position.phase} · ${s.position.plan} · ${s.position.status} · ${s.progress.percent}%` : `${s.milestone} — no position set`;
					case "progress": return `${s.progress.percent}% · ${s.progress.completedPhases}/${s.progress.totalPhases} phases · ${s.progress.completedPlans}/${s.progress.totalPlans} plans`;
					case "phases": return s.phases.length ? s.phases.map((p) => `${p.number}.${p.name}`).join(" · ") : "no phases";
					case "tasks": return s.tasks.length ? `${s.tasks.length} task(s) across ${s.features.length} feature(s)` : "no tasks";
					case "features": return s.features.length ? s.features.map((f) => f.name).join(" · ") : "no features";
					case "milestone": return s.milestone && s.milestone !== "—" ? String(s.milestoneName ?? s.milestone) : "no milestone set";
					case "state": return teaser(s.stateBody) || "STATE.md not found";
					case "roadmap": return teaser(s.roadmapBody) || "ROADMAP.md not found";
					case "plan": return s.currentPlanPath ? teaser(readIfExists(s.currentPlanPath)) : "no current plan";
					case "context": return s.currentPhase ? teaser(phaseFile("CONTEXT")) || "CONTEXT.md not found" : "no current phase";
					case "research": return s.currentPhase ? teaser(phaseFile("RESEARCH")) || "RESEARCH.md not found" : "no current phase";
					case "config": return "merged config — press ⏎ to view the JSON";
					case "reload": return "re-read project state from disk";
					default: return subcommands[name]?.description ?? "";
				}
			};

			const solyItems = (): ListItem[] =>
				Object.keys(subcommands).map((name) => ({
					id: name,
					marker: ICONS[name] ?? "▸",
					label: name,
					meta: subcommands[name]!.description,
					body: previewFor(name),
				}));

			// Plain-select fallback for non-TUI (RPC/print) modes.
			const picker = async (label: string) => {
				const entries = Object.entries(subcommands);
				const lines = entries.map(([name, spec]) => `${ICONS[name] ?? "▸"} ${name} — ${spec.description}`);
				const choice = await ui.select(label, lines);
				if (choice != null && typeof choice === "number") {
					const name = entries[choice]?.[0];
					if (name) await subcommands[name]!.run([name]);
				}
			};

			const openMenu = async () => {
				if (ctx.mode !== "tui") return picker("soly (esc to cancel):");
				const s = getState();
				await openListPanel(ctx, {
					title: "soly · state",
					headerRight: `${s.phases.length} phases · ${s.progress.percent}%`,
					build: solyItems,
					onSelect: (it) => {
						void subcommands[it.id]?.run([it.id]);
					},
				});
			};

			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = parts[0] ?? "";

			// /soly (or help) with no specific subcommand → the modal (TUI) / picker.
			if (!sub || sub === "help" || sub === "?" || sub === "--help" || sub === "-h") {
				return openMenu();
			}

			if (!subcommands[sub]) {
				ui.notify(`soly: unknown subcommand '${sub}'`, "error");
				return openMenu();
			}

			await subcommands[sub].run(parts);
		},
	});
	// ============================================================================
	// /artifacts — browse this session's html_artifact gallery
	// ============================================================================

	pi.registerCommand("artifacts", {
		description: "browse this session's html_artifact gallery (list, open, clear)",
		handler: async (args, ctx) => {
			if (!getConfig().artifacts.server) {
				ctx.ui.notify("soly: artifact session server is disabled (artifacts.server=false)", "info");
				return;
			}
			let server = getArtifactServer();
			if (!server) {
				// Restore the persisted per-project gallery (survives /reload + restart).
				try {
					server = await ensureArtifactServer(artifactDir(getConfig().artifacts.dir, ctx.cwd));
				} catch {
					// ignore — handled by the count check below
				}
			}
			if (!server || server.count === 0) {
				ctx.ui.notify("soly: no artifacts for this project yet (use the html_artifact tool)", "info");
				return;
			}
			const gallery = server.galleryUrl();
			const sub = args.trim().split(/\s+/).filter(Boolean)[0] ?? "";

			if (sub === "clear") {
				const n = server.clear();
				ctx.ui.notify(`soly: cleared ${n} artifact(s)`, "info");
				return;
			}
			if (sub === "open" || sub === "gallery") {
				try {
					await openExternally(pi, gallery);
					ctx.ui.notify(`soly: opened ${gallery}`, "info");
				} catch {
					ctx.ui.notify(`soly artifacts gallery: ${gallery}`, "info");
				}
				return;
			}

			if (ctx.mode === "tui") {
				await openListPanel(ctx, {
					title: "soly · artifacts",
					headerRight: `${server.count} · ${gallery}`,
					build: () =>
						(getArtifactServer()?.list() ?? []).map((a) => ({
							id: a.id,
							marker: "🖼",
							label: a.title,
							meta: new Date(a.createdAt).toLocaleTimeString(),
							body: a.url,
						})),
					onSelect: (it) => {
						const a = getArtifactServer()?.list().find((x) => x.id === it.id);
						if (a) void openExternally(pi, a.url);
					},
					actions: [
						{ key: "g", hint: "gallery", run: () => void openExternally(pi, gallery) },
						{ key: "x", hint: "delete", run: (it) => { getArtifactServer()?.remove(it.id); } },
					],
				});
				return;
			}

			// Non-TUI: print the list + gallery URL.
			const lines = server.list().map((a) => `🖼 ${a.title} — ${a.url}`);
			ctx.ui.notify([`soly artifacts gallery: ${gallery}`, "", ...lines].join("\n"), "info");
		},
	});

	// ============================================================================
	// /rulewizard
	// ============================================================================

	pi.registerCommand("rulewizard", {
		description:
			"interactive guide: decide whether a constraint should be a soly rule, an .editorconfig entry, or a linter config (eslint/biome/prettier). Use this BEFORE writing a new rule to avoid duplicating what linters already enforce.",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				[
					"soly-rule-wizard:",
					"",
					"tell me what behavior or outcome you want to constrain. I'll help you",
					"decide whether it should be:",
					"  • a soly rule (.soly/rules/*.md) — for process, behavior, or project",
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

	// ============================================================================
	// /why — show what context the LLM was working from
	// ============================================================================

	pi.registerCommand("why", {
		description:
			"show the rules + project state that were injected into the system prompt for the most recent turn. Use to answer 'why did the LLM do X?' — you can see the basis it was working from.",
		handler: async (args, ctx) => {
			const state = getState();
			const rules = getRules();
			const branch = ctx.sessionManager.getBranch();
			const lastTurnEntries = branch.slice(-6);

			const lines: string[] = [];
			lines.push("=== /why — basis for the most recent turn ===");
			lines.push("");

			// State
			if (state.exists) {
				lines.push("**Project state (injected):**");
				lines.push(`  milestone: ${state.milestone}${state.milestoneName ? ` — ${state.milestoneName}` : ""}`);
				if (state.position) {
					lines.push(`  position:  ${state.position.phase} / ${state.position.plan} (${state.position.status})`);
				}
				lines.push(`  progress:  ${state.progress.completedPhases}/${state.progress.totalPhases} phases, ${state.progress.completedPlans}/${state.progress.totalPlans} plans (${state.progress.percent}%)`);
				lines.push("");
			}

			// Rules
			if (rules.length > 0) {
				lines.push(`**Rules loaded (${rules.length} of which ${rules.filter((r) => r.enabled).length} enabled):**`);
				const bySource = rules.reduce<Record<string, number>>((acc, r) => {
					acc[r.sourceLabel] = (acc[r.sourceLabel] ?? 0) + 1;
					return acc;
				}, {});
				lines.push(
					`  by source: ${Object.entries(bySource)
						.map(([k, v]) => `${v} ${k}`)
						.join(", ")}`,
				);
				const phaseRuleCount = rules.filter((r) => r.phaseNumber != null).length;
				if (phaseRuleCount > 0) {
					lines.push(`  phase-scoped: ${phaseRuleCount}`);
				}
				lines.push("");
			}

			// NEW (I8): list the actual loaded rule files with paths + descriptions
			if (rules.length > 0) {
				lines.push("**Loaded rule files (the LLM was reading these):**");
				const enabled = rules.filter((rr) => rr.enabled);
				for (const r of enabled.slice(0, 30)) {
					const desc = r.meta.description ? ` — ${r.meta.description}` : "";
					const interactive = r.interactiveOnly ? " [interactive-only]" : "";
					lines.push(`  - \`${r.sourceLabel}/${r.relPath}\`${desc}${interactive}`);
				}
				if (enabled.length > 30) {
					lines.push(`  - ... and ${enabled.length - 30} more`);
				}
				lines.push("");
			}

			// Last few turns
			if (lastTurnEntries.length > 0) {
				lines.push("**Last few branch entries (what happened):**");
				for (const entry of lastTurnEntries) {
					if (entry.type === "message" && entry.message) {
						const role = entry.message.role;
						let text = "";
						if ("content" in entry.message) {
							const content = entry.message.content;
						if (typeof content === "string") text = content;
						else if (Array.isArray(content)) {
							text = content
								.filter((b: any) => b && b.type === "text")
								.map((b: any) => b.text)
								.join("\n");
						}
						}
						const summary = text.split(/\r?\n/)[0]?.slice(0, 120) ?? "";
						lines.push(`  [${role}] ${summary}${text.length > 120 ? "…" : ""}`);
					}
				}
				lines.push("");
			}

			lines.push(
				"The LLM's most recent turn was grounded in the rules and state shown above. " +
					"If a behavior surprises you, look here first for the basis.",
			);

			ctx.ui.notify(lines.join("\n"), "info");

			// Suppress unused arg
			void args;
		},
	});
}
