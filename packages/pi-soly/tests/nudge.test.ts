/// <reference types="bun-types" />
// =============================================================================
// tests/nudge.test.ts — Unit tests for nudge.ts (pure heuristic classifier)
// =============================================================================
//
// The behavioral nudge is prompt-only (no UI blocking) — heuristics on the
// user's prompt tell the model WHY this prompt triggers the nudge. We test
// that the classifier detects the right signals and suggests useful
// clarifying angles, without over-eager prompting.
// =============================================================================

import { describe, test, expect } from "bun:test";
import {
	classifyTaskHeuristics,
	buildNudgeSection,
	confirmLevelOf,
	buildSuggestionSection,
	type WorkflowSituation,
} from "../nudge.js";

describe("classifyTaskHeuristics", () => {
	test("trivial single-word prompt is not non-trivial", () => {
		const h = classifyTaskHeuristics("hi");
		expect(h.nonTrivial).toBe(false);
		expect(h.researchHeavy).toBe(false);
		expect(h.mentions).toEqual([]);
		expect(h.suggestedAngles).toEqual([]);
	});

	test("long prompt (>80 chars) is non-trivial", () => {
		const h = classifyTaskHeuristics(
			"please refactor the entire user service to use the new repository pattern we discussed",
		);
		expect(h.nonTrivial).toBe(true);
	});

	test("non-trivial verb (add, create, refactor, ...) triggers non-trivial", () => {
		const verbs = [
			"add a new endpoint for /login",
			"create the auth flow",
			"build the dashboard",
			"implement password reset",
			"refactor the query layer",
			"migrate the database",
			"rewrite the parser",
			"redesign the homepage",
			"convert the legacy types",
			"integrate with stripe",
			"introduce a new feature flag",
			"extract the email helper",
			"split the big file",
			"merge the two services",
			"restructure the auth module",
			"optimize the slow query",
			"generate type definitions",
			"scaffold a new project",
			"set up the build pipeline",
			"wire up the events",
		];
		for (const v of verbs) {
			expect(classifyTaskHeuristics(v).nonTrivial).toBe(true);
		}
	});

	test("research verbs trigger researchHeavy", () => {
		const samples = [
			"find out why the build fails",
			"look up the docs for stripe webhooks",
			"check the latest react version",
			"verify the assumption about ts strict mode",
			"investigate the memory leak",
			"research best practices for jwt",
			"figure out how to debug this",
			"why does the test suite hang",
			"how does the bundler work",
			"compare bun vs node for our use case",
			"which library should we pick",
			"benchmark the slow path",
			"audit the security model",
			"trace the data flow",
			"debug why the rate limit is wrong",
		];
		for (const s of samples) {
			expect(classifyTaskHeuristics(s).researchHeavy).toBe(true);
		}
	});

	test("URLs trigger researchHeavy", () => {
		const h = classifyTaskHeuristics("summarize https://example.com/article");
		expect(h.researchHeavy).toBe(true);
		expect(h.mentions).toContain("external URL");
	});

	test("version refs (v1.2.3, @scope/pkg) trigger researchHeavy", () => {
		const h1 = classifyTaskHeuristics("does bun 1.2.3 work with our setup?");
		expect(h1.researchHeavy).toBe(true);
		const h2 = classifyTaskHeuristics("is @tanstack/react-query a good fit?");
		expect(h2.researchHeavy).toBe(true);
	});

	test("multiple file references are detected", () => {
		const h = classifyTaskHeuristics(
			"check src/index.ts and src/lib/util.ts and tests/foo.test.ts for the bug",
		);
		expect(h.mentions.some((m) => m.includes("file references"))).toBe(true);
		expect(h.suggestedAngles.some((a) => a.includes("scope"))).toBe(true);
	});

	test("research-heavy prompt suggests source/result question", () => {
		const h = classifyTaskHeuristics("look up the stripe webhook best practices");
		expect(h.suggestedAngles.some((a) => a.includes("source") || a.includes("trust"))).toBe(true);
	});

	test("action verb without research suggests done-criteria question", () => {
		const h = classifyTaskHeuristics("refactor the parser to use the new token format");
		expect(h.suggestedAngles.some((a) => a.includes("done"))).toBe(true);
	});

	test("non-trivial without clear signals suggests constraints question", () => {
		// A 100+ char prompt with no verbs / no file paths / no version / no URL
		const longPrompt =
			"we need to make a decision about the future direction of this product given all the constraints we have been discussing and the various stakeholders involved";
		const h = classifyTaskHeuristics(longPrompt);
		expect(h.nonTrivial).toBe(true);
		expect(h.suggestedAngles.some((a) => a.includes("constraints"))).toBe(true);
	});
});

