// =============================================================================
// tests/init.test.ts — Tests for soly init scaffold
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initSolyProject, type InitUI } from "../init.js";

let tmpRoot: string;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soly-init-"));
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeUi(opts: {
	template?: string;
	confirm?: boolean;
} = {}): InitUI & {
	calls: Array<{ type: string; text: string }>;
} {
	const calls: Array<{ type: string; text: string }> = [];
	return {
		calls,
		notify: (text: string) => { calls.push({ type: "notify", text }); },
		select: async (_label: string, options: string[]) => opts.template ?? options[0] ?? null,
		confirm: async () => opts.confirm ?? true,
		input: async () => null,
	} as never;
}

function makeEmptyProject(): string {
	const dir = fs.mkdtempSync(path.join(tmpRoot, "project-"));
	return dir;
}

describe("initSolyProject", () => {
	test("creates .agents/ structure (minimal template)", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "minimal" });
		const result = await initSolyProject(dir, ui, { autoYes: true, template: "minimal" });
		expect(result.created).toBe(true);
		expect(result.template).toBe("minimal");
		// Core files exist
		expect(fs.existsSync(path.join(dir, ".agents", "ROADMAP.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "STATE.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "HANDOFF.json"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "docs", "vision.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "rules", "code-style.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "phases", ".gitkeep"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "iterations", ".gitkeep"))).toBe(true);
		// Top-level AGENTS.md
		expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
		// No template-specific extras for minimal
		expect(fs.existsSync(path.join(dir, ".agents", "rules", "routing.md"))).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("web-app template adds routing + auth rules", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "web-app" });
		await initSolyProject(dir, ui, { autoYes: true, template: "web-app" });
		expect(fs.existsSync(path.join(dir, ".agents", "rules", "routing.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "rules", "auth.md"))).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("library template adds publishing + testing rules", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "library" });
		await initSolyProject(dir, ui, { autoYes: true, template: "library" });
		expect(fs.existsSync(path.join(dir, ".agents", "rules", "publishing.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "rules", "testing.md"))).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("cli template adds commands + flags rules", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "cli" });
		await initSolyProject(dir, ui, { autoYes: true, template: "cli" });
		expect(fs.existsSync(path.join(dir, ".agents", "rules", "commands.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".agents", "rules", "flags.md"))).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("aborts when .agents/ or .soly/ already exists", async () => {
		const dir = makeEmptyProject();
		fs.mkdirSync(path.join(dir, ".agents"), { recursive: true });
		const ui = makeUi();
		const result = await initSolyProject(dir, ui, { autoYes: true, template: "minimal" });
		expect(result.created).toBe(false);
		expect(ui.calls.some((c) => c.type === "notify" && c.text.includes("already initialized"))).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("aborts when .soly/ exists (legacy project)", async () => {
		const dir = makeEmptyProject();
		fs.mkdirSync(path.join(dir, ".soly"), { recursive: true });
		const ui = makeUi();
		const result = await initSolyProject(dir, ui, { autoYes: true, template: "minimal" });
		expect(result.created).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("user cancels via template picker → no create", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "" }); // empty = cancel
		const result = await initSolyProject(dir, ui);
		expect(result.created).toBe(false);
		expect(fs.existsSync(path.join(dir, ".agents"))).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("user cancels via confirm → no create", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "minimal", confirm: false });
		const result = await initSolyProject(dir, ui);
		expect(result.created).toBe(false);
		expect(fs.existsSync(path.join(dir, ".agents"))).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("uses projectName in STATE.md when provided", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "minimal" });
		await initSolyProject(dir, ui, {
			autoYes: true,
			template: "minimal",
			projectName: "my-cool-app",
		});
		const state = fs.readFileSync(path.join(dir, ".agents", "STATE.md"), "utf-8");
		expect(state).toContain("my-cool-app");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("ROADMAP.md has 1 phase: bootstrap", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "minimal" });
		await initSolyProject(dir, ui, { autoYes: true, template: "minimal" });
		const roadmap = fs.readFileSync(path.join(dir, ".agents", "ROADMAP.md"), "utf-8");
		expect(roadmap).toContain("01");
		expect(roadmap).toContain("bootstrap");
		expect(roadmap).toContain("/plan 1");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("AGENTS.md at project root mentions soly commands", async () => {
		const dir = makeEmptyProject();
		const ui = makeUi({ template: "minimal" });
		await initSolyProject(dir, ui, { autoYes: true, template: "minimal" });
		const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8");
		expect(agents).toContain("/plan");
		expect(agents).toContain("/execute");
		expect(agents).toContain("/plan");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("does not overwrite existing files (idempotent)", async () => {
		const dir = makeEmptyProject();
		fs.writeFileSync(path.join(dir, "AGENTS.md"), "# My custom agents doc");
		const ui = makeUi({ template: "minimal" });
		await initSolyProject(dir, ui, { autoYes: true, template: "minimal" });
		const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8");
		expect(agents).toContain("My custom");
		expect(agents).not.toContain("soly");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
