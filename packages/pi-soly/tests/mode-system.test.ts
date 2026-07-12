// =============================================================================
// tests/mode-system.test.ts — mode resolver + auto-detect + writeConfig
// =============================================================================

import { describe, test, expect, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	resolveMode,
	autoDetectMode,
	writeModeConfig,
	MODE_CONFIG_VERSION,
	defaultPlansDir,
	type ResolvedMode,
} from "../config-mode.ts";

function makeTempCwd(): string {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "soly-mode-"));
	// Pre-create .agents so child writeFileSync calls don't need {recursive:true}
	fs.mkdirSync(path.join(cwd, ".agents"), { recursive: true });
	return cwd;
}

function makeTempHome(): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "soly-home-"));
	// Simulate the XDG-style home layout pi uses: ~/.pi
	fs.mkdirSync(path.join(home, ".pi"), { recursive: true });
	return home;
}

describe("autoDetectMode", () => {
	test("returns 'phases' when STATE.md exists", () => {
		const cwd = makeTempCwd();
		fs.mkdirSync(path.join(cwd, ".agents"), { recursive: true });
		fs.writeFileSync(path.join(cwd, ".agents", "STATE.md"), "# State\n");
		expect(autoDetectMode(cwd)).toBe("phases");
	});

	test("returns 'phases' when ROADMAP.md exists", () => {
		const cwd = makeTempCwd();
		fs.mkdirSync(path.join(cwd, ".agents"), { recursive: true });
		fs.writeFileSync(path.join(cwd, ".agents", "ROADMAP.md"), "# Roadmap\n");
		expect(autoDetectMode(cwd)).toBe("phases");
	});

	test("returns 'plans' when neither file exists", () => {
		const cwd = makeTempCwd();
		expect(autoDetectMode(cwd)).toBe("plans");
	});

	test("returns 'plans' when .agents does not exist", () => {
		const cwd = makeTempCwd();
		expect(autoDetectMode(cwd)).toBe("plans");
	});
});

describe("resolveMode — chain order", () => {
	let cwd: string;
	let home: string;

	beforeEach(() => {
		cwd = makeTempCwd();
		home = makeTempHome();
	});

	test("falls through to auto-detect when no config files exist", () => {
		const r: ResolvedMode = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("auto-detect");
		expect(r.needsPicker).toBe(true);
		expect(r.mode).toBe("plans"); // empty repo → plans
		expect(r.plansDir).toBe(".pi/plans");
	});

	test("user-global wins when ~/.pi/soly.user.json exists", () => {
		fs.writeFileSync(
			path.join(home, ".pi", "soly.user.json"),
			JSON.stringify({ version: MODE_CONFIG_VERSION, mode: "phases" }),
		);
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("user-global");
		expect(r.mode).toBe("phases");
		expect(r.needsPicker).toBe(false);
	});

	test("user-repo wins over repo-default", () => {
		fs.writeFileSync(
			path.join(cwd, ".agents", "soly.config.json"),
			JSON.stringify({ version: MODE_CONFIG_VERSION, mode: "phases" }),
		);
		fs.writeFileSync(
			path.join(cwd, ".agents", "soly.local.json"),
			JSON.stringify({ version: MODE_CONFIG_VERSION, mode: "plans" }),
		);
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("user-repo");
		expect(r.mode).toBe("plans");
	});

	test("user-global wins over user-repo (global is highest priority)", () => {
		fs.writeFileSync(
			path.join(home, ".pi", "soly.user.json"),
			JSON.stringify({ version: MODE_CONFIG_VERSION, mode: "phases" }),
		);
		fs.writeFileSync(
			path.join(cwd, ".agents", "soly.local.json"),
			JSON.stringify({ version: MODE_CONFIG_VERSION, mode: "plans" }),
		);
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("user-global");
		expect(r.mode).toBe("phases");
	});

	test("repo-default is the lowest non-detect layer", () => {
		fs.writeFileSync(
			path.join(cwd, ".agents", "soly.config.json"),
			JSON.stringify({ version: MODE_CONFIG_VERSION, mode: "phases" }),
		);
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("repo-default");
		expect(r.mode).toBe("phases");
	});

	test("custom plansDir in config is honored", () => {
		fs.writeFileSync(
			path.join(cwd, ".agents", "soly.config.json"),
			JSON.stringify({ version: MODE_CONFIG_VERSION, mode: "plans", plansDir: "/tmp/soly-plans" }),
		);
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.plansDir).toBe("/tmp/soly-plans");
	});

	test("malformed config falls back to default with warning", () => {
		fs.writeFileSync(path.join(cwd, ".agents", "soly.config.json"), "{ invalid json");
		const r = resolveMode(cwd, { homeDir: home });
		// The file's readConfigFile falls through to default, returning a warning.
		// We still try repo-default. But the repo-default file was malformed,
		// so we fall through to auto-detect.
		expect(r.source).toBe("auto-detect");
		expect(r.warnings.some((w) => w.includes("invalid JSON"))).toBe(true);
	});

	test("version mismatch falls back to default with warning", () => {
		fs.writeFileSync(
			path.join(cwd, ".agents", "soly.config.json"),
			JSON.stringify({ version: 999, mode: "phases" }),
		);
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("auto-detect");
		expect(r.warnings.some((w) => w.includes("version mismatch"))).toBe(true);
	});

	test("invalid mode value falls back to default with warning", () => {
		fs.writeFileSync(
			path.join(cwd, ".agents", "soly.config.json"),
			JSON.stringify({ version: MODE_CONFIG_VERSION, mode: "weird" }),
		);
		const r = resolveMode(cwd, { homeDir: home });
		expect(r.source).toBe("auto-detect");
		expect(r.warnings.some((w) => w.includes("invalid mode"))).toBe(true);
	});
});

