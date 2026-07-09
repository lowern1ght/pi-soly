// =============================================================================
// commands/soly.ts — /soly + /sly + /s commands
// =============================================================================
//
// The big one. State inspection picker with three groups (Status /
// Inspect / Manage). The body has the subcommand table (each entry
// dispatches to a buildXxxTransform or showFile) + the picker UI.
//
// Aliases /sly and /s share the same body. Keep them all here because
// the subcommand table IS the picker — splitting them would create
// artificial seams.
// =============================================================================

import * as path from "node:path";
import { readIfExists } from "../core.ts";
import { ListPanel, type ListItem, type ListGroup } from "../visual/list-panel.ts";
import { openSettingsUI } from "../workflows/settings-ui.ts";
import { buildExecuteTransform } from "../workflows/execute.ts";
import { buildNewTransform } from "../workflows/new.ts";
import { buildDoneTransform } from "../workflows/done.ts";
import { buildMigrateTransform } from "../workflows/migrate.ts";
import { buildPlanTransform, buildDiscussTransform } from "../workflows/planning.ts";
import { openListPanel, type CommandUI, type CommandsDeps } from "./_helpers.ts";
import { initSolyProject } from "../init.js";
import { parseSolyCommand, type SolyCommand, type WorkflowVerb } from "../workflows/parser.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type SolyDeps = Pick<CommandsDeps, "getState" | "getConfig" | "reloadConfig" | "updateStatus" | "refreshState" | "recordEvent">;

