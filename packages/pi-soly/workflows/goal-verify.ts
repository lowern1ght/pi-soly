// =============================================================================
// workflows/goal-verify.ts — Goal & Acceptance verification for `soly execute`
// =============================================================================
//
// Reads PLAN.md `## Goal` + `## Acceptance`, hands the LLM a structured
// "verify against the diff" prompt at end of execute, and lets the worker
// append a `## Status` section (idempotent, fenced by marker comments).
//
// Pure LLM review — no `bun/dotnet/pytest`-style mechanical checks. This
// plugin is multi-language; mechanical checks would be unreliable. The LLM
// walks `git diff master..HEAD` itself and judges.
//
// Headless-safe by construction: this module MUST NOT import `ask_pro`,
// `decision_deck`, `@earendil-works/pi-tui`, or call `ctx.ui.custom(...)`.
// A regression test greps the source for those tokens.
//
// Three public surfaces:
//   1. `parseGoalAndAcceptance(planPath)`   — read PLAN.md, return parsed
//                                            sections or `{ ok:false, error }`.
//   2. `buildVerificationPrompt(parsed, planPath)` — instruction string for
//                                            the execute worker.
//   3. `appendStatus(planPath, report)`     — idempotent append/replace of
//                                            the `## Status` section.
//
// Pure helpers (`buildStatusSection`, `findMarkerBlock`) are exported for tests.
// =============================================================================

import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GoalAcceptanceParsed = {
	ok: true;
	goal: string;
	acceptance: string[];
};

export type GoalAcceptanceError = {
	ok: false;
	error: string;
};

export type GoalAcceptanceResult = GoalAcceptanceParsed | GoalAcceptanceError;

export type StatusAcceptanceItem = {
	item: string;
	met: boolean;
	evidence: string;
};

export type StatusReport = {
	goalMet: boolean;
	acceptance: StatusAcceptanceItem[];
};

export const STATUS_BEGIN = "<!-- soly:status:begin -->";
export const STATUS_END = "<!-- soly:status:end -->";

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a PLAN.md and extract the `## Goal` text + each `- [ ]` bullet from
 * `## Acceptance`. Never throws — returns `{ ok:false, error }` so callers
 * (the verifier prompt) can surface a clean gap report instead of crashing
 * the execute worker.
 *
 * Tolerates frontmatter at the top of the file. Stops each section at the
 * next `## ` heading (case-insensitive on the marker). Multiple
 * `## Acceptance` sections: only the first is used.
 */
export function parseGoalAndAcceptance(planPath: string): GoalAcceptanceResult {
	let raw: string;
	try {
		raw = fs.readFileSync(planPath, "utf-8");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Cannot read PLAN.md at ${planPath}: ${msg}` };
	}

	// Strip optional frontmatter (--- ... --- at top of file).
	const body = stripFrontmatter(raw);

	const goalText = extractSectionBody(body, "Goal");
	if (goalText === null) {
		return { ok: false, error: "PLAN.md is missing required `## Goal` section." };
	}
	if (goalText.trim().length === 0) {
		return { ok: false, error: "`## Goal` section is empty." };
	}

	const acceptanceText = extractSectionBody(body, "Acceptance");
	if (acceptanceText === null) {
		return { ok: false, error: "PLAN.md is missing required `## Acceptance` section." };
	}

	const items = extractAcceptanceItems(acceptanceText);
	if (items.length === 0) {
		return { ok: false, error: "`## Acceptance` section has no `- [ ]` items." };
	}

	return { ok: true, goal: goalText.trim(), acceptance: items };
}

/** Strip YAML frontmatter (`---\n...\n---\n`) at the top of the file. */
function stripFrontmatter(raw: string): string {
	const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return m ? raw.slice(m[0].length) : raw;
}

/**
 * Extract the body of the FIRST `## <name>` section: everything from the
 * heading line (exclusive) up to the next `## ` heading or end of file.
 * Returns null if the section does not exist. Returns "" if the section
 * exists but is empty.
 */
function extractSectionBody(body: string, name: string): string | null {
	const lines = body.split(/\r?\n/);
	const headingRe = new RegExp(`^##\\s+${escapeRegex(name)}\\s*$`);
	const nextHeadingRe = /^##\s+\S+/;
	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (headingRe.test(lines[i] ?? "")) {
			startIdx = i;
			break;
		}
	}
	if (startIdx === -1) return null;
	let endIdx = lines.length;
	for (let i = startIdx + 1; i < lines.length; i++) {
		if (nextHeadingRe.test(lines[i] ?? "")) {
			endIdx = i;
			break;
		}
	}
	return lines.slice(startIdx + 1, endIdx).join("\n");
}

/** Pull each `- [ ] <text>` bullet (allowing leading whitespace) from a section body. */
function extractAcceptanceItems(section: string): string[] {
	const items: string[] = [];
	for (const line of section.split(/\r?\n/)) {
		// Require exactly `[ ]` (one space inside the brackets) — matches the
		// standard markdown task-list convention. Lines like `- [x] foo` or
		// `- [] foo` are intentionally NOT accepted: `x` is checked, and `[]`
		// (no inner space) is a typo we'd rather surface than silently keep.
		const m = line.match(/^\s*-\s+\[\s\]\s+(.+?)\s*$/);
		if (m) items.push(m[1]);
	}
	return items;
}

