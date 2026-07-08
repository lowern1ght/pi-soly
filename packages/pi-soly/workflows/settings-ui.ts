// =============================================================================
// workflows/settings-ui.ts — interactive soly settings editor
// =============================================================================
//
// Modal that lets the user toggle/cycle/± soly config values instead of
// reading a JSON dump in chat. Lives as a focused overlay panel built on
// the ListPanel primitive (same shape as the /soly and /rules pickers).
//
// Settings shape:
//   - bool   : row marker flips ◉/○ on Enter; current value shown in meta
//   - enum   : row marker shows the current value; Enter cycles to next
//   - number : row marker shows current value; + / - (also ← / →) step by 1
//
// Saving: each change is committed in-memory. On panel close (Esc), the
// full diff vs the original is written to `<solyDir>/soly.json` (the
// per-project config file). Global overrides at `~/.agents/soly.json`
// are left alone — pass `--scope global` in a future iteration to target
// that path; today the editor is project-scoped only.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";

import { matchesKey } from "@earendil-works/pi-tui";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { ListPanel, type ListItem, type ListAction, type ListGroup, type PanelKeybindings } from "../visual/list-panel.ts";

import { DEFAULT_CONFIG, type SolyConfig } from "../config.ts";

// ---------------------------------------------------------------------------
// Setting descriptors
// ---------------------------------------------------------------------------

type BoolSetting = {
	kind: "bool";
	key: string;
	label: string;
	description: string;
	get: (c: SolyConfig) => boolean;
	set: (c: SolyConfig, v: boolean) => void;
};

type EnumSetting = {
	kind: "enum";
	key: string;
	label: string;
	description: string;
	get: (c: SolyConfig) => string;
	set: (c: SolyConfig, v: string) => void;
	values: readonly string[];
};

type NumberSetting = {
	kind: "number";
	key: string;
	label: string;
	description: string;
	get: (c: SolyConfig) => number;
	set: (c: SolyConfig, v: number) => void;
	min: number;
	max: number;
	step?: number;
};

export type Setting = BoolSetting | EnumSetting | NumberSetting;

function getPath(c: SolyConfig, keys: string[]): unknown {
	let cur: unknown = c;
	for (const k of keys) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[k];
	}
	return cur;
}

function setPath<T extends object>(target: T, keys: string[], value: unknown): T {
	const next: T = { ...target };
	let cur: Record<string, unknown> = next as Record<string, unknown>;
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i]!;
		const inner = cur[k];
		cur[k] = { ...(typeof inner === "object" && inner !== null ? inner : {}) };
		cur = cur[k] as Record<string, unknown>;
	}
	cur[keys[keys.length - 1]!] = value;
	return next;
}

/** Ordered list of user-editable settings shown in the modal. Complex
 *  values (arrays, regex patterns) are intentionally omitted — see the
 *  comments in the descriptors. */