describe("buildNudgeSection", () => {
	test("returns a string with all three numbered points", () => {
		const section = buildNudgeSection({
			nonTrivial: false,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: [],
			complaint: false,
		});
		expect(section).toContain("1. **Pre-action gate.**");
		expect(section).toContain("2. **Scout with soly's own read tools.**");
		expect(section).toContain("3. **Reach for soly's interaction tools.**");
	});

	test("no longer instructs the model to delegate to an external subagent tool", () => {
		const section = buildNudgeSection(
			classifyTaskHeuristics("implement the auth refactor across src/auth/login.ts and src/auth/token.ts"),
			{ hasProject: true },
		);
		// The redesign drops the pi-subagents dependency: none of the old
		// "delegate to a subagent" imperatives should survive. (The section may
		// still *mention* subagent to say it's NOT needed.)
		expect(section).not.toContain("Background subagents by default");
		expect(section).not.toContain("Launch a single subagent");
		expect(section).not.toContain('prefer `subagent(...)`');
		expect(section).not.toContain("Subagent tool ergonomics");
	});

	test("includes trigger explanation for non-trivial prompt", () => {
		const section = buildNudgeSection({
			nonTrivial: true,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: [],
			complaint: false,
		});
		expect(section).toMatch(/Heuristics for this prompt:.*non-trivial task/);
	});

	test("includes trigger explanation for research-heavy prompt", () => {
		const section = buildNudgeSection({
			nonTrivial: false,
			researchHeavy: true,
			mentions: [],
			suggestedAngles: [],
			complaint: false,
		});
		expect(section).toMatch(/Heuristics for this prompt:.*research-heavy/);
	});

	test("renders suggested angles as a numbered list", () => {
		const section = buildNudgeSection({
			nonTrivial: true,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: ["which files are in scope?", "any deadline?"],
			complaint: false,
		});
		expect(section).toContain("1. which files are in scope?");
		expect(section).toContain("2. any deadline?");
	});

	test("routine prompt uses the 'looks routine' label", () => {
		const section = buildNudgeSection({
			nonTrivial: false,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: [],
			complaint: false,
		});
		expect(section).toContain("looks routine");
	});

	test("includes the 'Treat (1) and (2) as defaults, not laws' footer", () => {
		const section = buildNudgeSection({
			nonTrivial: false,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: [],
			complaint: false,
		});
		expect(section).toContain("Treat (1) and (2) as defaults, not laws");
	});
});

describe("buildNudgeSection — workflow routing (point 4)", () => {
	const nonTrivial = classifyTaskHeuristics("implement the auth refactor across src/auth/login.ts and src/auth/token.ts");
	const trivial = classifyTaskHeuristics("fix typo");

	test("suggests the soly lifecycle when a project exists and the task is non-trivial", () => {
		const s = buildNudgeSection(nonTrivial, { hasProject: true });
		expect(s.includes("Route project work through the soly plan workflow")).toBe(true);
		// The lifecycle now routes through the soly-workflow tool, on the user's
		// natural-language intent — not by making them type verbs.
		expect(s.includes("soly-workflow")).toBe(true);
		expect(s.includes("Read the user's intent")).toBe(true);
		expect(s.includes("soly verify")).toBe(true); // verify stays a text verb
	});

	test("instructs LLM to study the repo before scaffolding or fleshing out a plan", () => {
		const s = buildNudgeSection(nonTrivial, { hasProject: true });
		expect(s.includes("STUDY THE REPO")).toBe(true);
		expect(s.includes("soly-snippet")).toBe(true);
		expect(s.includes("soly-doc-search")).toBe(true);
	});

	test("embeds the actual defaultBranchPrefix in the workflow point", () => {
		// v3.0.0: defaultBranchPrefix removed from config. The nudge now
		// tells the LLM to ask the user via ask_pro instead of embedding
		// the prefix in the hint. We verify the hint mentions ask_pro + branches.
		const s = buildNudgeSection(nonTrivial, { hasProject: true });
		expect(s.includes("ask_pro")).toBe(true);
		expect(s.includes("Branch naming")).toBe(true);
	});

	test("instructs LLM to gap-hunt the plan before coding (corporate reviewer)", () => {
		const s = buildNudgeSection(nonTrivial, { hasProject: true });
		expect(s.includes("Corporate reviewer")).toBe(true);
		expect(s.includes("gap-hunt")).toBe(true);
		expect(s.includes("ask_pro")).toBe(true); // mentions ask_pro for surfacing gaps
		// Names the most common gap categories the LLM should look for
		expect(s.includes("Boundary cases")).toBe(true);
		expect(s.includes("Existing instances")).toBe(true);
		expect(s.includes("Tests")).toBe(true);
	});

	test("omitted without a project", () => {
		expect(buildNudgeSection(nonTrivial, { hasProject: false }).includes("Route project work")).toBe(false);
		expect(buildNudgeSection(nonTrivial).includes("Route project work")).toBe(false);
	});

	test("omitted for trivial tasks even with a project", () => {
		expect(buildNudgeSection(trivial, { hasProject: true }).includes("Route project work")).toBe(false);
	});
});

