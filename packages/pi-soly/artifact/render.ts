// =============================================================================
// render.ts — pure HTML artifact builder + gallery shell (no I/O)
// =============================================================================
//
// Turns LLM-supplied content into a nicely-styled HTML document and builds the
// session gallery shell — soly's local "artifacts". Pure: every function takes
// strings and returns strings; the stylesheet is passed in (loaded from a file
// or the built-in DEFAULT_CSS by the caller) so a project can restyle every
// artifact by dropping a `.agents/artifact-theme.css`.
//
// A body *fragment* is wrapped in the skeleton; a *full document* keeps its own
// markup but gets the theme injected as a base layer (its own styles win).
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

/** kebab-case slug for filenames/ids; falls back to "artifact" when empty. */
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

/** Stable filename for an id-keyed artifact (update-in-place). */
export function artifactFileNameForId(id: string): string {
	return `${slugify(id)}.html`;
}

/** True when content is already a complete HTML document. */
export function isFullDocument(content: string): boolean {
	const head = content.trimStart().slice(0, 256).toLowerCase();
	return head.startsWith("<!doctype") || head.startsWith("<html");
}

/** Inject soly's base stylesheet into a full document as a fallback layer
 *  (placed at the start of <head> so the document's own styles override it). */
export function injectStyle(doc: string, css: string): string {
	const style = `<style data-soly>${css}</style>`;
	if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}\n${style}`);
	if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${style}</head>`);
	return `${style}\n${doc}`;
}

/**
 * Build the final HTML. Fragments are wrapped in a styled skeleton; full
 * documents keep their markup but get the theme injected as a base layer.
 */
