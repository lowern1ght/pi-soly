// =============================================================================
// workflows/inspect.ts — Inspect / cleanup commands (soly doctor, iterations,
// phase delete). Direct-response — no LLM round-trip, no transforms.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SolyState } from "../core.js";
import type { SolyConfig } from "../config.js";

interface InspectUI {
	notify: (text: string, kind?: "info" | "warning" | "error") => void;
}

// ---------------------------------------------------------------------------
// soly doctor — health check
// ---------------------------------------------------------------------------

interface DoctorCheck {
	name: string;
	/** pass / warn / fail affect the count. `info` is purely informational
	 *  (e.g. "optional extension not installed") and doesn't change the totals. */
	status: "pass" | "warn" | "fail" | "info";
	detail: string;
}

export function showDoctor(_cmd: unknown, state: SolyState, ui: InspectUI, config: SolyConfig, activeTools: string[] = []): void {
	const checks: DoctorCheck[] = [];

	// 1. .soly/ exists
	checks.push({
		name: ".soly/ directory",
		status: state.exists ? "pass" : "fail",
		detail: state.exists ? state.solyDir : "no .soly/ found in cwd",
	});

	// 2. STATE.md exists + has frontmatter
	if (state.exists) {
		const statePath = path.join(state.solyDir, "STATE.md");
		if (fs.existsSync(statePath)) {
			const raw = fs.readFileSync(statePath, "utf-8");
			if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
				checks.push({ name: "STATE.md frontmatter", status: "pass", detail: "valid YAML block" });
			} else {
				checks.push({ name: "STATE.md frontmatter", status: "warn", detail: "missing top-level frontmatter" });
			}
		} else {
			checks.push({ name: "STATE.md", status: "fail", detail: "missing" });
		}
	}

	// 3. ROADMAP.md exists
	if (state.exists) {
		const roadmapPath = path.join(state.solyDir, "ROADMAP.md");
		if (fs.existsSync(roadmapPath)) {
			checks.push({ name: "ROADMAP.md", status: "pass", detail: "present" });
		} else {
			// Symmetric with STATE.md: both required for soly workflows to function
			checks.push({ name: "ROADMAP.md", status: "fail", detail: "missing — `soly plan N` needs phase context" });
		}
	}

	// 4. At least one phase
	if (state.exists) {
		const phasesDir = path.join(state.solyDir, "phases");
		if (fs.existsSync(phasesDir)) {
			const dirCount = fs.readdirSync(phasesDir, { withFileTypes: true })
				.filter((e) => e.isDirectory() && !e.name.startsWith("."))
				.length;
			checks.push({
				name: "phase directories",
				status: dirCount > 0 ? "pass" : "warn",
				detail: dirCount > 0 ? `${dirCount} phase(s)` : "none — run `soly plan <N>` to start",
			});
		}
	}

	// 5. Iteration file count
	if (state.exists) {
		const iterDir = path.join(state.solyDir, "iterations");
		if (fs.existsSync(iterDir)) {
			const files = fs.readdirSync(iterDir).filter((f) => f.endsWith(".md"));
			let warnDetail: string | null = null;
			if (files.length > 50) {
				warnDetail = `${files.length} files — consider enabling iteration.retentionDays in config`;
			} else if (files.length > 0) {
				warnDetail = `${files.length} files`;
			} else {
				warnDetail = "none";
			}
			checks.push({
				name: "iteration files",
				status: files.length > 50 ? "warn" : "pass",
				detail: warnDetail,
			});
		} else {
			checks.push({ name: "iteration files", status: "pass", detail: "no iterations yet" });
		}
	}

	// 6. Phase dir naming convention
	if (state.exists) {
		const phasesDir = path.join(state.solyDir, "phases");
		if (fs.existsSync(phasesDir)) {
			const bad: string[] = [];
			for (const e of fs.readdirSync(phasesDir, { withFileTypes: true })) {
				if (!e.isDirectory() || e.name.startsWith(".")) continue;
				if (!/^\d+(-|_).+/.test(e.name)) bad.push(e.name);
			}
			checks.push({
				name: "phase dir naming",
				status: bad.length === 0 ? "pass" : "warn",
				detail: bad.length === 0
					? "all match `<NN>-<slug>` convention"
					: `${bad.length} don't match convention: ${bad.join(", ")}`,
			});
		}
	}

	// 7. Plan files have frontmatter
	if (state.exists) {
		const phasesDir = path.join(state.solyDir, "phases");
		if (fs.existsSync(phasesDir)) {
			let totalPlans = 0;
			let badPlans = 0;
			// Tight match: "NN-something-PLAN.md" — phase number prefix, then
			// slug, then -PLAN.md. Avoids matching "old-PLAN-PLAN.md" or
			// "PLAN.md" without a phase prefix.
			const planRe = /^\d{2,}-.+-PLAN\.md$/;
			for (const p of fs.readdirSync(phasesDir, { withFileTypes: true })) {
				if (!p.isDirectory() || p.name.startsWith(".")) continue;
				for (const f of fs.readdirSync(path.join(phasesDir, p.name))) {
					if (planRe.test(f)) {
						totalPlans++;
						try {
							const raw = fs.readFileSync(path.join(phasesDir, p.name, f), "utf-8");
							if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) badPlans++;
						} catch {
							// Unreadable plan: count as bad so user notices
							badPlans++;
						}
					}
				}
			}
			checks.push({
				name: "PLAN.md frontmatter",
				status: badPlans === 0 ? "pass" : totalPlans > 0 ? "warn" : "pass",
				detail: totalPlans === 0
					? "no plans yet"
					: badPlans === 0
						? `all ${totalPlans} plans have valid frontmatter`
						: `${badPlans}/${totalPlans} plans missing frontmatter`,
			});
		}
	}

	// 8. Stale iteration files (if retention config > 0)
	if (state.exists && config.iteration.retentionDays > 0) {
		const iterDir = path.join(state.solyDir, "iterations");
		if (fs.existsSync(iterDir)) {
			const cutoff = Date.now() - config.iteration.retentionDays * 86400_000;
			let stale = 0;
			for (const f of fs.readdirSync(iterDir)) {
				try {
					const stat = fs.statSync(path.join(iterDir, f));
					if (stat.isFile() && stat.mtimeMs < cutoff) stale++;
				} catch { /* skip */ }
			}
			checks.push({
				name: "iteration retention",
				status: stale === 0 ? "pass" : "warn",
				detail: stale === 0
					? `no files older than ${pluralDays(config.iteration.retentionDays)}`
					: `${stale} file(s) older than ${pluralDays(config.iteration.retentionDays)} (will auto-prune on next session_start)`,
			});
		}
	}

	// 9. .soly/rules/ exists if state says rules are loaded
	if (state.exists) {
		const rulesDir = path.join(state.solyDir, "rules");
		checks.push({
			name: ".soly/rules/ directory",
			status: fs.existsSync(rulesDir) ? "pass" : "warn",
			detail: fs.existsSync(rulesDir) ? "present" : "no rules directory — soly will fall back to ~/.soly/rules/",
		});
	}

	// 10. pi-todo cross-extension (optional, but recommended for long agentic flows)
	if (state.exists) {
		const hasPiTodo = activeTools.includes("todo_update");
		checks.push({
			name: "pi-todo extension (cross-extension)",
			status: hasPiTodo ? "pass" : "info",
			detail: hasPiTodo
				? "todo_update tool loaded — plan execution will show live progress in footer"
				: "not detected (optional) — install pi-ask sibling for live progress on multi-step plans",
		});
	}

	// 11. subagent tool (execute/plan delegate to it; without it they run inline)
	if (state.exists) {
		const hasSubagent = activeTools.includes("subagent");
		checks.push({
			name: "subagent tool (delegated execution)",
			status: hasSubagent ? "pass" : "info",
			detail: hasSubagent
				? "subagent tool loaded — soly execute/plan delegate to a worker"
				: "not installed — soly execute/plan run inline in this session (install pi-subagents for delegated/parallel execution)",
		});
	}

	// Render
	const symbol = { pass: "✓", warn: "⚠", fail: "✗", info: "ℹ" };
	const color = { pass: "pass", warn: "warning", fail: "fail", info: "info" } as const;
	const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
	for (const c of checks) counts[c.status]++;

	const out: string[] = [];
	out.push("=== soly doctor ===");
	out.push("");
	for (const c of checks) {
		out.push(`  ${symbol[c.status]} ${c.name}  (${color[c.status]})`);
		out.push(`     ${c.detail}`);
	}
	out.push("");
	out.push(`Total: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail`);
	if (counts.fail > 0) {
		out.push("");
		out.push("Critical issues found — soly workflows may not work correctly until fixed.");
	} else if (counts.warn > 0) {
		out.push("");
		out.push("Warnings present — run `/soly iterations` and `/soly config` to review.");
	}
	ui.notify(out.join("\n"), counts.fail > 0 ? "error" : counts.warn > 0 ? "warning" : "info");
}

