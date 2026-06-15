// =============================================================================
// tests/iteration.test.ts — Unit tests for iteration.ts
// =============================================================================
//
// Tests the per-iteration context bundle: section builders, plan summary
// extraction, file lookups, and end-to-end bundle assembly. Uses a real
// temp dir (mkdtempSync) to exercise the file I/O code paths realistically.
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	buildIterationContent,
	extractPlanSummary,
	findPhaseContextPath,
	findPhaseDir,
	findPhaseResearchPath,
	findPlanFile,
	findRecentSummaries,
	findTaskDir,
	iterationFilePath,
	renderPlanSummaryInline,
	timestampSlug,
	writeIterationContext,
} from "../iteration.js";

// ----------------------------------------------------------------------------
// Temp dir setup — populated with a realistic .soly/ tree
// ----------------------------------------------------------------------------

let tmpRoot: string;
let solyDir: string;
let projectRoot: string;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-iter-test-"));
	projectRoot = tmpRoot;
	solyDir = path.join(tmpRoot, ".soly");
	fs.mkdirSync(path.join(solyDir, "docs"), { recursive: true });
	fs.mkdirSync(path.join(solyDir, "phases", "05-auth"), { recursive: true });
	fs.mkdirSync(path.join(solyDir, "features", "auth", "tasks", "auth-be-login-a3f9"), {
		recursive: true,
	});

	// Intent docs
	fs.writeFileSync(
		path.join(solyDir, "docs", "overview.md"),
		`# Project Overview

This app is a project management tool for small teams.

Key principles:
- Fast
- Simple
- Local-first
`,
	);

	fs.writeFileSync(
		path.join(solyDir, "docs", "design-vision.md"),
		`# Design Vision

Minimal, text-first UI. No animations. Dark mode by default.`,
	);

	// STATE.md
	fs.writeFileSync(
		path.join(solyDir, "STATE.md"),
		`---
milestone: v1.0
status: in-progress
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 5
  completed_plans: 2
  percent: 40
---

# Project State

## Current Position
- Phase: 5 (Auth)
- Plan: 2 of 3
- Status: in-progress

## Decisions
| Decision | Rationale | Phase |
|----------|-----------|-------|
| Use JWT | stateless, scales | 5 |
`,
	);

	// ROADMAP.md
	fs.writeFileSync(
		path.join(solyDir, "ROADMAP.md"),
		`# Roadmap

## Phase 1: Bootstrap
- Goal: Get a "hello world" running
- Requirements: REQ-01

## Phase 5: Auth
- Goal: User can sign up, log in, log out
- Requirements: REQ-AUTH-01, REQ-AUTH-02
- Depends on: Phase 1

## Phase 6: Tasks
- Goal: CRUD tasks
`,
	);

	// Phase 5 with CONTEXT, RESEARCH, 2 plans, 1 SUMMARY
	const phase5 = path.join(solyDir, "phases", "05-auth");
	fs.writeFileSync(
		path.join(phase5, "05-CONTEXT.md"),
		`# Phase 5 Context

Decisions made:
- Use JWT (not sessions)
- Argon2 for password hashing
- Refresh token rotation
`,
	);
	fs.writeFileSync(
		path.join(phase5, "05-RESEARCH.md"),
		`# Phase 5 Research

Chosen libs:
- jsonwebtoken
- argon2
- @fastify/jwt
`,
	);
	fs.writeFileSync(
		path.join(phase5, "05-01-login-PLAN.md"),
		`---
id: 05-01-login
phase: 5
plan: 1
title: "Login endpoint"
wave: 1
depends-on: []
requirements: [REQ-AUTH-01]
---

# Plan 1: Login

## Must Haves
### truths
- [ ] POST /api/auth/login returns 200 + JWT on valid creds
- [ ] POST /api/auth/login returns 401 on bad creds
### artifacts
- \`src/api/auth/login.ts\` — handler
### key_links
- src/api/auth/login.ts:login → src/services/auth.ts:verifyPassword
`,
	);
	fs.writeFileSync(
		path.join(phase5, "05-01-login-SUMMARY.md"),
		`# Plan 1 Summary

Done. Login endpoint shipped.

## Changed files
- src/api/auth/login.ts
`,
	);
	fs.writeFileSync(
		path.join(phase5, "05-02-refresh-PLAN.md"),
		`---
id: 05-02-refresh
phase: 5
plan: 2
title: "Token refresh"
wave: 1
depends-on: ["05-01-login"]
requirements: [REQ-AUTH-02]
---

# Plan 2: Refresh
`,
	);

	// Feature with 1 task
	const featureDir = path.join(solyDir, "features", "auth");
	fs.writeFileSync(
		path.join(featureDir, "README.md"),
		`# Auth feature

Handles user authentication.
`,
	);
	fs.writeFileSync(
		path.join(featureDir, "tasks", "auth-be-login-a3f9", "PLAN.md"),
		`---
id: auth-be-login-a3f9
kind: be
feature: auth
status: ready
priority: high
parallelizable: true
depends-on: []
---

# Task: Login

## Must Haves
### truths
- [ ] Valid creds return 200 + JWT
### artifacts
- \`src/api/auth/login.ts\`
### key_links
- login.ts:handle → services/auth.ts:verify
`,
	);
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