export function registerSolyCommand(pi: ExtensionAPI, deps: SolyDeps): void {
	const { getState, getConfig, reloadConfig, updateStatus, refreshState, recordEvent } = deps;

	const solyBody = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const ui: CommandUI = {
				notify: (t, k) => ctx.ui.notify(t, k ?? "info"),
				select: async (label, options) => {
					const result = await ctx.ui.select(label, options);
					return result === undefined ? null : options.indexOf(result);
				},
				confirm: (title, message) => ctx.ui.confirm(title, message),
			};
			// `init` is special — it scaffolds a NEW project, so it must run even
			// when there's no `.agents/` dir yet. Dispatch it before the project
			// guard below. (Moved here from the old standalone `/soly-init`.)
			{
				const firstArg = args.trim().split(/\s+/).filter(Boolean)[0] ?? "";
				if (firstArg === "init") {
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
					return;
				}
			}

			const state = getState();
			if (!state.exists) {

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

			};

			/** Dispatch a workflow verb from the `/soly` slash-command picker.
			 *  Same handlers used by the `soly <verb> ...` text-command path —
			 *  registered here so humans can also drive them via
			 *  `/soly <verb> ...` without having to type natural language and
			 *  wait for the LLM to translate. */
			const runWorkflow = async (
				verb: WorkflowVerb,
				parts: string[],
				ctx: ExtensionCommandContext,
				ui: CommandUI,
			): Promise<void> => {
				// parts[0] is the verb name; the args follow.
				const args = parts.slice(1);
				const cmd: SolyCommand = {
					verb,
					args,
					raw: `soly ${verb}${args.length ? " " + args.join(" ") : ""}`,
				};
				const state = getState();
				if (!state.exists) {

					return;
				}
				switch (verb) {
					case "new": {
						const r = buildNewTransform(cmd, state, ui, ctx.cwd, getConfig().plan.defaultBranchPrefix);
						if (r.handled && r.transformedText) recordEvent(r.transformedText);
						return;
					}
					case "done": {
						const r = buildDoneTransform(cmd, state, ui, ctx.cwd, { defaultBranchPrefix: getConfig().plan.defaultBranchPrefix });
						if (r.handled && r.transformedText) recordEvent(r.transformedText);
						return;
					}
					case "migrate": {
						const r = buildMigrateTransform(state, ui, ctx.cwd);
						if (r.handled && r.transformedText) recordEvent(r.transformedText);
						return;
					}
					case "plan": {
						const r = buildPlanTransform(cmd, state);
						if (r.handled && r.transformedText) recordEvent(r.transformedText);
						return;
					}
					case "discuss": {
						// Slash-command path doesn't have live ask_pro detection.
						// Pass `false` so the discuss transform falls back to its
						// plain-text discussion format; the LLM-driven path still
						// gets the richer ask_pro flow.
						const r = buildDiscussTransform(cmd, state, { hasAskPro: false });
						if (r.handled && r.transformedText) recordEvent(r.transformedText);
						return;
					}
					case "execute": {
						// Slash-command path doesn't have live interactive rules.
						const r = buildExecuteTransform(cmd, state, []);
						if (r.handled && r.transformedText) recordEvent(r.transformedText);
						return;
					}
					default:

						return;
				}
			};

			const subcommands = {
				// `agent` subcommand REMOVED — moved to the separate `pi-switch`
				// extension (rotor switcher removed in 1.4.0).
				// Soly no longer owns a rotor switcher.
				config: {
					description: "show merged config (per-project + global + defaults); edit .agents/soly.json or ~/.agents/soly.json",
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
						out.push(`  global:  ~/.agents/soly.json`);
						out.push(`  project: <cwd>/.agents/soly.json`);
						out.push("");
						out.push("To edit:");
						out.push(`  - project: edit \`${state.solyDir}/soly.json\` directly`);
						out.push(`  - global:  edit \`~/.agents/soly.json\``);
						out.push("After editing, run /soly reload to re-pick up changes.");

					},
				},
				position: {
					description: "one-screen position summary (default)",
					run: () => {
						const s = getState();
						if (s.position) {
							// Brief status; full inspector lives in `/soly inspect`.
							ui.notify(
								`pos: ${s.position.phase} · ${s.position.plan} (${s.position.status}) · ${s.progress.percent}%`,
								"info",
							);
						} else {
							recordEvent(`${s.milestone} — no position set`);
						}
					},
				},
				state: {
					description: "full STATE.md body",
					run: () => showFile("STATE.md", getState().stateBody),
				},
				plan: {
					description: "current PLAN.md body, OR `plan <slug>` to flesh out a plan",
					run: (parts: string[]) => {
						// Dual-purpose: no args = show current PLAN.md; with args
						// = dispatch to the plan-mode workflow. Same key the
						// state picker already had (state picker items and
						// workflow verbs share the same `/soly` namespace).
						if (parts.length <= 1) {
							const s = getState();
							if (!s.currentPlanPath) {
								ui.notify("soly: no current plan", "error");
								return;
							}
							showFile(
								`PLAN: ${path.basename(s.currentPlanPath)}`,
								readIfExists(s.currentPlanPath),
							);
							return;
						}
						void runWorkflow("plan", parts, ctx, ui);
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
						const line = `${s.progress.percent}% · ${s.progress.completedPhases}/${s.progress.totalPhases} phases · ${s.progress.completedPlans}/${s.progress.totalPlans} plans`;
						recordEvent(line);
					},
				},
				phases: {
					description: "list all phases with plan counts and C/R markers",
					run: () => {
						const phases = getState().phases;
						if (phases.length === 0) {
							recordEvent("no phases");
							return;
						}
						const current = getState().currentPhase?.number;
						const lines = phases.map((p) => {
							const marker = current === p.number ? "→" : " ";
							const cr = (p.contextExists ? "C" : "·") + (p.researchExists ? "R" : "·");
							return `${marker} ${String(p.number).padStart(2, "0")}. ${p.name}  [${cr}]  plans=${p.planCount}`;
						});
						recordEvent(lines.join("\n"));
					},
				},
				tasks: {
					description: "list all tasks grouped by feature (mirrors soly_list_tasks tool)",
					run: () => {
						const s = getState();
						if (s.tasks.length === 0) {
							recordEvent("no tasks");
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
						recordEvent(out.join("\n"));
					},
				},
				task: {
					description: "show one task's PLAN.md + SUMMARY.md if present  (usage: /soly task <id>)",
					run: (parts: string[]) => {
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
							recordEvent("no SUMMARY.md yet");
						}
					},
				},
				features: {
					description: "list all features with task counts and README presence",
					run: () => {
						const features = getState().features;
						if (features.length === 0) {
							recordEvent("no features");
							return;
						}
						const lines = features.map((f) => {
							const rm = f.readmeExists ? "R" : "·";
							return `  ${f.name.padEnd(28)} tasks=${f.taskCount}  [${rm}]`;
						});
						recordEvent(lines.join("\n"));
					},
				},
				milestone: {
					description: "show the active milestone document (.agents/milestones/<v>.md)",
					run: () => {
						const s = getState();
						if (!s.milestone || s.milestone === "—") {
							recordEvent("no milestone set");
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
						recordEvent(`re-read state: ${s.phases.length} phases · ${s.tasks.length} tasks`);
					},
				},
				// ------------------------------------------------------------------
				// Workflow verbs — same handlers used by the `soly <verb> ...`
				// text-command path. Registered here so humans can also drive
				// them via `/soly <verb> ...` from the slash picker without
				// typing natural language and waiting for the LLM to translate.
				// Each verb's buildXxxTransform already calls ui.notify on
				// success, so we just need to construct a fake `SolyCommand`
				// from the slash args and call the handler.
				// ------------------------------------------------------------------
				new: {
					description: "scaffold a new plan: create branch + .agents/plans/<slug>/PLAN.md (e.g. `/soly new statistic-preparation`)",
					run: (parts: string[]) => runWorkflow("new", parts, ctx, ui),
				},
				execute: {
					description: "execute a plan via subagent (e.g. `/soly execute statistic-preparation`)",
					run: (parts: string[]) => runWorkflow("execute", parts, ctx, ui),
				},
				discuss: {
					description: "interactive discussion of a plan (e.g. `/soly discuss statistic-preparation`)",
					run: (parts: string[]) => runWorkflow("discuss", parts, ctx, ui),
				},
				done: {
					description: "commit + push + open draft PR for a plan branch (e.g. `/soly done statistic-preparation`)",
					run: (parts: string[]) => runWorkflow("done", parts, ctx, ui),
				},
				migrate: {
					description: "one-shot: import .agents/phases/<NN>-<slug>/plans/PLAN.md as plan branches",
					run: () => runWorkflow("migrate", [], ctx, ui),
				},
				where: {
					description: "alias for `position` — current position + progress",
					run: (parts: string[]) => {
						const p = subcommands.position;
						if (p) void p.run();
					},
				},
				settings: {
					description: "interactive config editor (toggles, enums, numbers)",
					run: () => {
						void openSettingsUI({
							ctx,
							ui,
							solyDir: state.solyDir,
							getConfig,
							reloadConfig,
						});
					},
				},
			} as const;

			// Single-width BMP glyphs only — astral/VS16 emoji are mis-measured by
			// visibleWidth, overflow the panel, and ghost the modal on ↑↓.
			const ICONS: Record<string, string> = {
				position: "◎", state: "▤", plan: "▥", context: "◌",
				research: "⊙", roadmap: "≣", progress: "▰",
				phases: "▭", tasks: "✓", task: "◍",
				features: "★", milestone: "◈", reload: "↻", config: "▣",
				settings: "⚙", where: "◎",
			};

			// Short live preview shown in the modal's preview pane per subcommand.
			const previewFor = (name: string): string => {
				const s = getState();
				const teaser = (p: string | null): string => (p ?? "").replace(/\s+/g, " ").slice(0, 240);
				const phaseFile = (suffix: string) =>
					s.currentPhase ? readIfExists(path.join(s.currentPhase.dir, `${s.currentPhase.slug}-${suffix}.md`)) : null;
				switch (name) {
					case "where": return s.position ? `${s.position.phase} · ${s.position.plan} · ${s.position.status} · ${s.progress.percent}%` : `${s.milestone} — no position set`;
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
					case "settings": return "interactive config editor — toggles, enums, numbers";
					case "config": return "merged config JSON (read-only view)";
					case "reload": return "re-read project state from disk";
					default: return subcommands[name as keyof typeof subcommands]?.description ?? "";
				}
			};

			// Top-to-bottom group order in the /soly modal. Items in
			// `items[]` show in declaration order; subcommands not listed here
			// still work via `/soly <name>` directly but don't appear in the picker.
			const SOLY_GROUP_ORDER = ["status", "inspect", "manage"] as const;
			const SOLY_GROUPS: Record<string, { id: string; title: string; icon: string; items: string[] }> = {
				status: {
					id: "status",
					title: "Status",
					icon: "▰",
					items: ["where", "progress"],
				},
				inspect: {
					id: "inspect",
					title: "Inspect",
					icon: "▤",
					items: ["plan", "state", "roadmap", "context", "phases", "tasks", "milestone"],
				},
				manage: {
					id: "manage",
					title: "Manage",
					icon: "⚙",
					items: ["settings", "reload", "config"],
				},
			};

			const solyGroups = (): ListGroup[] =>
				SOLY_GROUP_ORDER.map((gid) => {
					const def = SOLY_GROUPS[gid]!;
					const items: ListItem[] = [];
					for (const name of def.items) {
						const spec = (subcommands as Record<string, { description: string; run: (parts: string[]) => unknown }>)[name];
						if (!spec) continue;
						items.push({
							id: name,
							marker: ICONS[name] ?? "▸",
							label: name,
							meta: spec.description,
							body: previewFor(name),
						});
					}
					return { id: def.id, title: def.title, icon: def.icon, items };
				}).filter((g) => g.items.length > 0);

			// Plain-select fallback for non-TUI (RPC/print) modes. Lists every
			// subcommand in declaration order (not grouped — grouping is a UI
			// nicety that only makes sense in the TUI overlay).
			const picker = async (label: string) => {
				const entries = Object.entries(subcommands);
				const lines = entries.map(([name, spec]) => `${ICONS[name] ?? "▸"} ${name} — ${spec.description}`);
				const choice = await ui.select(label, lines);
				if (choice != null && typeof choice === "number") {
					const name = entries[choice]?.[0];
					if (name) await (subcommands as Record<string, { run: (parts: string[]) => unknown }>)[name]!.run([name]);
				}
			};

			const openMenu = async () => {
				if (ctx.mode !== "tui") return picker("soly (esc to cancel):");
				const s = getState();
				await openListPanel(ctx, {
					title: "soly · state",
					headerRight: `${s.phases.length} phases · ${s.progress.percent}% · /sly /s`,
					build: solyGroups,
					onSelect: (it) => {
						void (subcommands as Record<string, { run: (parts: string[]) => unknown }>)[it.id]?.run([it.id]);
					},
				});
			};

			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = parts[0] ?? "";

			// /soly (or help) with no specific subcommand → the modal (TUI) / picker.
			if (!sub || sub === "help" || sub === "?" || sub === "--help" || sub === "-h") {
				return openMenu();
			}

			if (!(subcommands as Record<string, unknown>)[sub]) {
				ui.notify(`soly: unknown subcommand '${sub}'`, "error");
				return openMenu();
			}

			await (subcommands as Record<string, { run: (parts: string[]) => Promise<unknown> | unknown }>)[sub]!.run(parts);
	};

	pi.registerCommand("soly", {
		description: "soly: project state inspection (position, plan, state, phases, etc.) — type 'help' for subcommand picker",
		handler: solyBody,
	});
	// Short aliases — same body, three names. /sly is the typing-friendly form;
	// /s is the speed-freak form.
	pi.registerCommand("sly", {
		description: "alias for /soly",
		handler: solyBody,
	});
	pi.registerCommand("s", {
		description: "alias for /soly",
		handler: solyBody,
	});
}
