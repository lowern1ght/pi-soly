// =============================================================================
// settings/tools.ts — soly_config (read) + soly_settings_set (write)
// =============================================================================
//
// Two LLM-facing tools derived from the settings registry:
//
//   soly_config(action, key?) — read: get, list, explain, diff
//   soly_settings_set(changes, scope?, confirm?) — write: validate → gate →
//     write to the correct layer → reload → return applied diff
//
// Mode flows through the SAME write tool as everything else (key="mode").
// Internally it routes to writeModeConfig() not saveConfigFile().
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	SETTINGS,
	getSetting,
	allKeys,
	getEffectiveValue,
	describeAllowed,
	type SettingSpec,
	type Scope,
} from "./registry.ts";
import { writeModeConfig, resolveMode, type SolyMode } from "../config-mode.ts";
import type { SolyConfig } from "../config.ts";
import { renderSolyCall, callDetail } from "../visual/tool-render.ts";

export interface SettingsToolsDeps {
	/** Active resolved SolyConfig (for solyConfig-layer reads). */
	getConfig: () => SolyConfig;
	/** Resolved mode + plansDir (for mode-layer reads). */
	getMode: () => { mode: SolyMode; plansDir: string };
	/** Write a SolyConfig field to the correct file + reload. Caller handles
	 *  the actual deepMerge + saveConfigFile. Returns the file path written. */
	writeSolyConfig?: (key: string, value: unknown, scope: Scope) => string | null;
	/** Trigger config reload after a write. */
	reloadConfig?: () => void;
}

