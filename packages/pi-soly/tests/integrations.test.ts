// =============================================================================
// tests/integrations.test.ts — Tests for the cross-extension registry
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { KNOWN_INTEGRATIONS, buildIntegrationsSection } from "../integrations.js";

describe("KNOWN_INTEGRATIONS", () => {
	test("is non-empty", () => {
		expect(KNOWN_INTEGRATIONS.length).toBeGreaterThan(0);
	});

	test("every entry has required fields populated", () => {
		for (const i of KNOWN_INTEGRATIONS) {
			expect(i.tool.length).toBeGreaterThan(0);
			expect(i.extension.length).toBeGreaterThan(0);
			expect(i.summary.length).toBeGreaterThan(10);
			expect(i.whenToUse.length).toBeGreaterThan(10);
		}
	});

	test("tool names are unique (no collisions)", () => {
		const tools = KNOWN_INTEGRATIONS.map((i) => i.tool);
		expect(new Set(tools).size).toBe(tools.length);
	});
});

describe("buildIntegrationsSection", () => {
	test("returns null when no known tools are active", () => {
		expect(buildIntegrationsSection(["bash", "read", "edit"])).toBeNull();
		expect(buildIntegrationsSection([])).toBeNull();
	});

	test("mentions only the active tools, not the unactive ones", () => {
		const s = buildIntegrationsSection(["ask_pro", "bash"]);
		expect(s).not.toBeNull();
		expect(s).toContain("ask_pro");
		expect(s).toContain("pi-ask");
		// todo_update NOT installed → must NOT appear
		expect(s).not.toContain("todo_update");
		expect(s).not.toContain("pi-todo");
	});

	test("lists multiple integrations when several are active", () => {
		const s = buildIntegrationsSection(["ask_pro", "todo_update"]);
		expect(s).not.toBeNull();
		expect(s).toContain("ask_pro");
		expect(s).toContain("pi-ask");
		expect(s).toContain("todo_update");
		expect(s).toContain("pi-todo");
	});

	test("starts with the section header", () => {
		const s = buildIntegrationsSection(["ask_pro"]);
		expect(s!.trim().startsWith("## Cross-extension integrations")).toBe(true);
	});

	test("includes 'When:' guidance for each tool", () => {
		const s = buildIntegrationsSection(["ask_pro", "todo_update"]);
		// Each integration contributes a "When: ..." line
		const whenCount = (s!.match(/When:/g) ?? []).length;
		expect(whenCount).toBe(2);
	});

	test("is reasonably short (cumulative budget for system prompt)", () => {
		const s = buildIntegrationsSection(KNOWN_INTEGRATIONS.map((i) => i.tool));
		expect(s).not.toBeNull();
		// Each integration adds ~150 chars; 2 known = ~600 chars total
		expect(s!.length).toBeLessThan(1500);
	});

	test("pure function (deterministic)", () => {
		const tools = ["ask_pro", "todo_update"];
		expect(buildIntegrationsSection(tools)).toBe(buildIntegrationsSection(tools));
	});
});
