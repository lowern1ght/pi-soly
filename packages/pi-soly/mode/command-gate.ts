// =============================================================================
// mode/command-gate.ts — gate workflow commands by current mode
// =============================================================================
//
// In plans mode, the LLM-driven commands (`/soly new`, `/soly execute`,
// `/soly plan` …) are active. Phase-only commands (`/soly phase new`,
// `/soly phase list`, `/soly phase done`) are hidden in the picker and
// emit a usage error if invoked directly.
//
// In phases mode, the reverse. The shared commands (`/soly status`,
// `/soly verify`, `/soly inspect`, `/soly config`) work in both modes.
//
// We gate via a single helper called at the top of each command's handler.
// Centralising the check here means new commands can pick a mode without
// copying the same guard boilerplate.
// =============================================================================

import type { SolyMode } from "../config-mode.ts";

/** Tags that a command declares in its registration. */
export type CommandMode = "plans" | "phases" | "both";

/** Result of gating a command. If `mode === currentMode` or `mode === "both"`,
 *  the command runs. Otherwise the caller should emit a usage error. */
export function gateCommand(
	declared: CommandMode,
	currentMode: SolyMode,
): { allowed: boolean; reason?: string } {
	if (declared === "both") return { allowed: true };
	if (declared === currentMode) return { allowed: true };
	const other = declared === "plans" ? "phases" : "plans";
	return {
		allowed: false,
		reason: `this command is only available in ${declared} mode (current: ${currentMode}). Switch modes by editing .agents/soly.config.json, or use the ${other}-equivalent command.`,
	};
}