describe("confirmLevelOf (boolean back-compat → level)", () => {
	test("true → scope (strongest), false/undefined → off", () => {
		expect(confirmLevelOf(true)).toBe("scope");
		expect(confirmLevelOf(false)).toBe("off");
		expect(confirmLevelOf(undefined)).toBe("off");
	});
	test("explicit levels pass through", () => {
		expect(confirmLevelOf("off")).toBe("off");
		expect(confirmLevelOf("ask")).toBe("ask");
		expect(confirmLevelOf("scope")).toBe("scope");
	});
});

describe("buildNudgeSection — confirm before coding", () => {
	const nonTrivial = classifyTaskHeuristics("implement the auth refactor across src/auth/login.ts and src/auth/token.ts");
	const trivial = classifyTaskHeuristics("fix typo");

	test("scope batch for non-trivial tasks (true / 'scope') — asks the substantive questions", () => {
		for (const v of [true, "scope"] as const) {
			const s = buildNudgeSection(nonTrivial, { confirmBeforeCode: v });
			expect(s.includes("Scope it with me before you code")).toBe(true);
			expect(s.includes("ask_pro")).toBe(true);
			expect(s.toLowerCase().includes("before touching files")).toBe(true);
			// Names the placement + architecture dimensions explicitly.
			expect(s.includes("Placement")).toBe(true);
			expect(s.includes("Architecture / pattern")).toBe(true);
		}
	});

	test("'ask' level uses the lighter go/discuss confirmation, not the scope batch", () => {
		const s = buildNudgeSection(nonTrivial, { confirmBeforeCode: "ask" });
		expect(s.includes("Confirm before coding")).toBe(true);
		expect(s.includes("Scope it with me")).toBe(false);
		expect(s.includes("ask_pro")).toBe(true);
	});

	test("off when flag omitted, false, or 'off'", () => {
		expect(buildNudgeSection(nonTrivial).includes("Scope it with me")).toBe(false);
		expect(buildNudgeSection(nonTrivial, { confirmBeforeCode: false }).includes("Scope it with me")).toBe(false);
		const off = buildNudgeSection(nonTrivial, { confirmBeforeCode: "off" });
		expect(off.includes("Scope it with me")).toBe(false);
		expect(off.includes("Confirm before coding")).toBe(false);
	});

	test("not added for trivial tasks even when enabled", () => {
		expect(buildNudgeSection(trivial, { confirmBeforeCode: "scope" }).includes("Scope it with me")).toBe(false);
	});
});

