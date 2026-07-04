// =============================================================================
// tests/workflow-tool.test.ts — the first-party `soly_workflow` LLM tool
// =============================================================================
//
// The tool lets the model drive the soly lifecycle itself (no external
// subagent plugin). It reuses the same builders as the plain-text verbs and
// returns the instruction as tool-result content, which the model follows
// inline. These tests cover the dispatch + the "no subagent" guarantee.
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { registerWorkflowTool, WORKFLOW_ACTIONS } from "../workflows/llm-tools.ts";
import { DEFAULT_CONFIG } from "../config.ts";
import type { SolyState } from "../core.js";

type ToolDef = {
	name: string;
	execute: (
		id: string,
		params: { action: string; target?: string },
		signal: unknown,
		onUpdate: unknown,
		ctx: { cwd: string; ui: { notify: () => void }; hasUI: boolean; mode: string },
	) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
};

function initRepo(): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "soly-wftool-"));
	execFileSync("git", ["init", "-q"], { cwd: tmp });
	execFileSync("git", ["config", "user.email", "t@t"], { cwd: tmp });
	execFileSync("git", ["config", "user.name", "t"], { cwd: tmp });
	const solyDir = path.join(tmp, ".agents");
	fs.mkdirSync(solyDir, { recursive: true });
	fs.writeFileSync(path.join(solyDir, "STATE.md"), "# STATE");
	fs.writeFileSync(path.join(solyDir, "ROADMAP.md"), "# ROADMAP");
	// Commit so the working tree is clean — `new` refuses to scaffold otherwise.
	execFileSync("git", ["add", "."], { cwd: tmp });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
	return tmp;
}

function fakeState(solyDir: string): SolyState {
	return {
		solyDir,
		exists: true,
		milestone: "—",
		milestoneName: "",
		status: "in-progress",
		lastUpdated: "",
		progress: { totalPhases: 0, completedPhases: 0, totalPlans: 0, completedPlans: 0, percent: 0 },
		position: null,
		currentPhase: null,
		currentPlanPath: null,
		stateBody: "",
		roadmapBody: "",
		phases: [],
		features: [],
		tasks: [],
	};
}

function makeTool(tmp: string) {
	const state = fakeState(path.join(tmp, ".agents"));
	const captured = { workflowUsed: 0, verbLabel: null as string | null };
	let def: ToolDef | null = null;
	const pi = {
		registerTool: (d: ToolDef) => {
			if (d.name === "soly_workflow") def = d;
		},
	} as unknown as Parameters<typeof registerWorkflowTool>[0];
	registerWorkflowTool(pi, {
		getState: () => state,
		getInteractiveRules: () => [],
		getActiveTools: () => ["ask_pro"],
		getConfig: () => DEFAULT_CONFIG,
		onWorkflowUsed: () => {
			captured.workflowUsed++;
		},
		setVerbLabel: (v) => {
			captured.verbLabel = v;
		},
	});
	const ctx = { cwd: tmp, ui: { notify: () => {} }, hasUI: true, mode: "tui" };
	return { def: def!, ctx, captured };
}

describe("soly_workflow tool", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = initRepo();
	});
	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	test("registers a tool named soly_workflow with the lifecycle actions", () => {
		const { def } = makeTool(tmp);
		expect(def.name).toBe("soly_workflow");
		expect([...WORKFLOW_ACTIONS]).toEqual(["new", "discuss", "plan", "execute", "done"]);
	});

	test("execute action returns an INLINE instruction — never a subagent call", async () => {
		// A fleshed-out plan on disk.
		const planDir = path.join(tmp, ".agents", "plans", "auth-jwt");
		fs.mkdirSync(planDir, { recursive: true });
		fs.writeFileSync(path.join(planDir, "PLAN.md"), "# Plan: auth-jwt\n\n## Goal\nShip JWT auth\n");
		const { def, ctx, captured } = makeTool(tmp);

		const res = await def.execute("id1", { action: "execute", target: "auth-jwt" }, null, null, ctx);
		const text = res.content.map((c) => c.text).join("\n");

		expect(text).toContain(".agents/plans/auth-jwt/PLAN.md");
		expect(text.toLowerCase()).toContain("inline");
		expect(text).not.toContain("subagent(");
		expect(text).not.toContain("Do NOT do the work inline");
		// Bookkeeping: fires the drift reset + sets the mode label.
		expect(captured.workflowUsed).toBe(1);
		expect(captured.verbLabel).toBe("execute");
	});

	test("plan action points at the plan file and does not delegate", async () => {
		const planDir = path.join(tmp, ".agents", "plans", "auth-jwt");
		fs.mkdirSync(planDir, { recursive: true });
		fs.writeFileSync(path.join(planDir, "PLAN.md"), "# Plan: auth-jwt\n\n## Goal\nTBD\n");
		const { def, ctx } = makeTool(tmp);

		const res = await def.execute("id2", { action: "plan", target: "auth-jwt" }, null, null, ctx);
		const text = res.content.map((c) => c.text).join("\n");
		expect(text).toContain(".agents/plans/auth-jwt/PLAN.md");
		expect(text).not.toContain("subagent(");
	});

	test("new action scaffolds a branch + stub PLAN.md via the shared builder", async () => {
		const { def, ctx } = makeTool(tmp);
		const res = await def.execute("id3", { action: "new", target: "auth-jwt" }, null, null, ctx);
		const text = res.content.map((c) => c.text).join("\n");
		// buildNewTransform created the plan dir on a new branch.
		expect(fs.existsSync(path.join(tmp, ".agents", "plans", "auth-jwt", "PLAN.md"))).toBe(true);
		expect(text).toContain("auth-jwt");
	});
});
