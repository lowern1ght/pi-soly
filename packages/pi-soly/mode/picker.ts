// =============================================================================
// mode/picker.ts — first-run mode picker (modal via ListPanel)
// =============================================================================
//
// Shown when resolveMode() returns source: "auto-detect" + needsPicker: true.
// Asks the user to commit to a mode, then writes the choice to
// .agents/soly.config.json (the repo-default layer).
//
// Reuses the existing ListPanel component — it already has fuzzy search,
// keyboard nav, onSelect, and a done() callback for cancellation. We wrap
// it in ctx.ui.custom() directly (not via openListPanel) so we get the
// done callback and can resolve with null on cancellation.
// =============================================================================

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ListPanel, type ListItem, type ListGroup } from "../visual/list-panel.ts";
import { resolveMode, writeModeConfig, type SolyMode } from "../config-mode.ts";

/** The three choices in the first-run picker. */
type PickerChoice = "plans" | "phases" | "defer";

/** Result of the picker: chosen mode + plans dir, or null if cancelled. */
export type PickerResult = { mode: SolyMode; plansDir: string } | null;

/** Show the first-run mode picker. Resolves to the chosen mode + dir, or
 *  null if the user dismissed the panel (Esc, "defer"). */
export async function showModePicker(
	ctx: ExtensionCommandContext,
): Promise<PickerResult> {
	const detected = resolveMode(ctx.cwd, { homeDir: undefined });
	const currentMode = detected.mode;
	const currentDir = detected.plansDir;

	return new Promise<PickerResult>((resolve) => {
		let settled = false;
		const settle = (r: PickerResult) => {
			if (settled) return;
			settled = true;
			resolve(r);
		};

		const groups: ListGroup[] = [
			{
				id: "modes",
				title: "How do you want to use soly?",
				icon: "☖",
				items: [
					{
						id: "plans",
						marker: currentMode === "plans" ? "★" : "○",
						label: "plans",
						meta: currentMode === "plans" ? "auto-detected" : "lightweight, LLM-driven",
						body:
							"Local-first workflow. soly scaffolds a plan branch, the LLM works the plan, " +
							"you review. No shared state files. Plans live in .pi/plans/ (gitignored).\n\n" +
							"Best for: solo work, exploratory refactors, one-off investigations.",
					},
					{
						id: "phases",
						marker: currentMode === "phases" ? "★" : "○",
						label: "phases",
						meta: currentMode === "phases" ? "auto-detected" : "shared, multi-contributor",
						body:
							"Traditional soly workflow. STATE.md + ROADMAP.md track progress. Phases live in " +
							".agents/phases/ (committed). Visible to the whole team.\n\n" +
							"Best for: multi-contributor projects, long-running work, code review across a team.",
					},
					{
						id: "defer",
						marker: "⏵",
						label: "defer",
						meta: "decide later",
						body:
							"Skip the choice for now. soly will keep auto-detecting. You can pick a mode later " +
							"by creating .agents/soly.config.json, .agents/soly.local.json, or ~/.pi/soly.user.json.",
					},
				],
			},
		];

		void ctx.ui.custom<void>(
			(tui, theme, keybindings, done) => {
				return new ListPanel({
					tui,
					theme,
					keybindings,
					done: () => {
						// Esc / panel dismiss → treat as cancel / defer
						settle(null);
						done();
					},
					title: "soly · mode",
					headerRight: "first run",
					groups,
					refresh: () => groups,
					onSelect: (item: ListItem) => {
						if (item.id === "plans" || item.id === "phases") {
							settle({ mode: item.id, plansDir: currentDir });
						} else {
							// "defer" — close without writing
							settle(null);
						}
					},
				});
			},
			{ overlay: true },
		).then(
			() => {
				// ui.custom() resolved — if onSelect or done didn't fire, treat as cancel.
				settle(null);
			},
			() => {
				// Rejection from ui.custom() — also cancel.
				settle(null);
			},
		);
	});
}

/** Show the picker AND persist the choice to .agents/soly.config.json.
 *  Returns the path written, or null if the user cancelled. */
export async function pickAndPersist(
	ctx: ExtensionCommandContext,
	layer: "repo-default" | "user-repo" | "user-global" = "repo-default",
): Promise<{ mode: SolyMode; plansDir: string; filePath: string } | null> {
	const choice = await showModePicker(ctx);
	if (!choice) return null;
	const result = writeModeConfig(layer, ctx.cwd, choice);
	return { mode: choice.mode, plansDir: choice.plansDir, filePath: result.path };
}
