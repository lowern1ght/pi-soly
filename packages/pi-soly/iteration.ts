// =============================================================================
// iteration.ts — Per-iteration context bundle (B2 of the soly design)
// =============================================================================
//
// Writes a self-contained .md file under `.agents/iterations/` that bundles
// everything a worker needs for ONE iteration of a plan / task / phase:
// intent docs, STATE.md, ROADMAP row, phase CONTEXT, phase RESEARCH, up
// to 3 prior SUMMARYs, and the current PLAN.md (for exec).
//
// Why a file (and not just system-prompt injection):
//   - The bundle is too large for system prompt (intent + CONTEXT +
//     RESEARCH + prior SUMMARYs + current PLAN ≈ 6–8k tokens)
//   - File is auditable — humans can inspect what context a worker had
//   - Resume after `soly pause` is reliable: file persists across sessions
//   - Worker can re-read sections it forgot without bothering the user
//
// Plus a small inline summary (must_haves + anti-patterns) is included in
// the worker's task string itself, so the worker has the most critical
// bits available even before opening the file.
//
// All worktree writes go to `.agents/iterations/` (under the project's
// `.agents/`), never to the project root. See workflow markdown templates
// for the hard rule.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFileSync, readIfExists } from "./core.ts";

export type IterationKind = "exec" | "plan" | "discuss" | "pause";

export interface IterationInput {
	solyDir: string;
	projectRoot: string;
	kind: IterationKind;
	/** Phase number (for plan / discuss / exec-phase). */
	phaseNumber?: number;
	/** Plan number within phase (only for kind=exec of a phase plan). */
	planNumber?: number;
	/** Task id (only for task-mode execution / planning). */
	taskId?: string;
	/** Plan name (only for plan-mode execution / planning — `.agents/plans/<name>/`). */
	planName?: string;
	/** Feature name (only for task-mode). Backfilled from disk if omitted. */
	feature?: string;
}

export interface IterationOutput {
	/** Absolute path to the written file. */
	filePath: string;
	/** Path relative to projectRoot (for display in prompts). */
	relPath: string;
	/** Filename only. */
	fileName: string;
	/** File size in bytes. */
	bytes: number;
	/** Estimated tokens. */
	tokens: number;
	/** Generation timestamp (ISO 8601). */
	generatedAt: string;
}

// ----------------------------------------------------------------------------
// Section token budgets. Total target: ~6500 tokens (fits comfortably in
// worker's context window; worker can re-read source files for full content).
// ----------------------------------------------------------------------------

const SECTION_BUDGETS = {
	intent: 500,
	state: 400,
	roadmap: 400,
	context: 1500,
	research: 1500,
	summaries: 1800, // up to 3 × 600
	plan: 2500,
	antipatterns: 500,
	featureReadme: 800,
} as const;

/** Slug-shaped ISO timestamp suitable for filenames (e.g. 20260614T201530Z). */
export function timestampSlug(): string {
	return new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d+Z$/, "Z");
}

/** Truncate text to roughly N tokens (1 token ≈ 4 chars). */
function truncate(text: string, maxTokens: number, note?: string): string {
	const maxChars = maxTokens * 4;
	if (text.length <= maxChars) return text;
	const footer = note
		? `\n\n<!-- ${note}; truncated at ${maxTokens} tokens (${text.length} chars) -->`
		: `\n\n<!-- truncated at ${maxTokens} tokens (${text.length} chars) -->`;
	return text.slice(0, maxChars) + footer;
}

/** Make an absolute path relative to projectRoot for display. */
function rel(projectRoot: string, abs: string): string {
	const r = path.relative(projectRoot, abs);
	return r.startsWith("..") ? abs : r;
}

// ----------------------------------------------------------------------------
// Disk lookups
// ----------------------------------------------------------------------------

