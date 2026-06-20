// =============================================================================
// tests/artifact.test.ts — html_artifact pure builder + config wiring
// =============================================================================

import { describe, expect, test } from "bun:test";
import {
	escapeHtml,
	slugify,
	artifactFileName,
	isFullDocument,
	buildArtifactHtml,
} from "../artifact/render.ts";
import { buildArtifactSection } from "../artifact/prompt.ts";
import { DEFAULT_CONFIG } from "../config.ts";

describe("artifact — slug & filename", () => {
	test("slugify normalizes and caps", () => {
		expect(slugify("Auth: Token Storage!")).toBe("auth-token-storage");
		expect(slugify("   ")).toBe("artifact");
		expect(slugify("a".repeat(80)).length).toBeLessThanOrEqual(48);
	});

	test("artifactFileName combines slug + stamp", () => {
		expect(artifactFileName("My Page", "abc")).toBe("my-page-abc.html");
		expect(artifactFileName("", "x")).toBe("artifact-x.html");
	});
});

describe("artifact — escapeHtml", () => {
	test("escapes the dangerous five", () => {
		expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
	});
});

describe("artifact — isFullDocument", () => {
	test("detects full documents", () => {
		expect(isFullDocument("<!doctype html><html></html>")).toBe(true);
		expect(isFullDocument("  \n<HTML>")).toBe(true);
		expect(isFullDocument("<h1>hi</h1>")).toBe(false);
		expect(isFullDocument("<div>body</div>")).toBe(false);
	});
});

describe("artifact — buildArtifactHtml", () => {
	test("passes full documents through untouched", () => {
		const doc = "<!doctype html><html><body>x</body></html>";
		expect(buildArtifactHtml("T", doc)).toBe(doc);
	});

	test("wraps a fragment in a styled, self-contained skeleton", () => {
		const out = buildArtifactHtml("Demo", "<p>hello</p>");
		expect(out.startsWith("<!doctype html>")).toBe(true);
		expect(out).toContain("<title>Demo</title>");
		expect(out).toContain("<h1>Demo</h1>"); // header bar
		expect(out).toContain("<p>hello</p>"); // body embedded
		expect(out).toContain("<style>"); // inline CSS
		expect(out).not.toContain("http://"); // no external requests
		expect(out).not.toContain("https://");
	});

	test("escapes the title to prevent breaking out of <title>", () => {
		const out = buildArtifactHtml("<script>", "<p>x</p>");
		expect(out).toContain("<title>&lt;script&gt;</title>");
		expect(out).not.toContain("<title><script></title>");
	});
});

describe("artifact — config & prompt", () => {
	test("default config has an artifacts section", () => {
		expect(DEFAULT_CONFIG.artifacts.open).toBe(true);
		expect(DEFAULT_CONFIG.artifacts.dir).toBe("");
	});

	test("prompt section names the tool and the self-contained rule", () => {
		const s = buildArtifactSection();
		expect(s).toContain("html_artifact");
		expect(s.toLowerCase()).toContain("self-contained");
	});
});
