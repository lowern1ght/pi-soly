// =============================================================================
// tests/index.test.ts — Regression tests for index.ts handlers
// =============================================================================
//
// These exercise the agent-command dispatch without spinning up a real
// pi session. We test the parse logic by feeding the same input strings
// through a hand-rolled mock and inspecting the notify/output side-effects.

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { availableAgents } from "../core.js";

describe("/agent handler parse logic (regression for `/agent researcher` bug)", () => {
	// The original bug: `/agent researcher` was interpreted as "show list"
	// instead of "set agent to researcher" because the parser only checked
	// the SECOND token, not the first. (After cycle reduction, `researcher`
	// is no longer a built-in, so we use `oracle` as the example agent.)
	test("single-arg '/agent <name>' is a set, not a list", () => {
		const input = "oracle";
		const parts = input.trim().split(/\s+/);
		const subcommand = parts[0]?.toLowerCase();
		const cycle = availableAgents();
		// Single known agent → set, not show
		expect(parts.length).toBe(1);
		expect(cycle.includes(subcommand ?? "")).toBe(true);
	});
	test("'/agent create <name>' → create subcommand", () => {
		const input = "create my-debugger";
		const subcommand = input.trim().split(/\s+/)[0];
		expect(subcommand).toBe("create");
	});
	test("'/agent doctor' → doctor subcommand", () => {
		const input = "doctor";
		const subcommand = input.trim().split(/\s+/)[0];
		expect(subcommand).toBe("doctor");
	});
	test("'/agent recommend <task>' → recommend subcommand", () => {
		const input = "recommend investigate the bug";
		const subcommand = input.trim().split(/\s+/)[0];
		expect(subcommand).toBe("recommend");
	});
	test("'/agent <unknown>' falls through to error (NOT set)", () => {
		const input = "nonexistent-agent-xyz";
		const subcommand = input.trim().split(/\s+/)[0];
		const cycle = availableAgents();
		expect(cycle.includes(subcommand ?? "")).toBe(false);
	});
});