describe("buildSuggestionSection (proactive next step)", () => {
	const base: WorkflowSituation = {
		hasProject: true,
		branch: "master",
		onPlanBranch: false,
		planSlug: null,
		planExists: false,
		planIsStub: false,
		dirty: false,
		readyTaskIds: [],
	};

	test("empty when there's no project", () => {
		expect(buildSuggestionSection({ ...base, hasProject: false })).toBe("");
	});

	test("always teaches the model to call soly-workflow on loose intent", () => {
		const s = buildSuggestionSection(base);
		expect(s).toContain("soly-workflow");
		expect(s).toContain("You propose; the user confirms; you run it.");
		// No dependency on the external `subagent(...)` tool.
		expect(s).not.toContain("subagent(");
	});

	test("stub PLAN on a plan branch → suggests fleshing it out (plan)", () => {
		const s = buildSuggestionSection({
			...base,
			branch: "feature/auth-jwt",
			onPlanBranch: true,
			planSlug: "feature/auth-jwt",
			planExists: true,
			planIsStub: true,
		});
		expect(s).toContain('action: "plan"');
		expect(s).toContain("feature/auth-jwt");
	});

	test("ready PLAN on a clean plan branch → suggests execute", () => {
		const s = buildSuggestionSection({
			...base,
			branch: "auth-jwt",
			onPlanBranch: true,
			planSlug: "auth-jwt",
			planExists: true,
			planIsStub: false,
		});
		expect(s).toContain('action: "execute"');
	});

	test("dirty tree on a ready plan branch → suggests done", () => {
		const s = buildSuggestionSection({
			...base,
			branch: "auth-jwt",
			onPlanBranch: true,
			planSlug: "auth-jwt",
			planExists: true,
			planIsStub: false,
			dirty: true,
		});
		expect(s).toContain('action: "done"');
	});

	test("plan branch without a PLAN.md → suggests scaffolding (new)", () => {
		const s = buildSuggestionSection({
			...base,
			branch: "auth-jwt",
			onPlanBranch: true,
			planSlug: "auth-jwt",
			planExists: false,
		});
		expect(s).toContain('action: "new"');
	});

	test("ready tasks off a plan branch → surfaces them for execute", () => {
		const s = buildSuggestionSection({ ...base, readyTaskIds: ["auth-login-a3f9", "auth-token-b1c2"] });
		expect(s).toContain('action: "execute"');
		expect(s).toContain("auth-login-a3f9");
	});
});

// ---------------------------------------------------------------------------
// detectComplaint — complaint pattern detection
// ---------------------------------------------------------------------------

describe("detectComplaint", () => {
	const { detectComplaint } = require("../nudge.ts") as { detectComplaint: (s: string) => boolean };

	test("detects Russian complaint phrases", () => {
		expect(detectComplaint("IdentityExceptionKind меня напрягает")).toBe(true);
		expect(detectComplaint("мне не нравится что agent делает X")).toBe(true);
		expect(detectComplaint("this кринж")).toBe(true);
		expect(detectComplaint("убирай this просто ренейм делай")).toBe(true);
		expect(detectComplaint("почему опять god switch")).toBe(true);
		expect(detectComplaint("не делай так")).toBe(true);
		expect(detectComplaint("бесит когда он так пишет")).toBe(true);
		expect(detectComplaint("переделай по-другому")).toBe(true);
	});

	test("detects English complaint phrases", () => {
		expect(detectComplaint("redo this differently")).toBe(true);
		expect(detectComplaint("I don't like the agent doing X")).toBe(true);
		expect(detectComplaint("why does it keep doing Z")).toBe(true);
		expect(detectComplaint("stop doing that")).toBe(true);
		expect(detectComplaint("this is annoying")).toBe(true);
	});

	test("does not flag neutral requests", () => {
		expect(detectComplaint("add a login page")).toBe(false);
		expect(detectComplaint("refactor the auth module")).toBe(false);
		expect(detectComplaint("how does this work?")).toBe(false);
		expect(detectComplaint("use cancellationToken instead of ct")).toBe(false);
	});
});

describe("buildNudgeSection — complaint directive", () => {
	test("injects agent-coach directive when complaint detected", () => {
		const section = buildNudgeSection({
			nonTrivial: true,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: [],
			complaint: true,
		});
		expect(section).toContain("User complaint detected");
		expect(section).toContain("agent-coach");
		expect(section).toContain("SKILL.md");
	});

	test("no complaint directive when complaint is false", () => {
		const section = buildNudgeSection({
			nonTrivial: true,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: [],
			complaint: false,
		});
		expect(section).not.toContain("User complaint detected");
		expect(section).not.toContain("agent-coach");
	});
});
