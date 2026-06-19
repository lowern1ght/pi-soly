// =============================================================================
// tests/visual.test.ts — soly chrome (Phase 2 visual) unit tests
// =============================================================================
//
// Covers the pure, deterministic layer: token/path/elapsed formatting,
// width-aware segment composition + priority dropping, the working telemetry
// line, ctx% color roles, and the footer/top-bar segment builders (via the
// identity styler so column math is exact). Component classes are thin
// wrappers over these builders and need no TUI to test.
// =============================================================================

import { describe, expect, test } from "bun:test";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { createChrome } from "../visual/chrome.ts";
import { formatTokens, formatCwd, fitPath, formatElapsed } from "../visual/format.ts";
import { composeBar, fitParts, type Segment } from "../visual/segments.ts";
import { buildWorkingMessage } from "../visual/working.ts";
import { ctxColor } from "../visual/colors.ts";
import { identityStyler } from "../visual/style.ts";
import { buildFooterLine, type FooterData } from "../visual/footer.ts";
import { buildTopBarLines } from "../visual/topbar.ts";
import { buildWelcomeLines, parseRecentChanges, SOLY_ART, type WelcomeInput } from "../visual/welcome.ts";
import { hexToRgb, gradient, fgAnsi, colorizeColumns, xterm256ToRgb, parseAnsiColor, variations } from "../visual/gradient.ts";
import { emptyChromeData } from "../visual/data.ts";
import { DEFAULT_CONFIG } from "../config.ts";

describe("format", () => {
	test("formatTokens tiers", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(-5)).toBe("0");
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(12_400)).toBe("12k");
		expect(formatTokens(1_200_000)).toBe("1.2M");
	});

	test("formatCwd returns ~ at home and absolute outside home", () => {
		expect(formatCwd("/home/u", "/home/u")).toBe("~");
		expect(formatCwd("/var/log", "/home/u")).toBe("/var/log");
		expect(formatCwd("/anything", undefined)).toBe("/anything");
	});

	test("fitPath shrinks through tiers and never exceeds maxWidth", () => {
		const cwd = "/a/b/c/pi-soly-framework";
		expect(fitPath(cwd, "/a/b", 0)).toBe("");
		const wide = fitPath(cwd, "/a/b", 100);
		expect(wide.includes("pi-soly-framework")).toBe(true);
		const mid = fitPath(cwd, "/a/b", 20);
		expect(mid.length).toBeLessThanOrEqual(20);
		expect(mid.includes("pi-soly-framework")).toBe(true);
		const narrow = fitPath(cwd, "/a/b", 6);
		expect(narrow.length).toBeLessThanOrEqual(6);
	});

	test("formatElapsed floors to seconds", () => {
		expect(formatElapsed(8400)).toBe("8s");
		expect(formatElapsed(-10)).toBe("0s");
	});
});

describe("segments.composeBar", () => {
	const opts = { sep: " · ", fillChar: "-", styleFill: (s: string) => s };

	test("fills the gap and produces an exact-width line", () => {
		const left: Segment[] = [{ id: "a", text: "AAAA", priority: 9 }];
		const right: Segment[] = [{ id: "b", text: "BB", priority: 5 }];
		const line = composeBar({ ...opts, left, right, width: 20 });
		expect(visibleWidth(line)).toBe(20);
		expect(line.startsWith("AAAA")).toBe(true);
		expect(line.endsWith("BB")).toBe(true);
		expect(line.includes("-")).toBe(true);
	});

	test("drops the lowest-priority segment when too narrow", () => {
		const left: Segment[] = [{ id: "keep", text: "AAAAAAAA", priority: 9 }];
		const right: Segment[] = [{ id: "drop", text: "BBBB", priority: 2 }];
		const line = composeBar({ ...opts, left, right, width: 8 });
		expect(line).toBe("AAAAAAAA");
	});

	test("right-only / left-only still fit", () => {
		const line = composeBar({ ...opts, left: [{ id: "x", text: "HELLO", priority: 1 }], right: [], width: 10 });
		expect(line).toBe("HELLO");
	});
});

