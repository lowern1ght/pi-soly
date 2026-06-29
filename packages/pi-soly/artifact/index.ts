// =============================================================================
// index.ts — pi-artifact extension entry point
// =============================================================================
//
// Registers one LLM tool: `html_artifact`. Renders LLM-supplied HTML to a
// self-contained file in a per-project dir and (by default) serves it from
// a session-scoped HTTP server with a live gallery of every artifact made this
// session — soly's local equivalent of Claude Code artifacts. Falls back to
// opening the file directly when the server is disabled or can't bind.
//
// The pure HTML builders live in render.ts; the server in server.ts; this module
// does the I/O wiring and teaches the LLM about the capability via the prompt.
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { platform } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { Type } from "typebox";
import type { SolyConfig } from "../config.ts";
import { atomicWriteFileSync } from "../util.ts";
import { buildArtifactHtml, artifactFileName, artifactFileNameForId, DEFAULT_CSS } from "./render.ts";
import {
	artifactDir,
	resolveArtifactBase,
	ensureArtifactServer,
	disposeArtifactServer,
	invalidateArtifactServer,
} from "./session.ts";

type ToolText = { content: { type: "text"; text: string }[]; details: Record<string, unknown> };
type Asset = { path: string; content: string; encoding?: string };

/** Load the artifact CSS theme: config override → .agents/artifact-theme.css →
 *  built-in DEFAULT_CSS. */
function loadCss(themeCfg: string, cwd: string): string {
	const candidates: string[] = [];
	const t = themeCfg.trim();
	if (t) candidates.push(path.isAbsolute(t) ? t : path.join(cwd, t));
	candidates.push(path.join(cwd, ".agents", "artifact-theme.css"));
	for (const c of candidates) {
		try {
			return fs.readFileSync(c, "utf-8");
		} catch {
			// try next
		}
	}
	return DEFAULT_CSS;
}

/** Delete session artifact dirs older than `days` under `baseDir`. Best-effort;
 *  skips when days <= 0. */
function pruneOldSessions(baseDir: string, days: number): void {
	if (days <= 0) return;
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(baseDir, { withFileTypes: true });
	} catch {
		return; // base dir doesn't exist yet — nothing to prune
	}
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const p = path.join(baseDir, e.name);
		try {
			if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
		} catch {
			// best effort
		}
	}
}

/** Write sibling assets into the session dir (confined to it). Returns count. */
function writeAssets(dir: string, assets: Asset[]): number {
	const root = path.resolve(dir);
	let n = 0;
	for (const a of assets) {
		const target = path.resolve(root, a.path);
		if (target !== root && !target.startsWith(root + path.sep)) continue; // skip traversal
		try {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			const buf = a.encoding === "base64" ? Buffer.from(a.content, "base64") : Buffer.from(a.content, "utf-8");
			fs.writeFileSync(target, buf);
			n++;
		} catch {
			// best effort
		}
	}
	return n;
}

/** Open a file or URL with the OS default handler (browser for .html / http). */
async function openInBrowser(pi: ExtensionAPI, target: string): Promise<void> {
	const o = platform();
	const r =
		o === "darwin"
			? await pi.exec("open", [target])
			: o === "win32"
				? await pi.exec("cmd", ["/c", "start", "", target])
				: await pi.exec("xdg-open", [target]);
	if (r.code !== 0) throw new Error(r.stderr || `open failed (exit ${r.code})`);
}

/** Direct-file fallback: open the .html file itself (no server). */
async function fileMode(
	pi: ExtensionAPI,
	file: string,
	bytes: number,
	shouldOpen: boolean,
	note?: string,
): Promise<ToolText> {
	let opened = false;
	let openError: string | undefined;
	if (shouldOpen) {
		try {
			await openInBrowser(pi, file);
			opened = true;
		} catch (err) {
			openError = String(err);
		}
	}
	const lines = [`Artifact written: ${file}`];
	if (note) lines.push(`(${note})`);
	if (opened) lines.push("Opened in the default browser.");
	else if (shouldOpen) lines.push(`(could not auto-open: ${openError ?? "unknown"} — open the file manually)`);
	else lines.push("(not opened — open the file manually or set artifacts.open)");
	return { content: [{ type: "text", text: lines.join("\n") }], details: { path: file, opened, bytes } };
}