export const SETTINGS: Setting[] = [
	// ---- iteration ----
	{
		kind: "number",
		key: "iteration.retentionDays",
		label: "Iteration retention",
		description: "auto-prune iteration files older than N days (0 = keep forever)",
		get: (c) => c.iteration.retentionDays,
		set: (c, v) => { c.iteration = { ...c.iteration, retentionDays: v }; },
		min: 0, max: 365,
	},
	{
		kind: "bool",
		key: "iteration.includeResearch",
		label: "Include RESEARCH in bundle",
		description: "add RESEARCH.md sections to the per-iteration context bundle",
		get: (c) => c.iteration.includeResearch,
		set: (c, v) => { c.iteration = { ...c.iteration, includeResearch: v }; },
	},
	{
		kind: "bool",
		key: "iteration.includeAntiPatterns",
		label: "Include Anti-Patterns in bundle",
		description: "add the Anti-Patterns table from .continue-here.md to the bundle",
		get: (c) => c.iteration.includeAntiPatterns,
		set: (c, v) => { c.iteration = { ...c.iteration, includeAntiPatterns: v }; },
	},

	// ---- agent ----
	{
		kind: "bool",
		key: "agent.preferAskPro",
		label: "Prefer ask_pro over picker",
		description: "use the ask_pro multi-question tool instead of soly's built-in picker in discuss flow",
		get: (c) => c.agent.preferAskPro,
		set: (c, v) => { c.agent = { ...c.agent, preferAskPro: v }; },
	},
	{
		kind: "bool",
		key: "agent.toolHints",
		label: "Per-turn tool hints",
		description: "inject context-aware affordance hints (examples → html_artifact, options → decision_deck, …)",
		get: (c) => c.agent.toolHints,
		set: (c, v) => { c.agent = { ...c.agent, toolHints: v }; },
	},
	{
		kind: "enum",
		key: "agent.confirmBeforeCode",
		label: "Confirm-before-code gate",
		description: "before non-trivial coding, make the LLM batch decisions via ask_pro",
		get: (c) => c.agent.confirmBeforeCode as string,
		set: (c, v) => {
			c.agent = { ...c.agent, confirmBeforeCode: v as SolyConfig["agent"]["confirmBeforeCode"] };
		},
		values: ["off", "ask", "scope"],
	},

	// ---- display ----
	{
		kind: "bool",
		key: "display.defaultRecommendedFirst",
		label: "Default to ⭐ first",
		description: "always show the recommended option as the first row in pickers",
		get: (c) => c.display.defaultRecommendedFirst,
		set: (c, v) => { c.display = { ...c.display, defaultRecommendedFirst: v }; },
	},
	{
		kind: "number",
		key: "display.maxPhasesInStatus",
		label: "Max phases in status",
		description: "cap on how many phases appear in /soly status",
		get: (c) => c.display.maxPhasesInStatus,
		set: (c, v) => { c.display = { ...c.display, maxPhasesInStatus: v }; },
		min: 1, max: 50,
	},
	{
		kind: "number",
		key: "display.maxDecisionsInLog",
		label: "Max decisions in log",
		description: "cap on how many decisions appear in soly log default",
		get: (c) => c.display.maxDecisionsInLog,
		set: (c, v) => { c.display = { ...c.display, maxDecisionsInLog: v }; },
		min: 1, max: 500,
	},

	// ---- hotReload ----
	{
		kind: "number",
		key: "hotReload.pollMs",
		label: "Hot-reload poll interval (ms)",
		description: "how often to check for rule changes (lower = snappier, higher = less disk I/O)",
		get: (c) => c.hotReload.pollMs,
		set: (c, v) => { c.hotReload = { ...c.hotReload, pollMs: v }; },
		min: 250, max: 60_000, step: 250,
	},
	{
		kind: "bool",
		key: "hotReload.notifyOnRuleChange",
		label: "Notify on rule changes",
		description: "show a notify when rule files change on disk",
		get: (c) => c.hotReload.notifyOnRuleChange,
		set: (c, v) => { c.hotReload = { ...c.hotReload, notifyOnRuleChange: v }; },
	},

	// ---- chrome ----
	{
		kind: "bool",
		key: "chrome.enabled",
		label: "Chrome (top bar + footer)",
		description: "install soly's status chrome (top bar + custom footer + spinner)",
		get: (c) => c.chrome.enabled,
		set: (c, v) => { c.chrome = { ...c.chrome, enabled: v }; },
	},
	{
		kind: "bool",
		key: "chrome.ascii",
		label: "ASCII fallbacks (no glyphs)",
		description: "use BMP glyphs instead of Nerd-Font icons (for terminals without font support)",
		get: (c) => c.chrome.ascii,
		set: (c, v) => { c.chrome = { ...c.chrome, ascii: v }; },
	},
	{
		kind: "bool",
		key: "chrome.telemetry",
		label: "Working telemetry",
		description: "show live elapsed · ↑↓ tokens · tok/s next to the working spinner",
		get: (c) => c.chrome.telemetry,
		set: (c, v) => { c.chrome = { ...c.chrome, telemetry: v }; },
	},
	{
		kind: "number",
		key: "chrome.spinnerIntervalMs",
		label: "Spinner frame interval (ms)",
		description: "how fast the working spinner animates",
		get: (c) => c.chrome.spinnerIntervalMs,
		set: (c, v) => { c.chrome = { ...c.chrome, spinnerIntervalMs: v }; },
		min: 50, max: 1000, step: 25,
	},

	// ---- verify ----
	{
		kind: "bool",
		key: "verify.freshContext",
		label: "Fresh-context review",
		description: "strip prior review iterations from context each pass (re-review with truly fresh eyes)",
		get: (c) => c.verify.freshContext,
		set: (c, v) => { c.verify = { ...c.verify, freshContext: v }; },
	},
	{
		kind: "number",
		key: "verify.maxIterations",
		label: "Verify max iterations",
		description: "max self-review passes before the loop stops on its own",
		get: (c) => c.verify.maxIterations,
		set: (c, v) => { c.verify = { ...c.verify, maxIterations: v }; },
		min: 1, max: 20,
	},

	// ---- editor ----
	{
		kind: "enum",
		key: "editor.command",
		label: "$EDITOR command",
		description: "command used for `/open` and edit-redirect (e.g. code, vim, code-insiders)",
		get: (c) => c.editor.command,
		set: (c, v) => { c.editor = { ...c.editor, command: v }; },
		values: ["code", "code-insiders", "cursor", "vim", "nvim", "nano", "emacs", "subl", "xed"],
	},
];

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export type Notifier = {
	notify: (text: string, level?: "info" | "warning" | "error") => void;
};

