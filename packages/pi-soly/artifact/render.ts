// =============================================================================
// render.ts — pure HTML artifact builder (no I/O)
// =============================================================================
//
// Turns LLM-supplied content into a self-contained, nicely-styled HTML document
// that can be written to disk and opened in a browser — soly's local answer to
// "artifacts". If the content is already a full document (<!doctype/<html), it
// is passed through untouched; otherwise it's wrapped in a minimal skeleton with
// a clean default stylesheet (good code blocks, tables, light/dark aware).
//
// Pure: every function here takes strings and returns strings. The timestamp
// used in filenames is passed in by the caller so this module stays testable
// and deterministic.
// =============================================================================

/** Escape text for safe interpolation into HTML (title, header). */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** kebab-case slug for filenames; falls back to "artifact" when empty. */
export function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "artifact";
}

/** Deterministic artifact filename: `<slug>-<stamp>.html`. */
export function artifactFileName(title: string, stamp: string): string {
	return `${slugify(title)}-${stamp}.html`;
}

/** True when content is already a complete HTML document. */
export function isFullDocument(content: string): boolean {
	const head = content.trimStart().slice(0, 256).toLowerCase();
	return head.startsWith("<!doctype") || head.startsWith("<html");
}

/**
 * Build the final HTML. Full documents pass through; fragments are wrapped in a
 * styled skeleton with `title` as the page title and an optional header bar.
 */
export function buildArtifactHtml(title: string, content: string): string {
	if (isFullDocument(content)) return content;
	const safeTitle = escapeHtml(title);
	const header = title ? `<header><h1>${safeTitle}</h1></header>\n` : "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle || "soly artifact"}</title>
<style>${SKELETON_CSS}</style>
</head>
<body>
<main>
${header}${content}
</main>
</body>
</html>
`;
}

/** One artifact in the session gallery. */
export type GalleryEntry = { id: string; title: string; file: string; createdAt: number };

/**
 * Build the session gallery page: a live-updating list of every artifact made
 * this session, newest first. `token` namespaces the routes. The page opens an
 * SSE stream and reloads when a new artifact is registered. Self-contained.
 */
export function buildGalleryHtml(entries: GalleryEntry[], token: string): string {
	const items =
		entries.length === 0
			? `<p class="empty">No artifacts yet — they'll appear here as they're created.</p>`
			: `<ul class="gallery">\n${entries
					.map(
						(e) =>
							`<li><a href="/${token}/a/${encodeURIComponent(e.file)}">${escapeHtml(
								e.title,
							)}</a><time data-ts="${e.createdAt}"></time></li>`,
					)
					.join("\n")}\n</ul>`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>soly artifacts</title>
<style>${SKELETON_CSS}
.gallery{list-style:none;padding:0;margin:0}
.gallery li{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:.7rem 0;border-bottom:1px solid #e3e3e8}
.gallery a{font-size:1.05rem;font-weight:600}
.gallery time{color:#8a8a8e;font-size:.85rem;white-space:nowrap}
.empty{color:#8a8a8e}
.sub{font-size:.6em;font-weight:400;color:#8a8a8e}
@media (prefers-color-scheme:dark){.gallery li{border-color:#2c2c2e}}
</style>
</head>
<body>
<main>
<header><h1>soly artifacts <span class="sub">· this session</span></h1></header>
${items}
<script>
try{new EventSource('/${token}/events').onmessage=function(){location.reload()}}catch(e){}
document.querySelectorAll('time[data-ts]').forEach(function(t){t.textContent=new Date(+t.dataset.ts).toLocaleString()});
</script>
</main>
</body>
</html>
`;
}

// Self-contained stylesheet — no external fonts, scripts, or CDN requests.
const SKELETON_CSS = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#1c1c1e;background:#fbfbfd}
main{max-width:860px;margin:0 auto;padding:2.5rem 1.25rem 4rem}
header h1{margin:0 0 1.5rem;font-size:1.9rem;line-height:1.2;border-bottom:1px solid #e3e3e8;padding-bottom:.6rem}
h1,h2,h3{line-height:1.25;font-weight:650}
h2{margin-top:2rem;font-size:1.4rem}
h3{margin-top:1.5rem;font-size:1.15rem}
p{margin:.8rem 0}
a{color:#0a66c2;text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:.9em;
  background:#f0f0f4;border-radius:4px;padding:.12em .35em}
pre{background:#f5f5f7;border:1px solid #e3e3e8;border-radius:10px;padding:1rem 1.1rem;overflow-x:auto;
  line-height:1.5}
pre code{background:none;padding:0;font-size:.875rem}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.95rem}
th,td{border:1px solid #e3e3e8;padding:.5rem .7rem;text-align:left;vertical-align:top}
th{background:#f0f0f4;font-weight:650}
blockquote{margin:1rem 0;padding:.4rem 1rem;border-left:3px solid #c7c7cc;color:#48484a}
img{max-width:100%;height:auto}
hr{border:none;border-top:1px solid #e3e3e8;margin:2rem 0}
.cols{display:flex;gap:1rem;flex-wrap:wrap}
.cols>*{flex:1 1 280px;min-width:0}
@media (prefers-color-scheme:dark){
  body{color:#e6e6eb;background:#161618}
  header h1,h2,h3{border-color:#2c2c2e}
  code{background:#2c2c2e}
  pre{background:#1f1f22;border-color:#2c2c2e}
  th{background:#222225}
  th,td,hr{border-color:#2c2c2e}
  a{color:#5aa9ff}
  blockquote{border-color:#48484a;color:#aeaeb2}
}
`;
