// =============================================================================
// tests/goal-verify.test.ts — Goal & Acceptance verification module
// =============================================================================

/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
	appendStatus,
	buildStatusSection,
	buildVerificationPrompt,
	findMarkerBlock,
	parseGoalAndAcceptance,
	STATUS_BEGIN,
	STATUS_END,
} from "../workflows/goal-verify.ts";

let tmpRoot: string;
let planPath: string;

const SAMPLE_PLAN = `# Plan: feat/sample

## Goal

Add a settings panel that lets the user toggle dark mode.

## Steps

1. Add a Toggle component.
2. Wire it into the navbar.

## Acceptance

- [ ] Toggle component renders in the navbar
- [ ] Clicking the toggle persists state to localStorage
- [ ] On page reload, the toggle reflects the persisted state
`;

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-goal-verify-"));
	planPath = path.join(tmpRoot, "PLAN.md");
	fs.writeFileSync(planPath, SAMPLE_PLAN, "utf-8");
});

afterEach(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parseGoalAndAcceptance", () => {
	test("happy path: extracts Goal text + each - [ ] bullet", () => {
		const result = parseGoalAndAcceptance(planPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.goal).toBe("Add a settings panel that lets the user toggle dark mode.");
		expect(result.acceptance).toEqual([
			"Toggle component renders in the navbar",
			"Clicking the toggle persists state to localStorage",
			"On page reload, the toggle reflects the persisted state",
		]);
	});

	test("tolerates leading whitespace and CRLF line endings on bullets", () => {
		const raw = `## Goal\r\n\r\nToggle button.\r\n\r\n## Acceptance\r\n   - [ ] first\r\n\t- [ ] second\r\n`;
		fs.writeFileSync(planPath, raw, "utf-8");
		const r = parseGoalAndAcceptance(planPath);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.acceptance).toEqual(["first", "second"]);
	});

	test("empty Goal section → returns error (not throw)", () => {
		fs.writeFileSync(planPath, `## Goal\n\n## Acceptance\n\n- [ ] x\n`, "utf-8");
		const r = parseGoalAndAcceptance(planPath);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/Goal.*empty/i);
	});

	test("missing Acceptance section → returns error", () => {
		fs.writeFileSync(planPath, `## Goal\n\nDo something.\n\n## Steps\n\n- step\n`, "utf-8");
		const r = parseGoalAndAcceptance(planPath);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/Acceptance/i);
		expect(r.error).toMatch(/missing/i);
	});

	test("Acceptance section with no - [ ] bullets → returns error", () => {
		fs.writeFileSync(planPath, `## Goal\n\nDo something.\n\n## Acceptance\n\nJust prose, no bullets.\n`, "utf-8");
		const r = parseGoalAndAcceptance(planPath);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/no `- \[ \]` items/i);
	});

	test("multiple Acceptance sections → only the first is used", () => {
		const raw = `## Goal\n\nDo x.\n\n## Acceptance\n\n- [ ] first\n\n## Acceptance\n\n- [ ] second\n`;
		fs.writeFileSync(planPath, raw, "utf-8");
		const r = parseGoalAndAcceptance(planPath);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.acceptance).toEqual(["first"]);
	});

	test("strips frontmatter before parsing", () => {
		const raw = `---\nstatus: planned\nowner: alice\n---\n# Plan\n\n## Goal\n\nDo x.\n\n## Acceptance\n\n- [ ] one\n`;
		fs.writeFileSync(planPath, raw, "utf-8");
		const r = parseGoalAndAcceptance(planPath);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.goal).toBe("Do x.");
		expect(r.acceptance).toEqual(["one"]);
	});

	test("non-existent file → returns error with the path", () => {
		const r = parseGoalAndAcceptance(path.join(tmpRoot, "nope.md"));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/Cannot read PLAN\.md/);
		expect(r.error).toContain("nope.md");
	});

	test("Goal text preserves internal newlines (trimmed at edges)", () => {
		const raw = `## Goal\n\n  First line.\n\n  Second line.\n\n## Acceptance\n\n- [ ] x\n`;
		fs.writeFileSync(planPath, raw, "utf-8");
		const r = parseGoalAndAcceptance(planPath);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// String.prototype.trim() only strips outer whitespace; inner indent is
		// preserved as-is so user-written structure (lists, code blocks) survives.
		expect(r.goal).toBe("First line.\n\n  Second line.");
	});

	test("malformed bullet `- [] x` (no inner space) and checked `[x]` are skipped", () => {
		const raw = `## Goal\n\nDo x.\n\n## Acceptance\n\n- [ ] valid\n- [] typo no space inside\n- [x] already checked\n- [X] also checked\n- [ ]also no trailing space\n`;
		fs.writeFileSync(planPath, raw, "utf-8");
		const r = parseGoalAndAcceptance(planPath);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.acceptance).toEqual(["valid"]);
	});
});

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

