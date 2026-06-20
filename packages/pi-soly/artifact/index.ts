// =============================================================================
// index.ts — pi-artifact extension entry point
// =============================================================================
//
// Registers one LLM tool: `html_artifact`. Renders LLM-supplied HTML to a
// self-contained file in a per-session temp dir and (by default) serves it from
// a session-scoped HTTP server with a live gallery of every artifact made this
// session — soly's local equivalent of Claude Code artifacts. Falls back to
// opening the file directly when the server is disabled or can't bind.
//
// The pure HTML builders live in render.ts; the server in server.ts; this module
// does the I/O wiring and teaches the LLM about the capability via the prompt.
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { platform } from "node:os";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import { Type } from "typebox";
import type { SolyConfig } from "../config.ts";
import { atomicWriteFileSync } from "../util.ts";
import { buildArtifactHtml, artifactFileName } from "./render.ts";
import { ArtifactServer } from "./server.ts";

type ToolText = { content: { type: "text"; text: string }[]; details: Record<string, unknown> };

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

/** Resolve the artifact base directory: config override (abs / ~ / relative to
 *  cwd) or the OS temp dir under pi-soly-artifacts/. */
function resolveDir(configDir: string, cwd: string): string {
	const d = configDir.trim();
	if (!d) return path.join(os.tmpdir(), "pi-soly-artifacts");
	if (d === "~" || d.startsWith("~/") || d.startsWith("~\\")) {
		return path.join(os.homedir(), d.slice(1).replace(/^[/\\]/, ""));
	}
	return path.isAbsolute(d) ? d : path.join(cwd, d);
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
	let server: ArtifactServer | null = null;
	const sessionId = randomBytes(6).toString("hex");

	// Usage guidance lives in the soly-framework skill + the main soly prompt
	// pointer — not injected here.
	pi.on("session_shutdown", async () => {
		server?.stop();
		server = null;
	});

	pi.registerTool({
		name: "html_artifact",
		label: "soly · html_artifact",
		description:
			"Render HTML to a self-contained file and serve it from a per-session gallery in the browser — soly's artifacts. `html` is a full document or a body fragment (wrapped in a styled light/dark skeleton with good code/table styling). Use when a visual rendered result beats terminal text: example galleries, comparisons, diagrams, HTML/CSS demos. Self-contained only — inline CSS/JS, no external URLs. Returns a localhost URL for the artifact + the session gallery.",
		parameters: Type.Object({
			title: Type.String({ description: "Title (used for <title>, header, gallery, filename)." }),
			html: Type.String({
				description:
					"Full document or body fragment. Code in <pre><code>…</code></pre>. Self-contained (inline CSS/JS, no external requests).",
			}),
			open: Type.Optional(
				Type.Boolean({ description: "Open the gallery in the browser (default: artifacts.open)." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolText> {
			const cfg = getConfig().artifacts;
			const sessionDir = path.join(resolveDir(cfg.dir, ctx.cwd), sessionId);
			try {
				fs.mkdirSync(sessionDir, { recursive: true });
			} catch (err) {
				return {
					content: [{ type: "text", text: `html_artifact: could not create ${sessionDir}: ${String(err)}` }],
					details: { error: "mkdir_failed", dir: sessionDir },
				};
			}

			const file = path.join(sessionDir, artifactFileName(params.title, Date.now().toString(36)));
			const html = buildArtifactHtml(params.title, params.html);
			atomicWriteFileSync(file, html);
			const bytes = Buffer.byteLength(html);
			const shouldOpen = params.open ?? cfg.open;

			if (!cfg.server) return fileMode(pi, file, bytes, shouldOpen);

			if (!server) server = new ArtifactServer(sessionDir);
			try {
				await server.ensureStarted();
			} catch (err) {
				return fileMode(pi, file, bytes, shouldOpen, `session server unavailable: ${String(err)}`);
			}

			const url = server.register(params.title, file);
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
			const lines = [`Artifact: ${url}`, `Gallery (all session artifacts): ${gallery}`];
			if (opened) lines.push("Opened the gallery in your browser.");
			else if (openError) lines.push(`(could not auto-open: ${openError})`);
			return { content: [{ type: "text", text: lines.join("\n") }], details: { url, gallery, path: file, bytes, opened } };
		},
	});
}
