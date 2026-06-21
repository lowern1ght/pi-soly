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
	buildGalleryShell,
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
	test("keeps a full document's markup but injects the base theme", () => {
		const doc = "<!doctype html><html><head></head><body>x</body></html>";
		const out = buildArtifactHtml("T", doc);
		expect(out).toContain("<body>x</body>"); // original markup preserved
		expect(out).toContain("<style data-soly>"); // theme injected as a base layer
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

describe("artifact — gallery shell", () => {
	test("is a self-contained SPA shell wired to the token routes", () => {
		const html = buildGalleryShell("TOK");
		expect(html).toContain('var T="TOK"'); // token baked into the JS
		expect(html).toContain("'/'+T+'/list'"); // fetches the list
		expect(html).toContain("EventSource");
		expect(html).toContain("<iframe");
		expect(html).not.toContain("http://"); // no external requests
	});
});

describe("artifact — session server", () => {
	test("serves shell/list/artifact with MIME, updates in place, rejects bad token + traversal", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soly-art-"));
		fs.writeFileSync(path.join(dir, "demo.html"), "<!doctype html><h1>Demo Body</h1>");
		fs.writeFileSync(path.join(dir, "data.json"), '{"x":1}');
		const srv = new ArtifactServer(dir);
		await srv.ensureStarted();
		try {
			const base = srv.galleryUrl(); // http://127.0.0.1:PORT/<token>/
			const url = srv.register("Demo", path.join(dir, "demo.html"), "demo");

			// Artifact served as HTML
			const aRes = await fetch(url);
			expect(aRes.status).toBe(200);
			expect(aRes.headers.get("content-type")).toContain("text/html");
			expect(await aRes.text()).toContain("Demo Body");

			// Gallery shell
			const gRes = await fetch(base);
			expect(gRes.status).toBe(200);
			expect(await gRes.text()).toContain("soly artifacts");

			// List JSON
			const list = (await (await fetch(base + "list")).json()) as { id: string; title: string }[];
			expect(list.length).toBe(1);
			expect(list[0]?.id).toBe("demo");

			// Update-in-place: same id → still one entry, new title
			srv.register("Demo v2", path.join(dir, "demo.html"), "demo");
			const list2 = (await (await fetch(base + "list")).json()) as { title: string }[];
			expect(list2.length).toBe(1);
			expect(list2[0]?.title).toBe("Demo v2");

			// Sibling asset served with correct MIME
			const jRes = await fetch(base + "a/data.json");
			expect(jRes.status).toBe(200);
			expect(jRes.headers.get("content-type")).toContain("application/json");

			// Wrong token → 404
			const badToken = base.replace(/\/[0-9a-f]+\/$/, "/deadbeef/");
			expect((await fetch(badToken)).status).toBe(404);

			// Path traversal is refused (403 or 404 depending on URL normalization)
			const trav = base + "a/" + encodeURIComponent("../../etc/hosts");
			expect([403, 404]).toContain((await fetch(trav)).status);

			// count / list / remove / clear
			srv.register("Second", path.join(dir, "data.json"), "two");
			expect(srv.count).toBe(2);
			expect(srv.list().map((e) => e.id).sort()).toEqual(["demo", "two"]);
			expect(srv.list()[0]?.url).toContain("/a/");
			expect(srv.remove("two")).toBe(true);
			expect(srv.remove("nope")).toBe(false);
			expect(srv.count).toBe(1);
			expect(srv.clear()).toBe(1);
			expect(srv.count).toBe(0);

			// First-open latch fires exactly once
			expect(srv.consumeFirstOpen()).toBe(true);
			expect(srv.consumeFirstOpen()).toBe(false);
		} finally {
			srv.stop();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a fresh server restores persisted artifacts from the manifest (survives /reload)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soly-art-persist-"));
		fs.writeFileSync(path.join(dir, "a.html"), "<h1>A</h1>");
		try {
			const s1 = new ArtifactServer(dir);
			s1.register("Alpha", path.join(dir, "a.html"), "alpha"); // persists index.json
			// Simulate /reload: a brand-new server over the same project dir.
			const s2 = new ArtifactServer(dir);
			expect(s2.count).toBe(1);
			expect(s2.list()[0]?.id).toBe("alpha");
			expect(s2.list()[0]?.title).toBe("Alpha");
			// An entry whose file was deleted is dropped on restore.
			fs.unlinkSync(path.join(dir, "a.html"));
			expect(new ArtifactServer(dir).count).toBe(0);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
