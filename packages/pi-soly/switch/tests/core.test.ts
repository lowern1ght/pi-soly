// =============================================================================
// tests/core.test.ts — Tests for pi-switch core
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_AGENT,
	BUILTIN_AGENTS,
	AGENT_META,
	getAgentMeta,
	isValidAgentName,
	discoverUserAgents,
	availableAgents,
	nextAgent,
	parseAgentName,
	formatAgentBadge,
	formatAgentSwitchNotify,
	formatHeaderLine,
	groupedAvailableAgents,
	agentFilePath,
	loadAgent,
	saveAgent,
} from "../core.js";

describe("DEFAULT_AGENT", () => {
	test("is 'worker'", () => {
		expect(DEFAULT_AGENT).toBe("worker");
	});
});

describe("isValidAgentName", () => {
	test("accepts simple names", () => {
		expect(isValidAgentName("worker")).toBe(true);
		expect(isValidAgentName("my_agent")).toBe(true);
	});
	test("rejects invalid", () => {
		expect(isValidAgentName("with space")).toBe(false);
		expect(isValidAgentName("")).toBe(false);
		expect(isValidAgentName("a".repeat(65))).toBe(false);
	});
});

describe("AGENT_META", () => {
	test("every built-in has metadata", () => {
		for (const a of BUILTIN_AGENTS) {
			expect(AGENT_META[a]).toBeDefined();
			expect(AGENT_META[a]!.emoji.length).toBeGreaterThan(0);
		}
	});
	test("meta has writesFiles flag", () => {
		expect(AGENT_META.worker!.writesFiles).toBe(true);
		expect(AGENT_META.oracle!.writesFiles).toBe(false);
	});
});

describe("getAgentMeta", () => {
	test("returns fallback for unknown", () => {
		const m = getAgentMeta("zzz");
		expect(m.emoji.length).toBeGreaterThan(0);
	});
});

describe("nextAgent", () => {
	test("cycles forward", () => {
		expect(nextAgent("a", ["a", "b", "c"])).toBe("b");
		expect(nextAgent("c", ["a", "b", "c"])).toBe("a");
	});
	test("returns first if current not in cycle", () => {
		expect(nextAgent("zzz", ["a", "b"])).toBe("a");
	});
});

describe("parseAgentName", () => {
	test("trims and validates", () => {
		expect(parseAgentName("  oracle  ")).toBe("oracle");
		expect(parseAgentName("with space")).toBeNull();
	});
});

describe("formatAgentBadge", () => {
	test("null for default", () => {
		expect(formatAgentBadge(DEFAULT_AGENT)).toBeNull();
	});
	test("emoji + name for non-default", () => {
		const b = formatAgentBadge("oracle");
		expect(b).toContain("oracle");
	});
});

describe("formatAgentSwitchNotify", () => {
	test("multi-line: old → new + capability", () => {
		const out = formatAgentSwitchNotify("worker", "oracle");
		expect(out).toContain("pi-switch agent changed");
		expect(out).toContain("worker");
		expect(out).toContain("oracle");
		expect(out).toContain("writes files: no");
	});
});

describe("formatHeaderLine", () => {
	test("always non-empty (even for default)", () => {
		const h = formatHeaderLine("worker");
		expect(h).toContain("worker");
		expect(h).toContain("Ctrl+Tab");
	});
	test("includes read-only tag when applicable", () => {
		const h = formatHeaderLine("oracle");
		expect(h).toContain("read-only");
	});
	test("omits read-only tag when agent writes", () => {
		const h = formatHeaderLine("worker");
		expect(h).not.toContain("read-only");
	});
});

describe("groupedAvailableAgents", () => {
	test("includes built-in group", () => {
		const groups = groupedAvailableAgents("/nonexistent");
		expect(groups[0]?.header).toBe("built-in");
	});
	test("includes user group when present", () => {
		// Use HOME override so the new ~.agents/agents/ scan picks up our fixture
		const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
		const prevHome = process.env.HOME;
		const prevUserProfile = process.env.USERPROFILE;
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pis-home-"));
		process.env.HOME = tmp;
		process.env.USERPROFILE = tmp;
		const agentsDir = path.join(tmp, ".agents", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(path.join(agentsDir, "my.md"), "---\nname: my-helper\n---\n# body\n");
		const groups = groupedAvailableAgents();
		const userGroup = groups.find((g) => g.header === "user-defined");
		expect(userGroup?.agents).toContain("my-helper");
		// restore
		process.env.HOME = prevHome ?? home;
		process.env.USERPROFILE = prevUserProfile ?? home;
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	test("includes project agent when present (cwd scope)", () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pis-proj-"));
		const agentsDir = path.join(projectDir, ".agents", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(path.join(agentsDir, "proj.md"), "---\nname: project-helper\n---\n# body\n");
		const groups = groupedAvailableAgents(projectDir);
		const userGroup = groups.find((g) => g.header === "user-defined");
		expect(userGroup?.agents).toContain("project-helper");
		fs.rmSync(projectDir, { recursive: true, force: true });
	});
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("agentFilePath", () => {
	test("prefers .soly/agent when soly dir exists", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pis-path-"));
		fs.mkdirSync(path.join(cwd, ".soly"), { recursive: true });
		expect(agentFilePath(cwd)).toBe(path.join(cwd, ".soly", "agent"));
		fs.rmSync(cwd, { recursive: true, force: true });
	});
	test("falls back to ~/.pi-switch/agent when no soly", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pis-fb-"));
		// Ensure no .soly in cwd
		expect(agentFilePath(cwd)).toContain(".pi-switch");
		fs.rmSync(cwd, { recursive: true, force: true });
	});
});

describe("loadAgent / saveAgent", () => {
	let tmpCwd: string;
	let origHome: string | undefined;
	beforeAll(() => {
		tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pis-rt-"));
		origHome = process.env.HOME;
		process.env.HOME = tmpCwd;
	});
	afterAll(() => {
		if (origHome) process.env.HOME = origHome;
		fs.rmSync(tmpCwd, { recursive: true, force: true });
	});

	test("round-trip", () => {
		saveAgent(tmpCwd, "oracle");
		expect(loadAgent(tmpCwd)).toBe("oracle");
	});
	test("returns null when file missing", () => {
		const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), "pis-fresh-"));
		fs.mkdirSync(path.join(freshHome, ".pi-switch"), { recursive: true });
		const prevHome = process.env.HOME;
		process.env.HOME = freshHome;
		try {
			expect(loadAgent("/anywhere")).toBeNull();
		} finally {
			process.env.HOME = prevHome;
		}
		fs.rmSync(freshHome, { recursive: true, force: true });
	});
	test("rejects invalid name on load", () => {
		const file = agentFilePath(tmpCwd);
		fs.writeFileSync(file, "with space\n", "utf-8");
		expect(loadAgent(tmpCwd)).toBeNull();
	});
});
