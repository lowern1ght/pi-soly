// =============================================================================
// tests/parser.test.ts — Unit tests for workflows/parser.ts
// =============================================================================
//
// Parser is pure (no I/O), so we can hammer it with edge cases. The shapes
// it produces are the contract the workflow handlers depend on — every
// workflow verb has a recognized form, and unknown forms must return null
// (not throw, not silently misroute).
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import {
	parseSolyCommand,
	describeExecuteTarget,
	describePlanTarget,
} from "../workflows/parser.js";

describe("parseSolyCommand", () => {
	test("returns null for empty input", () => {
		expect(parseSolyCommand("")).toBeNull();
		expect(parseSolyCommand("   ")).toBeNull();
	});

	test("returns null for slash commands", () => {
		// /soly is a separate code path; plain "soly ..." is the workflow verb
		expect(parseSolyCommand("/soly status")).toBeNull();
		expect(parseSolyCommand("/rules list")).toBeNull();
	});

	test("returns null for non-soly input", () => {
		expect(parseSolyCommand("hello world")).toBeNull();
		expect(parseSolyCommand("please execute phase 5")).toBeNull();
	});

	test("returns null for unknown verbs", () => {
		expect(parseSolyCommand("soly frobnicate 11")).toBeNull();
		expect(parseSolyCommand("soly 11")).toBeNull();
	});

	test("matches all 9 known verbs", () => {
		const verbs = [
			"execute",
			"pause",
			"compact",
			"resume",
			"status",
			"log",
			"diff",
			"plan",
			"discuss",
		] as const;
		for (const v of verbs) {
			const r = parseSolyCommand(`soly ${v}`);
			expect(r).not.toBeNull();
			expect(r!.verb).toBe(v);
		}
	});

	test("preserves raw text and case-insensitive verb", () => {
		const r = parseSolyCommand("SOLY Execute 11");
		expect(r).not.toBeNull();
		expect(r!.verb).toBe("execute");
		expect(r!.args).toEqual(["11"]);
		expect(r!.raw).toBe("SOLY Execute 11");
	});

	test("captures all args", () => {
		const r = parseSolyCommand("soly execute 11.02 --feature auth");
		expect(r).not.toBeNull();
		expect(r!.verb).toBe("execute");
		expect(r!.args).toEqual(["11.02", "--feature", "auth"]);
	});

	test("only matches when 'soly' is a separate token at the start", () => {
		// "solylike" should NOT match — it must be exactly "soly" then space
		expect(parseSolyCommand("solylike execute 5")).toBeNull();
	});

	test("requires whitespace after soly (bare 'soly' is now the help verb)", () => {
		// Bare "soly" → help verb (B4 fix)
		expect(parseSolyCommand("soly")?.verb).toBe("help");
		// 'solyexecute' (no space) — still rejected, must have a separator
		expect(parseSolyCommand("solyexecute")).toBeNull();
	});
});

describe("describeExecuteTarget", () => {
	test("returns null for empty args", () => {
		expect(describeExecuteTarget([])).toBeNull();
	});

	test("parses phase number (single integer)", () => {
		const t = describeExecuteTarget(["11"]);
		expect(t).toEqual({ kind: "phase", phase: 11, plan: null, raw: "11" });
	});

	test("parses phase.plan (two-level)", () => {
		const t = describeExecuteTarget(["11.02"]);
		expect(t).toEqual({ kind: "phase", phase: 11, plan: 2, raw: "11.02" });
	});

	test("rejects malformed numbers", () => {
		expect(describeExecuteTarget(["11.2.3"])).toBeNull();
		expect(describeExecuteTarget(["-5"])).toBeNull();
	});

	test("plain letters are now a valid plan slug (1.15.x)", () => {
		// `abc` matches the kebab-case slug regex, so it's a valid plan name.
		expect(describeExecuteTarget(["abc"])).toEqual({ kind: "plan", name: "abc", prefix: null, raw: "abc" });
	});

	test("parses task id (slug-4hex)", () => {
		const t = describeExecuteTarget(["auth-be-login-a3f9"]);
		expect(t).toEqual({ kind: "task", taskId: "auth-be-login-a3f9", raw: "auth-be-login-a3f9" });
	});

	test("task id is case-insensitive on the hex part", () => {
		expect(describeExecuteTarget(["auth-be-login-A3F9"])).not.toBeNull();
	});

	test("non-hex task-id-shaped string is treated as a plan slug (1.15.x)", () => {
		// `auth-be-login-zzzz` looks task-id-shaped but the trailing part isn't
		// hex. Before 1.15.x this was null. After 1.15.x it matches the
		// kebab-case plan-slug regex and is a valid plan name.
		expect(describeExecuteTarget(["auth-be-login-zzzz"])).toEqual({
			kind: "plan",
			name: "auth-be-login-zzzz",
			prefix: null,
			raw: "auth-be-login-zzzz",
		});
	});

	test("parses --all flag", () => {
		const t = describeExecuteTarget(["--all"]);
		expect(t).toEqual({ kind: "all", raw: "--all" });
	});

	test("--all-ready is accepted as an alias", () => {
		const t = describeExecuteTarget(["--all-ready"]);
		expect(t).toEqual({ kind: "all", raw: "--all-ready" });
	});

	test("parses --feature <name>", () => {
		const t = describeExecuteTarget(["--feature", "auth"]);
		expect(t).toEqual({ kind: "feature", feature: "auth", raw: "--feature auth" });
	});

	test("--feature without value is rejected", () => {
		expect(describeExecuteTarget(["--feature"])).toBeNull();
	});

	test("--feature flag value being another flag falls back to that flag", () => {
		// Documenting the impl behavior: `--feature --all` resolves as `--all`
		// because the --all check runs before the --feature check.
		expect(describeExecuteTarget(["--feature", "--all"])).toEqual({
			kind: "all",
			raw: "--feature --all",
		});
	});

	test("positional mixed with flags: target wins over feature", () => {
		// --feature is the only flag, no positional → feature target
		expect(describeExecuteTarget(["--feature", "auth"])).toEqual({
			kind: "feature",
			feature: "auth",
			raw: "--feature auth",
		});
		// positional "5" alone → phase target
		expect(describeExecuteTarget(["5"])).toEqual({
			kind: "phase",
			phase: 5,
			plan: null,
			raw: "5",
		});
	});
});