describe("segments.fitParts", () => {
	test("drops low-priority parts to fit width", () => {
		const parts: Segment[] = [
			{ id: "label", text: "Working", priority: 5 },
			{ id: "time", text: "8s", priority: 4 },
			{ id: "tokens", text: "up 12k", priority: 3 },
			{ id: "rate", text: "148 tok/s", priority: 2 },
		];
		expect(fitParts(parts, 100)).toBe("Working · 8s · up 12k · 148 tok/s");
		expect(fitParts(parts, 12)).toBe("Working · 8s");
		const tiny = fitParts(parts, 3); // single part, still too wide → truncated w/ ellipsis
		expect(visibleWidth(tiny)).toBeLessThanOrEqual(3);
		expect(tiny.includes("…")).toBe(true);
	});
});

describe("working.buildWorkingMessage", () => {
	test("full telemetry line", () => {
		const msg = buildWorkingMessage(
			{ label: "Working", elapsedMs: 8000, inputTokens: 12_400, outputTokens: 1200 },
			120,
		);
		expect(msg.includes("Working")).toBe(true);
		expect(msg.includes("8s")).toBe(true);
		expect(msg.includes("↑12k")).toBe(true);
		expect(msg.includes("↓1.2k")).toBe(true);
		expect(msg.includes("150 tok/s")).toBe(true);
	});

	test("drops fields on a narrow terminal", () => {
		const msg = buildWorkingMessage(
			{ label: "Working", elapsedMs: 8000, inputTokens: 12_400, outputTokens: 1200 },
			14,
		);
		expect(msg).toBe("Working · 8s");
	});

	test("omits rate before the first second / output", () => {
		const msg = buildWorkingMessage({ label: "Working", elapsedMs: 0, inputTokens: 0, outputTokens: 0 }, 120);
		expect(msg).toBe("Working · 0s");
	});
});

describe("colors.ctxColor", () => {
	test("thresholds match pi's footer", () => {
		expect(ctxColor(95)).toBe("error");
		expect(ctxColor(80)).toBe("warning");
		expect(ctxColor(50)).toBe("muted");
		expect(ctxColor(null)).toBe("muted");
	});
});

function fakeFooterData(branch: string | null, statuses: Record<string, string>): FooterData {
	return {
		getGitBranch: () => branch,
		getExtensionStatuses: () => new Map(Object.entries(statuses)),
		getAvailableProviderCount: () => 1,
	};
}

describe("footer.buildFooterLine", () => {
	test("renders phase, ctx%, git, rules, foreign ext statuses; excludes own 'soly' key", () => {
		const data = emptyChromeData();
		data.ctxPercent = 34;
		data.ctxTokens = 12_400;
		data.cwd = "/home/u/proj";
		data.home = "/home/u";
		data.modelId = "opus";
		data.phaseLabel = "plan 1/3";
		data.rulesActive = 4;
		const fd = fakeFooterData("master", { soly: "SOLY-STATUS", mcp: "MCP-OK" });
		const line = buildFooterLine(data, fd, 200, { ascii: true, styler: identityStyler });
		expect(line.includes("plan 1/3")).toBe(true);
		expect(line.includes("34%")).toBe(true);
		expect(line.includes("git: master")).toBe(true);
		expect(line.includes("4 rules")).toBe(true);
		expect(line.includes("MCP-OK")).toBe(true);
		expect(line.includes("SOLY-STATUS")).toBe(false);
		expect(line.includes("↑12k")).toBe(true);
		expect(line.includes("opus")).toBe(true); // no active verb → model lives in footer
	});

	test("shows model in footer when no verb is active", () => {
		const data = emptyChromeData();
		data.ctxPercent = 10;
		data.modelId = "opus";
		const fd = fakeFooterData(null, {});
		const line = buildFooterLine(data, fd, 120, { ascii: true, styler: identityStyler });
		expect(line.includes("opus")).toBe(true);
	});

	test("omits model from footer when a verb is active (top bar shows it)", () => {
		const data = emptyChromeData();
		data.modelId = "opus";
		data.verbLabel = "execute";
		const fd = fakeFooterData(null, {});
		const line = buildFooterLine(data, fd, 120, { ascii: true, styler: identityStyler });
		expect(line.includes("opus")).toBe(false);
	});

	test("git dirty count renders when present", () => {
		const data = emptyChromeData();
		data.gitDirty = 3;
		const fd = fakeFooterData("master", {});
		const line = buildFooterLine(data, fd, 120, { ascii: true, styler: identityStyler });
		expect(line.includes("master *3")).toBe(true);
	});
});

