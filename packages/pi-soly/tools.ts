// =============================================================================
// tools.ts — LLM-callable tools for the soly extension
// =============================================================================
//
// Registers three tools the LLM can call:
//   - soly_read         — read any .soly/ artifact (state/plan/roadmap/...)
//   - soly_log_decision — append a row to STATE.md Decisions table
//   - soly_list_phases  — list all phases with markers
//
// All paths are relative to <cwd>/.soly/ (the soly layout — NOT .planning/).
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readIfExists, splitFrontmatter, atomicWriteFileSync, solyDirFor, type SolyState } from "./core.ts";
import { detectEnv, type EnvSummary } from "./env.ts";
import type { SolyConfig } from "./config.ts";
import { buildDocIndex, searchDocs, readSnippet, stripHtml } from "./docs.ts";
import { buildScratchpad, SCRATCHPAD_LIMITS } from "./scratchpad.ts";

const execFileAsync = promisify(execFile);

/** Tools need read/write access to the live state plus a refresh hook. */
export interface ToolsDeps {
	getState: () => SolyState;
	refreshState: () => void;
	getConfig?: () => SolyConfig;
}

export function registerTools(pi: ExtensionAPI, deps: ToolsDeps): void {
	const { getState, refreshState, getConfig } = deps;

	// Simple in-memory cache for file reads (soly_read, soly_snippet).
	// Key: absolute path. Value: { content, mtimeMs }.
	// Invalidated when file mtime changes (cheap stat) or after 30s TTL.
	const readCache = new Map<string, { content: string; mtimeMs: number; ts: number }>();
	const CACHE_TTL_MS = 30_000;

	function readWithCache(absPath: string): string | null {
		const now = Date.now();
		let mtimeMs = 0;
		try {
			mtimeMs = fs.statSync(absPath).mtimeMs;
		} catch {
			return null;
		}
		const cached = readCache.get(absPath);
		if (cached && cached.mtimeMs === mtimeMs && now - cached.ts < CACHE_TTL_MS) {
			return cached.content;
		}
		try {
			const content = fs.readFileSync(absPath, "utf-8");
			readCache.set(absPath, { content, mtimeMs, ts: now });
			return content;
		} catch {
			return null;
		}
	}

	pi.registerTool({
		name: "soly_read",
		label: "soly read",
		description:
			"Read a .soly/ artifact (state, plan, context, research, roadmap, requirements, project, milestone, task). `phase` targets a specific phase (default: current); `taskId` for the task artifact. Returns the file text.",
		parameters: Type.Object({
			artifact: StringEnum([
				"state",
				"plan",
				"context",
				"research",
				"roadmap",
				"requirements",
				"project",
				"milestone",
				"task",
			] as const),
			phase: Type.Optional(
				Type.String({
					description:
						"Phase number (for plan/context/research/milestone). Defaults to current phase.",
				}),
			),
			taskId: Type.Optional(
				Type.String({
					description:
						"Task ID (for task artifact). E.g. 'auth-be-login-a3f9'. Reads tasks/<id>/PLAN.md.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const state = getState();
			const { artifact, phase } = params;
			let rel: string;
			let abs: string;

			if (artifact === "state") {
				rel = "STATE.md";
				abs = path.join(state.solyDir, rel);
			} else if (artifact === "roadmap") {
				rel = "ROADMAP.md";
				abs = path.join(state.solyDir, rel);
			} else if (artifact === "requirements") {
				rel = "REQUIREMENTS.md";
				abs = path.join(state.solyDir, rel);
			} else if (artifact === "project") {
				rel = "PROJECT.md";
				abs = path.join(state.solyDir, rel);
			} else if (artifact === "milestone") {
				rel = state.milestone
					? `milestones/${state.milestone}.md`
					: "MILESTONES.md";
				abs = path.join(state.solyDir, rel);
			} else if (artifact === "task") {
				const taskId = params.taskId;
				if (!taskId) {
					return {
						content: [
							{ type: "text", text: "soly_read: task artifact requires taskId parameter" },
						],
						details: { error: "missing_task_id" },
					};
				}
				const task = state.tasks.find((t) => t.id === taskId);
				if (!task) {
					return {
						content: [
							{ type: "text", text: `soly: task ${taskId} not found in .soly/features/*/tasks/` },
						],
						details: { error: "task_not_found", taskId },
					};
				}
				rel = path.join("features", task.feature, "tasks", task.id, "PLAN.md");
				abs = path.join(state.solyDir, rel);
			} else {
				const targetNum = phase ? parseInt(phase, 10) : state.currentPhase?.number;
				const target = targetNum
					? state.phases.find((p) => p.number === targetNum)
					: state.currentPhase;
				if (!target) {
					return {
						content: [
							{
								type: "text",
								text: `soly: no phase found${phase ? ` for number ${phase}` : " (no current phase)"}`,
							},
						],
						details: { error: "no_phase" },
					};
				}
				if (artifact === "plan") {
					const planFile = target.plans[0];
					if (!planFile) {
						return {
							content: [
								{ type: "text", text: `soly: no plans in phase ${target.number}` },
							],
							details: { error: "no_plan" },
						};
					}
					rel = path.join("phases", target.slug, planFile);
				} else if (artifact === "context") {
					rel = path.join("phases", target.slug, `${target.slug}-CONTEXT.md`);
				} else {
					rel = path.join("phases", target.slug, `${target.slug}-RESEARCH.md`);
				}
				abs = path.join(state.solyDir, rel);
			}

			const content = readWithCache(abs);
			if (!content) {
				return {
					content: [{ type: "text", text: `soly: file not found: ${rel}` }],
					details: { error: "not_found", path: rel },
				};
			}
			return {
				content: [{ type: "text", text: content }],
				details: { path: rel, length: content.length },
			};
		},
	});

	pi.registerTool({
		name: "soly_log_decision",
		label: "soly log decision",
		description:
			"Append a one-line decision + rationale to the Decisions table in .soly/STATE.md (creates it if missing). For meaningful choices: scope cuts, library picks, trade-offs. `phase` defaults to current.",
		parameters: Type.Object({
			decision: Type.String({ description: "The decision made (one line)." }),
			rationale: Type.String({ description: "Why this decision was made (one line)." }),
			phase: Type.Optional(
				Type.String({
					description: "Phase number this decision relates to. Defaults to current phase.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const state = getState();
			const { decision, rationale } = params;
			const phaseRef =
				params.phase ?? (state.currentPhase ? String(state.currentPhase.number) : "—");
			const statePath = path.join(state.solyDir, "STATE.md");
			const raw = readIfExists(statePath);
			if (!raw) {
				return {
					content: [{ type: "text", text: "soly: STATE.md not found" }],
					details: { error: "not_found" },
				};
			}

			const safeDecision = decision.replace(/\|/g, "\\|");
			const safeRationale = rationale.replace(/\|/g, "\\|");
			const row = `| ${safeDecision} | ${safeRationale} | ${phaseRef} |`;

			try {
				const lines = raw.split(/\r?\n/);
				const decisionsIdx = lines.findIndex((l) => /^##\s*Decisions\s*$/.test(l));

				if (decisionsIdx === -1) {
					const header = [
						"",
						"## Decisions",
						"",
						"| Decision | Rationale | Phase |",
						"|----------|-----------|-------|",
						row,
						"",
					].join("\n");
					const updated = raw.endsWith("\n") ? `${raw}${header}` : `${raw}\n${header}`;
					atomicWriteFileSync(statePath, updated, "utf-8");
				} else {
					let insertAt = decisionsIdx + 1;
					while (insertAt < lines.length && !lines[insertAt].startsWith("|")) {
						insertAt++;
					}
					while (
						insertAt < lines.length &&
						lines[insertAt].startsWith("|") &&
						!/^\|[-\s|]+\|$/.test(lines[insertAt].trim())
					) {
						insertAt++;
					}
					lines.splice(insertAt, 0, row);
					atomicWriteFileSync(statePath, lines.join("\n"), "utf-8");
				}
			} catch (err) {
				return {
					content: [
						{ type: "text", text: `soly: failed to write STATE.md: ${(err as Error).message}` },
					],
					details: { error: "write_failed" },
				};
			}

			refreshState();
			return {
				content: [
					{
						type: "text",
						text: `Decision logged to STATE.md (phase ${phaseRef}): ${decision}`,
					},
				],
				details: { decision, phase: phaseRef },
			};
		},
	});

	pi.registerTool({
		name: "soly_list_tasks",
		label: "soly list tasks",
		description:
			"List all tasks across features (kind, status, priority, deps). Use before `soly execute <task-id>` / `--all`.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			const state = getState();
			if (state.tasks.length === 0) {
				return {
					content: [{ type: "text", text: "soly: no tasks found" }],
					details: { count: 0 },
				};
			}
			const lines = state.tasks.map((t) => {
				const deps = t.dependsOn.length > 0 ? `  deps=[${t.dependsOn.join(",")}]` : "";
				const par = t.parallelizable ? "  \u26a1" : "";
				return `\u2192 ${t.id}  [${t.feature}/${t.kind}]  status=${t.status}  prio=${t.priority}${par}${deps}`;
			});
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { count: state.tasks.length },
			};
		},
	});

	pi.registerTool({
		name: "soly_list_phases",
		label: "soly list phases",
		description:
			"List phases with plan count, C/R (context/research) markers, and current-position marker (→). Use before `soly plan <N>` / `execute <N>`.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			const state = getState();
			if (state.phases.length === 0) {
				return {
					content: [{ type: "text", text: "soly: no phases found" }],
					details: { count: 0 },
				};
			}
			const lines = state.phases.map((p) => {
				const marker = state.currentPhase?.number === p.number ? "→" : " ";
				const cr = (p.contextExists ? "C" : "·") + (p.researchExists ? "R" : "·");
				return `${marker} Phase ${p.number}: ${p.name}  [${cr}]  plans=${p.planCount}`;
			});
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					count: state.phases.length,
					current: state.currentPhase?.number ?? null,
				},
			};
		},
	});

	pi.registerTool({
		name: "soly_todos",
		label: "soly todos",
		description:
			"Scan the tree for TODO/FIXME/HACK/XXX/NOTE comments, grouped by file (common source extensions; excludes node_modules/.git/dist/build/.soly). Needs ripgrep on PATH. `paths` overrides root, `limit` caps (default 200).",
		parameters: Type.Object({
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description: "Directories or files to scan. Defaults to cwd.",
				}),
			),
			limit: Type.Optional(
				Type.Number({
					description: "Max matches to return. Default 200.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const targets = params.paths && params.paths.length > 0 ? params.paths : [ctx.cwd];
			const limit = params.limit && params.limit > 0 ? params.limit : 200;
			const cwd = ctx.cwd;

			const rgArgs = [
				"--no-heading",
				"--line-number",
				"--color=never",
				"--hidden",
				"--glob=!.git/**",
				"--glob=!node_modules/**",
				"--glob=!dist/**",
				"--glob=!build/**",
				"--glob=!.soly/**",
				"--glob=!coverage/**",
				"-tts",
				"-tjs",
				"-tpy",
				"-tgo",
				"-trs",
				"-e",
				"\\b(TODO|FIXME|HACK|XXX|NOTE)\\b",
				...targets,
			];

			type Match = { file: string; line: number; text: string; tag: string };
			const matches: Match[] = [];
			try {
				const { stdout } = await execFileAsync("rg", rgArgs, {
					cwd,
					maxBuffer: 4 * 1024 * 1024,
					encoding: "utf-8",
					windowsHide: true,
				});
				for (const line of stdout.split(/\r?\n/)) {
					if (!line) continue;
					const m = line.match(/^(.*?):(\d+):(?:\d+:)?(.*)$/);
					if (!m) continue;
					const file = m[1];
					const lineNum = parseInt(m[2], 10);
					const text = m[3].trim();
					const tagMatch = text.match(/\b(TODO|FIXME|HACK|XXX|NOTE)\b/);
					matches.push({
						file,
						line: lineNum,
						text,
						tag: tagMatch?.[1] ?? "TODO",
					});
					if (matches.length >= limit) break;
				}
			} catch {
				return {
					content: [
						{
							type: "text",
							text:
								`soly_todos: no matches found (or \`rg\` is not on PATH — install ripgrep for full functionality).`,
						},
					],
					details: { count: 0, hint: "install ripgrep" },
				};
			}

			const byFile = new Map<string, Match[]>();
			for (const m of matches) {
				const list = byFile.get(m.file) ?? [];
				list.push(m);
				byFile.set(m.file, list);
			}

			const byTag = new Map<string, number>();
			for (const m of matches) {
				byTag.set(m.tag, (byTag.get(m.tag) ?? 0) + 1);
			}

			const tagSummary = [...byTag.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([k, v]) => `${v} ${k}`)
				.join(", ");

			const out: string[] = [];
			out.push(
				`soly_todos: ${matches.length} match(es) in ${byFile.size} file(s) — ${tagSummary}`,
			);
			out.push("");
			for (const [file, list] of [...byFile.entries()].sort()) {
				out.push(`  ${file}`);
				for (const m of list.slice(0, 5)) {
					out.push(`    L${m.line} [${m.tag}]  ${m.text.slice(0, 120)}`);
				}
				if (list.length > 5) {
					out.push(`    ... and ${list.length - 5} more in this file`);
				}
			}
			if (matches.length >= limit) {
				out.push("");
				out.push(`(hit limit of ${limit}; pass higher \`limit\` to see more)`);
			}

			return {
				content: [{ type: "text", text: out.join("\n") }],
				details: {
					count: matches.length,
					files: byFile.size,
					byTag: Object.fromEntries(byTag),
				},
			};
		},
	});

	// ============================================================================
	// soly_env — project environment summary
	// ============================================================================

	pi.registerTool({
		name: "soly_env",
		label: "soly env",
		description:
			"Detect the project's environment as a one-screen summary: package manager, runtimes, key deps, scripts, services (from compose), and tooling flags (ts/tests/docker/ci). Answers 'what test runner / package manager / is docker used'.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const env = detectEnv(ctx.cwd);
			const lines: string[] = [];
			lines.push("=== soly env ===");
			lines.push("");
			if (env.projectName) {
				lines.push(`name:           ${env.projectName}${env.projectVersion ? ` @ ${env.projectVersion}` : ""}`);
			}
			if (env.packageManager) lines.push(`pkg manager:   ${env.packageManager}`);
			if (env.runtimes.length > 0) lines.push(`runtimes:      ${env.runtimes.join(", ")}`);
			if (env.mainDependencies.length > 0)
				lines.push(`key deps:      ${env.mainDependencies.join(", ")}`);
			if (env.scripts.length > 0) lines.push(`scripts:       ${env.scripts.map((s) => `\`${s}\``).join(" ")}`);
			const flags: string[] = [];
			if (env.hasTypeScript) flags.push("TypeScript");
			if (env.hasTests) flags.push("tests");
			if (env.hasDocker) flags.push("docker");
			if (env.hasCI) flags.push("ci");
			if (flags.length > 0) lines.push(`tooling:       ${flags.join(", ")}`);
			if (env.services.length > 0) lines.push(`services:      ${env.services.join(", ")}`);

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { ...env },
			};
		},
	});

	// ============================================================================
	// soly_snippet — bounded file read with line numbers
	// ============================================================================

	pi.registerTool({
		name: "soly_snippet",
		label: "soly snippet",
		description:
			"Read a bounded line range from a file with line numbers — a specific function/section without the whole file. `offset` 0-indexed, `limit` default 100 (cap 500). For .html, `format=\"stripped\"` removes tags.",
		parameters: Type.Object({
			path: Type.String({ description: "File path (relative to cwd or absolute)." }),
			offset: Type.Optional(Type.Number({ description: "0-indexed start line. Default 0." })),
			limit: Type.Optional(Type.Number({ description: "Max lines. Default 100, cap 500." })),
			format: Type.Optional(
				StringEnum(["raw", "stripped"] as const, {
					description: '"raw" (default) or "stripped" (remove HTML tags).',
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const requested = params.path;
			const abs = path.isAbsolute(requested)
				? requested
				: path.resolve(ctx.cwd, requested);
			const offset = params.offset && params.offset > 0 ? params.offset : 0;
			const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 500) : 100;
			const format = params.format ?? "raw";

			const result = readSnippet(abs, offset, limit);
			if (!result) {
				return {
					content: [
						{ type: "text", text: `soly_snippet: file not found: ${requested}` },
					],
					details: { error: "not_found" },
				};
			}

			// Optional HTML strip
			const isHtml = /\.(html?|htm)$/i.test(abs);
			let lines = result.lines;
			if (isHtml && format === "stripped") {
				// Strip whole file (not line-by-line) so block-level tags collapse
				// across line boundaries, then re-split.
				const joined = result.lines.join("\n");
				const stripped = stripHtml(joined);
				lines = stripped.split(/\r?\n/);
			}

			const numbered = lines.map((l, i) => {
				const lineNum = offset + i + 1;
				return `${String(lineNum).padStart(5, " ")}  ${l}`;
			});
			const header = `=== ${requested}${format === "stripped" ? " (stripped)" : ""} (lines ${offset + 1}–${offset + lines.length} of ${result.totalLines}) ===`;
			const footer = result.outOfRange
				? `\n(…${result.totalLines - (offset + lines.length)} more lines; pass higher \`offset\` to continue)`
				: "";
			return {
				content: [{ type: "text", text: `${header}\n${numbered.join("\n")}${footer}` }],
				details: {
					path: abs,
					offset,
					lines: lines.length,
					totalLines: result.totalLines,
					format,
				},
			};
		},
	});

	// ============================================================================
	// soly_doc_search — search .md index for relevant docs
	// ============================================================================

	pi.registerTool({
		name: "soly_doc_search",
		label: "soly doc search",
		description:
			"Search .md/.html under cwd for a query (intent docs prioritized, hits tagged [intent]/[phase-intent]/[project]). Use to find docs before loading one with soly_snippet. `limit` default 10 (cap 50).",
		parameters: Type.Object({
			query: Type.String({ description: "Search query (substring, case-insensitive)." }),
			limit: Type.Optional(
				Type.Number({ description: "Max hits. Default 10, cap 50." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 50) : 10;
			const index = buildDocIndex(ctx.cwd);
			const hits = searchDocs(index, params.query, limit);

			if (hits.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `soly_doc_search: no matches for "${params.query}" in ${index.length} indexed .md/.html file(s).`,
						},
					],
					details: { count: 0, indexed: index.length },
				};
			}

			const out: string[] = [];
			out.push(`soly_doc_search: ${hits.length} hit(s) for "${params.query}" (${index.length} files indexed):`);
			out.push("");
			for (const h of hits) {
				const tag =
					h.entry.sourceKind === "intent"
						? "[intent]"
						: h.entry.sourceKind === "phase-intent"
							? "[phase-intent]"
							: "[project]";
				out.push(`  ${tag} ${h.entry.relPath}  (score=${h.score})`);
				if (h.entry.title) out.push(`    title:   ${h.entry.title}`);
				if (h.entry.preview) out.push(`    preview: ${h.entry.preview.slice(0, 140)}`);
				for (const ex of h.excerpts) {
					out.push(`    match:   ${ex}`);
				}
				out.push("");
			}
			out.push("Use soly_snippet(path=\"<relpath>\", offset=N, limit=M) to load a specific range.");
			return {
				content: [{ type: "text", text: out.join("\n") }],
				details: { count: hits.length, indexed: index.length },
			};
		},
	});

	// ============================================================================
	// soly_scratchpad — recent conversation summary
	// ============================================================================

	pi.registerTool({
		name: "soly_scratchpad",
		label: "soly scratchpad",
		description:
			"Compact recap of the recent conversation (one line per turn). Use to recover context after a break or brief a sibling subagent. `limit` default 20 user-turns (cap 50).",
		parameters: Type.Object({
			limit: Type.Optional(
				Type.Number({
					description: "Max user-turns to include. Default 20, cap 50.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const limit =
				params.limit && params.limit > 0
					? Math.min(params.limit, SCRATCHPAD_LIMITS.max)
					: SCRATCHPAD_LIMITS.default;
			const branch = ctx.sessionManager.getBranch();
			const pad = buildScratchpad(branch, limit);

			if (pad.entries.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `soly_scratchpad: no prior conversation (this is the first turn).`,
						},
					],
					details: { count: 0 },
				};
			}

			const out: string[] = [];
			out.push(`soly_scratchpad: ${pad.turnCount} user-turn(s), ${pad.entries.length} message(s) total:`);
			out.push("");
			for (const e of pad.entries) {
				const prefix = e.role === "user" ? "U" : e.role === "assistant" ? "A" : "T";
				out.push(`[${e.turn}][${prefix}] ${e.summary}`);
			}
			out.push("");
			out.push("Use this to recover context after a long break, or to brief a sibling subagent without sharing the full session history.");
			return {
				content: [{ type: "text", text: out.join("\n") }],
				details: {
					turnCount: pad.turnCount,
					entryCount: pad.entries.length,
					fromTurn: pad.fromTurn,
					branchLength: pad.branchLength,
				},
			};
		},
	});

	// ============================================================================
	// soly_ask_user — multiple-choice picker (for `soly discuss` interactive flow)
	// ============================================================================

	pi.registerTool({
		name: "soly_ask_user",
		label: "soly ask user",
		description:
			"DEPRECATED — prefer `ask_pro` (multi-question picker). Fallback only. Asks one multiple-choice question via pi's picker; option #1 is the recommended answer (⭐ prefix + a `rationale`). `allowOther` adds a custom-text 'Other…'. Returns the chosen text (or custom string); Esc → cancelled.",
		parameters: Type.Object({
			title: Type.String({ description: "Title above the picker." }),
			question: Type.String({ description: "The question (one sentence)." }),
			options: Type.Array(Type.String(), {
				description: "2-4 options; #1 is recommended (⭐ prefix).",
			}),
			rationale: Type.Optional(
				Type.String({ description: "Why #1 is recommended (shown above the picker)." }),
			),
			allowOther: Type.Optional(
				Type.Boolean({ description: "Add a custom-text 'Other…' choice." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "soly_ask_user requires a UI-capable session (TUI or RPC mode). Run `soly discuss <N>` from the interactive pi TUI.",
						},
					],
					details: { error: "no_ui", mode: ctx.mode },
				};
			}
			if (params.options.length < 2) {
				return {
					content: [
						{ type: "text", text: "soly_ask_user: need at least 2 options" },
					],
					details: { error: "too_few_options" },
				};
			}
			if (params.options.length > 4) {
				return {
					content: [
						{
							type: "text",
							text: "soly_ask_user: 2-4 options recommended (>4 hurts the picker UX)",
						},
					],
					details: { error: "too_many_options" },
				};
			}

			// Build the picker title — include the question + optional rationale.
			const headerLines: string[] = [params.title];
			headerLines.push("");
			headerLines.push(params.question);
			if (params.rationale) {
				headerLines.push("");
				headerLines.push(`💡 ${params.rationale}`);
			}
			const pickerTitle = headerLines.join("\n");

			const displayOptions = params.allowOther
				? [...params.options, "Other…"]
				: params.options;

			const choice = await ctx.ui.select(pickerTitle, displayOptions);
			if (choice === undefined) {
				return {
					content: [
						{
							type: "text",
							text: "(user cancelled the picker — defer this question)",
						},
					],
					details: { cancelled: true },
				};
			}

			// "Other…" picked → open a text input dialog
			if (params.allowOther && choice === "Other…") {
				const customText = await ctx.ui.input(
					`${params.title} — custom answer`,
					"Type your answer…",
				);
				if (customText === undefined) {
					return {
						content: [
							{
								type: "text",
								text: "(user cancelled custom input — defer this question)",
							},
						],
						details: { cancelled: true },
					};
				}
				const trimmed = customText.trim();
				if (trimmed === "") {
					return {
						content: [
							{
								type: "text",
								text: "(user submitted empty input — defer this question)",
							},
						],
						details: { cancelled: true },
					};
				}
				return {
					content: [
						{
							type: "text",
							text: `User chose [Other]: "${trimmed}"`,
						},
					],
					details: { choice: "other", customText: trimmed },
				};
			}

			const chosenIndex = displayOptions.indexOf(choice);
			return {
				content: [
					{
						type: "text",
						text: `User chose: ${choice}${chosenIndex === 0 ? " (recommended)" : ""}`,
					},
				],
				details: { choice, chosenIndex, allOptions: displayOptions },
			};
		},
	});

	// ============================================================================
	// soly_finish_discuss — finalize a phase discussion (writes CONTEXT.md)
	// ============================================================================

	pi.registerTool({
		name: "soly_finish_discuss",
		label: "soly finish discuss",
		description:
			"Finalize a `soly discuss <N>` session: write `<phase>-CONTEXT.md` with all decisions and delete the checkpoint. Call AFTER all gray-area questions are answered — not for partial progress (use soly_save_discuss_checkpoint for that).",
		parameters: Type.Object({
			phase_number: Type.Number({ description: "Phase number being discussed." }),
			domain: Type.String({
				description:
					"1-2 paragraphs: what this phase delivers (grounded in ROADMAP + intent, no implementation details).",
			}),
			decisions: Type.Array(
				Type.Object({
					category: Type.String({ description: "Decision category (e.g. 'Session handling')." }),
					choice: Type.String({ description: "What was chosen." }),
					rationale: Type.Optional(
						Type.String({ description: "Why (default 'user discretion')." }),
					),
				}),
				{ description: "All decisions captured this round." },
			),
			canonical_refs: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"MANDATORY. Files the planner needs (intent docs, REQUIREMENTS, contracts), full paths from `.soly/`.",
				}),
			),
			deferred_ideas: Type.Optional(
				Type.Array(Type.String(), { description: "Scope-creep items for future phases." }),
			),
			codebase_context: Type.Optional(
				Type.Array(Type.String(), {
					description: "Reusable assets/patterns the planner should know (path — what to reuse).",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			// Locate phase dir
			const solyDir = solyDirFor(ctx.cwd);
			if (!fs.existsSync(solyDir)) {
				return {
					content: [{ type: "text", text: "soly_finish_discuss: no .soly/ in cwd" }],
					details: { error: "no_soly" },
				};
			}
			const phaseNum = params.phase_number;
			const phasesRoot = path.join(solyDir, "phases");
			let phaseDir: string | null = null;
			if (fs.existsSync(phasesRoot)) {
				for (const entry of fs.readdirSync(phasesRoot, { withFileTypes: true })) {
					if (!entry.isDirectory()) continue;
					const m = entry.name.match(/^0*(\d+)/);
					if (m && parseInt(m[1]!, 10) === phaseNum) {
						phaseDir = path.join(phasesRoot, entry.name);
						break;
					}
				}
			}
			if (!phaseDir) {
				return {
					content: [
						{
							type: "text",
							text: `soly_finish_discuss: phase ${phaseNum} not found in .soly/phases/`,
						},
					],
					details: { error: "no_phase", phase: phaseNum },
				};
			}

			const padded = String(phaseNum).padStart(2, "0");
			const slug = path
				.basename(phaseDir)
				.replace(/^\d+-?/, "")
				.trim();
			const generatedAt = new Date().toISOString();

			// Build CONTEXT.md
			const lines: string[] = [];
			lines.push("---");
			lines.push(`phase: ${phaseNum}  phase_slug: ${slug}  generated: ${generatedAt}`);
			lines.push(
				`areas_completed: ${params.decisions.length}  areas_deferred: ${(params.deferred_ideas ?? []).length}`,
			);
			lines.push("---");
			lines.push("");
			lines.push(`# ${phaseNum}: ${slug || "Phase"} — Discussion Context`);
			lines.push("");
			lines.push(`<domain>${params.domain}</domain>`);
			lines.push("");

			if (params.decisions.length > 0) {
				lines.push("<decisions>");
				// Group by category
				const byCategory = new Map<string, typeof params.decisions>();
				for (const d of params.decisions) {
					const list = byCategory.get(d.category) ?? [];
					list.push(d);
					byCategory.set(d.category, list);
				}
				for (const [cat, list] of byCategory) {
					lines.push(`### ${cat}`);
					for (const d of list) {
						lines.push(`- **Decision:** ${d.choice}`);
						lines.push(`  **Rationale:** ${d.rationale ?? "user discretion"}`);
						lines.push(`  **Source:** soly discuss ${phaseNum} (soly_finish_discuss)`);
					}
				}
				lines.push("</decisions>");
				lines.push("");
			} else {
				lines.push(
					"<decisions>_(No decisions captured — discussion may have been deferred. See <deferred_ideas>.)_</decisions>",
				);
				lines.push("");
			}

			lines.push("<canonical_refs> <!-- MANDATORY -->");
			const refs = params.canonical_refs ?? [];
			if (refs.length > 0) {
				for (const ref of refs) {
					lines.push(`- \`${ref}\` — referenced from discuss`);
				}
			} else {
				lines.push("- (no external docs referenced)");
			}
			lines.push("</canonical_refs>");
			lines.push("");

			if ((params.codebase_context ?? []).length > 0) {
				lines.push("<codebase_context>");
				lines.push("Reusable assets/patterns the planner should know:");
				for (const c of params.codebase_context!) {
					lines.push(`- ${c}`);
				}
				lines.push("</codebase_context>");
				lines.push("");
			}

			if ((params.deferred_ideas ?? []).length > 0) {
				lines.push("<deferred_ideas>");
				for (const d of params.deferred_ideas!) {
					lines.push(`- ${d}`);
				}
				lines.push("</deferred_ideas>");
				lines.push("");
			}

			const contextPath = path.join(phaseDir, `${padded}-CONTEXT.md`);
			atomicWriteFileSync(contextPath, lines.join("\n"), "utf-8");

			// Delete checkpoint if exists
			const checkpointPath = path.join(phaseDir, `${padded}-DISCUSS-CHECKPOINT.json`);
			let deletedCheckpoint = false;
			if (fs.existsSync(checkpointPath)) {
				try {
					fs.unlinkSync(checkpointPath);
					deletedCheckpoint = true;
				} catch {
					// best effort
				}
			}

			return {
				content: [
					{
						type: "text",
						text: `Discussion complete for phase ${phaseNum} (${slug || "phase"}).\n\nWrote: \`${path.relative(ctx.cwd, contextPath)}\`\nDecisions: ${params.decisions.length}\nDeferred: ${(params.deferred_ideas ?? []).length}\nCheckpoint cleaned up: ${deletedCheckpoint}\n\nNext step: \`soly plan ${phaseNum}\``,
					},
				],
				details: {
					contextPath,
					decisionsCount: params.decisions.length,
					deferredCount: (params.deferred_ideas ?? []).length,
					deletedCheckpoint,
				},
			};
		},
	});

	// ============================================================================
	// soly_save_discuss_checkpoint — partial progress, for resume after a quit
	// ============================================================================

	pi.registerTool({
		name: "soly_save_discuss_checkpoint",
		label: "soly save discuss checkpoint",
		description:
			"Save a partial-progress checkpoint for `soly discuss <N>` (call after each decision so a quit doesn't lose progress; the next `soly discuss <N>` resumes from it). When done, call `soly_finish_discuss`.",
		parameters: Type.Object({
			phase_number: Type.Number({ description: "Phase number being discussed." }),
			decisions: Type.Array(
				Type.Object({
					category: Type.String({ description: "Decision category." }),
					choice: Type.String({ description: "What was chosen." }),
					rationale: Type.Optional(Type.String()),
				}),
				{ description: "Decisions captured so far this session." },
			),
			areas_total: Type.Optional(
				Type.Number({ description: "Total gray areas planned for this discussion (for progress display)." }),
			),
			areas_completed: Type.Optional(
				Type.Array(Type.Number(), { description: "0-based indices of completed areas." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const solyDir = solyDirFor(ctx.cwd);
			const phasesRoot = path.join(solyDir, "phases");
			if (!fs.existsSync(phasesRoot)) {
				return {
					content: [{ type: "text", text: "soly_save_discuss_checkpoint: no .soly/phases/ in cwd" }],
					details: { error: "no_phases" },
				};
			}
			const phaseNum = params.phase_number;
			let phaseDir: string | null = null;
			let phaseSlug = "";
			for (const entry of fs.readdirSync(phasesRoot, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const m = entry.name.match(/^0*(\d+)-?(.*)$/);
				if (m && parseInt(m[1]!, 10) === phaseNum) {
					phaseDir = path.join(phasesRoot, entry.name);
					phaseSlug = m[2] ?? "";
					break;
				}
			}
			if (!phaseDir) {
				return {
					content: [
						{ type: "text", text: `soly_save_discuss_checkpoint: phase ${phaseNum} not found` },
					],
					details: { error: "no_phase", phase: phaseNum },
				};
			}

			const padded = String(phaseNum).padStart(2, "0");
			const checkpointPath = path.join(phaseDir, `${padded}-DISCUSS-CHECKPOINT.json`);
			const checkpoint = {
				version: "1.0",
				phase: phaseNum,
				padded_phase: padded,
				phase_slug: phaseSlug,
				phase_dir: phaseDir,
				round: 1,
				areas_total: params.areas_total ?? null,
				areas_completed: params.areas_completed ?? [],
				areas_deferred: [],
				decisions: params.decisions,
				generated_at: new Date().toISOString(),
				next_action: "await_user_answers",
			};
			atomicWriteFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

			return {
				content: [
					{
						type: "text",
						text: `Checkpoint saved (${params.decisions.length} decision(s)). Next \`soly discuss ${phaseNum}\` will resume from here.`,
					},
				],
				details: {
					checkpointPath,
					decisionsCount: params.decisions.length,
					areasCompleted: params.areas_completed?.length ?? 0,
					areasTotal: params.areas_total ?? null,
				},
			};
		},
	});
}