describe("timestampSlug", () => {
	test("returns ISO-like shape without separators except T and Z", () => {
		const ts = timestampSlug();
		expect(ts).toMatch(/^\d{8}T\d{6}Z$/);
	});
});

describe("extractPlanSummary", () => {
	test("parses frontmatter + must-haves", () => {
		const md = `---
id: 05-02-foo
phase: 5
plan: 2
title: "Foo plan"
wave: 2
depends-on: ["05-01-bar"]
requirements: [REQ-1, REQ-2]
---

## Must Haves
### truths
- [ ] First truth
- [ ] Second truth
### artifacts
- \`src/foo.ts\` — handler
### key_links
- foo.ts:A → bar.ts:B — wired
`;
		const s = extractPlanSummary(md);
		expect(s).not.toBeNull();
		expect(s!.id).toBe("05-02-foo");
		expect(s!.title).toBe("Foo plan");
		expect(s!.wave).toBe(2);
		expect(s!.requirements).toEqual(["REQ-1", "REQ-2"]);
		expect(s!.dependsOn).toEqual(["05-01-bar"]);
		expect(s!.mustHaves.truths).toEqual(["First truth", "Second truth"]);
		expect(s!.mustHaves.artifacts).toContain("`src/foo.ts` — handler");
		expect(s!.mustHaves.keyLinks).toContain("foo.ts:A → bar.ts:B — wired");
	});

	test("returns null for content without frontmatter", () => {
		expect(extractPlanSummary("just some text")).toBeNull();
	});
});

describe("renderPlanSummaryInline", () => {
	test("renders all sections", () => {
		const s = extractPlanSummary(`---
id: x
title: "X"
wave: 1
requirements: [R1]
depends-on: []
---

## Must Haves
### truths
- [ ] T1
### artifacts
- \`a.ts\`
### key_links
- a→b
`);
		expect(s).not.toBeNull();
		const out = renderPlanSummaryInline(s!);
		expect(out).toContain("**Plan title**: X");
		expect(out).toContain("**Wave**: 1");
		expect(out).toContain("**Requirements**: [R1]");
		expect(out).toContain("**Must-haves — truths**");
		expect(out).toContain("T1");
	});
});

// ----------------------------------------------------------------------------
// Disk lookups
// ----------------------------------------------------------------------------