export function registerSettingsTools(pi: ExtensionAPI, deps: SettingsToolsDeps): void {
	const { getConfig, getMode } = deps;

	// ---- soly_config (read) ----
	pi.registerTool({
		name: "soly-config",
		renderShell: "self",
		renderCall(args, theme, context) {
			return renderSolyCall(theme, "soly-config", callDetail("soly-config", args as Record<string, unknown>), context.lastComponent);
		},
		label: "soly config",
		description:
			"Read soly settings. Actions: get (current value + source layer), list (all keys + values), explain (allowed values + sensitivity + default), diff (current vs defaults). " +
			"Use BEFORE changing settings to understand what's available and valid.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("get"),
				Type.Literal("list"),
				Type.Literal("explain"),
				Type.Literal("diff"),
			]),
			key: Type.Optional(
				Type.String({ description: "Setting key for get/explain (e.g. 'mode', 'chrome.ascii')." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cfg = getConfig();
			const mode = getMode();

			if (params.action === "list") {
				const lines: string[] = ["soly settings (all):", ""];
				for (const spec of SETTINGS) {
					const val = getEffectiveValue(spec, cfg as unknown as Record<string, unknown>, mode);
					const display = val === undefined ? "(unset)" : JSON.stringify(val);
					lines.push(`  ${spec.key} = ${display}  [${spec.sensitivity}]`);
				}
				lines.push("");
				lines.push(`Total: ${SETTINGS.length} settings. Use action=explain for details on any key.`);
				return { details: {}, content: [{ type: "text", text: lines.join("\n") }] };
			}

			if (params.action === "get") {
				if (!params.key) {
					return { details: {}, content: [{ type: "text", text: "Usage: soly_config action=get key=<key>" }] };
				}
				const spec = getSetting(params.key);
				if (!spec) {
					return { details: {}, content: [{ type: "text", text: `Unknown setting "${params.key}". Call soly_config action=list for all keys.` }] };
				}
				const val = getEffectiveValue(spec, cfg as unknown as Record<string, unknown>, mode);
				return {
					details: {},
					content: [{
						type: "text",
						text: `${spec.key} = ${val === undefined ? "(unset)" : JSON.stringify(val)}\n  ${spec.summary}\n  sensitivity: ${spec.sensitivity}`,
					}],
				};
			}

			if (params.action === "explain") {
				if (!params.key) {
					return { details: {}, content: [{ type: "text", text: "Usage: soly_config action=explain key=<key>" }] };
				}
				const spec = getSetting(params.key);
				if (!spec) {
					return { details: {}, content: [{ type: "text", text: `Unknown setting "${params.key}".` }] };
				}
				const val = getEffectiveValue(spec, cfg as unknown as Record<string, unknown>, mode);
				const lines = [
					`${spec.key}:`,
					`  summary:     ${spec.summary}`,
					`  ${describeAllowed(spec.schema)}`,
					`  current:     ${val === undefined ? "(unset)" : JSON.stringify(val)}`,
					`  default:     ${JSON.stringify(spec.default)}`,
					`  sensitivity: ${spec.sensitivity} (${spec.sensitivity === "structural" ? "requires confirmation" : spec.sensitivity === "behavioral" ? "announce on change" : "silent"})`,
					`  scopes:      ${spec.scopes.join(", ")}`,
				];
				return { details: {}, content: [{ type: "text", text: lines.join("\n") }] };
			}

			if (params.action === "diff") {
				const lines: string[] = ["settings diff (current vs defaults):", ""];
				for (const spec of SETTINGS) {
					const val = getEffectiveValue(spec, cfg as unknown as Record<string, unknown>, mode);
					if (JSON.stringify(val) !== JSON.stringify(spec.default)) {
						lines.push(`  ${spec.key}: ${JSON.stringify(spec.default)} → ${val === undefined ? "(unset)" : JSON.stringify(val)}`);
					}
				}
				if (lines.length === 2) lines.push("  (all defaults — no overrides)");
				return { details: {}, content: [{ type: "text", text: lines.join("\n") }] };
			}

			return { details: {}, content: [{ type: "text", text: `Unknown action: ${params.action}` }] };
		},
	});

	// ---- soly_settings_set (write) ----
	// Build the changes schema from the registry: one optional field per setting.
	const changesSchema = Type.Object(
		Object.fromEntries(SETTINGS.map((s) => [s.key, Type.Optional(s.schema)])),
	);

	pi.registerTool({
		name: "soly-settings-set",
		renderShell: "self",
		renderCall(args, theme, context) {
			return renderSolyCall(theme, "soly-settings-set", callDetail("soly-settings-set", args as Record<string, unknown>), context.lastComponent);
		},
		label: "soly settings set",
		description:
			"Change soly settings. Pass one or more keys in `changes`. Structural changes (mode, chrome.enabled, artifacts.server, editor.command) require user confirmation. " +
			"Call soly_config action=explain first if unsure about allowed values. " +
			"The tool validates types, writes to the correct file, and reloads — no restart needed.",
		parameters: Type.Object({
			changes: changesSchema,
			scope: Type.Optional(
				Type.Union([
					Type.Literal("project"),
					Type.Literal("local"),
					Type.Literal("global"),
				]),
			),
			confirm: Type.Optional(
				Type.Boolean({ description: "Required for structural changes in headless mode." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const scope: Scope = params.scope ?? "project";
			const changes = params.changes as Record<string, unknown>;
			const appliedDiffs: Array<{ key: string; from: unknown; to: unknown }> = [];
			const skipped: string[] = [];
			const errors: string[] = [];

			for (const [key, value] of Object.entries(changes)) {
				const spec = getSetting(key);
				if (!spec) {
					errors.push(`Unknown setting "${key}". Call soly_config action=list.`);
					continue;
				}

				// Validate with TypeBox.
				if (!Value.Check(spec.schema, value)) {
					errors.push(`Invalid "${key}": got ${JSON.stringify(value)}. ${describeAllowed(spec.schema)}`);
					continue;
				}

				// Gate: structural settings require confirmation.
				if (spec.sensitivity === "structural") {
					const hasUI = ctx?.ui?.confirm !== undefined;
					if (hasUI) {
						const ok = await ctx.ui.confirm(
							`Change ${key} → ${JSON.stringify(value)}?`,
							spec.summary,
						);
						if (!ok) {
							skipped.push(key);
							continue;
						}
					} else if (!params.confirm) {
						errors.push(`"${key}" is structural; re-call with confirm:true or ask the user.`);
						continue;
					}
				}

				// Read current value for diff.
				const cfg = getConfig();
				const mode = getMode();
				const from = getEffectiveValue(spec, cfg as unknown as Record<string, unknown>, mode);

				// Write to the correct layer.
				if (spec.layer === "mode") {
					const modeConfig: Record<string, unknown> = {};
					if (key === "mode") modeConfig.mode = value as SolyMode;
					if (key === "plansDir") modeConfig.plansDir = value as string;
					writeModeConfig(
						scope === "global" ? "user-global" : scope === "local" ? "user-repo" : "repo-default",
						ctx.cwd,
						modeConfig as { mode: SolyMode; plansDir?: string },
						{ homeDir: os.homedir() },
					);
				} else {
					// solyConfig layer — delegate to writeSolyConfig if available.
					if (!deps.writeSolyConfig) {
						errors.push(`Cannot write "${key}" — writeSolyConfig not wired. Edit .agents/soly.json manually.`);
						continue;
					}
					deps.writeSolyConfig(key, value, scope);
				}

				appliedDiffs.push({ key, from, to: value });
			}

			// Reload config so the change takes effect immediately.
			if (appliedDiffs.length > 0 && deps.reloadConfig) {
				deps.reloadConfig();
			}

			// Build result.
			const lines: string[] = [];
			if (appliedDiffs.length > 0) {
				lines.push(`Applied ${appliedDiffs.length} change(s):`);
				for (const d of appliedDiffs) {
					lines.push(`  ${d.key}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`);
				}
			}
			if (skipped.length > 0) lines.push(`\nSkipped (user declined): ${skipped.join(", ")}`);
			if (errors.length > 0) {
				lines.push("\nErrors:");
				lines.push(...errors.map((e) => `  ${e}`));
			}
			if (appliedDiffs.some((d) => d.key === "mode")) {
				lines.push("\n⚠ Mode changed — new workflow active next turn.");
			}

			return { details: {}, content: [{ type: "text", text: lines.join("\n") || "No changes." }] };
		},
	});
}