/** Find the phase directory `<solyDir>/phases/<NN>-<slug>/` matching phaseNumber. */
export function findPhaseDir(solyDir: string, phaseNumber: number): string | null {
	const phasesRoot = path.join(solyDir, "phases");
	if (!fs.existsSync(phasesRoot)) return null;
	for (const entry of fs.readdirSync(phasesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const m = entry.name.match(/^(\d+)/);
		if (m && parseInt(m[1], 10) === phaseNumber) {
			return path.join(phasesRoot, entry.name);
		}
	}
	return null;
}

/** Find the task directory for a given task id. */
export function findTaskDir(
	solyDir: string,
	taskId: string,
): { dir: string; feature: string } | null {
	const featuresRoot = path.join(solyDir, "features");
	if (!fs.existsSync(featuresRoot)) return null;
	for (const f of fs.readdirSync(featuresRoot, { withFileTypes: true })) {
		if (!f.isDirectory()) continue;
		const taskDir = path.join(featuresRoot, f.name, "tasks", taskId);
		if (fs.existsSync(taskDir)) return { dir: taskDir, feature: f.name };
	}
	return null;
}

/** Find the PLAN.md file for a given plan number within a phase dir. */
export function findPlanFile(phaseDir: string, planNumber: number): string | null {
	const padded = String(planNumber).padStart(2, "0");
	let files: string[];
	try {
		files = fs.readdirSync(phaseDir);
	} catch {
		return null;
	}
	const re = new RegExp(`^\\d+-${padded}-.+-PLAN\\.md$`);
	const match = files.find((f) => re.test(f));
	return match ? path.join(phaseDir, match) : null;
}

/** Find the most recent N SUMMARY.md files in a phase dir, oldest-first. */
export function findRecentSummaries(dir: string, n: number): string[] {
	let files: string[];
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith("-SUMMARY.md"));
	} catch {
		return [];
	}
	files.sort();
	return files.slice(-n).map((f) => path.join(dir, f));
}

/** Find a phase's `<NN>-CONTEXT.md` path (or null).
 *  Convention: filename starts with the padded phase number, not the full
 *  slug. e.g. `.agents/phases/05-auth/05-CONTEXT.md`, not `05-auth-CONTEXT.md`. */
export function findPhaseContextPath(phaseDir: string): string | null {
	const slug = path.basename(phaseDir);
	const numMatch = slug.match(/^(\d+)/);
	if (!numMatch) return null;
	const padded = numMatch[1]!.padStart(2, "0");
	const p = path.join(phaseDir, `${padded}-CONTEXT.md`);
	return fs.existsSync(p) ? p : null;
}

/** Find a phase's `<NN>-RESEARCH.md` path (or null). */
export function findPhaseResearchPath(phaseDir: string): string | null {
	const slug = path.basename(phaseDir);
	const numMatch = slug.match(/^(\d+)/);
	if (!numMatch) return null;
	const padded = numMatch[1]!.padStart(2, "0");
	const p = path.join(phaseDir, `${padded}-RESEARCH.md`);
	return fs.existsSync(p) ? p : null;
}

/** Find a phase's `.continue-here.md` path (or null). */
export function findContinueHerePath(phaseDir: string): string | null {
	const p = path.join(phaseDir, ".continue-here.md");
	return fs.existsSync(p) ? p : null;
}

// ----------------------------------------------------------------------------
// Section loaders (each returns the section body, already truncated)
// ----------------------------------------------------------------------------

function loadIntentSummary(solyDir: string, maxTokens: number): string {
	const docsRoot = path.join(solyDir, "docs");
	if (!fs.existsSync(docsRoot)) return "_(no \`.agents/docs/\` directory — drop your 0-point docs there)_";

	const files: string[] = [];
	for (const e of fs.readdirSync(docsRoot, { withFileTypes: true })) {
		if (e.name.startsWith(".")) continue;
		const full = path.join(docsRoot, e.name);
		if (e.isDirectory()) {
			for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
				if (sub.isFile() && sub.name.endsWith(".md")) files.push(path.join(full, sub.name));
			}
		} else if (e.isFile() && e.name.endsWith(".md")) {
			files.push(full);
		}
	}
	if (files.length === 0) return "_(no \`.md\` files in \`.agents/docs/\`)_";

	files.sort();
	const out: string[] = [];
	let usedChars = 0;
	const maxChars = maxTokens * 4;
	for (const f of files) {
		const relPath = path.relative(solyDir, f);
		const body = readIfExists(f) ?? "";
		const preview = body
			.replace(/^---[\s\S]*?---\r?\n/, "")
			.split(/\r?\n/)
			.filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("```"))
			.slice(0, 6)
			.join(" ");
		const chunk = `- \`${relPath}\`: ${preview.slice(0, 240)}\n`;
		if (usedChars + chunk.length > maxChars) {
			out.push(`\n_(truncated at ${maxTokens} tokens; full files in \`.agents/docs/\`)_\n`);
			break;
		}
		out.push(chunk);
		usedChars += chunk.length;
	}
	return out.join("");
}