// ---------------------------------------------------------------------------

/** "1 day" / "2 days" / "0 days" — small grammar helper used in doctor output. */
function pluralDays(n: number): string {
	return n === 1 ? "1 day" : `${n} days`;
}

// ---------------------------------------------------------------------------
// soly todos — read .soly/todos.json or .pi-todos.json and show as a notify.
// Mirrors what pi-todo would render in the footer, so the user can see
// todos even when pi-todo extension isn't loaded (e.g. just-installed).
// ---------------------------------------------------------------------------

/** Try to find a todo file in cwd. Returns the path or null. */
function findTodosFile(cwd: string): string | null {
	const candidates = [
		path.join(cwd, ".soly", "todos.json"),
		path.join(cwd, ".pi-todos.json"),
	];
	for (const c of candidates) {
		if (fs.existsSync(c)) return c;
	}
	return null;
}

export function showTodos(
	_cmd: { verb: string; args: string[]; raw: string },
	state: SolyState,
	ui: InspectUI,
): void {
	if (!state.exists) {
		ui.notify("soly todos: no .soly/ directory in cwd", "error");
		return;
	}
	const file = findTodosFile(state.solyDir);
	if (!file) {
		ui.notify(
			"soly todos: no todo file found. Install the `pi-todo` extension or write `.soly/todos.json` manually.",
			"info",
		);
		return;
	}
	let parsed: { todos?: Array<{ content?: string; status?: string; activeForm?: string }> } | null = null;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		ui.notify(`soly todos: failed to parse ${path.basename(file)} (corrupt JSON?)`, "error");
		return;
	}
	if (!parsed || !Array.isArray(parsed.todos) || parsed.todos.length === 0) {
		ui.notify("soly todos: list is empty. Use the LLM's `todo_update` tool to add items.", "info");
		return;
	}
	const todos = parsed.todos;
	const total = todos.length;
	const done = todos.filter((t) => t.status === "completed").length;
	const lines: string[] = [];
	lines.push(`=== soly todos (${done}/${total} done) — from ${path.basename(file)} ===`);
	lines.push("");
	for (const t of todos) {
		if (typeof t.content !== "string" || typeof t.status !== "string") continue;
		const mark = t.status === "completed" ? "✓" : t.status === "in_progress" ? "⋯" : "○";
		const suffix = t.status === "in_progress" && typeof t.activeForm === "string" ? ` (${t.activeForm})` : "";
		lines.push(`  ${mark} ${t.content}${suffix}`);
	}
	ui.notify(lines.join("\n"), "info");
}