describe("buildVerificationPrompt", () => {
	test("contains the Goal text verbatim", () => {
		const parsed = parseGoalAndAcceptance(planPath);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const prompt = buildVerificationPrompt(parsed, planPath);
		expect(prompt).toContain(parsed.goal);
	});

	test("contains every acceptance item as a verbatim `- <item>` line", () => {
		const parsed = parseGoalAndAcceptance(planPath);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const prompt = buildVerificationPrompt(parsed, planPath);
		for (const item of parsed.acceptance) {
			expect(prompt).toContain(`- ${item}`);
		}
	});

	test("includes the marker comments and the plan path hint", () => {
		const parsed = parseGoalAndAcceptance(planPath);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const prompt = buildVerificationPrompt(parsed, planPath);
		expect(prompt).toContain(STATUS_BEGIN);
		expect(prompt).toContain(STATUS_END);
		expect(prompt).toContain(planPath);
	});

	test("mentions the BLOCKED → STOP / do-not-call-soly-done rule", () => {
		const parsed = parseGoalAndAcceptance(planPath);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const prompt = buildVerificationPrompt(parsed, planPath);
		expect(prompt).toContain("BLOCKED");
		expect(prompt.toLowerCase()).toContain("stop");
	});
});

// ---------------------------------------------------------------------------
// Status section appender
// ---------------------------------------------------------------------------

describe("buildStatusSection", () => {
	test("PASS verdict when goalMet true and all items met", () => {
		const md = buildStatusSection({
			goalMet: true,
			acceptance: [
				{ item: "a", met: true, evidence: "src/foo.ts:10" },
				{ item: "b", met: true, evidence: "src/bar.ts:1" },
			],
		});
		expect(md).toContain("**Goal met:** YES");
		expect(md).toContain("**Verdict:** PASS");
		expect(md).toContain("- [x] a — src/foo.ts:10");
		expect(md).toContain("- [x] b — src/bar.ts:1");
		expect(md).toContain(STATUS_BEGIN);
		expect(md).toContain(STATUS_END);
	});

	test("BLOCKED verdict when any item unmet", () => {
		const md = buildStatusSection({
			goalMet: true,
			acceptance: [
				{ item: "a", met: true, evidence: "ok" },
				{ item: "b", met: false, evidence: "missing in src/" },
			],
		});
		expect(md).toContain("**Verdict:** BLOCKED");
		expect(md).toContain("- [ ] b — GAP: missing in src/");
	});

	test("BLOCKED verdict when goalMet is false", () => {
		const md = buildStatusSection({
			goalMet: false,
			acceptance: [{ item: "a", met: true, evidence: "ok" }],
		});
		expect(md).toContain("**Goal met:** NO");
		expect(md).toContain("**Verdict:** BLOCKED");
	});
});

describe("findMarkerBlock", () => {
	test("returns null when markers are absent", () => {
		expect(findMarkerBlock("hello world")).toBeNull();
	});

	test("returns null when only one marker is present", () => {
		expect(findMarkerBlock(`hello ${STATUS_BEGIN} world`)).toBeNull();
		expect(findMarkerBlock(`hello ${STATUS_END} world`)).toBeNull();
	});

	test("returns indices when both markers present", () => {
		const raw = `prefix ${STATUS_BEGIN}\nstuff\n${STATUS_END} suffix`;
		const block = findMarkerBlock(raw);
		expect(block).not.toBeNull();
		if (!block) return;
		expect(raw.slice(block.begin)).toContain(STATUS_BEGIN);
		expect(raw.slice(0, block.end)).toContain(STATUS_END);
	});
});

