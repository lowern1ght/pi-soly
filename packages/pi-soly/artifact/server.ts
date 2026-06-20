// =============================================================================
// server.ts — per-session HTTP server for browsing artifacts
// =============================================================================
//
// One lightweight HTTP server per pi session, serving every html_artifact made
// this session from a single stable URL: a live-updating gallery at `/<token>/`
// plus each artifact at `/<token>/a/<file>`. Built on node:http (no deps).
//
// Security: binds 127.0.0.1 only and namespaces all routes under a random
// `token` so other local processes can't enumerate the artifacts. Lifecycle:
// started lazily on the first artifact, stopped on session_shutdown. The link
// is valid only while the pi session runs (not a share-after-exit mechanism).
// =============================================================================

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { buildGalleryHtml, type GalleryEntry } from "./render.ts";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;

export class ArtifactServer {
	private server: http.Server | null = null;
	private port = 0;
	private readonly token = randomBytes(12).toString("hex");
	private readonly entries: GalleryEntry[] = [];
	private readonly clients = new Set<http.ServerResponse>();
	private opened = false;

	/** @param dir absolute session artifact directory (files are served from here) */
	constructor(private readonly dir: string) {}

	get started(): boolean {
		return this.server !== null;
	}

	/** True exactly once — for "open the gallery in the browser the first time". */
	consumeFirstOpen(): boolean {
		if (this.opened) return false;
		this.opened = true;
		return true;
	}

	galleryUrl(): string {
		return `http://127.0.0.1:${this.port}/${this.token}/`;
	}

	artifactUrl(file: string): string {
		return `http://127.0.0.1:${this.port}/${this.token}/a/${encodeURIComponent(path.basename(file))}`;
	}

	/** Start listening on an ephemeral 127.0.0.1 port. Idempotent. */
	async ensureStarted(): Promise<void> {
		if (this.server) return;
		const server = http.createServer((req, res) => this.handle(req, res));
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				this.port = typeof addr === "object" && addr ? addr.port : 0;
				resolve();
			});
		});
		this.server = server;
	}

	/** Record a new artifact and notify open gallery tabs. Returns its URL. */
	register(title: string, file: string): string {
		const base = path.basename(file);
		this.entries.unshift({
			id: randomBytes(4).toString("hex"),
			title,
			file: base,
			createdAt: Date.now(),
		});
		for (const res of this.clients) {
			try {
				res.write("data: reload\n\n");
			} catch {
				// dropped client — cleaned up on its 'close'
			}
		}
		return this.artifactUrl(base);
	}

	stop(): void {
		for (const res of this.clients) {
			try {
				res.end();
			} catch {
				// ignore
			}
		}
		this.clients.clear();
		try {
			this.server?.close();
		} catch {
			// ignore
		}
		this.server = null;
	}

	private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts[0] !== this.token) {
			res.writeHead(404);
			res.end("not found");
			return;
		}
		const rest = parts.slice(1);
		if (rest.length === 0) {
			res.writeHead(200, HTML_HEADERS);
			res.end(buildGalleryHtml(this.entries, this.token));
			return;
		}
		if (rest[0] === "events") {
			this.serveEvents(res);
			return;
		}
		if (rest[0] === "a" && rest[1]) {
			this.serveArtifact(decodeURIComponent(rest[1]), res);
			return;
		}
		res.writeHead(404);
		res.end("not found");
	}

	private serveEvents(res: http.ServerResponse): void {
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		res.write(": connected\n\n");
		this.clients.add(res);
		res.on("close", () => this.clients.delete(res));
	}

	private serveArtifact(name: string, res: http.ServerResponse): void {
		// Confine to the session dir: basename only, no traversal.
		const file = path.join(this.dir, path.basename(name));
		let body: Buffer;
		try {
			body = fs.readFileSync(file);
		} catch {
			res.writeHead(404);
			res.end("artifact not found");
			return;
		}
		res.writeHead(200, HTML_HEADERS);
		res.end(body);
	}
}
