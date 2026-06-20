// =============================================================================
// tests/artifact.test.ts — html_artifact pure builder + config wiring
// =============================================================================

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	escapeHtml,
	slugify,
	artifactFileName,
	isFullDocument,
	buildArtifactHtml,
	buildGalleryHtml,
} from "../artifact/render.ts";
import { ArtifactServer } from "../artifact/server.ts";
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

describe("artifact — config", () => {
	test("default config has an artifacts section", () => {
		expect(DEFAULT_CONFIG.artifacts.open).toBe(true);
		expect(DEFAULT_CONFIG.artifacts.dir).toBe("");
	});

	test("default config enables the session server", () => {
		expect(DEFAULT_CONFIG.artifacts.server).toBe(true);
	});
});

describe("artifact — gallery builder", () => {
	test("lists entries with token-scoped links, escaping, and live-reload", () => {
		const html = buildGalleryHtml(
			[{ id: "1", title: "My <Art>", file: "my-art-x.html", createdAt: 1000 }],
			"TOK",
		);
		expect(html).toContain("/TOK/a/my-art-x.html"); // token-scoped artifact link
		expect(html).toContain("My &lt;Art&gt;"); // title escaped
		expect(html).toContain("/TOK/events"); // SSE endpoint
		expect(html).toContain("EventSource");
		expect(html).not.toContain("http://"); // no external requests
	});

	test("empty state", () => {
		expect(buildGalleryHtml([], "TOK")).toContain("No artifacts yet");
	});
});

describe("artifact — session server", () => {
	test("serves the gallery + artifact, rejects bad token + traversal", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soly-art-"));
		fs.writeFileSync(path.join(dir, "demo-x.html"), "<!doctype html><h1>Demo Body</h1>");
		const srv = new ArtifactServer(dir);
		await srv.ensureStarted();
		try {
			const url = srv.register("Demo", path.join(dir, "demo-x.html"));

			const aRes = await fetch(url);
			expect(aRes.status).toBe(200);
			expect(await aRes.text()).toContain("Demo Body");

			const gRes = await fetch(srv.galleryUrl());
			expect(gRes.status).toBe(200);
			expect(await gRes.text()).toContain("Demo"); // title listed

			// Wrong token → 404
			const badToken = srv.galleryUrl().replace(/\/[0-9a-f]+\/$/, "/deadbeef/");
			expect((await fetch(badToken)).status).toBe(404);

			// Path traversal is stripped to a basename → not found
			const trav = srv.galleryUrl() + "a/" + encodeURIComponent("../../etc/hosts");
			expect((await fetch(trav)).status).toBe(404);

			// First-open latch fires exactly once
			expect(srv.consumeFirstOpen()).toBe(true);
			expect(srv.consumeFirstOpen()).toBe(false);
		} finally {
			srv.stop();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
