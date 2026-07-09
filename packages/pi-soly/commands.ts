// =============================================================================
// commands.ts — Slash command registry (thin orchestrator)
// =============================================================================
//
// Wires up the per-command modules under `commands/`. The actual command
// bodies live in those modules so each one stays small and focused:
//
//   commands/_helpers.ts    — CommandUI, CommandsDeps, openListPanel, openExternally
//   commands/rules.ts       — /rules
//   commands/docs.ts        — /docs
//   commands/artifacts.ts   — /artifacts
//   commands/rulewizard.ts  — /rulewizard
//   commands/why.ts         — /why
//   commands/soly.ts        — /soly, /sly, /s (the big one — subcommand table)
//
// `registerCommands(pi, deps)` is the public surface called by `index.ts`.
// It takes a `CommandsDeps` and dispatches to the per-command `register*Command`
// functions, each of which takes a `Pick<CommandsDeps, …>` of just what
// it needs.
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CommandUI, CommandsDeps } from "./commands/_helpers.ts";
import { registerRulesCommand } from "./commands/rules.ts";
import { registerDocsCommand } from "./commands/docs.ts";
import { registerArtifactsCommand } from "./commands/artifacts.ts";
import { registerRulewizardCommand } from "./commands/rulewizard.ts";
import { registerWhyCommand } from "./commands/why.ts";
import { registerSolyCommand } from "./commands/soly.ts";

// Re-exports for backwards compatibility with external imports.
export type { CommandUI, CommandsDeps };

/** Public API called by `index.ts`. Each per-command register function
 *  pulls the deps it needs from the passed `CommandsDeps`; we just
 *  forward the whole object. */
export function registerCommands(pi: ExtensionAPI, deps: CommandsDeps): void {
	registerRulesCommand(pi, deps);
	registerDocsCommand(pi, deps);
	registerSolyCommand(pi, deps); // also registers /sly and /s
	registerArtifactsCommand(pi, deps);
	registerRulewizardCommand(pi, deps);
	registerWhyCommand(pi, deps);
}
