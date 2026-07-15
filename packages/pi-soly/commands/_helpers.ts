// =============================================================================
// commands/_helpers.ts — shared types + helpers for the per-command modules
// =============================================================================
//
// Re-exports from here:
//   - CommandUI, CommandsDeps      — contracts the slash commands need
//   - openListPanel                 — wraps ListPanel in ctx.ui.custom
//   - openExternally                — OS-default handler for URLs/files
//
// Each per-command module imports what it needs from here. The thin
// `commands/index.ts` orchestrator wires the deps object.
// =============================================================================

import * as path from "node:path";
import { platform } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ListPanel, type ListItem, type ListAction, type ListGroup } from "../visual/list-panel.ts";
import type { SolyState, RuleFile } from "../core.ts";
import type { SolyConfig } from "../config.ts";
import type { IntentDoc } from "../intent.ts";

/** Minimum ui surface the command handlers actually need. */
export interface CommandUI {
	notify: (text: string, kind?: "info" | "warning" | "error") => void;
	select: (label: string, options: string[]) => Promise<number | null>;
	confirm: (title: string, message: string) => Promise<boolean>;
	input?: (label: string, placeholder?: string) => Promise<string | undefined>;
}

/** All live-state callbacks the slash commands need. The orchestrator
 *  (index.ts) injects these from the extension's runtime. Per-command
 *  modules take a `Pick<CommandsDeps, …>` of just what they need. */
export interface CommandsDeps {
	getRules: () => RuleFile[];
	getOverridden: () => string[];
	refreshRules: () => void;
	getState: () => SolyState;
	refreshState: () => void;
	updateStatus: (ui: CommandUI) => void;
	getConfig: () => SolyConfig;
	reloadConfig: () => void;
	getIntentDocs: () => IntentDoc[];
	/** Record a soly event (any level). Everything goes through the
	 *  Working sub-line — no popups at all. */
	recordEvent: (text: string, level?: "info" | "warning" | "error") => void;
	/** Current soly mode (plans/phases). Used for command gating. */
	getMode: () => "plans" | "phases";
}

/** Open a focused list modal (overlay) for the given grouped items. */
export async function openListPanel(
	ctx: ExtensionCommandContext,
	spec: {
		title: string;
		headerRight?: string;
		build: () => ListGroup[];
		actions?: ListAction[];
		onSelect?: (item: ListItem) => void;
	},
): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, theme, keybindings, done) =>
			new ListPanel({
				tui,
				theme,
				keybindings,
				done: () => done(),
				title: spec.title,
				headerRight: spec.headerRight,
				groups: spec.build(),
				actions: spec.actions,
				refresh: spec.build,
				onSelect: spec.onSelect,
			}),
		{ overlay: true },
	);
}

/** Open a URL/file with the OS default handler (browser for http/.html). */
export async function openExternally(pi: ExtensionAPI, target: string): Promise<void> {
	const o = platform();
	const r =
		o === "darwin"
			? await pi.exec("open", [target])
			: o === "win32"
				? await pi.exec("cmd", ["/c", "start", "", target])
				: await pi.exec("xdg-open", [target]);
	if (r.code !== 0) throw new Error(r.stderr || `open failed (exit ${r.code})`);
}

/** Re-export path used by some command bodies. */
export { path };