// ---------------------------------------------------------------------------
// soly iterations [N] — list recent iteration files (sorted mtime desc)
// ---------------------------------------------------------------------------

export function showIterations(
	cmd: { args: string[]; verb: string; raw: string },
	state: SolyState,
	ui: InspectUI,
	limitDefault: number = 10,
): void {
	if (!state.exists) {
		ui.notify("soly iterations: no .soly/ directory in cwd", "error");
		return;
	}
	const iterDir = path.join(state.solyDir, "iterations");
	if (!fs.existsSync(iterDir)) {
		ui.notify("soly iterations: no iterations yet (run soly plan or soly execute first)", "info");
		return;
	}

	// Optional N
	const nArg = cmd.args[0]?.trim();
	let limit = limitDefault;
	if (nArg) {
		const parsed = parseInt(nArg, 10);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			ui.notify(`soly iterations: invalid count "${nArg}"`, "error");
			return;
		}
		limit = parsed;
	}

	const files = fs.readdirSync(iterDir)
		.filter((f) => f.endsWith(".md"))
		.map((f) => {
			const full = path.join(iterDir, f);
			const stat = fs.statSync(full);
			return { name: f, mtimeMs: stat.mtimeMs, size: stat.size };
		})
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, limit);

	if (files.length === 0) {
		ui.notify("soly iterations: no iteration files found", "info");
		return;
	}

	const out: string[] = [];
	out.push(`=== soly iterations (last ${files.length}) ===`);
	out.push("");
	for (const f of files) {
		const ago = humanizeAge(Date.now() - f.mtimeMs);
		const sizeKb = (f.size / 1024).toFixed(1);
		out.push(`  ${f.name}  (${sizeKb}k, ${ago})`);
	}
	if (limitDefault === 10 && cmd.args[0] === undefined) {
		out.push("");
		out.push("Tip: `soly iterations 20` for more, `soly diff iterations <a> <b>` to compare two.");
	}
	ui.notify(out.join("\n"), "info");
}