describe("topbar.buildTopBarLines", () => {
	test("hidden when no verb is active (even with a phase set)", () => {
		const data = emptyChromeData();
		data.phaseLabel = "plan 1/3"; // phase lives in the footer now
		data.modelId = "opus"; // model alone does NOT keep the bar open
		expect(buildTopBarLines(data, 120, { ascii: true, styler: identityStyler })).toEqual([]);
	});

	test("shows the verb + model when a workflow verb is active", () => {
		const data = emptyChromeData();
		data.verbLabel = "execute";
		data.modelId = "opus";
		const lines = buildTopBarLines(data, 120, { ascii: true, styler: identityStyler });
		expect(lines.length).toBe(1);
		expect(lines[0]?.includes("execute")).toBe(true);
		expect(lines[0]?.includes("opus")).toBe(true);
	});
});

describe("welcome", () => {
	const input: WelcomeInput = {
		version: "1.12.0",
		hasProject: true,
		phaseLabel: "plan 2/5",
		nextHint: "→ /execute",
		rulesActive: 4,
		docsCount: 2,
		recent: ["1.11.2  MCP footer", "1.10.0  ask_pro previews"],
	};

	test("parseRecentChanges reads top N version + summary", () => {
		const cl = [
			"# Changelog",
			"",
			"## [1.9.1] — 2026-06-XX",
			"### Changed",
			"- **Removed spammy notification** — tracking preserved.",
			"",
			"## [1.9.0] — 2026-06-XX",
			"### Added",
			"- **`/docs stats`** command — breakdown.",
		].join("\n");
		const r = parseRecentChanges(cl, 2);
		expect(r.length).toBe(2);
		expect(r[0]).toBe("1.9.1  Removed spammy notification");
		expect(r[1]).toBe("1.9.0  /docs stats");
	});

	test("full welcome with textured banner, project state, commands, recent", () => {
		const lines = buildWelcomeLines(input, { ascii: false, styler: identityStyler, width: 120 });
		const text = lines.join("\n");
		// Banner rows are drawn with mixed block glyphs (not a single solid char).
		expect(text.includes("█")).toBe(true);
		expect(text.includes("▓")).toBe(true);
		expect(text.includes("running on pi")).toBe(true);
		expect(text.includes("v1.12.0")).toBe(true);
		expect(text.includes("plan 2/5")).toBe(true);
		expect(text.includes("→ /execute")).toBe(true);
		expect(text.includes("/soly-init")).toBe(true);
		expect(text.includes("1.11.2  MCP footer")).toBe(true);
	});

	test("ascii mode uses the plain wordmark, not the art", () => {
		const lines = buildWelcomeLines(input, { ascii: true, styler: identityStyler, width: 120 });
		expect(lines[0]).toBe("soly");
		expect(lines.join("\n").includes(SOLY_ART[0] ?? "")).toBe(false);
	});

	test("no-project state points to /soly-init", () => {
		const text = buildWelcomeLines(
			{ ...input, hasProject: false },
			{ ascii: true, styler: identityStyler, width: 120 },
		).join("\n");
		expect(text.includes("no soly project here")).toBe(true);
	});

	test("gradient banner emits truecolor ANSI and each row spans full width", () => {
		const lines = buildWelcomeLines(input, {
			ascii: false,
			styler: identityStyler,
			width: 60,
			colorMode: "truecolor",
			colorStops: ["#000000", "#ffffff"],
		});
		expect(lines[0]?.includes("\x1b[38;2;")).toBe(true); // banner row is colored
		expect(visibleWidth(lines[0] ?? "")).toBe(60); // …and fills the width
	});

	test("banner derives its gradient from the theme accent when no stops set", () => {
		const colored = buildWelcomeLines(input, {
			ascii: false,
			styler: identityStyler,
			width: 50,
			colorMode: "truecolor",
			accent: { r: 200, g: 100, b: 20 },
		});
		expect(colored[0]?.includes("\x1b[38;2;")).toBe(true);
	});
});

