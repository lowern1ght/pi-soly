// =============================================================================
// settings/registry.ts — single source of truth for all soly settings
// =============================================================================
//
// Every setting soly knows about is declared here exactly once. From this
// registry we derive:
//   - the LLM tool parameter schema (soly_settings_set)
//   - the runtime validator (Value.Check)
//   - the system-prompt snapshot ("soly: mode=plans · confirm=scope")
//   - the gating policy (sensitivity tiers)
//   - the /soly config list output
//
// The two existing config subsystems (SolyConfig in config.ts, ModeConfig
// in config-mode.ts) are NOT replaced — the registry knows which layer each
// setting belongs to and routes writes accordingly. Callers don't see the
// split.
// =============================================================================

import { Type, type TSchema } from "typebox";

/** How "dangerous" a setting is. Drives confirmation gating. */
export type Sensitivity = "cosmetic" | "behavioral" | "structural";

/** Which config subsystem a setting lives in. Hidden from the LLM. */
export type ConfigLayer = "solyConfig" | "mode";

/** Where a setting may be written: project file, local override, or global. */
export type Scope = "project" | "local" | "global";

/** One setting in the registry. */
export interface SettingSpec {
	/** Dotted path the LLM uses: "mode", "chrome.ascii", "agent.confirmBeforeCode". */
	readonly key: string;
	/** TypeBox schema — drives tool param type AND runtime validation. */
	readonly schema: TSchema;
	/** Which config file this actually lives in. */
	readonly layer: ConfigLayer;
	/** Drives gating: cosmetic (silent), behavioral (announce), structural (confirm). */
	readonly sensitivity: Sensitivity;
	/** One-line summary for `explain` + prompt snapshot. */
	readonly summary: string;
	/** Where this setting may be written. */
	readonly scopes: readonly Scope[];
	/** Current default value (for `diff` command). */
	readonly default: unknown;
}

// ---------------------------------------------------------------------------
// The registry — one entry per user-facing setting.
// ---------------------------------------------------------------------------