describe("appendStatus", () => {
	test("appends a new Status section when markers are absent", () => {
		appendStatus(planPath, {
			goalMet: true,
			acceptance: [
				{ item: "Toggle component renders in the navbar", met: true, evidence: "src/x.ts:1" },
				{ item: "Clicking the toggle persists state to localStorage", met: true, evidence: "src/x.ts:5" },
				{ item: "On page reload, the toggle reflects the persisted state", met: true, evidence: "src/x.ts:9" },
			],
		});
		const after = fs.readFileSync(planPath, "utf-8");
		expect(after).toContain(STATUS_BEGIN);
		expect(after).toContain(STATUS_END);
		expect(after).toContain("**Verdict:** PASS");
		// Original content is preserved untouched.
		expect(after).toContain("## Goal");
		expect(after).toContain("Add a settings panel that lets the user toggle dark mode.");
	});

	test("is idempotent: a second call replaces, does not duplicate", () => {
		appendStatus(planPath, {
			goalMet: false,
			acceptance: [
				{ item: "Toggle component renders in the navbar", met: true, evidence: "ok" },
				{ item: "Clicking the toggle persists state to localStorage", met: false, evidence: "missing" },
				{ item: "On page reload, the toggle reflects the persisted state", met: false, evidence: "missing" },
			],
		});
		const firstRead = fs.readFileSync(planPath, "utf-8");

		appendStatus(planPath, {
			goalMet: true,
			acceptance: [
				{ item: "Toggle component renders in the navbar", met: true, evidence: "ok" },
				{ item: "Clicking the toggle persists state to localStorage", met: true, evidence: "ok" },
				{ item: "On page reload, the toggle reflects the persisted state", met: true, evidence: "ok" },
			],
		});
		const secondRead = fs.readFileSync(planPath, "utf-8");

		// Block count: must not double.
		const begins = (secondRead.match(/soly:status:begin/g) ?? []).length;
		const ends = (secondRead.match(/soly:status:end/g) ?? []).length;
		expect(begins).toBe(1);
		expect(ends).toBe(1);
		// And the second verdict is the latest.
		expect(secondRead).toContain("**Verdict:** PASS");
		expect(secondRead).not.toContain("GAP: missing");
		// Original PLAN body is still there.
		expect(secondRead).toContain(firstRead.split(STATUS_BEGIN)[0]);
	});

	test("does NOT touch text outside the marker block on replace", () => {
		const userNote = "<!-- user note: do not delete me -->\n";
		const block = `${STATUS_BEGIN}\n## Status\n\nold content\n${STATUS_END}\n`;
		fs.writeFileSync(planPath, `${SAMPLE_PLAN}\n${userNote}${block}`, "utf-8");

		appendStatus(planPath, {
			goalMet: true,
			acceptance: [{ item: "x", met: true, evidence: "ok" }],
		});

		const after = fs.readFileSync(planPath, "utf-8");
		expect(after).toContain("<!-- user note: do not delete me -->");
		expect(after).toContain("## Goal");
		expect(after).toContain("Add a settings panel that lets the user toggle dark mode.");
		expect(after).not.toContain("old content");
	});
});

// ---------------------------------------------------------------------------
// Headless regression guard
// ---------------------------------------------------------------------------

describe("goal-verify.ts is headless-safe by construction", () => {
	test("source contains no ask_pro / decision_deck / pi-tui imports or call sites", () => {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const raw = fs.readFileSync(path.join(here, "..", "workflows", "goal-verify.ts"), "utf-8");
		// Strip comments so documentation that mentions forbidden symbols
		// (e.g. "must NOT call ctx.ui.custom") does NOT trigger a false
		// positive. Comments explain the rule; code enforces it.
		const code = stripComments(raw);
		// Forbidden patterns — keep verifier headless-safe. If a future
		// contributor wires in an interactive confirm-gap flow, this test
		// fails loudly with the rationale spelled out in PLAN.md.
		const forbidden: { pattern: RegExp; why: string }[] = [
			{ pattern: /from\s+["'][^"']*\/ask(\/|\.ts?)/, why: "ask_pro requires UI; returns {error:'no_ui'} in headless mode" },
			{ pattern: /from\s+["'][^"']*\/deck(\/|\.ts?)/, why: "decision_deck requires UI; same reason" },
			{ pattern: /from\s+["']@earendil-works\/pi-tui/, why: "TUI is the interactive surface — would couple verifier to UI mode" },
			{ pattern: /ctx\.ui\.custom\s*\(/, why: "ctx.ui.custom only works in TUI / RPC UI mode" },
			{ pattern: /\baskPro\s*\(/, why: "function call site — same restriction" },
			{ pattern: /\bdecisionDeck\s*\(/, why: "function call site — same restriction" },
		];
		const violations = forbidden.filter((f) => f.pattern.test(code));
		if (violations.length > 0) {
			const detail = violations.map((v) => `  - ${v.pattern.source}: ${v.why}`).join("\n");
			throw new Error(
				`goal-verify.ts must stay headless-safe. Violations in code (comments ignored):\n${detail}`,
			);
		}
		expect(violations.length).toBe(0);
	});
});

/** Strip // line comments and /* ... block comments * / from source text. */
function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/\s+\/\/.*$/gm, "");
}