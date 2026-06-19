// =============================================================================
// tests/subagent-preflight.test.ts — execute/plan inline fallback
// =============================================================================
//
// execute/plan instructions tell the model to launch a `subagent(...)` tool
// provided by the external pi-subagents plugin. When that tool isn't present,
// withSubagentPreflight prepends an override telling the model to run inline,
// instead of silently asking for a tool that doesn't exist.
// =============================================================================

import { describe, expect, test } from "bun:test";
import { withSubagentPreflight } from "../workflows/index.ts";

describe("withSubagentPreflight", () => {
	const body = "Launch a single subagent for this work. Do NOT do the work inline.";

	test("passes the instruction through unchanged when subagent is available", () => {
		expect(withSubagentPreflight(body, ["subagent", "ask_pro"])).toBe(body);
	});

	test("prepends an inline-execution override when subagent is missing", () => {
		const out = withSubagentPreflight(body, ["ask_pro"]);
		expect(out).not.toBe(body);
		expect(out.endsWith(body)).toBe(true);
		expect(out.toLowerCase()).toContain("not installed");
		expect(out.toLowerCase()).toContain("inline");
	});

	test("treats an empty tool list as 'no subagent'", () => {
		expect(withSubagentPreflight(body, []).endsWith(body)).toBe(true);
		expect(withSubagentPreflight(body, [])).not.toBe(body);
	});
});
