// =============================================================================
// tests/settings.test.ts — registry + describeAllowed + getEffectiveValue
// =============================================================================

import { describe, test, expect } from "bun:test";
import {
	SETTINGS,
	getSetting,
	allKeys,
	settingsBySensitivity,
	getEffectiveValue,
	describeAllowed,
	snapshotKeys,
} from "../settings/registry.ts";
import { Type } from "typebox";

describe("settings/registry", () => {
	test("SETTINGS is non-empty", () => {
		expect(SETTINGS.length).toBeGreaterThan(10);
	});

	test("every spec has a unique key", () => {
		const keys = SETTINGS.map((s) => s.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("every spec has required fields", () => {
		for (const s of SETTINGS) {
			expect(s.key).toBeTruthy();
			expect(s.schema).toBeDefined();
			expect(s.layer).toMatch(/^(solyConfig|mode)$/);
			expect(s.sensitivity).toMatch(/^(cosmetic|behavioral|structural)$/);
			expect(s.summary.length).toBeGreaterThan(10);
			expect(s.scopes.length).toBeGreaterThan(0);
			expect(s.default).toBeDefined();
		}
	});

	test("mode is registered as structural", () => {
		const mode = getSetting("mode");
		expect(mode).toBeDefined();
		expect(mode!.sensitivity).toBe("structural");
		expect(mode!.layer).toBe("mode");
	});

	test("chrome.ascii is registered as cosmetic", () => {
		const ascii = getSetting("chrome.ascii");
		expect(ascii).toBeDefined();
		expect(ascii!.sensitivity).toBe("cosmetic");
	});

	test("agent.confirmBeforeCode is registered as behavioral", () => {
		const cbc = getSetting("agent.confirmBeforeCode");
		expect(cbc).toBeDefined();
		expect(cbc!.sensitivity).toBe("behavioral");
	});

	test("getSetting returns undefined for unknown key", () => {
		expect(getSetting("nonexistent.key")).toBeUndefined();
	});

	test("allKeys returns sorted list", () => {
		const keys = allKeys();
		expect(keys).toEqual([...keys].sort());
	});

	test("settingsBySensitivity filters correctly", () => {
		const structural = settingsBySensitivity("structural");
		expect(structural.length).toBeGreaterThan(0);
		expect(structural.every((s) => s.sensitivity === "structural")).toBe(true);
	});

	test("snapshotKeys excludes cosmetic", () => {
		const snapshot = snapshotKeys();
		expect(snapshot.every((s) => s.sensitivity !== "cosmetic")).toBe(true);
	});
});

describe("getEffectiveValue", () => {
	test("reads mode from modeConfig", () => {
		const spec = getSetting("mode")!;
		const val = getEffectiveValue(spec, null, { mode: "phases", plansDir: ".agents/plans" });
		expect(val).toBe("phases");
	});

	test("reads chrome.ascii from solyConfig", () => {
		const spec = getSetting("chrome.ascii")!;
		const val = getEffectiveValue(spec, { chrome: { ascii: true } } as never, null);
		expect(val).toBe(true);
	});

	test("reads nested agent.confirmBeforeCode", () => {
		const spec = getSetting("agent.confirmBeforeCode")!;
		const val = getEffectiveValue(spec, { agent: { confirmBeforeCode: "ask" } } as never, null);
		expect(val).toBe("ask");
	});

	test("returns undefined for missing nested path", () => {
		const spec = getSetting("chrome.ascii")!;
		const val = getEffectiveValue(spec, {} as never, null);
		expect(val).toBeUndefined();
	});
});

describe("describeAllowed", () => {
	test("describes boolean", () => {
		const s = describeAllowed(Type.Boolean());
		expect(s).toContain("true");
		expect(s).toContain("false");
	});

	test("describes string", () => {
		const s = describeAllowed(Type.String());
		expect(s).toContain("string");
	});

	test("describes integer with min/max", () => {
		const s = describeAllowed(Type.Integer({ minimum: 0, maximum: 100 }));
		expect(s).toContain("0");
		expect(s).toContain("100");
	});

	test("describes union of literals", () => {
		const s = describeAllowed(Type.Union([Type.Literal("a"), Type.Literal("b")]));
		expect(s).toContain('"a"');
		expect(s).toContain('"b"');
	});
});
