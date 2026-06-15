// =============================================================================
// html.ts — Shared HTML utilities (shared between intent and docs loaders)
// =============================================================================
//
// Single source of truth for parsing `.html`/`.htm` intent docs and for
// stripping HTML tags from arbitrary text. Previously duplicated in
// intent.ts and docs.ts — extracting here lets the test suite cover
// one parser instead of two, and prevents drift.
//
// Public API:
//   - stripHtml(html)              — strip tags + decode common entities
//   - extractHtmlMeta(html)        — pull <title> / <h1> / <meta description>
//   - extractTitleAndPreview(raw, ext, opts?) — unified .md / .html frontmatter
//
// All functions are pure (no I/O) — they accept a string and return
// a string (or a small object). They never read the filesystem.
// =============================================================================

const HTML_TAG_RE = /<[^>]+>/g;
const HTML_STYLE_RE = /<style[\s\S]*?<\/style>/gi;
const HTML_SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HTML_TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HTML_H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const HTML_META_DESC_RE = /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i;

// Markdown frontmatter (YAML-ish). Captures: [1] body after the closing `---`.
const MD_FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/;

/** Strip just the tags (used internally for title/description extraction). */
function stripTags(html: string): string {
  return html
    .replace(HTML_STYLE_RE, " ")
    .replace(HTML_SCRIPT_RE, " ")
    .replace(HTML_COMMENT_RE, " ")
    .replace(HTML_TAG_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip HTML tags and decode common entities. Whitespace is collapsed. */
export function stripHtml(html: string): string {
  return stripTags(html)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export interface HtmlMeta {
  title: string;
  description: string;
}

/**
 * Extract `<title>` / `<h1>` (fallback) / `<meta name="description">` from a
 * raw HTML document. Entities in the extracted text are decoded. Title is
 * capped at 200 chars, description at 300.
 */
export function extractHtmlMeta(html: string): HtmlMeta {
  const titleMatch = html.match(HTML_TITLE_RE);
  const h1Match = html.match(HTML_H1_RE);
  const metaMatch = html.match(HTML_META_DESC_RE);
  const title =
    (titleMatch?.[1] ? stripHtml(titleMatch[1]) : "") ||
    (h1Match?.[1] ? stripHtml(h1Match[1]) : "");
  const description = metaMatch?.[1] ? stripHtml(metaMatch[1]) : "";
  return {
    title: title.slice(0, 200),
    description: description.slice(0, 300),
  };
}

export interface ExtractedDoc {
  title: string;
  preview: string;
}

/**
 * Unified title + preview extractor for both `.md` and `.html`/`.htm` files.
 * Markdown path strips YAML frontmatter, picks the first H1 (or first non-blank
 * non-code-fence line as fallback), and joins non-heading non-code paragraphs.
 * HTML path delegates to `extractHtmlMeta` + `stripHtml`.
 *
 * @param raw   Full file content
 * @param ext   Lowercase file extension, e.g. ".md", ".html", ".htm"
 * @param opts  `maxPreview` caps the preview string (default 200)
 */
export function extractTitleAndPreview(
  raw: string,
  ext: ".md" | ".html" | ".htm",
  opts: { maxPreview?: number } = {},
): ExtractedDoc {
  const maxPreview = opts.maxPreview ?? 200;
  if (ext === ".html" || ext === ".htm") {
    const { title, description } = extractHtmlMeta(raw);
    return {
      title: title.slice(0, 120),
      preview: description || stripHtml(raw).slice(0, maxPreview),
    };
  }

  // Markdown path
  const fmMatch = raw.match(MD_FRONTMATTER_RE);
  const body = fmMatch ? fmMatch[1] : raw;
  const lines = body.split(/\r?\n/);

  // Strip fenced code blocks (``` ... ```) so we don't pull in code as the
  // title or as part of the preview body. Track open/close state across
  // lines: a fence opens, everything until the matching close is skipped.
  const stripCodeBlocks = (input: string[]): string[] => {
    const out: string[] = [];
    let inFence = false;
    for (const l of input) {
      const trimmed = l.trim();
      if (trimmed.startsWith("```")) {
        inFence = !inFence;
        continue; // skip the fence line itself
      }
      if (inFence) continue;
      out.push(l);
    }
    return out;
  };
  const bodyLines = stripCodeBlocks(lines);

  let title = "";
  for (const l of bodyLines) {
    const h = l.match(/^#\s+(.+)$/);
    if (h) {
      title = h[1].trim();
      break;
    }
  }
  if (!title) {
    for (const l of bodyLines) {
      const t = l.trim();
      if (t) {
        title = t;
        break;
      }
    }
  }

  const meaningful = bodyLines
    .filter((l) => l.trim() && !l.startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title.slice(0, 120),
    preview: meaningful.slice(0, maxPreview),
  };
}
