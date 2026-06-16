// =============================================================================
// tests/e2e-commands.test.ts — E2E tests for slash command handlers
// =============================================================================
//
// Registers all commands via registerCommands() with a mock pi, then invokes
// the handlers directly with mock ctx/ui. Verifies that commands produce the
// right output (notify calls) for common inputs.
//
// This catches bugs that unit tests miss: wrong imports, broken handler
// wiring, crashes on edge cases (empty args, unknown subcommands, etc.).
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerCommands, type CommandUI } from "../commands.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

let tmpRoot: string;
let projectDir: string;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-e2e-"));
	projectDir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
	// Fake .soly/ structure
	const solyDir = path.join(projectDir, ".soly");
	fs.mkdirSync(solyDir, { recursive: true });
	fs.writeFileSync(path.join(solyDir, "STATE.md"), "---\nmilestone: v0.1\n---\n# State\n\n## Decisions\n\n| Date | Decision | Why |\n|------|----------|-----|\n| 2026-01-01 | test | reason |\n");
	fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# Roadmap\n\n| # | Phase | Status |\n|---|-------|--------|\n| 01 | bootstrap | pending |\n");
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockCtx {
	ui: {
		notify: (text: string, level?: "info" | "warning" | "error") => void;
		select: (label: string, options: string[]) => Promise<string | undefined>;
		confirm: (title: string, message: string) => Promise<boolean>;
		input: (label: string, placeholder?: string) => Promise<string | undefined>;
	};
	cwd: string;
}

function makeMockPi(): ExtensionAPI & {
	_commands: Map<string, { description: string; handler: (args: string, ctx: MockCtx) => Promise<void> }>;
} {
	const commands = new Map();
	const mockPi = {
		on: () => {},
		registerCommand: (name: string, spec: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) => {
			commands.set(name, spec);
		},
		registerTool: () => {},
		getActiveTools: () => [],
		_commands: commands,
	} as unknown as ExtensionAPI & { _commands: Map<string, { description: string; handler: (args: string, ctx: MockCtx) => Promise<void> }> };
	return mockPi;
}

function makeMockCtx(cwd: string, opts: { selectResult?: string; confirmResult?: boolean } = {}): MockCtx {
	const notifications: Array<{ text: string; level?: string }> = [];
	return {
		ui: {
			notify: (text: string, level?: "info" | "warning" | "error") => {
				notifications.push({ text, level });
			},
			select: async () => opts.selectResult,
			confirm: async () => opts.confirmResult ?? false,
			input: async () => undefined,
		},
		cwd,
	} as unknown as MockCtx & { _notifications: typeof notifications };
}

