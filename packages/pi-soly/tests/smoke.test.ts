// =============================================================================
// tests/smoke.test.ts — Smoke test: extension loads and registers without error
// =============================================================================
//
// Catches bugs like the 1.4.0 "piSwitchExtension is not defined" regression:
// when an import is deleted but the call site is left behind, tsc doesn't
// catch it (different locations) and unit tests don't catch it (they don't
// call the main entry). This test:
//
//   1. Imports index.ts (catches missing imports, syntax errors)
//   2. Checks default export is a function (catches wrong export shape)
//   3. Calls the function with a mock `pi` (catches ReferenceError in body,
//      orphaned calls, missing functions)
//
// The mock `pi` is a Proxy that accepts any method call and returns a no-op.
// The extension only does registration at call time (no event handlers fire),
// so this is safe.
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import solyExtension from "../index.js";

/** A mock pi object that accepts any method call and returns a no-op.
 *  This lets us call solyExtension(pi) without a real pi instance. */
function makeMockPi(): unknown {
	return new Proxy(
		{},
		{
			get() {
				// Every property access returns a no-op function.
				// This handles pi.on(), pi.registerCommand(), pi.registerTool(),
				// pi.getActiveTools(), etc.
				return () => [];
			},
		},
	);
}

describe("smoke: extension entry point", () => {
	test("module loads without error (imports resolve)", () => {
		// If any import in index.ts is broken (deleted file, syntax error),
		// this import would have already thrown at the top of the file.
		expect(solyExtension).toBeDefined();
	});

	test("default export is a function", () => {
		expect(typeof solyExtension).toBe("function");
	});

	test("calling with mock pi does not throw", () => {
		const mockPi = makeMockPi();
		// This exercises the full function body — all pi.on/registerCommand/
		// registerTool calls, all sub-module mounts (piAskExtension, etc.).
		// If there's a ReferenceError (orphaned call to a deleted import),
		// this will throw.
		expect(() => solyExtension(mockPi as never)).not.toThrow();
	});

	test("registers at least one event handler", () => {
		const calls: string[] = [];
		const mockPi = new Proxy(
			{},
			{
				get(_t, prop) {
					return (...args: unknown[]) => {
						calls.push(String(prop));
						// Some methods return arrays (getActiveTools)
						if (String(prop) === "getActiveTools") return [];
						return undefined;
					};
				},
			},
		);
		solyExtension(mockPi as never);
		// Should have called pi.on at least once (session_start, before_agent_start, input)
		expect(calls.filter((c) => c === "on").length).toBeGreaterThan(0);
	});

	test("registers at least one command", () => {
		const calls: string[] = [];
		const mockPi = new Proxy(
			{},
			{
				get(_t, prop) {
					return (...args: unknown[]) => {
						calls.push(String(prop));
						if (String(prop) === "getActiveTools") return [];
						return undefined;
					};
				},
			},
		);
		solyExtension(mockPi as never);
		// Should have called pi.registerCommand (for /soly, /rules, /why, etc.)
		expect(calls.filter((c) => c === "registerCommand").length).toBeGreaterThan(0);
	});

	test("registers at least one tool", () => {
		const calls: string[] = [];
		const mockPi = new Proxy(
			{},
			{
				get(_t, prop) {
					return (...args: unknown[]) => {
						calls.push(String(prop));
						if (String(prop) === "getActiveTools") return [];
						return undefined;
					};
				},
			},
		);
		solyExtension(mockPi as never);
		// Should have called pi.registerTool (for soly_read, soly_log_decision, etc.)
		expect(calls.filter((c) => c === "registerTool").length).toBeGreaterThan(0);
	});
});