describe("gradient", () => {
	test("hexToRgb parses #rgb and #rrggbb, rejects junk", () => {
		expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
		expect(hexToRgb("0f0")).toEqual({ r: 0, g: 255, b: 0 });
		expect(hexToRgb("nope")).toBeNull();
	});

	test("gradient samples n colors across stops", () => {
		const g = gradient([{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }], 3);
		expect(g.length).toBe(3);
		expect(g[0]).toEqual({ r: 0, g: 0, b: 0 });
		expect(g[1]).toEqual({ r: 128, g: 128, b: 128 });
		expect(g[2]).toEqual({ r: 255, g: 255, b: 255 });
	});

	test("fgAnsi per color mode", () => {
		expect(fgAnsi({ r: 1, g: 2, b: 3 }, "truecolor")).toBe("\x1b[38;2;1;2;3m");
		expect(fgAnsi({ r: 0, g: 0, b: 0 }, "256color")).toBe("\x1b[38;5;16m");
		expect(fgAnsi({ r: 0, g: 0, b: 0 }, "none")).toBe("");
	});

	test("colorizeColumns: none passes through, truecolor wraps + resets", () => {
		expect(colorizeColumns("ab", [{ r: 1, g: 1, b: 1 }], "none")).toBe("ab");
		const c = colorizeColumns("ab", [{ r: 1, g: 1, b: 1 }, { r: 2, g: 2, b: 2 }], "truecolor");
		expect(c.includes("\x1b[38;2;")).toBe(true);
		expect(c.endsWith("\x1b[0m")).toBe(true);
	});

	test("xterm256ToRgb maps cube endpoints", () => {
		expect(xterm256ToRgb(16)).toEqual({ r: 0, g: 0, b: 0 });
		expect(xterm256ToRgb(231)).toEqual({ r: 255, g: 255, b: 255 });
	});

	test("parseAnsiColor reads truecolor and 256 fg, rejects others", () => {
		expect(parseAnsiColor("\x1b[38;2;10;20;30m")).toEqual({ r: 10, g: 20, b: 30 });
		expect(parseAnsiColor("\x1b[38;5;231m")).toEqual({ r: 255, g: 255, b: 255 });
		expect(parseAnsiColor("\x1b[1m")).toBeNull();
	});

	test("variations returns darker → base → lighter", () => {
		const v = variations({ r: 100, g: 100, b: 100 });
		expect(v.length).toBe(3);
		expect(v[0]!.r).toBeLessThan(100);
		expect(v[1]).toEqual({ r: 100, g: 100, b: 100 });
		expect(v[2]!.r).toBeGreaterThan(100);
	});
});