function loadStateSection(solyDir: string, maxTokens: number): string {
	const statePath = path.join(solyDir, "STATE.md");
	const raw = readIfExists(statePath);
	if (!raw) return "_(no \`STATE.md\`) — initialize with \`soly init\` or create manually_";

	// Prefer "Current Position" + "## Decisions" + top 20 lines of frontmatter
	const lines = raw.split(/\r?\n/);
	const out: string[] = [];
	let inSection = "";
	let buf: string[] = [];

	const flush = () => {
		if (buf.length > 0) {
			out.push(buf.join("\n"));
			buf = [];
		}
	};

	for (const l of lines) {
		if (l.match(/^##\s*Current Position/i)) {
			flush();
			inSection = "current";
			buf.push(l);
			continue;
		}
		if (l.match(/^##\s*Decisions/i)) {
			flush();
			inSection = "decisions";
			buf.push(l);
			continue;
		}
		if (l.match(/^##\s/) && (inSection === "current" || inSection === "decisions")) {
			flush();
			inSection = "";
		}
		if (inSection) buf.push(l);
	}
	flush();

	const combined = out.length > 0 ? out.join("\n\n") : truncate(raw, maxTokens);
	return truncate(combined.trim(), maxTokens);
}

function loadRoadmapRow(solyDir: string, phaseNumber: number, maxTokens: number): string {
	const roadmapPath = path.join(solyDir, "ROADMAP.md");
	const raw = readIfExists(roadmapPath);
	if (!raw) return "_(no \`ROADMAP.md\`)_";

	const lines = raw.split(/\r?\n/);
	// Match `## Phase <N>`, `## Phase <NN>`, `## <N>`, `## <NN>`, `## <N>-...`
	// The phase number is matched with optional zero-padding, the "Phase"
	// prefix is optional, the separator is `:` / `-` / space.
	const re = new RegExp(
		`^#{2,4}\\s+(?:Phase\\s+)?0*${phaseNumber}(?:[\\s:\\-.]|$)`,
		"i",
	);
	const startIdx = lines.findIndex((l) => re.test(l));
	if (startIdx === -1) return truncate(raw, maxTokens);

	const out: string[] = [];
	for (let i = startIdx; i < lines.length; i++) {
		const l = lines[i]!;
		if (i > startIdx && /^##\s/.test(l)) break;
		out.push(l);
	}
	return truncate(out.join("\n"), maxTokens);
}

function loadPhaseContext(phaseDir: string, maxTokens: number): string {
	const p = findPhaseContextPath(phaseDir);
	if (!p) return "_(no \`CONTEXT.md\` for this phase — run \`soly discuss <N>\` first if decisions are missing)_";
	return truncate(readIfExists(p) ?? "", maxTokens);
}

function loadPhaseResearch(phaseDir: string, maxTokens: number): string {
	const p = findPhaseResearchPath(phaseDir);
	if (!p) return "_(no \`RESEARCH.md\` for this phase yet)_";
	return truncate(readIfExists(p) ?? "", maxTokens);
}

function loadPlanFile(planFile: string, maxTokens: number): string {
	return truncate(readIfExists(planFile) ?? "", maxTokens);
}

function loadPhaseSummaries(phaseDir: string, n: number, perSummaryTokens: number): string {
	const files = findRecentSummaries(phaseDir, n);
	if (files.length === 0) return "_(no prior \`SUMMARY.md\` files in this phase)_";
	return files
		.map((f) => `### ${path.basename(f)}\n\n${truncate(readIfExists(f) ?? "", perSummaryTokens)}`)
		.join("\n\n---\n\n");
}

function loadFeatureTaskSummaries(
	taskDir: string,
	n: number,
	perSummaryTokens: number,
): string {
	const featureDir = path.dirname(path.dirname(taskDir));
	const tasksDir = path.join(featureDir, "tasks");
	if (!fs.existsSync(tasksDir)) return "_(no prior task \`SUMMARY.md\` files in this feature)_";
	const all: string[] = [];
	for (const t of fs.readdirSync(tasksDir, { withFileTypes: true })) {
		if (!t.isDirectory()) continue;
		const s = path.join(tasksDir, t.name, "SUMMARY.md");
		if (fs.existsSync(s) && s !== path.join(taskDir, "SUMMARY.md")) all.push(s);
	}
	all.sort();
	const recent = all.slice(-n);
	if (recent.length === 0) return "_(no prior task \`SUMMARY.md\` files in this feature)_";
	return recent
		.map((f) => `### ${path.basename(path.dirname(f))}\n\n${truncate(readIfExists(f) ?? "", perSummaryTokens)}`)
		.join("\n\n---\n\n");
}

function loadAntiPatterns(phaseDir: string, maxTokens: number): string {
	const cont = findContinueHerePath(phaseDir);
	if (!cont) return "_(no \`.continue-here.md\` for this phase)_";
	const body = readIfExists(cont) ?? "";
	const lines = body.split(/\r?\n/);
	const out: string[] = [];
	let inSection = false;
	for (const l of lines) {
		if (l.match(/^##\s*Critical Anti-Patterns/i)) {
			inSection = true;
			out.push(l);
			continue;
		}
		if (inSection) {
			if (l.match(/^##\s/) && !l.match(/Critical Anti-Patterns/i)) break;
			out.push(l);
		}
	}
	if (out.length === 0) return "_(no \`## Critical Anti-Patterns\` section in \`.continue-here.md\`) — safe to proceed_";
	return truncate(out.join("\n"), maxTokens, "blocking rows only");
}

function loadFeatureReadme(feature: string, solyDir: string, maxTokens: number): string {
	const readme = path.join(solyDir, "features", feature, "README.md");
	if (!fs.existsSync(readme)) return `_(no \`.agents/features/${feature}/README.md\`)_`;
	return truncate(readIfExists(readme) ?? "", maxTokens);
}

// ----------------------------------------------------------------------------
// Plan summary extraction (for inline task-string cache)
// ----------------------------------------------------------------------------

export interface PlanSummary {
	id: string;
	title: string;
	wave: number;
	requirements: string[];
	dependsOn: string[];
	mustHaves: {
		truths: string[];
		artifacts: string[];
		keyLinks: string[];
	};
}

/** Extract key fields from a PLAN.md for inline use in the worker task. */
export function extractPlanSummary(planContent: string): PlanSummary | null {
	const m = planContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (!m) return null;
	const yaml = m[1]!;
	const body = m[2]!;

	const get = (key: string): string => {
		const line = yaml.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
		return (line?.split(":").slice(1).join(":") ?? "").trim().replace(/^["']|["']$/g, "");
	};

	const id = get("id") || "";
	const title = get("title") || "";
	const wave = parseInt(get("wave") || "1", 10) || 1;
	// Split helper: strip outer [ ], split on comma, trim, strip inner quotes.
	const splitList = (raw: string): string[] =>
		raw
			.replace(/^\[|\]$/g, "")
			.split(",")
			.map((s) => s.trim().replace(/^["']|["']$/g, ""))
			.filter(Boolean);
	const requirements = splitList(get("requirements"));
	const dependsOn = splitList(get("depends-on"));

	// Must Haves
	const truths: string[] = [];
	const artifacts: string[] = [];
	const keyLinks: string[] = [];
	const mhMatch = body.match(/##\s*Must Haves\s*\n([\s\S]*?)(?=\n##\s|\s*$)/);
	if (mhMatch) {
		const mhBody = mhMatch[1]!;
		const truthSec = mhBody.match(/###\s*truths\b[\s\S]*?(?=###\s|$)/i)?.[0];
		if (truthSec) {
			for (const m of truthSec.matchAll(/^- \[[ x]\]\s*(.+)$/gm)) truths.push(m[1]!.trim());
		}
		const artSec = mhBody.match(/###\s*artifacts\b[\s\S]*?(?=###\s|$)/i)?.[0];
		if (artSec) {
			for (const m of artSec.matchAll(/^-\s*(.+)$/gm)) {
				const t = m[1]!.trim();
				if (t && !t.startsWith("###")) artifacts.push(t);
			}
		}
		const linkSec = mhBody.match(/###\s*key_links\b[\s\S]*?(?=###\s|$)/i)?.[0];
		if (linkSec) {
			for (const m of linkSec.matchAll(/^-\s*(.+)$/gm)) {
				const t = m[1]!.trim();
				if (t && !t.startsWith("###")) keyLinks.push(t);
			}
		}
	}

	return { id, title, wave, requirements, dependsOn, mustHaves: { truths, artifacts, keyLinks } };
}

/** Render a PlanSummary as a compact bullet block for inline use. */
export function renderPlanSummaryInline(s: PlanSummary): string {
	const out: string[] = [];
	if (s.title) out.push(`- **Plan title**: ${s.title}`);
	out.push(`- **Wave**: ${s.wave}`);
	if (s.requirements.length > 0) out.push(`- **Requirements**: [${s.requirements.join(", ")}]`);
	if (s.dependsOn.length > 0) out.push(`- **Depends-on**: [${s.dependsOn.join(", ")}]`);
	if (s.mustHaves.truths.length > 0) {
		out.push(`- **Must-haves — truths**:`);
		for (const t of s.mustHaves.truths) out.push(`  - ${t}`);
	}
	if (s.mustHaves.artifacts.length > 0) {
		out.push(`- **Must-haves — artifacts**:`);
		for (const a of s.mustHaves.artifacts) out.push(`  - ${a}`);
	}
	if (s.mustHaves.keyLinks.length > 0) {
		out.push(`- **Must-haves — key_links**:`);
		for (const k of s.mustHaves.keyLinks) out.push(`  - ${k}`);
	}
	return out.join("\n");
}

// ----------------------------------------------------------------------------
// Bundle assembly
// ----------------------------------------------------------------------------

/** Build the full bundle content (no I/O — pure-ish, only reads from disk). */
export function buildIterationContent(input: IterationInput): string {
	const sections: string[] = [];
	const generatedAt = new Date().toISOString();
	const projectRoot = input.projectRoot;

	// ---- Frontmatter ----
	sections.push("---");
	sections.push(`generated: ${generatedAt}`);
	sections.push(`kind: ${input.kind}`);
	if (input.phaseNumber != null) sections.push(`phase: ${input.phaseNumber}`);
	if (input.planNumber != null) sections.push(`plan: ${input.planNumber}`);
	if (input.taskId) sections.push(`task: ${input.taskId}`);
	if (input.feature) sections.push(`feature: ${input.feature}`);
	sections.push(`soly_dir: ${input.solyDir}`);
	sections.push("---");
	sections.push("");

	// ---- Title ----
	let title: string;
	if (input.kind === "exec") {
		title = input.taskId
			? `# Iteration Context — Execute Task \`${input.taskId}\``
			: `# Iteration Context — Execute Phase ${input.phaseNumber} / Plan ${input.planNumber}`;
	} else if (input.kind === "plan") {
		title = input.taskId
			? `# Iteration Context — Plan Task \`${input.taskId}\``
			: `# Iteration Context — Plan Phase ${input.phaseNumber}`;
	} else if (input.kind === "discuss") {
		title = `# Iteration Context — Discuss Phase ${input.phaseNumber}`;
	} else {
		title = `# Iteration Context — ${input.kind}`;
	}
	sections.push(title);
	sections.push("");
	sections.push(`**Generated**: ${generatedAt}`);
	sections.push(`**Soly dir**: \`${rel(projectRoot, input.solyDir) || ".agents"}\``);
	if (input.taskId) {
		sections.push(`**Task**: \`${input.taskId}\` in feature \`${input.feature ?? "?"}\``);
	} else if (input.phaseNumber != null) {
		sections.push(
			`**Phase**: ${input.phaseNumber}${input.planNumber != null ? ` / Plan ${input.planNumber}` : ""}`,
		);
	}
	sections.push("");
	sections.push("> **Read this file first.** It contains all the context you need for this iteration.");
	sections.push(
		"> If you need the full unabridged version of any section, the source path is given in the section header.",
	);
	sections.push("");

	// ---- Section 0: Intent ----
	sections.push("## 0. Project Intent (from `.agents/docs/`)");
	sections.push("");
	sections.push(
		`_Source: \`.agents/docs/\` (full files in \`.agents/docs/\`, see also \`soly_intent\` tool)_`,
	);
	sections.push("");
	sections.push(loadIntentSummary(input.solyDir, SECTION_BUDGETS.intent));
	sections.push("");

	// ---- Look up phase / task dirs (backfill feature from disk if needed) ----
	let phaseDir: string | null = null;
	if (input.phaseNumber != null) phaseDir = findPhaseDir(input.solyDir, input.phaseNumber);

	let taskDir: string | null = null;
	if (input.taskId) {
		const found = findTaskDir(input.solyDir, input.taskId);
		if (found) {
			taskDir = found.dir;
			if (!input.feature) input.feature = found.feature;
		}
	}

	// ---- Section 1: State (only if there's a project state) ----
	if (input.kind !== "pause") {
		sections.push("## 1. Project State (`.agents/STATE.md` — Current Position + Decisions)");
		sections.push("");
		sections.push(`_Source: \`${rel(projectRoot, path.join(input.solyDir, "STATE.md"))}\`_`);
		sections.push("");
		sections.push(loadStateSection(input.solyDir, SECTION_BUDGETS.state));
		sections.push("");
	}

	// ---- Phase-based sections (intent/plan/exec with a phase number) ----
	if ((input.kind === "plan" || input.kind === "exec" || input.kind === "discuss") && input.phaseNumber != null) {
		// Section 2: ROADMAP row
		sections.push(`## 2. ROADMAP.md — Phase ${input.phaseNumber} row`);
		sections.push("");
		sections.push(`_Source: \`${rel(projectRoot, path.join(input.solyDir, "ROADMAP.md"))}\`_`);
		sections.push("");
		sections.push(loadRoadmapRow(input.solyDir, input.phaseNumber, SECTION_BUDGETS.roadmap));
		sections.push("");
	}

	if ((input.kind === "plan" || input.kind === "exec" || input.kind === "discuss") && phaseDir) {
		// Section 3: Phase CONTEXT (also for discuss — facilitator refines, doesn't re-derive)
		const ctxPath = findPhaseContextPath(phaseDir);
		sections.push("## 3. Phase CONTEXT");
		sections.push("");
		sections.push(`_Source: \`${ctxPath ? rel(projectRoot, ctxPath) : "(missing)"}\`_`);
		sections.push("");
		sections.push(loadPhaseContext(phaseDir, SECTION_BUDGETS.context));
		sections.push("");
	}

	if ((input.kind === "plan" || input.kind === "exec") && phaseDir) {
		// Section 4: Phase RESEARCH
		// (Section 3 Phase CONTEXT is emitted by the plan|exec|discuss block above.)
		const resPath = findPhaseResearchPath(phaseDir);
		sections.push("## 4. Phase RESEARCH");
		sections.push("");
		sections.push(`_Source: \`${resPath ? rel(projectRoot, resPath) : "(missing)"}\`_`);
		sections.push("");
		sections.push(loadPhaseResearch(phaseDir, SECTION_BUDGETS.research));
		sections.push("");

		// Section 5: Prior SUMMARYs
		sections.push("## 5. Prior SUMMARYs (last 3 in this phase)");
		sections.push("");
		sections.push(loadPhaseSummaries(phaseDir, 3, 600));
		sections.push("");

		// For exec, also include the current PLAN
		if (input.kind === "exec" && input.planNumber != null) {
			const planFile = findPlanFile(phaseDir, input.planNumber);
			if (planFile) {
				sections.push(`## 6. Current PLAN (\`${path.basename(planFile)}\`)`);
				sections.push("");
				sections.push(`_Source: \`${rel(projectRoot, planFile)}\`_`);
				sections.push("");
				sections.push(loadPlanFile(planFile, SECTION_BUDGETS.plan));
				sections.push("");
			}
		}

		// Section 7: Anti-patterns (from .continue-here.md)
		if (input.kind === "exec") {
			sections.push("## 7. Critical Anti-Patterns (from `.continue-here.md`, if present)");
			sections.push("");
			sections.push(
				"_Treat any `severity = blocking` row as a hard rule. Acknowledge before proceeding._",
			);
			sections.push("");
			sections.push(loadAntiPatterns(phaseDir, SECTION_BUDGETS.antipatterns));
			sections.push("");
		}
	}

	// ---- Task-mode sections ----
	if (input.taskId && taskDir) {
		const featureName = input.feature ?? "unknown";
		const readmeRel = path.join(input.solyDir, "features", featureName, "README.md");

		// Section 2 (replaces phase sections): Feature README
		sections.push("## 2. Feature README");
		sections.push("");
		sections.push(`_Source: \`${rel(projectRoot, readmeRel)}\`_`);
		sections.push("");
		sections.push(loadFeatureReadme(featureName, input.solyDir, SECTION_BUDGETS.featureReadme));
		sections.push("");

		// Section 3: Prior task SUMMARYs
		sections.push("## 3. Prior task SUMMARYs (last 3 in this feature)");
		sections.push("");
		sections.push(loadFeatureTaskSummaries(taskDir, 3, 600));
		sections.push("");

		// Section 4: Current task PLAN
		if (input.kind === "exec" || input.kind === "plan") {
			const planFile = path.join(taskDir, "PLAN.md");
			if (fs.existsSync(planFile)) {
				sections.push("## 4. Current task PLAN");
				sections.push("");
				sections.push(`_Source: \`${rel(projectRoot, planFile)}\`_`);
				sections.push("");
				sections.push(loadPlanFile(planFile, SECTION_BUDGETS.plan));
				sections.push("");
			}
		}
	}

	sections.push("---");
	sections.push("");
	sections.push(
		"**End of iteration context.** Continue with the workflow instructions in the task prompt.",
	);

	return sections.join("\n");
}

// ----------------------------------------------------------------------------
// File writer
// ----------------------------------------------------------------------------

/** Compute the bundle file path (does not write). */
export function iterationFilePath(input: IterationInput): string {
	const iterationsDir = path.join(input.solyDir, "iterations");
	const ts = timestampSlug();
	let fileName: string;
	if (input.taskId) {
		const feat = input.feature ?? "task";
		fileName = `${feat}__${input.taskId}-${input.kind}-${ts}.md`;
	} else if (input.phaseNumber == null) {
		fileName = `${input.kind}-${ts}.md`;
	} else {
		const padded = String(input.phaseNumber).padStart(2, "0");
		const planPart =
			input.planNumber != null ? `-${String(input.planNumber).padStart(2, "0")}` : "";
		fileName = `${padded}${planPart}-${input.kind}-${ts}.md`;
	}
	return path.join(iterationsDir, fileName);
}

/** Build the bundle + write it to disk. Returns metadata. */
export function writeIterationContext(input: IterationInput): IterationOutput {
	const iterationsDir = path.join(input.solyDir, "iterations");
	fs.mkdirSync(iterationsDir, { recursive: true });
	const filePath = iterationFilePath(input);
	const content = buildIterationContent(input);
	atomicWriteFileSync(filePath, content, "utf-8");
	return {
		filePath,
		relPath: rel(input.projectRoot, filePath),
		fileName: path.basename(filePath),
		bytes: content.length,
		tokens: Math.ceil(content.length / 4),
		generatedAt: new Date().toISOString(),
	};
}
