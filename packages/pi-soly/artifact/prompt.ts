// =============================================================================
// prompt.ts — System-prompt section for the pi-artifact extension
// =============================================================================
//
// Injected via before_agent_start so the LLM knows the html_artifact tool
// exists, when to reach for it, and the self-contained constraint. The trap is
// both under-use (never producing a visual when one would help) and over-use
// (a whole HTML page for something a code block answers).
// =============================================================================

/** Build the "when to use html_artifact" section. Pure, testable. */
export function buildArtifactSection(): string {
	return `

## pi-artifact — when to use \`html_artifact\`

\`html_artifact\` renders HTML to a self-contained local file and opens it in the browser — soly's artifacts. Reach for it when a visual, rendered result beats terminal text: example galleries, before/after or side-by-side comparisons, tables, diagrams, a small HTML/CSS/SVG demo. Pass \`title\` + \`html\` (a body fragment is fine — it's wrapped in a styled skeleton; put code in \`<pre><code>\`). **Self-contained only:** inline all CSS/JS, embed images as data: URIs, no external/CDN requests. Don't use it for a single snippet (markdown code block), prose, or interactive choices (\`ask_pro\`/\`decision_deck\`). Mention the returned file path to the user.`;
}
