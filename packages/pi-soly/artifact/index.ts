// =============================================================================
// index.ts — pi-artifact extension entry point
// =============================================================================
//
// Registers one LLM tool: `html_artifact`. Renders LLM-supplied HTML to a
// self-contained file in a temp directory and opens it in the browser — soly's
// local equivalent of Claude Code artifacts. Use it when a visual, rendered
// result (styled examples, diagrams, comparison tables, code galleries) beats
// terminal text/markdown.
//
// The pure HTML builder lives in render.ts; this module does the I/O (write +
// open) and teaches the LLM about the capability via the system prompt.
// =============================================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { platform } from "node:os";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { Type } from "typebox";
import type { SolyConfig } from "../config.ts";
import { atomicWriteFileSync } from "../util.ts";
import { buildArtifactHtml, artifactFileName } from "./render.ts";
import { buildArtifactSection } from "./prompt.ts";

/** Open a file with the OS default handler (browser for .html). */
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

/** Resolve the artifact output directory: config override (abs / ~ / relative
 *  to cwd) or the OS temp dir under pi-soly-artifacts/. */
function resolveDir(configDir: string, cwd: string): string {
	const d = configDir.trim();
	if (!d) return path.join(os.tmpdir(), "pi-soly-artifacts");
	if (d === "~" || d.startsWith("~/") || d.startsWith("~\\")) {
		return path.join(os.homedir(), d.slice(1).replace(/^[/\\]/, ""));
	}
	return path.isAbsolute(d) ? d : path.join(cwd, d);
}

export default function piArtifactExtension(
	pi: ExtensionAPI,
	getConfig: () => SolyConfig,
) {
	pi.on("before_agent_start", async (event) => {
		return { systemPrompt: event.systemPrompt + buildArtifactSection() };
	});

	pi.registerTool({
		name: "html_artifact",
		label: "soly · html_artifact",
		description:
			"Render HTML to a self-contained local file and open it in the browser — soly's artifacts. `html` is a full document or a body fragment (wrapped in a styled light/dark skeleton with good code/table styling). Use when a visual rendered result beats terminal text: example galleries, comparisons, diagrams, HTML/CSS demos. Self-contained only — inline CSS/JS, no external URLs. Returns the file path.",
		parameters: Type.Object({
			title: Type.String({ description: "Title (used for <title>, header, filename)." }),
			html: Type.String({
				description:
					"Full document or body fragment. Code in <pre><code>…</code></pre>. Self-contained (inline CSS/JS, no external requests).",
			}),
			open: Type.Optional(
				Type.Boolean({ description: "Open in browser after writing (default: artifacts.open)." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cfg = getConfig().artifacts;
			const dir = resolveDir(cfg.dir, ctx.cwd);
			try {
				fs.mkdirSync(dir, { recursive: true });
			} catch (err) {
				return {
					content: [{ type: "text", text: `html_artifact: could not create ${dir}: ${String(err)}` }],
					details: { error: "mkdir_failed", dir },
				};
			}

			const stamp = Date.now().toString(36);
			const file = path.join(dir, artifactFileName(params.title, stamp));
			const html = buildArtifactHtml(params.title, params.html);
			atomicWriteFileSync(file, html);

			const shouldOpen = params.open ?? cfg.open;
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
			if (opened) lines.push("Opened in the default browser.");
			else if (shouldOpen) lines.push(`(could not auto-open: ${openError ?? "unknown"} — open the file manually)`);
			else lines.push("(not opened — open the file manually or set artifacts.open)");

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { path: file, opened, bytes: Buffer.byteLength(html) },
			};
		},
	});
}