describe("writeModeConfig", () => {
	let cwd: string;
	let home: string;

	beforeEach(() => {
		cwd = makeTempCwd();
		home = makeTempHome();
	});

	test("writes user-global to ~/.pi/soly.user.json", () => {
		const result = writeModeConfig("user-global", cwd, { mode: "plans", plansDir: ".pi/plans" }, { homeDir: home });
		expect(result.path).toBe(path.join(home, ".pi", "soly.user.json"));
		const content = JSON.parse(fs.readFileSync(result.path, "utf-8"));
		expect(content.mode).toBe("plans");
		expect(content.version).toBe(MODE_CONFIG_VERSION);
		expect(content.plansDir).toBe(".pi/plans");
	});

	test("writes user-repo to .agents/soly.local.json + updates .gitignore", () => {
		const result = writeModeConfig("user-repo", cwd, { mode: "phases" }, { homeDir: home });
		expect(result.path).toBe(path.join(cwd, ".agents", "soly.local.json"));
		const content = JSON.parse(fs.readFileSync(result.path, "utf-8"));
		expect(content.mode).toBe("phases");
		// .gitignore should now include the local config
		const gi = fs.readFileSync(path.join(cwd, ".gitignore"), "utf-8");
		expect(gi).toContain(".agents/soly.local.json");
	});

	test("writes repo-default to .agents/soly.config.json (no gitignore touch)", () => {
		const result = writeModeConfig("repo-default", cwd, { mode: "plans" }, { homeDir: home });
		expect(result.path).toBe(path.join(cwd, ".agents", "soly.config.json"));
		// .gitignore should NOT have been created or touched
		expect(fs.existsSync(path.join(cwd, ".gitignore"))).toBe(false);
	});
});

describe("defaultPlansDir", () => {
	test("returns .pi/plans for plans mode", () => {
		expect(defaultPlansDir("plans")).toBe(".pi/plans");
	});
	test("returns .agents/plans for phases mode", () => {
		expect(defaultPlansDir("phases")).toBe(".agents/plans");
	});
});