/** Marker tokens for the row glyph. Bool: ●/○ ; enum/number: shows value. */
function markerFor(s: Setting, value: unknown): string {
	if (s.kind === "bool") return value ? "◉" : "○";
	if (s.kind === "enum") {
		const idx = s.values.indexOf(value as string);
		return idx >= 0 ? String(idx + 1) : "?";
	}
	// number — show value with arrow hints
	return String(value);
}

function displayValue(s: Setting, value: unknown): string {
	if (s.kind === "bool") return value ? "ON" : "OFF";
	if (s.kind === "enum") return String(value);
	if (s.kind === "number") return String(value);
	return String(value);
}

/** Convert a fully-resolved SolyConfig to a plain JSON-serializable object,
 *  diffing against `DEFAULT_CONFIG` so we only persist user overrides. */
function diffVsDefaults(c: SolyConfig): SolyConfig {
	// We treat SolyConfig as Record<string, unknown> for the recursion since
	// TS won't let us declare `out` as both. The fields we touch are all
	// JSON-serializable primitives or nested objects of the same shape.
	const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as unknown as Record<string, unknown>;
	const walk = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
		for (const k of Object.keys(source)) {
			const sv = source[k];
			if (sv && typeof sv === "object" && !Array.isArray(sv)) {
				if (!target[k] || typeof target[k] !== "object") target[k] = {};
				walk(target[k] as Record<string, unknown>, sv as Record<string, unknown>);
			} else if (!deepEqual(target[k], sv)) {
				target[k] = sv;
			}
		}
	};
	walk(out, c as unknown as Record<string, unknown>);
	// Strip any keys that ended up at default (empty walks leave them).
	const prune = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
		for (const k of Object.keys(target)) {
			const tv = target[k];
			const sv = source[k];
			if (tv && typeof tv === "object" && !Array.isArray(tv) && sv && typeof sv === "object") {
				prune(tv as Record<string, unknown>, sv as Record<string, unknown>);
				if (Object.keys(tv).length === 0) delete target[k];
			} else if (deepEqual(tv, sv)) {
				delete target[k];
			}
		}
	};
	prune(out, DEFAULT_CONFIG as unknown as Record<string, unknown>);
	return out as unknown as SolyConfig;
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return a === b;
	if (typeof a !== typeof b) return false;
	if (typeof a === "object") {
		const ak = Object.keys(a as object);
		const bk = Object.keys(b as object);
		if (ak.length !== bk.length) return false;
		for (const k of ak) if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
		return true;
	}
	return false;
}

/** Write `data` to `<solyDir>/soly.json`, preserving any existing top-level
 *  keys the user has set but soly doesn't know about. */
function saveConfigFile(solyDir: string, data: SolyConfig): void {
	const target = path.join(solyDir, "soly.json");
	let merged = data as unknown as Record<string, unknown>;
	if (fs.existsSync(target)) {
		try {
			const raw = fs.readFileSync(target, "utf-8");
			const existing = JSON.parse(raw) as Record<string, unknown>;
			// Carry over unknown keys (forward-compat with future fields).
			for (const k of Object.keys(existing)) {
				if (!(k in merged)) merged[k] = existing[k];
			}
		} catch { /* corrupt file → overwrite is fine */ }
	}
	const mergedTyped: SolyConfig = merged as unknown as SolyConfig;
	fs.mkdirSync(solyDir, { recursive: true });
	fs.writeFileSync(target, JSON.stringify(mergedTyped, null, 2) + "\n", "utf-8");
}

export type SettingsUIDeps = {
	ctx: { ui: { custom: <T>(factory: (tui: TUI, theme: Theme, keybindings: PanelKeybindings, done: (result?: T) => void) => Component & { dispose?: () => void } | Promise<Component & { dispose?: () => void }>, opts?: { overlay?: boolean } | undefined) => Promise<T | undefined> } };
	ui: Notifier;
	/** Where to write `<solyDir>/soly.json` (typically `state.solyDir`). */
	solyDir: string;
	/** Live config snapshot — re-read on every call so we pick up writes
	 *  done by other panels in the same session. */
	getConfig: () => SolyConfig;
	/** Reload the live config from disk after we wrote the file. */
	reloadConfig: () => void;
};