describe("chrome.install (integration)", () => {
	type RenderFactory = (tui: TUI, theme: Theme, fd?: FooterData) => { render(w: number): string[] };
	type Recorder = {
		footer?: RenderFactory;
		header?: RenderFactory;
		widgets: Map<string, { factory: RenderFactory; placement?: string }>;
		indicator?: { frames?: string[]; intervalMs?: number };
		messages: Array<string | undefined>;
	};

	const tui = { requestRender() {} } as unknown as TUI;
	const theme = {
		fg: (_c: string, t: string) => t,
		bold: (t: string) => t,
		getFgAnsi: () => "",
		getColorMode: () => "truecolor",
	} as unknown as Theme;
	const fd: FooterData = {
		getGitBranch: () => "master",
		getExtensionStatuses: () => new Map(),
		getAvailableProviderCount: () => 1,
	};

	function mkConfig(over: Partial<ReturnType<typeof base>> = {}) {
		function base() {
			return { enabled: true, ascii: true, spinnerFrames: ["a", "b"], spinnerIntervalMs: 90, telemetry: true, bannerColors: [] as string[] };
		}
		return { ...base(), ...over };
	}

	function mkUi(rec: Recorder): ExtensionUIContext {
		const ui = {
			setFooter: (f: RenderFactory) => { rec.footer = f; },
			setWidget: (key: string, f: RenderFactory, opts?: { placement?: string }) =>
				rec.widgets.set(key, { factory: f, placement: opts?.placement }),
			setWorkingIndicator: (o?: { frames?: string[]; intervalMs?: number }) => { rec.indicator = o; },
			setWorkingMessage: (m?: string) => rec.messages.push(m),
			setHeader: (f: RenderFactory) => { rec.header = f; },
		};
		return ui as unknown as ExtensionUIContext;
	}

	function newRec(): Recorder {
		return { widgets: new Map(), messages: [] };
	}

	test("installs footer, top-bar widget and the spinner; both render", () => {
		const rec = newRec();
		const chrome = createChrome(() => mkConfig());
		chrome.install(mkUi(rec));

		expect(rec.indicator?.frames?.length).toBe(2);
		expect(typeof rec.footer).toBe("function");
		const widget = rec.widgets.get("soly-chrome-top");
		expect(widget?.placement).toBe("aboveEditor");

		chrome.data.ctxPercent = 42;
		const footerLines = rec.footer?.(tui, theme, fd).render(80) ?? [];
		expect(footerLines.length).toBe(1);
		expect(footerLines[0]?.includes("42%")).toBe(true);

		const top = widget?.factory(tui, theme);
		expect(top?.render(80)).toEqual([]); // hidden: no verb yet
		chrome.data.verbLabel = "execute";
		chrome.data.modelId = "opus";
		expect(top?.render(80)[0]?.includes("execute")).toBe(true);

		// header is empty until setWelcome, then renders the welcome
		expect(typeof rec.header).toBe("function");
		const header = rec.header?.(tui, theme);
		expect(header?.render(80)).toEqual([]);
		chrome.setWelcome({
			version: "1.0.0",
			hasProject: false,
			phaseLabel: null,
			nextHint: null,
			rulesActive: 0,
			docsCount: 0,
			recent: [],
		});
		expect((header?.render(80) ?? []).join("\n").includes("running on pi")).toBe(true);
	});

	test("disabled config installs nothing", () => {
		const rec = newRec();
		createChrome(() => mkConfig({ enabled: false })).install(mkUi(rec));
		expect(rec.footer).toBeUndefined();
		expect(rec.widgets.size).toBe(0);
	});

	test("working lifecycle sets a telemetry message then restores default", () => {
		const rec = newRec();
		const chrome = createChrome(() => mkConfig());
		const ui = mkUi(rec);
		chrome.data.ctxTokens = 5000;
		chrome.startWorking(ui);
		chrome.updateWorking(ui, 800);
		expect(rec.messages.some((m) => typeof m === "string" && m.includes("Working"))).toBe(true);
		chrome.stopWorking(ui);
		expect(rec.messages[rec.messages.length - 1]).toBeUndefined(); // default restored
	});
});

describe("config.chrome defaults", () => {
	test("ships enabled with the snowflake spinner", () => {
		expect(DEFAULT_CONFIG.chrome.enabled).toBe(true);
		expect(DEFAULT_CONFIG.chrome.spinnerFrames.length).toBe(10);
		expect(DEFAULT_CONFIG.chrome.spinnerIntervalMs).toBe(90);
		expect(DEFAULT_CONFIG.chrome.telemetry).toBe(true);
	});
});
