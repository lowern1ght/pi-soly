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

\`html_artifact\` renders HTML to a self-contained local file and opens it in the browser — soly's version of artifacts. Reach for it when a **visual, rendered** result beats terminal text:
- A gallery of code examples with explanations, or before/after comparisons
- Side-by-side options, comparison tables, or a styled cheat-sheet
- Diagrams, a small rendered HTML/CSS/SVG demo, or anything where layout/color carries meaning

How: pass \`title\` and \`html\`. \`html\` can be a full document OR just body content — a fragment is wrapped in a styled skeleton (clean typography, nice \`<pre><code>\` blocks, tables, light/dark aware), so usually you only send the body. Put code in \`<pre><code>…</code></pre>\`.

**Hard constraint — self-contained:** inline all CSS and JS, embed images as data: URIs. No external stylesheets, fonts, scripts, or CDN/network requests (the file is opened from disk).

Don't use it for: a single short snippet (use a markdown code block), plain prose answers, or interactive choices (use \`ask_pro\` / \`decision_deck\`). The file is written to a temp dir and the path is returned to you — mention it to the user.`;
}