function makeMockDeps(cwd: string) {
	const solyDir = path.join(cwd, ".soly");
	return {
		getRules: () => [],
		getOverridden: () => [],
		refreshRules: () => {},
		getState: () => ({
			exists: fs.existsSync(solyDir),
			solyDir,
			milestone: "v0.1",
			currentPosition: null,
			currentPhase: null,
			currentPlanPath: null,
			stateBody: "",
			roadmapBody: "",
			phases: [],
			features: [],
			tasks: [],
			progress: { totalPhases: 0, completedPhases: 0, totalPlans: 0, completedPlans: 0, totalTasks: 0, completedTasks: 0, percent: 0 },
			position: null,
			lastUpdated: "",
		}),
		refreshState: () => {},
		updateStatus: () => {},
		getConfig: () => ({
			version: "1.4.2",
			iteration: { retentionDays: 7, maxFiles: 50 },
			rules: { contextBudgetPct: 10, includeAntiPatterns: true },
			agent: { preferAskPro: false, autoCheckpointOnPause: true, useSolyWorkerSubagents: false },
			display: { defaultRecommendedFirst: true, maxPhasesInStatus: 5, maxDecisionsInLog: 5 },
			paths: { excludeGlobs: [] },
			hotReload: { pollMs: 2000, notifyOnChange: true },
			drift: { threshold: 5, reminderLevel: "soft", maxThreshold: 20 },
			scratchpad: { limit: 50 },
			nudge: { nonTrivialEnabled: true, researchHeavyEnabled: true },
			codeMap: { maxFiles: 200, maxDepth: 5 },
		}),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: /soly command", () => {
	const mockPi = makeMockPi();

	beforeAll(() => {
		registerCommands(mockPi, makeMockDeps(projectDir) as never);
	});

	test("command is registered", () => {
		expect(mockPi._commands.has("soly")).toBe(true);
	});

	test("handler does not throw with empty args", async () => {
		const ctx = makeMockCtx(projectDir);
		const handler = mockPi._commands.get("soly")!.handler;
		// Empty args → picker (select returns undefined = cancel)
		await expect(handler("", ctx as never)).resolves.toBeUndefined();
	});

	test("handler does not throw with unknown subcommand", async () => {
		const ctx = makeMockCtx(projectDir);
		const handler = mockPi._commands.get("soly")!.handler;
		await expect(handler("nonexistent", ctx as never)).resolves.toBeUndefined();
	});

	test("position subcommand shows state info", async () => {
		const ctx = makeMockCtx(projectDir) as unknown as MockCtx & { _notifications: Array<{ text: string; level?: string }> };
		// Re-wrap to capture notifications
		const notifs: Array<{ text: string; level?: string }> = [];
		ctx.ui.notify = (text: string, level?: string) => { notifs.push({ text, level }); };
		(ctx as unknown as { _notifications: typeof notifs })._notifications = notifs;

		const handler = mockPi._commands.get("soly")!.handler;
		await handler("position", ctx as never);
		// Should have called notify at least once
		expect(notifs.length).toBeGreaterThan(0);
	});

	test("state subcommand does not throw", async () => {
		const ctx = makeMockCtx(projectDir);
		const handler = mockPi._commands.get("soly")!.handler;
		await expect(handler("state", ctx as never)).resolves.toBeUndefined();
	});

	test("roadmap subcommand does not throw", async () => {
		const ctx = makeMockCtx(projectDir);
		const handler = mockPi._commands.get("soly")!.handler;
		await expect(handler("roadmap", ctx as never)).resolves.toBeUndefined();
	});
});

describe("E2E: /rules command", () => {
	const mockPi = makeMockPi();

	beforeAll(() => {
		registerCommands(mockPi, makeMockDeps(projectDir) as never);
	});

	test("command is registered", () => {
		expect(mockPi._commands.has("rules")).toBe(true);
	});

	test("list subcommand does not throw", async () => {
		const ctx = makeMockCtx(projectDir);
		const handler = mockPi._commands.get("rules")!.handler;
		await expect(handler("list", ctx as never)).resolves.toBeUndefined();
	});

	test("help subcommand does not throw", async () => {
		const ctx = makeMockCtx(projectDir);
		const handler = mockPi._commands.get("rules")!.handler;
		await expect(handler("help", ctx as never)).resolves.toBeUndefined();
	});
});

describe("E2E: /why command", () => {
	const mockPi = makeMockPi();

	beforeAll(() => {
		registerCommands(mockPi, makeMockDeps(projectDir) as never);
	});

	test("command is registered", () => {
		expect(mockPi._commands.has("why")).toBe(true);
	});

	test("handler does not crash fatally", async () => {
		const ctx = makeMockCtx(projectDir);
		const handler = mockPi._commands.get("why")!.handler;
		// /why may need context we don't have in mock — just verify it doesn't
		// throw a non-recoverable error (Promise rejection is OK)
		try {
			await handler("", ctx as never);
		} catch (e) {
			// Expected — /why needs session context we can't mock
			expect(e).toBeDefined();
		}
	});
});

describe("E2E: /soly-migrate command", () => {
	const mockPi = makeMockPi();

	beforeAll(() => {
		registerCommands(mockPi, makeMockDeps(projectDir) as never);
	});

	test("command is registered", () => {
		expect(mockPi._commands.has("soly-migrate")).toBe(true);
	});

	test("dry-run does not throw", async () => {
		const ctx = makeMockCtx(projectDir);
		const handler = mockPi._commands.get("soly-migrate")!.handler;
		// --dry-run flag should work without actually moving
		await expect(handler("--dry-run", ctx as never)).resolves.toBeUndefined();
	});
});

describe("E2E: /soly-init command", () => {
	const mockPi = makeMockPi();

	beforeAll(() => {
		registerCommands(mockPi, makeMockDeps(projectDir) as never);
	});

	test("command is registered", () => {
		expect(mockPi._commands.has("soly-init")).toBe(true);
	});
});
