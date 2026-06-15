/// <reference types="bun-types" />
// =============================================================================
// tests/html.test.ts — Unit tests for html.ts (shared HTML utilities)
// =============================================================================
//
// html.ts is pure (no I/O) — we test it in isolation. Coverage: tag
// stripping, entity decoding, title/description extraction from raw HTML,
// and the unified .md/.html extractor used by both docs.ts and intent.ts.
// =============================================================================

import { describe, test, expect } from "bun:test";
import { stripHtml, extractHtmlMeta, extractTitleAndPreview } from "../html.js";

describe("stripHtml", () => {
	test("strips simple tags", () => {
		expect(stripHtml("<p>hello</p>")).toBe("hello");
		expect(stripHtml("<p>hello <b>world</b></p>")).toBe("hello world");
	});

	test("strips <style> and <script> content entirely", () => {
		expect(stripHtml("hello<style>.x{color:red}</style>world")).toBe("hello world");
		expect(stripHtml("hello<script>alert(1)</script>world")).toBe("hello world");
	});

	test("strips HTML comments", () => {
		expect(stripHtml("before<!-- secret -->after")).toBe("before after");
	});

	test("decodes common entities", () => {
		expect(stripHtml("a&nbsp;b")).toBe("a b");
		expect(stripHtml("Q&amp;A")).toBe("Q&A");
		expect(stripHtml("&lt;tag&gt;")).toBe("<tag>");
		expect(stripHtml("say &quot;hi&quot;")).toBe('say "hi"');
		expect(stripHtml("it&#39;s")).toBe("it's");
	});

	test("collapses whitespace", () => {
		expect(stripHtml("a\n\nb\t\tc")).toBe("a b c");
		expect(stripHtml("  <p>  hello  </p>  ")).toBe("hello");
	});

	test("trims leading/trailing whitespace", () => {
		expect(stripHtml("   <p>x</p>   ")).toBe("x");
	});

	test("handles empty input", () => {
		expect(stripHtml("")).toBe("");
	});

	test("handles nested tags", () => {
		expect(stripHtml("<div><span><em>x</em></span></div>")).toBe("x");
	});
});

describe("extractHtmlMeta", () => {
	test("reads <title>", () => {
		const html = "<html><head><title>My Page</title></head><body>body</body></html>";
		const m = extractHtmlMeta(html);
		expect(m.title).toBe("My Page");
	});

	test("falls back to <h1> when no <title>", () => {
		const html = "<html><body><h1>Header</h1></body></html>";
		const m = extractHtmlMeta(html);
		expect(m.title).toBe("Header");
	});

	test("<title> wins over <h1>", () => {
		const html = "<html><head><title>Title</title></head><body><h1>H1</h1></body></html>";
		const m = extractHtmlMeta(html);
		expect(m.title).toBe("Title");
	});

	test("reads <meta name='description'>", () => {
		const html = `<html><head><meta name="description" content="A short summary"></head></html>`;
		const m = extractHtmlMeta(html);
		expect(m.description).toBe("A short summary");
	});

	test("decodes entities in title and description", () => {
		const html = `<html><head><title>Q&amp;A: &lt;the&gt; future</title><meta name="description" content="it&#39;s a test"></head></html>`;
		const m = extractHtmlMeta(html);
		expect(m.title).toBe("Q&A: <the> future");
		expect(m.description).toBe("it's a test");
	});

	test("caps title at 200 chars and description at 300", () => {
		const longTitle = "a".repeat(500);
		const longDesc = "b".repeat(500);
		const html = `<html><head><title>${longTitle}</title><meta name="description" content="${longDesc}"></head></html>`;
		const m = extractHtmlMeta(html);
		expect(m.title.length).toBe(200);
		expect(m.description.length).toBe(300);
	});

	test("returns empty title when neither <title> nor <h1> present", () => {
		const html = "<html><body><p>just body</p></body></html>";
		const m = extractHtmlMeta(html);
		expect(m.title).toBe("");
	});
});

describe("extractTitleAndPreview", () => {
	test("markdown: extracts H1 as title", () => {
		const md = `# Welcome

This is the body of the document.`;
		const r = extractTitleAndPreview(md, ".md");
		expect(r.title).toBe("Welcome");
		expect(r.preview).toContain("This is the body");
	});

	test("markdown: strips frontmatter before title extraction", () => {
		const md = `---
description: frontmatter desc
author: alice
---

# Real Title

Body content here.`;
		const r = extractTitleAndPreview(md, ".md");
		expect(r.title).toBe("Real Title");
		expect(r.preview).toContain("Body content here");
		// Frontmatter should NOT appear in preview
		expect(r.preview).not.toContain("frontmatter desc");
	});

	test("markdown: falls back to first non-blank, non-code-fence line", () => {
		// No H1 in the body — fallback should pick the first non-blank line.
		const md = `Not a heading, just a sentence.

And another paragraph.
`;
		const r = extractTitleAndPreview(md, ".md");
		expect(r.title).toBe("Not a heading, just a sentence.");
	});

	test("markdown: H1 wins over fallback", () => {
		// Both an H1 and a fallback-eligible line exist — H1 wins.
		const md = `Some intro line.

# Real heading

body`;
		const r = extractTitleAndPreview(md, ".md");
		expect(r.title).toBe("Real heading");
	});

	test("markdown: skips code-fence lines in fallback", () => {
		const md = `\`\`\`js
const x = 1;
\`\`\`
First real line.`;
		const r = extractTitleAndPreview(md, ".md");
		expect(r.title).toBe("First real line.");
	});

	test("markdown: filters headings and code from preview body", () => {
		const md = `# Title

body line one
body line two

\`\`\`js
const skip = 1;
\`\`\`

more body`;
		const r = extractTitleAndPreview(md, ".md");
		expect(r.preview).toContain("body line one");
		expect(r.preview).toContain("body line two");
		expect(r.preview).not.toContain("const skip");
	});

	test("html: delegates to extractHtmlMeta + stripHtml", () => {
		const html = `<html><head><title>T</title><meta name="description" content="D"></head><body>body</body></html>`;
		const r = extractTitleAndPreview(html, ".html");
		expect(r.title).toBe("T");
		expect(r.preview).toBe("D");
	});

	test("html: when no description, uses stripped body as preview", () => {
		const html = `<html><head><title>T</title></head><body><p>body</p></body></html>`;
		const r = extractTitleAndPreview(html, ".html");
		expect(r.title).toBe("T");
		expect(r.preview).toContain("body");
	});

	test("respects maxPreview", () => {
		const long = "# t\n\n" + "x".repeat(1000);
		const r = extractTitleAndPreview(long, ".md", { maxPreview: 50 });
		expect(r.preview.length).toBeLessThanOrEqual(50);
	});

	test("title is capped at 120 chars", () => {
		const longTitle = "a".repeat(200);
		const md = `# ${longTitle}\n\nbody`;
		const r = extractTitleAndPreview(md, ".md");
		expect(r.title.length).toBe(120);
	});
});