export function buildArtifactHtml(title: string, content: string, css: string = DEFAULT_CSS): string {
	if (isFullDocument(content)) return injectStyle(content, css);
	const safeTitle = escapeHtml(title);
	const header = title ? `<header><h1>${safeTitle}</h1></header>\n` : "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle || "soly artifact"}</title>
<style>${css}</style>
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
 * The session gallery SPA shell: a sidebar listing every artifact this session
 * (fetched live from `/<token>/list`), a viewer iframe, filter box, light/dark
 * toggle, and "open raw". An SSE stream re-fetches the list and refreshes the
 * open artifact when something changes. Vanilla JS — no framework, no CDN.
 */
export function buildGalleryShell(token: string): string {
	const t = JSON.stringify(token);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>soly artifacts</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<aside id="side">
  <header><span>soly artifacts <span class="sub">this project</span></span><button id="theme" title="Toggle theme">◐</button></header>
  <input id="q" placeholder="Filter…" autocomplete="off">
  <ul id="list"></ul>
  <p id="empty">No artifacts yet — they'll appear here as they're created.</p>
</aside>
<main>
  <div id="bar"><span class="grow" id="cur">Select an artifact →</span><button id="raw">Open raw ↗</button></div>
  <iframe id="view" title="artifact"></iframe>
</main>
<script>
(function(){
  var T=${t};
  var list=document.getElementById('list'),q=document.getElementById('q'),
      view=document.getElementById('view'),cur=document.getElementById('cur'),
      empty=document.getElementById('empty');
  var entries=[],activeFile=null;
  function fmt(ts){try{return new Date(ts).toLocaleString()}catch(e){return ''}}
  function show(e){activeFile=e.file;view.src='/'+T+'/a/'+encodeURIComponent(e.file)+'?t='+Date.now();cur.textContent=e.title;render();}
  function render(){
    var f=(q.value||'').toLowerCase();
    empty.style.display=entries.length?'none':'block';
    list.innerHTML='';
    entries.filter(function(e){return e.title.toLowerCase().indexOf(f)>=0}).forEach(function(e){
      var li=document.createElement('li');
      if(e.file===activeFile)li.className='active';
      var t=document.createElement('span');t.className='t';t.textContent=e.title;
      var ts=document.createElement('span');ts.className='ts';ts.textContent=fmt(e.createdAt);
      li.appendChild(t);li.appendChild(ts);
      li.onclick=function(){show(e)};
      list.appendChild(li);
    });
  }
  function load(cb){fetch('/'+T+'/list').then(function(r){return r.json()}).then(function(d){entries=d||[];render();if(cb)cb()}).catch(function(){});}
  q.oninput=render;
  document.getElementById('raw').onclick=function(){if(view.src)window.open(view.src,'_blank')};
  var th=document.getElementById('theme');
  function applyTheme(x){if(x)document.documentElement.setAttribute('data-theme',x)}
  applyTheme(localStorage.getItem('soly-theme'));
  th.onclick=function(){var c=document.documentElement.getAttribute('data-theme');var n=c==='dark'?'light':'dark';applyTheme(n);try{localStorage.setItem('soly-theme',n)}catch(e){}};
  load(function(){if(entries.length)show(entries[0])});
  try{var es=new EventSource('/'+T+'/events');es.onmessage=function(){load(function(){
    if(activeFile&&entries.some(function(e){return e.file===activeFile}))show(entries.filter(function(e){return e.file===activeFile})[0]);
    else if(entries.length)show(entries[0]);
  })};}catch(e){}
})();
</script>
</body>
</html>
`;
}

// Self-contained artifact stylesheet — no external fonts, scripts, or CDN
// requests. Overridable per project via .agents/artifact-theme.css.
export const DEFAULT_CSS = `
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

// Gallery app-shell chrome (distinct from artifact content styling above).
const SHELL_CSS = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;height:100vh;display:flex;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;background:#fbfbfd}
#side{width:280px;flex:0 0 280px;display:flex;flex-direction:column;height:100vh;background:#f5f5f7;border-right:1px solid #e3e3e8}
#side header{padding:1rem 1rem .6rem;font-weight:650;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
#side header .sub{font-size:.7rem;font-weight:400;color:#8a8a8e}
#theme{font:inherit;border:1px solid #d0d0d5;background:#fff;border-radius:7px;cursor:pointer;padding:.1rem .45rem}
#q{margin:.2rem 1rem .6rem;padding:.4rem .6rem;border:1px solid #d0d0d5;border-radius:8px;font:inherit}
#list{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1}
#list li{padding:.55rem 1rem;border-bottom:1px solid #ececf0;cursor:pointer}
#list li:hover{background:#ececf0}
#list li.active{background:#e1e8ff}
#list .t{font-weight:600;font-size:.92rem;display:block}
#list .ts{color:#8a8a8e;font-size:.75rem}
#empty{padding:1rem;color:#8a8a8e}
main{flex:1;height:100vh;display:flex;flex-direction:column;min-width:0}
#bar{display:flex;gap:.5rem;align-items:center;padding:.4rem .8rem;border-bottom:1px solid #e3e3e8;font-size:.85rem}
#bar .grow{flex:1;color:#48484a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#bar button{font:inherit;padding:.25rem .6rem;border:1px solid #d0d0d5;border-radius:7px;background:#fff;cursor:pointer}
iframe{flex:1;border:0;width:100%;background:#fff}
html[data-theme=dark]{color-scheme:dark}
html[data-theme=light]{color-scheme:light}
html[data-theme=dark] body{color:#e6e6eb;background:#161618}
html[data-theme=dark] #side{background:#1c1c1e;border-color:#2c2c2e}
html[data-theme=dark] #q,html[data-theme=dark] #theme,html[data-theme=dark] #bar button{background:#222;color:#e6e6eb;border-color:#3a3a3c}
html[data-theme=dark] #list li{border-color:#242426}
html[data-theme=dark] #list li:hover{background:#242426}
html[data-theme=dark] #list li.active{background:#2a3358}
html[data-theme=dark] #bar{border-color:#2c2c2e}
html[data-theme=dark] iframe{background:#161618}
@media (prefers-color-scheme:dark){
  body{color:#e6e6eb;background:#161618}
  #side{background:#1c1c1e;border-color:#2c2c2e}
  #q,#theme,#bar button{background:#222;color:#e6e6eb;border-color:#3a3a3c}
  #list li{border-color:#242426}
  #list li:hover{background:#242426}
  #list li.active{background:#2a3358}
  #bar{border-color:#2c2c2e}
  iframe{background:#161618}
}
`;