/** Open the interactive settings modal. Mutates `working` in memory, then
 *  writes the diff to `<solyDir>/soly.json` on close. */
export function openSettingsUI(deps: SettingsUIDeps): void {
	const { ctx, ui, solyDir, getConfig, reloadConfig } = deps;

	// Take a deep copy so we can mutate freely; on close, diff vs defaults
	// and persist the override file.
	const working: SolyConfig = JSON.parse(JSON.stringify(getConfig()));
	const originalJson = JSON.stringify(working);

	const itemFor = (s: Setting): ListItem => {
		const v = s.get(working);
		return {
			id: s.key,
			marker: markerFor(s, v),
			label: s.label,
			meta: displayValue(s, v),
			body: `${s.description}\n\nkey: ${s.key}${s.kind === "enum" ? `\nvalues: ${s.values.join(" / ")}` : ""}${s.kind === "number" ? `\nrange: ${s.min}..${s.max}${s.step ? ` step ${s.step}` : ""}` : ""}`,
		};
	};

	const buildGroups = (): ListGroup[] => [
		{ id: "iteration", title: "Iteration", icon: "↻", items: SETTINGS.filter((s) => s.key.startsWith("iteration.")).map(itemFor) },
		{ id: "agent", title: "Agent", icon: "◉", items: SETTINGS.filter((s) => s.key.startsWith("agent.")).map(itemFor) },
		{ id: "display", title: "Display", icon: "▤", items: SETTINGS.filter((s) => s.key.startsWith("display.")).map(itemFor) },
		{ id: "reload", title: "Hot reload", icon: "↺", items: SETTINGS.filter((s) => s.key.startsWith("hotReload.")).map(itemFor) },
		{ id: "chrome", title: "Chrome", icon: "▰", items: SETTINGS.filter((s) => s.key.startsWith("chrome.")).map(itemFor) },
		{ id: "verify", title: "Verify", icon: "✓", items: SETTINGS.filter((s) => s.key.startsWith("verify.")).map(itemFor) },
		{ id: "editor", title: "Editor", icon: "▥", items: SETTINGS.filter((s) => s.key.startsWith("editor.")).map(itemFor) },
	].filter((g) => g.items.length > 0);

	const findSetting = (key: string): Setting | undefined => SETTINGS.find((s) => s.key === key);

	const applyToggle = (item: ListItem): void => {
		const s = findSetting(item.id);
		if (!s) return;
		if (s.kind === "bool") {
			const cur = s.get(working);
			s.set(working, !cur);
		} else if (s.kind === "enum") {
			const cur = s.get(working) as string;
			const idx = s.values.indexOf(cur);
			const next = s.values[(idx + 1) % s.values.length]!;
			s.set(working, next);
		} else if (s.kind === "number") {
			const cur = s.get(working);
			const step = s.step ?? 1;
			const next = Math.min(s.max, Math.max(s.min, cur + step));
			s.set(working, next);
		}
	};

	ctx.ui.custom<void>(
		(tui: TUI, theme: Theme, keybindings: PanelKeybindings, done: () => void) => {
			const stepDown = (item: ListItem): void => {
				const s = findSetting(item.id);
				if (!s || s.kind !== "number") return;
				const step = s.step ?? 1;
				const cur = s.get(working);
				s.set(working, Math.max(s.min, cur - step));
			};

			return new ListPanel({
				tui,
				theme,
				keybindings,
				done: () => {
					// Persist changes if the in-memory copy diverged from the
					// original. Reads include both default-fills and global
					// overrides — we only store the diff vs defaults.
					if (JSON.stringify(working) !== originalJson) {
						try {
							const diff = diffVsDefaults(working);
							saveConfigFile(solyDir, diff);
							ui.notify(`settings saved → ${path.basename(solyDir)}/soly.json`, "info");
							// Re-read the config from disk so the active config matches
							// what we just wrote.
							reloadConfig();
						} catch (e) {
							ui.notify(`save failed: ${(e as Error).message}`, "error");
						}
					}
					done();
				},
				title: "soly · settings",
				headerRight: `save on Esc → soly.json`,
				groups: buildGroups(),
				onSelect: (it) => applyToggle(it),
				actions: [
					{ key: "-", hint: "−1", run: stepDown },
				],
			});
		},
		{ overlay: true },
	);
}