/** Escape a literal string for safe inclusion in a RegExp constructor. */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the LLM instruction injected at the end of an execute worker block
 * (task / plan / phase plan-level). The worker is told to read PLAN.md,
 * walk `git diff master..HEAD`, judge each acceptance item, judge the
 * Goal as a whole, and append/replace a `## Status` section between the
 * marker comments.
 *
 * `planPathHint` is a textual hint about where PLAN.md lives — typically the
 * absolute path. The worker resolves it via `read`.
 */
export function buildVerificationPrompt(parsed: GoalAcceptanceParsed, planPathHint: string): string {
	const itemsList = parsed.acceptance.map((a) => `- ${a}`).join("\n");
	return `

GOAL VERIFICATION (mandatory before close-out):

Before reporting this work as done, verify that the diff actually
delivers the plan's Goal and meets every Acceptance item. This is a
hard gate — if it fails, you must NOT call \`soly done\`; you must
report the gap and stop.

PLAN.md: ${planPathHint}

Goal (verbatim from PLAN.md):

"""
${parsed.goal}
"""

Acceptance items (verbatim, ${parsed.acceptance.length} total):

${itemsList}

Steps:
1. Read ${planPathHint} (use the read tool) to confirm the Goal and
   Acceptance text.
2. Run \`git diff master..HEAD\` (or \`git diff origin/master..HEAD\`
   if no local master) to see what actually changed.
3. For each Acceptance item above, judge met / not-met. Cite evidence
   — file:line from the diff, or a short reasoning string.
4. Judge the Goal as a whole against the actual outcome.
5. Use the edit tool to append or replace a \`## Status\` section in
   ${planPathHint}, between the marker comments:

${STATUS_BEGIN}
## Status

**Goal met:** YES | NO

### Acceptance
- [x] <item text> — <evidence>
- [ ] <item text> — GAP: <what is missing>

**Verdict:** PASS | BLOCKED — gaps remain
${STATUS_END}

   If the markers already exist in the file, replace the content
   between them. If they don't, append the block at end of file. Do
   NOT touch any text outside the markers.
6. If Verdict is BLOCKED: STOP. Do NOT call \`soly done\`. Report the
   gap inline and list which Acceptance items remain unmet.
7. If Verdict is PASS: proceed to the close-out steps below.

---
`;
}

// ---------------------------------------------------------------------------
// Status section appender
// ---------------------------------------------------------------------------

/** Pure: build the Status markdown block between the marker comments. */
export function buildStatusSection(report: StatusReport): string {
	const allMet = report.goalMet && report.acceptance.every((a) => a.met);
	const verdict = allMet ? "PASS" : "BLOCKED — gaps remain";
	const lines: string[] = [];
	lines.push(STATUS_BEGIN);
	lines.push("## Status");
	lines.push("");
	lines.push(`**Goal met:** ${report.goalMet ? "YES" : "NO"}`);
	lines.push("");
	lines.push("### Acceptance");
	for (const a of report.acceptance) {
		const box = a.met ? "[x]" : "[ ]";
		const tag = a.met ? "— " : "— GAP: ";
		lines.push(`- ${box} ${a.item} ${tag}${a.evidence}`);
	}
	lines.push("");
	lines.push(`**Verdict:** ${verdict}`);
	lines.push(STATUS_END);
	return lines.join("\n");
}

/**
 * Find the marker block in `raw`. Returns:
 *   { begin, end } — slice indices (begin = index of STATUS_BEGIN,
 *                     end = index AFTER STATUS_END), or null if either
 *                     marker is missing or the order is wrong.
 */
export function findMarkerBlock(raw: string): { begin: number; end: number } | null {
	const begin = raw.indexOf(STATUS_BEGIN);
	const endIdx = raw.indexOf(STATUS_END);
	if (begin === -1 || endIdx === -1 || endIdx < begin) return null;
	return { begin, end: endIdx + STATUS_END.length };
}

/**
 * Append or replace the `## Status` section in PLAN.md. Idempotent: a
 * second run replaces the previous block (between marker comments)
 * instead of duplicating content. Never touches text outside the
 * marker block.
 */
export function appendStatus(planPath: string, report: StatusReport): void {
	const raw = fs.readFileSync(planPath, "utf-8");
	const section = buildStatusSection(report);
	const block = findMarkerBlock(raw);

	let next: string;
	if (block) {
		// Replace between markers, preserve prefix and suffix content.
		const before = raw.slice(0, block.begin).replace(/\s+$/, "");
		const after = raw.slice(block.end).replace(/^\s+/, "");
		const parts = [before, section];
		if (after.length > 0) parts.push(after);
		next = parts.join("\n\n") + "\n";
	} else {
		// Append at end of file.
		const trimmed = raw.replace(/\s+$/, "");
		next = `${trimmed}\n\n${section}\n`;
	}

	fs.writeFileSync(planPath, next, "utf-8");
}