function humanizeAge(ms: number): string {
	if (ms < 60_000) return "just now";
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
	if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`;
	return `${Math.round(ms / (30 * 86_400_000))}mo ago`;
}

// ---------------------------------------------------------------------------
// soly diff iterations <a> <b> — compare two iteration files
// ---------------------------------------------------------------------------

export function showDiffIterations(
	cmd: { args: string[]; verb: string; raw: string },
	state: SolyState,
	ui: InspectUI,
): void {
	if (!state.exists) {
		ui.notify("soly diff iterations: no .soly/ directory in cwd", "error");
		return;
	}
	const iterDir = path.join(state.solyDir, "iterations");
	if (cmd.args.length < 2) {
		ui.notify(
			`soly diff iterations: need two file arguments (e.g. "soly diff iterations 05-02-exec-T1.md 05-02-exec-T2.md")`,
			"error",
		);
		return;
	}
	const [a, b] = [cmd.args[0]!, cmd.args[1]!];
	const pathA = path.isAbsolute(a) ? a : path.join(iterDir, a);
	const pathB = path.isAbsolute(b) ? b : path.join(iterDir, b);

	if (!fs.existsSync(pathA)) {
		ui.notify(`soly diff iterations: file not found: ${a}`, "error");
		return;
	}
	if (!fs.existsSync(pathB)) {
		ui.notify(`soly diff iterations: file not found: ${b}`, "error");
		return;
	}

	const bodyA = fs.readFileSync(pathA, "utf-8");
	const bodyB = fs.readFileSync(pathB, "utf-8");

	const out: string[] = [];
	out.push(`=== soly diff iterations ===`);
	out.push(`  A: ${a}  (${(bodyA.length / 1024).toFixed(1)}k)`);
	out.push(`  B: ${b}  (${(bodyB.length / 1024).toFixed(1)}k)`);
	out.push("");
	if (bodyA === bodyB) {
		out.push("Files are identical.");
	} else {
		out.push("Files differ. Showing the LLM-friendly view (both full bodies — model can diff mentally):");
		out.push("");
		out.push("--- BEGIN A ---");
		out.push(bodyA);
		out.push("--- END A ---");
		out.push("");
		out.push("--- BEGIN B ---");
		out.push(bodyB);
		out.push("--- END B ---");
	}
	ui.notify(out.join("\n"), "info");
}

// ---------------------------------------------------------------------------
// soly phase delete <N> — soft-delete a phase (move to .trash)
// ---------------------------------------------------------------------------

export function showPhaseDelete(
	cmd: { args: string[]; verb: string; raw: string },
	state: SolyState,
	ui: InspectUI,
): void {
	if (!state.exists) {
		ui.notify("soly phase delete: no .soly/ directory in cwd", "error");
		return;
	}
	if (cmd.args.length < 1) {
		ui.notify("soly phase delete: need a phase number (e.g. `soly phase delete 5`)", "error");
		return;
	}
	const phaseNum = parseInt(cmd.args[0]!, 10);
	if (!Number.isFinite(phaseNum)) {
		ui.notify(`soly phase delete: invalid phase number "${cmd.args[0]}"`, "error");
		return;
	}

	const phase = state.phases.find((p) => p.number === phaseNum);
	if (!phase) {
		const known = state.phases.map((p) => p.number).join(", ") || "(none)";
		ui.notify(`soly phase delete: phase ${phaseNum} not found. Known: ${known}`, "error");
		return;
	}

	const trashDir = path.join(state.solyDir, "phases", ".trash");
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
	const dest = path.join(trashDir, `${phase.slug}-${stamp}`);

	try {
		fs.mkdirSync(trashDir, { recursive: true });
		fs.renameSync(phase.dir, dest);
	} catch (e) {
		ui.notify(`soly phase delete: failed to move phase (${(e as Error).message})`, "error");
		return;
	}

	const out: string[] = [];
	out.push(`✓ Phase ${phaseNum} (${phase.name}) moved to .trash/`);
	out.push(`  ${phase.dir}  →  ${dest}`);
	out.push("");
	out.push("To restore: `mv` it back to .soly/phases/");
	out.push("To permanently delete: `rm -rf " + dest + "`");
	ui.notify(out.join("\n"), "info");
}