export const SETTINGS: readonly SettingSpec[] = [
	// ---- Mode system (v3.0) ----
	{
		key: "mode",
		layer: "mode",
		sensitivity: "structural",
		schema: Type.Union([Type.Literal("plans"), Type.Literal("phases")]),
		summary: "Workflow: plans (local, LLM-driven) vs phases (shared STATE.md/ROADMAP.md).",
		scopes: ["project", "local", "global"],
		default: "plans",
	},
	{
		key: "plansDir",
		layer: "mode",
		sensitivity: "structural",
		schema: Type.String(),
		summary: "Where plan files live (plans mode). Default: .pi/plans",
		scopes: ["project", "local"],
		default: ".pi/plans",
	},

	// ---- Agent behavior ----
	{
		key: "agent.confirmBeforeCode",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Union([Type.Literal("off"), Type.Literal("ask"), Type.Literal("scope")]),
		summary: "Gate before writing code: off | ask | scope.",
		scopes: ["project", "global"],
		default: "scope",
	},
	{
		key: "agent.preferAskPro",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Boolean(),
		summary: "Prefer ask_pro for multi-question prompts.",
		scopes: ["project", "global"],
		default: true,
	},
	{
		key: "agent.nudgeNotify",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Boolean(),
		summary: "Show visible chat nudge for non-trivial tasks.",
		scopes: ["project", "global"],
		default: false,
	},
	{
		key: "agent.toolHints",
		layer: "solyConfig",
		sensitivity: "cosmetic",
		schema: Type.Boolean(),
		summary: "Show tool affordance hints in the system prompt.",
		scopes: ["project", "global"],
		default: true,
	},

	// ---- Chrome (visual) ----
	{
		key: "chrome.enabled",
		layer: "solyConfig",
		sensitivity: "structural",
		schema: Type.Boolean(),
		summary: "Install soly's custom chrome (footer + top bar + spinner).",
		scopes: ["project", "global"],
		default: true,
	},
	{
		key: "chrome.ascii",
		layer: "solyConfig",
		sensitivity: "cosmetic",
		schema: Type.Boolean(),
		summary: "Use ASCII fallbacks instead of Unicode glyphs.",
		scopes: ["project", "global"],
		default: false,
	},
	{
		key: "chrome.telemetry",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Boolean(),
		summary: "Show token count + throughput in the working indicator.",
		scopes: ["project", "global"],
		default: true,
	},
	{
		key: "chrome.spinnerIntervalMs",
		layer: "solyConfig",
		sensitivity: "cosmetic",
		schema: Type.Integer({ minimum: 50, maximum: 2000 }),
		summary: "Spinner animation interval in ms (50–2000).",
		scopes: ["project", "global"],
		default: 150,
	},

	// ---- Iteration ----
	{
		key: "iteration.retentionDays",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Integer({ minimum: 0, maximum: 365 }),
		summary: "Auto-prune iteration files older than N days (0 = keep forever).",
		scopes: ["project", "global"],
		default: 0,
	},
	{
		key: "iteration.includeResearch",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Boolean(),
		summary: "Include RESEARCH.md sections in per-iteration context.",
		scopes: ["project", "global"],
		default: true,
	},

	// ---- Verify (self-review loop) ----
	{
		key: "verify.maxIterations",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Integer({ minimum: 1, maximum: 20 }),
		summary: "Max iterations for `soly verify` self-review loop.",
		scopes: ["project", "global"],
		default: 7,
	},
	{
		key: "verify.freshContext",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Boolean(),
		summary: "Use fresh (compacted) context for each verify iteration.",
		scopes: ["project", "global"],
		default: false,
	},

	// ---- Artifacts ----
	{
		key: "artifacts.open",
		layer: "solyConfig",
		sensitivity: "cosmetic",
		schema: Type.Boolean(),
		summary: "Open rendered HTML artifacts in the browser automatically.",
		scopes: ["project", "global"],
		default: true,
	},
	{
		key: "artifacts.server",
		layer: "solyConfig",
		sensitivity: "structural",
		schema: Type.Boolean(),
		summary: "Serve artifacts from a per-session HTTP server (live gallery).",
		scopes: ["project", "global"],
		default: true,
	},
	{
		key: "artifacts.retentionDays",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.Integer({ minimum: 0, maximum: 365 }),
		summary: "Prune session artifact dirs older than N days (0 = keep forever).",
		scopes: ["project", "global"],
		default: 7,
	},
	{
		key: "artifacts.dir",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.String(),
		summary: "Output directory for artifacts. Empty → OS temp dir.",
		scopes: ["project", "global"],
		default: "",
	},

	// ---- Editor ----
	{
		key: "editor.command",
		layer: "solyConfig",
		sensitivity: "behavioral",
		schema: Type.String(),
		summary: "Command to open files in the user's editor (e.g. 'code', 'vim').",
		scopes: ["project", "global"],
		default: "code",
	},
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const byKey = new Map<string, SettingSpec>(SETTINGS.map((s) => [s.key, s]));

/** Find a setting by dotted key. Returns undefined if not found. */
export function getSetting(key: string): SettingSpec | undefined {
	return byKey.get(key);
}

/** All registered keys, sorted. */
export function allKeys(): string[] {
	return SETTINGS.map((s) => s.key).sort();
}

/** Settings filtered by sensitivity tier. */
export function settingsBySensitivity(tier: Sensitivity): readonly SettingSpec[] {
	return SETTINGS.filter((s) => s.sensitivity === tier);
}

/** Generate a compact one-line snapshot for the system prompt.
 *  Only high-signal keys (structural + behavioral), omitting cosmetic ones
 *  to keep the prompt lean. */
export function snapshotKeys(): readonly SettingSpec[] {
	return SETTINGS.filter((s) => s.sensitivity !== "cosmetic");
}

// ---------------------------------------------------------------------------
// Value extraction — read current values from the two config subsystems.
// ---------------------------------------------------------------------------

/** Get the current effective value for a setting, reading from whichever
 *  config object is active. Returns the value, or undefined if not
 *  applicable (e.g. mode key when no mode is resolved yet). */
export function getEffectiveValue(
	spec: SettingSpec,
	activeConfig: Record<string, unknown> | null,
	modeConfig: { mode: string; plansDir: string } | null,
): unknown {
	if (spec.layer === "mode") {
		if (!modeConfig) return undefined;
		if (spec.key === "mode") return modeConfig.mode;
		if (spec.key === "plansDir") return modeConfig.plansDir;
		return undefined;
	}
	// solyConfig: walk the dotted path.
	const parts = spec.key.split(".");
	let obj: unknown = activeConfig;
	for (const p of parts) {
		if (typeof obj !== "object" || obj === null) return undefined;
		obj = (obj as Record<string, unknown>)[p];
	}
	return obj;
}

// ---------------------------------------------------------------------------
// Description helpers for the LLM
// ---------------------------------------------------------------------------

/** Human-readable description of allowed values for a TypeBox schema.
 *  Used in `explain` output + validation errors. */
export function describeAllowed(schema: TSchema): string {
	// TypeBox stores metadata in schema[Symbol.for('TypeBox.Kind')] etc.
	// Simple heuristic: if it has "enum" it's a union of literals.
	const anySchema = schema as Record<string, unknown>;
	if (anySchema["anyOf"]) {
		const opts = (anySchema["anyOf"] as Array<Record<string, unknown>>)
			.map((s) => (s.const !== undefined ? JSON.stringify(s.const) : "?"))
			.join(" | ");
		return `allowed: ${opts}`;
	}
	if (anySchema["type"] === "boolean") return "allowed: true | false";
	if (anySchema["type"] === "integer" || anySchema["type"] === "number") {
		const min = anySchema["minimum"] !== undefined ? `min ${anySchema["minimum"]}` : "";
		const max = anySchema["maximum"] !== undefined ? `max ${anySchema["maximum"]}` : "";
		return `allowed: number${min || max ? ` (${[min, max].filter(Boolean).join(", ")})` : ""}`;
	}
	if (anySchema["type"] === "string") return "allowed: string";
	return "allowed: (see schema)";
}
