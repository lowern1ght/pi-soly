// =============================================================================
// commands/why.ts — /why command (show context that grounded the last turn)
// =============================================================================

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CommandsDeps } from "./_helpers.ts";

type WhyDeps = Pick<CommandsDeps, "getState" | "getRules">;

export function registerWhyCommand(pi: ExtensionAPI, deps: WhyDeps): void {
	const { getState, getRules } = deps;

	pi.registerCommand("why", {
		description:
			"show the rules + project state that were injected into the system prompt for the most recent turn. Use to answer 'why did the LLM do X?' — you can see the basis it was working from.",
		handler: async (args, ctx) => {
			const state = getState();
			const rules = getRules();
			const branch = ctx.sessionManager.getBranch();
			const lastTurnEntries = branch.slice(-6);

			const lines: string[] = [];
			lines.push("=== /why — basis for the most recent turn ===");
			lines.push("");

			// State
			if (state.exists) {
				lines.push("**Project state (injected):**");
				lines.push(`  milestone: ${state.milestone}${state.milestoneName ? ` — ${state.milestoneName}` : ""}`);
				if (state.position) {
					lines.push(`  position:  ${state.position.phase} / ${state.position.plan} (${state.position.status})`);
				}
				lines.push(`  progress:  ${state.progress.completedPhases}/${state.progress.totalPhases} phases, ${state.progress.completedPlans}/${state.progress.totalPlans} plans (${state.progress.percent}%)`);
				lines.push("");
			}

			// Rules
			if (rules.length > 0) {
				lines.push(`**Rules loaded (${rules.length} of which ${rules.filter((r) => r.enabled).length} enabled):**`);
				const bySource = rules.reduce<Record<string, number>>((acc, r) => {
					acc[r.sourceLabel] = (acc[r.sourceLabel] ?? 0) + 1;
					return acc;
				}, {});
				lines.push(
					`  by source: ${Object.entries(bySource)
						.map(([k, v]) => `${v} ${k}`)
						.join(", ")}`,
				);
				const phaseRuleCount = rules.filter((r) => r.phaseNumber != null).length;
				if (phaseRuleCount > 0) {
					lines.push(`  phase-scoped: ${phaseRuleCount}`);
				}
				lines.push("");
			}

			// List the actual loaded rule files with paths + descriptions
			if (rules.length > 0) {
				lines.push("**Loaded rule files (the LLM was reading these):**");
				const enabled = rules.filter((rr) => rr.enabled);
				for (const r of enabled.slice(0, 30)) {
					const desc = r.meta.description ? ` — ${r.meta.description}` : "";
					const interactive = r.interactiveOnly ? " [interactive-only]" : "";
					lines.push(`  - \`${r.sourceLabel}/${r.relPath}\`${desc}${interactive}`);
				}
				if (enabled.length > 30) {
					lines.push(`  - ... and ${enabled.length - 30} more`);
				}
				lines.push("");
			}

			// Last few turns
			if (lastTurnEntries.length > 0) {
				lines.push("**Last few branch entries (what happened):**");
				for (const entry of lastTurnEntries) {
					if (entry.type === "message" && entry.message) {
						const role = entry.message.role;
						let text = "";
						if ("content" in entry.message) {
							const content = entry.message.content;
							if (typeof content === "string") text = content;
							else if (Array.isArray(content)) {
								text = content
									.filter((b: any) => b && b.type === "text")
									.map((b: any) => b.text)
									.join("\n");
							}
						}
						const summary = text.split(/\r?\n/)[0]?.slice(0, 120) ?? "";
						lines.push(`  [${role}] ${summary}${text.length > 120 ? "…" : ""}`);
					}
				}
				lines.push("");
			}

			lines.push(
				"The LLM's most recent turn was grounded in the rules and state shown above. " +
					"If a behavior surprises you, look here first for the basis.",
			);

			ctx.ui.notify(lines.join("\n"), "info");

			// Suppress unused arg
			void args;
		},
	});
}