describe("findPhaseDir / findTaskDir / findPlanFile / findRecentSummaries", () => {
	test("findPhaseDir locates the phase dir by number", () => {
		const found = findPhaseDir(solyDir, 5);
		expect(found).toBe(path.join(solyDir, "phases", "05-auth"));
	});

	test("findPhaseDir returns null for missing phase", () => {
		expect(findPhaseDir(solyDir, 99)).toBeNull();
	});

	test("findPhaseContextPath / findPhaseResearchPath", () => {
		const phaseDir = findPhaseDir(solyDir, 5)!;
		expect(findPhaseContextPath(phaseDir)).toBe(path.join(phaseDir, "05-CONTEXT.md"));
		expect(findPhaseResearchPath(phaseDir)).toBe(path.join(phaseDir, "05-RESEARCH.md"));
	});

	test("findPlanFile matches the plan number", () => {
		const phaseDir = findPhaseDir(solyDir, 5)!;
		const pf = findPlanFile(phaseDir, 1);
		expect(pf).toBe(path.join(phaseDir, "05-01-login-PLAN.md"));
		expect(findPlanFile(phaseDir, 2)).toBe(path.join(phaseDir, "05-02-refresh-PLAN.md"));
		expect(findPlanFile(phaseDir, 99)).toBeNull();
	});

	test("findRecentSummaries returns up to N", () => {
		const phaseDir = findPhaseDir(solyDir, 5)!;
		const summaries = findRecentSummaries(phaseDir, 3);
		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toContain("SUMMARY.md");
	});

	test("findTaskDir locates by task id and returns feature", () => {
		const found = findTaskDir(solyDir, "auth-be-login-a3f9");
		expect(found).not.toBeNull();
		expect(found!.feature).toBe("auth");
		expect(found!.dir).toContain("auth-be-login-a3f9");
	});

	test("findTaskDir returns null for missing task", () => {
		expect(findTaskDir(solyDir, "nope-aaaa")).toBeNull();
	});
});

// ----------------------------------------------------------------------------
// End-to-end: buildIterationContent
// ----------------------------------------------------------------------------