export default function piArtifactExtension(pi: ExtensionAPI, getConfig: () => SolyConfig) {
	// A stale owner server may linger in the shared holder after /reload — stop
	// it (and clear its registry) so its pinned port is freed; the next artifact
	// (or /artifacts) re-resolves and re-binds it, restoring the per-project
	// manifest. No-op when nothing is running (fresh process).
	disposeArtifactServer();

	// Usage guidance lives in the soly-framework skill + the main soly prompt
	// pointer — not injected here.
	pi.on("session_start", async (_event, ctx) => {
		const cfg = getConfig().artifacts;
		pruneOldSessions(resolveArtifactBase(cfg.dir, ctx.cwd), cfg.retentionDays);
	});
	pi.on("session_shutdown", async () => {
		// Stop the server only if we own it; if we were a client reusing another
		// window's server, leave it running.
		disposeArtifactServer();
	});

	pi.registerTool({
		name: "html_artifact",
		label: "soly · html_artifact",
		description:
			"Render HTML to a self-contained file and serve it from a per-project gallery in the browser — soly's artifacts. `html` is a full document or a body fragment (wrapped in a styled light/dark skeleton; theme overridable via .agents/artifact-theme.css). Pass `id` to update an existing artifact in place (re-render). Pass `assets` to write sibling files (images/css/json) the HTML references via relative paths. Use when a visual rendered result beats terminal text. Self-contained otherwise — no external URLs. The gallery is shared across every pi window in this folder and survives restarts. Returns the localhost URL + gallery.",
		parameters: Type.Object({
			title: Type.String({ description: "Title (used for <title>, header, gallery, filename)." }),
			html: Type.String({
				description:
					"Full document or body fragment. Code in <pre><code>…</code></pre>. May reference sibling `assets` by relative path; otherwise self-contained.",
			}),
			id: Type.Optional(
				Type.String({ description: "Stable id — re-calling with the same id updates that artifact in place." }),
			),
			assets: Type.Optional(
				Type.Array(
					Type.Object({
						path: Type.String({ description: "Relative path within the artifact dir (e.g. 'data.json', 'img/logo.png')." }),
						content: Type.String({ description: "File content." }),
						encoding: Type.Optional(Type.String({ description: "'utf8' (default) or 'base64' for binary." })),
					}),
					{ description: "Sibling files the HTML references by relative path." },
				),
			),
			open: Type.Optional(
				Type.Boolean({ description: "Open the gallery in the browser (default: artifacts.open)." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolText> {
			const cfg = getConfig().artifacts;
			const dir = artifactDir(cfg.dir, ctx.cwd);
			try {
				fs.mkdirSync(dir, { recursive: true });
			} catch (err) {
				return {
					content: [{ type: "text", text: `html_artifact: could not create ${dir}: ${String(err)}` }],
					details: { error: "mkdir_failed", dir },
				};
			}

			if (params.assets?.length) writeAssets(dir, params.assets);

			const css = loadCss(cfg.theme, ctx.cwd);
			const name = params.id ? artifactFileNameForId(params.id) : artifactFileName(params.title, Date.now().toString(36));
			const file = path.join(dir, name);
			const html = buildArtifactHtml(params.title, params.html, css);
			atomicWriteFileSync(file, html);
			const bytes = Buffer.byteLength(html);
			const shouldOpen = params.open ?? cfg.open;

			if (!cfg.server) return fileMode(pi, file, bytes, shouldOpen);

			let server: Awaited<ReturnType<typeof ensureArtifactServer>>;
			try {
				server = await ensureArtifactServer(dir, ctx.cwd);
			} catch (err) {
				return fileMode(pi, file, bytes, shouldOpen, `artifact server unavailable: ${String(err)}`);
			}

			// Register over the shared server. If the owning window died mid-call
			// (client POST fails), re-resolve — probe finds nothing, so we start our
			// own server on the same pinned port (same URL) — then retry once.
			let url: string;
			try {
				url = await server.register(params.title, file, params.id);
			} catch {
				invalidateArtifactServer();
				server = await ensureArtifactServer(dir, ctx.cwd);
				url = await server.register(params.title, file, params.id);
			}
			const gallery = server.galleryUrl();
			let opened = false;
			let openError: string | undefined;
			if (shouldOpen && server.consumeFirstOpen()) {
				try {
					await openInBrowser(pi, gallery);
					opened = true;
				} catch (err) {
					openError = String(err);
				}
			}
			// No mid-turn ctx.ui.notify here: firing one while the model is still
			// streaming forces a repaint that can garble the TUI (the toast collided
			// with the footer + duplicated streamed lines). The user still sees the
			// artifact via auto-open, the `🖼 N` footer indicator, this tool result,
			// and `/artifacts`.
			const lines = [`Artifact: ${url}`, `Gallery (all project artifacts): ${gallery}`];
			if (opened) lines.push("Opened the gallery in your browser.");
			else if (openError) lines.push(`(could not auto-open: ${openError})`);
			return { content: [{ type: "text", text: lines.join("\n") }], details: { url, gallery, path: file, bytes, opened } };
		},
	});
}
