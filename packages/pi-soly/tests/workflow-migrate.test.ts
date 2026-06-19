// =============================================================================
// tests/workflow-migrate.test.ts — `soly migrate` (legacy → unified) transform
// =============================================================================
//
// Distinct from migrate.test.ts (which covers the `.soly/`→`.agents/` rename).
// This covers the `soly migrate` workflow verb that converts the legacy
// phases/plans + features layout into the unified phases/<N>/tasks/ model.
// =============================================================================

import { describe, test, expect } from "bun:test";
import { buildMigrateTransform } from "../workflows/migrate.ts";
import { parseSolyCommand } from "../workflows/parser.ts";
import type { PhaseInfo, SolyState } from "../core.ts";

function st(over: Partial<SolyState>): SolyState {
	return { exists: true, phases: [], features: [], ...over } as unknown as SolyState;
}
function phase(over: Partial<PhaseInfo>): PhaseInfo {
	return { number: 1, name: "x", slug: "01-x", dir: "/x", planCount: 0, contextExists: false, researchExists: false, plans: [], ...over } as PhaseInfo;
}

describe("soly migrate (workflow verb)", () => {
	test("parser recognizes the verb", () => {
		expect(parseSolyCommand("soly migrate")?.verb).toBe("migrate");
	});

	test("no project → nothing to migrate", () => {
		const r = buildMigrateTransform(st({ exists: false }));
		expect(r.transformedText?.toLowerCase().includes("nothing to migrate")).toBe(true);
	});

	test("already unified → nothing to migrate", () => {
		const r = buildMigrateTransform(st({ phases: [phase({ plans: [], tasks: [] })], features: [] }));
		expect(r.transformedText?.includes("already on the unified model")).toBe(true);
	});

	test("legacy plans → emits a conversion protocol", () => {
		const r = buildMigrateTransform(st({ phases: [phase({ slug: "01-foundation", plans: ["01-01-PLAN.md"], tasks: [] })] }));
		expect(r.transformedText?.includes("convert the legacy layout")).toBe(true);
		expect(r.transformedText?.includes("01-foundation")).toBe(true);
		expect(r.transformedText?.includes("tasks/<task-id>/PLAN.md")).toBe(true);
	});

	test("legacy features are detected", () => {
		const features = [{ slug: "auth", taskCount: 2 }] as unknown as SolyState["features"];
		const r = buildMigrateTransform(st({ features }));
		expect(r.transformedText?.includes("features/")).toBe(true);
		expect(r.transformedText?.includes("auth")).toBe(true);
	});
});