describe("buildIterationContent (exec phase, plan 1)", () => {
	let content: string;
	beforeAll(() => {
		content = buildIterationContent({
			solyDir,
			projectRoot,
			kind: "exec",
			phaseNumber: 5,
			planNumber: 1,
		});
	});

	test("frontmatter has kind/phase/plan/soly_dir", () => {
		expect(content).toMatch(/^---\n/);
		expect(content).toContain("kind: exec");
		expect(content).toContain("phase: 5");
		expect(content).toContain("plan: 1");
		expect(content).toContain(`soly_dir: ${solyDir}`);
	});

	test("includes intent docs as section 0", () => {
		expect(content).toMatch(/## 0\. Project Intent/);
		expect(content).toContain("overview.md");
		expect(content).toContain("design-vision.md");
	});

	test("includes STATE.md Current Position + Decisions", () => {
		expect(content).toMatch(/## 1\. Project State/);
		expect(content).toContain("Current Position");
		expect(content).toContain("Use JWT");
	});

	test("includes ROADMAP row for phase 5", () => {
		expect(content).toMatch(/## 2\. ROADMAP\.md — Phase 5/);
		expect(content).toContain("## Phase 5: Auth");
		expect(content).not.toContain("## Phase 1: Bootstrap");
	});

	test("includes phase CONTEXT (section 3)", () => {
		expect(content).toMatch(/## 3\. Phase CONTEXT/);
		expect(content).toContain("Argon2");
	});

	test("includes phase RESEARCH (section 4)", () => {
		expect(content).toMatch(/## 4\. Phase RESEARCH/);
		expect(content).toContain("jsonwebtoken");
	});

	test("includes prior SUMMARYs (section 5)", () => {
		expect(content).toMatch(/## 5\. Prior SUMMARYs/);
		expect(content).toContain("Login endpoint shipped");
	});

	test("includes current PLAN at section 6 (plan-level exec)", () => {
		expect(content).toMatch(/## 6\. Current PLAN/);
		expect(content).toContain("Login endpoint");
		expect(content).toContain("Must Haves");
	});

	test("always reads FIRST instruction in header", () => {
		expect(content).toContain("Read this file first");
	});

	test("sources are listed with relative paths", () => {
		expect(content).toContain("_Source:");
		// On Windows, path.relative uses backslashes — match either separator.
		expect(content).toMatch(/\.soly[/\\]STATE\.md/);
		expect(content).toMatch(/\.soly[/\\]ROADMAP\.md/);
	});
});

describe("buildIterationContent (exec task)", () => {
	test("task mode uses feature README + task PLAN instead of phase sections", () => {
		const content = buildIterationContent({
			solyDir,
			projectRoot,
			kind: "exec",
			taskId: "auth-be-login-a3f9",
		});
		expect(content).toContain("kind: exec");
		expect(content).toContain("task: auth-be-login-a3f9");
		expect(content).toMatch(/## 2\. Feature README/);
		expect(content).toContain("Handles user authentication");
		expect(content).toMatch(/## 4\. Current task PLAN/);
		expect(content).toContain("Valid creds return 200 + JWT");
		// No phase sections
		expect(content).not.toMatch(/## 3\. Phase CONTEXT/);
	});
});

describe("buildIterationContent (plan phase)", () => {
	test("plan mode skips section 6 (no current PLAN) and section 7 (no anti-patterns)", () => {
		const content = buildIterationContent({
			solyDir,
			projectRoot,
			kind: "plan",
			phaseNumber: 5,
		});
		expect(content).toContain("kind: plan");
		expect(content).toMatch(/## 3\. Phase CONTEXT/);
		expect(content).toMatch(/## 4\. Phase RESEARCH/);
		expect(content).toMatch(/## 5\. Prior SUMMARYs/);
		// No section 6 or 7 in plan mode
		expect(content).not.toMatch(/## 6\. Current PLAN/);
		expect(content).not.toMatch(/## 7\. Critical Anti-Patterns/);
	});
});

describe("buildIterationContent (discuss phase)", () => {
	test("includes ROADMAP row but no RESEARCH/prior SUMMARYs sections", () => {
		const content = buildIterationContent({
			solyDir,
			projectRoot,
			kind: "discuss",
			phaseNumber: 5,
		});
		expect(content).toContain("kind: discuss");
		// Discuss includes CONTEXT (refine it) and ROADMAP, but no RESEARCH/SUMMARY
		expect(content).toMatch(/## 3\. Phase CONTEXT/);
		expect(content).toMatch(/## 2\. ROADMAP\.md/);
		// Discuss doesn't load RESEARCH or SUMMARYs (those are for the planner/executor)
		expect(content).not.toMatch(/## 4\. Phase RESEARCH/);
		expect(content).not.toMatch(/## 5\. Prior SUMMARYs/);
	});
});

// ----------------------------------------------------------------------------
// File writer
// ----------------------------------------------------------------------------

describe("iterationFilePath / writeIterationContext", () => {
	test("phase-exec path: <NN>-<MM>-exec-<ts>.md", () => {
		const p = iterationFilePath({
			solyDir,
			projectRoot,
			kind: "exec",
			phaseNumber: 5,
			planNumber: 2,
		});
		expect(path.basename(p)).toMatch(/^05-02-exec-\d{8}T\d{6}Z\.md$/);
	});

	test("phase-plan path: <NN>-plan-<ts>.md (no plan number)", () => {
		const p = iterationFilePath({
			solyDir,
			projectRoot,
			kind: "plan",
			phaseNumber: 5,
		});
		expect(path.basename(p)).toMatch(/^05-plan-\d{8}T\d{6}Z\.md$/);
	});

	test("task path: <feature>__<task>-<kind>-<ts>.md", () => {
		const p = iterationFilePath({
			solyDir,
			projectRoot,
			kind: "exec",
			taskId: "auth-be-login-a3f9",
			feature: "auth",
		});
		expect(path.basename(p)).toMatch(/^auth__auth-be-login-a3f9-exec-\d{8}T\d{6}Z\.md$/);
	});

	test("writeIterationContext creates iterations dir + writes file", () => {
		const out = writeIterationContext({
			solyDir,
			projectRoot,
			kind: "exec",
			phaseNumber: 5,
			planNumber: 1,
		});
		expect(fs.existsSync(out.filePath)).toBe(true);
		expect(out.filePath).toContain(path.join(".soly", "iterations"));
		expect(out.tokens).toBeGreaterThan(100);
		const written = fs.readFileSync(out.filePath, "utf-8");
		expect(written).toContain("kind: exec");
		expect(written).toContain("phase: 5");
	});

	test("relPath is projectRoot-relative", () => {
		const out = writeIterationContext({
			solyDir,
			projectRoot,
			kind: "plan",
			phaseNumber: 5,
		});
		expect(out.relPath).toMatch(/^\.soly[\\/]iterations[\\/]/);
	});
});
