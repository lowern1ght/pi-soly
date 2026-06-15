// =============================================================================
// integrations.ts — Registry of known cross-extension integrations
// =============================================================================
//
// soly treats itself as a platform: it composes with sibling pi-extensions
// when they're loaded. This file is the single source of truth for which
// external extensions we know about and how to advertise them in the
// system prompt. Add a new entry when a sibling extension ships a tool
// that the LLM should reach for in a soly-aware way.
//
// Detection: passive (read `pi.getActiveTools()` from `before_agent_start`).
// We only mention extensions that are *actually installed* — no noise about
// extensions the user hasn't loaded.
// =============================================================================

export interface KnownIntegration {
	/** Tool name as registered with `pi.registerTool`. Case-sensitive match. */
	tool: string;
	/** Short human label for the extension package (e.g. "pi-ask"). */
	extension: string;
	/** One-line summary of what the tool does. */
	summary: string;
	/** When/how the LLM should use this tool inside a soly workflow. */
	whenToUse: string;
}

/** Single registry — add new entries here, no other code changes needed. */
export const KNOWN_INTEGRATIONS: KnownIntegration[] = [
	{
		tool: "ask_pro",
		extension: "pi-ask",
		summary: "Multi-question tabbed picker (Claude Code style).",
		whenToUse:
			"Use instead of `soly_ask_user` for `soly discuss` flows when you have multiple related questions. PREFERRED in `soly discuss` when available.",
	},
	{
		tool: "todo_update",
		extension: "pi-todo",
		summary: "Live, user-visible task list rendered in the footer.",
		whenToUse:
			"During `soly execute <plan>`, seed todos at the start with one item per `<task>` so the user sees real-time progress. Update as you work: pending → in_progress → completed. Clear the list when the SUMMARY is committed.",
	},
];

/** Build the cross-extension integrations section for the system prompt.
 *  Returns null when none of the registered tools are present (no noise). */
export function buildIntegrationsSection(activeTools: readonly string[]): string | null {
	const installed = KNOWN_INTEGRATIONS.filter((i) => activeTools.includes(i.tool));
	if (installed.length === 0) return null;

	const lines: string[] = [];
	lines.push("");
	lines.push("## Cross-extension integrations (active in this session)");
	lines.push("");
	lines.push(
		"The following optional pi-extensions are loaded. Use their tools when the situation matches — they exist to make your output more useful to the user.",
	);
	lines.push("");
	for (const i of installed) {
		lines.push(`- \`${i.tool}\` (from \`${i.extension}\`) — ${i.summary}`);
		lines.push(`  When: ${i.whenToUse}`);
	}
	return lines.join("\n");
}
