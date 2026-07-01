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
import { classifyTaskHeuristics, buildNudgeSection, confirmLevelOf } from "../nudge.js";

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
		});
		expect(section).toContain("1. **Pre-action gate.**");
		expect(section).toContain("2. **Background subagents by default.**");
		expect(section).toContain("3. **Subagent tool ergonomics.**");
	});

	test("includes trigger explanation for non-trivial prompt", () => {
		const section = buildNudgeSection({
			nonTrivial: true,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: [],
		});
		expect(section).toMatch(/Heuristics for this prompt:.*non-trivial task/);
	});

	test("includes trigger explanation for research-heavy prompt", () => {
		const section = buildNudgeSection({
			nonTrivial: false,
			researchHeavy: true,
			mentions: [],
			suggestedAngles: [],
		});
		expect(section).toMatch(/Heuristics for this prompt:.*research-heavy/);
	});

	test("renders suggested angles as a numbered list", () => {
		const section = buildNudgeSection({
			nonTrivial: true,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: ["which files are in scope?", "any deadline?"],
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
		});
		expect(section).toContain("looks routine");
	});

	test("includes the 'Treat (1) and (2) as defaults, not laws' footer", () => {
		const section = buildNudgeSection({
			nonTrivial: false,
			researchHeavy: false,
			mentions: [],
			suggestedAngles: [],
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
		expect(s.includes("soly discuss")).toBe(true);
		expect(s.includes("soly verify")).toBe(true);
		expect(s.includes("soly new <slug>")).toBe(true);
	});

	test("instructs LLM to study the repo before scaffolding or fleshing out a plan", () => {
		const s = buildNudgeSection(nonTrivial, { hasProject: true });
		expect(s.includes("STUDY THE REPO")).toBe(true);
		expect(s.includes("soly_snippet")).toBe(true);
		expect(s.includes("soly_doc_search")).toBe(true);
	});

	test("embeds the actual defaultBranchPrefix in the workflow point", () => {
		const s = buildNudgeSection(nonTrivial, {
			hasProject: true,
			defaultBranchPrefix: "feature",
		});
		expect(s.includes("Branches look like `feature/<slug>`")).toBe(true);
		expect(s.includes('project default is **`"feature"`**')).toBe(true);
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
