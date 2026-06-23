// =============================================================================
// tests/mcp-calltool-args.test.ts — regression: callTool argument positions
// =============================================================================
//
// The adapter's McpServerManager.callTool must call the SDK client's callTool
// as callTool(params, resultSchema?, options?) — i.e. pass `undefined` (→ SDK
// default CallToolResultSchema) as the 2nd arg and `signal` as the 3rd.
//
// A previous inline cast treated the method as (params, options?) and passed
// the adapter's options object ({ _bookkeep, signal }) as the 2nd argument,
// landing it in the resultSchema slot. The SDK then validated every response
// via safeParse({_bookkeep,...}, result); a plain object has no .safeParse, so
// every tool call crashed with "v3Schema.safeParse is not a function" (and the
// same result-validation path in request() broke tool listings, leaving only
// the adapter's own meta-tools visible). This test pins the argument order so
// the bug can't silently regress.
// =============================================================================

import { describe, expect, test } from "bun:test";
import { McpServerManager } from "../mcp/server-manager.ts";

/** A fake connected connection whose client.callTool records its raw args. */
function fakeConnection() {
	const calls: unknown[][] = [];
	const callTool = (...args: unknown[]) => {
		calls.push(args);
		return Promise.resolve({ content: [{ type: "text", text: "ok" }] });
	};
	return {
		calls,
		conn: {
			// Minimal ServerConnection shape — only what callTool() touches.
			client: { callTool },
			transport: {},
			definition: {},
			tools: [],
			resources: [],
			lastUsedAt: Date.now(),
			inFlight: 0,
			status: "connected" as const,
		},
	};
}

/** New manager with a fake "connected" server injected into its private map. */
function setup(serverName: string) {
	const mgr = new McpServerManager();
	const { calls, conn } = fakeConnection();
	(mgr as unknown as { connections: Map<string, unknown> }).connections.set(serverName, conn);
	return { mgr, calls };
}

describe("McpServerManager.callTool — SDK argument positions", () => {
	test("passes undefined as resultSchema, signal as 3rd arg (not options as resultSchema)", async () => {
		const { mgr, calls } = setup("srv");
		const ac = new AbortController();
		// _bookkeep:false keeps the call self-contained (no bookkeeping state
		// needed) so we focus purely on the args handed to the SDK.
		await mgr.callTool(
			"srv",
			{ name: "spawn_actor", arguments: { x: 1 } },
			{ signal: ac.signal, _bookkeep: false },
		);

		expect(calls.length).toBe(1);
		const [params, resultSchema, options] = calls[0] as [unknown, unknown, unknown];

		// 1st arg: the tool-call params, untouched.
		expect(params).toEqual({ name: "spawn_actor", arguments: { x: 1 } });

		// 2nd arg: MUST be undefined (→ SDK default CallToolResultSchema). The bug
		// passed { _bookkeep, signal } here, which is what crashed.
		expect(resultSchema).toBeUndefined();

		// 3rd arg: only the SDK-relevant option (signal) is forwarded — _bookkeep
		// is adapter-internal and must NOT leak to the SDK.
		expect(options).toEqual({ signal: ac.signal });
	});

	test("without a signal, omits the SDK options arg entirely", async () => {
		const { mgr, calls } = setup("srv");
		await mgr.callTool("srv", { name: "t", arguments: {} }, { _bookkeep: false });

		const [, , options] = calls[0] as [unknown, unknown, unknown];
		expect(options).toBeUndefined();
	});
});