describe("describePlanTarget", () => {
	test("returns null for empty args", () => {
		expect(describePlanTarget([])).toBeNull();
	});

	test("parses phase number", () => {
		const t = describePlanTarget(["7"]);
		expect(t).toEqual({ kind: "phase", phase: 7, raw: "7" });
	});

	test("parses task id (existing-task mode)", () => {
		const t = describePlanTarget(["auth-be-login-a3f9"]);
		expect(t).toEqual({ kind: "task", taskId: "auth-be-login-a3f9", raw: "auth-be-login-a3f9" });
	});

	test("parses --new-task <slug> --feature <name>", () => {
		const t = describePlanTarget(["--new-task", "add-logout", "--feature", "auth"]);
		expect(t).toEqual({
			kind: "new-task",
			slug: "add-logout",
			feature: "auth",
			raw: "--new-task add-logout --feature auth",
		});
	});

	test("--new-task order is independent of --feature", () => {
		const t = describePlanTarget(["--feature", "auth", "--new-task", "add-logout"]);
		expect(t).toEqual({
			kind: "new-task",
			slug: "add-logout",
			feature: "auth",
			raw: "--feature auth --new-task add-logout",
		});
	});

	test("--new-task without --feature falls through to plan mode (1.15.x)", () => {
		// Old behavior rejected this with null. After 1.15.x, the parser
		// treats --new-task (a flag we don't know how to honor without
		// --feature) as a no-op and the positional arg becomes a plan slug.
		expect(describePlanTarget(["--new-task", "add-logout"])).toEqual({
			kind: "plan",
			name: "add-logout",
			prefix: null,
			raw: "--new-task add-logout",
		});
	});

	test("--new-task without slug falls back to --feature mode", () => {
		// Documenting the impl behavior: when --new-task has no real slug
		// (its value starts with --), the parser treats it as a typo and
		// falls back to --feature mode using the rest of the args.
		expect(describePlanTarget(["--new-task", "--feature", "auth"])).toEqual({
			kind: "feature",
			feature: "auth",
			raw: "--new-task --feature auth",
		});
	});

	test("parses --feature <name> alone (plan-all-tasks-in-feature mode)", () => {
		const t = describePlanTarget(["--feature", "auth"]);
		expect(t).toEqual({ kind: "feature", feature: "auth", raw: "--feature auth" });
	});

	test("ambiguous: --new-task and --feature is treated as new-task (more specific)", () => {
		// This documents the disambiguation rule: --new-task wins because it's
		// the more specific flag combination. The user expects a "create new"
		// when they explicitly say --new-task.
		const t = describePlanTarget(["--new-task", "x", "--feature", "y"]);
		expect(t!.kind).toBe("new-task");
	});

	test("rejects unknown shapes", () => {
		expect(describePlanTarget(["11.02"])).toBeNull(); // plan-shape N.MM is execute-only
	});

	test("plain word is now a valid plan slug (1.15.x)", () => {
		expect(describePlanTarget(["whatever"])).toEqual({
			kind: "plan",
			name: "whatever",
			prefix: null,
			raw: "whatever",
		});
	});
});

// ---------------------------------------------------------------------------
// Regression: every WorkflowVerb should parse. If you add a verb to the
// union, also add a test here AND a dispatcher branch in workflows/index.ts.
// (Both the parser and the dispatcher are easy to forget when adding
// a new verb — this test catches the parser side.)
// ---------------------------------------------------------------------------

describe("parseSolyCommand — every registered verb parses", () => {
	const verbs = [
		"execute", "pause", "compact", "resume", "status", "log", "diff",
		"plan", "discuss", "help", "doctor", "iterations", "phase", "todos",
	] as const;
	for (const v of verbs) {
		test(`soly ${v} → verb=${v}`, () => {
			const r = parseSolyCommand(`soly ${v}`);
			expect(r).not.toBeNull();
			expect(r!.verb).toBe(v);
		});
	}
});
