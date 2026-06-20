// =============================================================================
// server.ts — per-session HTTP server for browsing artifacts
// =============================================================================
//
// One lightweight HTTP server per pi session serving every html_artifact made
// this session from a single stable URL: a vanilla-JS gallery SPA at `/<token>/`
// (sidebar + iframe + filter + theme + live SSE), the artifact list as JSON at
// `/<token>/list`, and any file in the session dir at `/<token>/a/<path>` with a
// proper MIME type (so artifacts can pull sibling CSS/JS/images). Built on
// node:http (no deps).
//
// Security: binds 127.0.0.1 only, namespaces routes under a random `token`, and
// confines file serving to the session dir. Lifecycle: started lazily on the
// first artifact, stopped on session_shutdown. The link is valid only while the
// pi session runs (not a share-after-exit mechanism).
// =============================================================================

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { buildGalleryShell, type GalleryEntry } from "./render.ts";

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".md": "text/plain; charset=utf-8",
};

function mimeFor(file: string): string {
	return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

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

	/** Number of artifacts registered this session. */
	get count(): number {
		return this.entries.length;
	}

	/** Snapshot of the current entries (newest first), each with its URL. */
	list(): (GalleryEntry & { url: string })[] {
		return this.entries.map((e) => ({ ...e, url: this.artifactUrl(e.file) }));
	}

	/** Remove an artifact by id (and delete its file). Returns whether it existed. */
	remove(id: string): boolean {
		const i = this.entries.findIndex((e) => e.id === id);
		if (i < 0) return false;
		const [e] = this.entries.splice(i, 1);
		if (e) this.deleteFile(e.file);
		this.broadcast();
		return true;
	}

	/** Remove every artifact (and delete the files). Returns how many. */
	clear(): number {
		const n = this.entries.length;
		for (const e of this.entries) this.deleteFile(e.file);
		this.entries.length = 0;
		this.broadcast();
		return n;
	}

	private deleteFile(base: string): void {
		try {
			fs.unlinkSync(path.join(this.dir, base));
		} catch {
			// best effort
		}
	}

	/** Notify open gallery tabs (SSE) that the list changed. */
	private broadcast(): void {
		for (const res of this.clients) {
			try {
				res.write("data: update\n\n");
			} catch {
				// dropped client — cleaned up on its 'close'
			}
		}
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

	/** Record (or, when `id` matches an existing entry, update in place) an
	 *  artifact and notify open gallery tabs. Returns its URL. */
	register(title: string, file: string, id?: string): string {
		const base = path.basename(file);
		const existing = id ? this.entries.find((e) => e.id === id) : undefined;
		if (existing) {
			existing.title = title;
			existing.file = base;
			existing.createdAt = Date.now();
		} else {
			this.entries.unshift({
				id: id ?? randomBytes(4).toString("hex"),
				title,
				file: base,
				createdAt: Date.now(),
			});
		}
		this.broadcast();
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
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(buildGalleryShell(this.token));
			return;
		}
		if (rest[0] === "list") {
			res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(this.entries));
			return;
		}
		if (rest[0] === "events") {
			this.serveEvents(res);
			return;
		}
		if (rest[0] === "a" && rest.length > 1) {
			this.serveFile(rest.slice(1).map((p) => decodeURIComponent(p)).join("/"), res);
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

	/** Serve a file from the session dir, confined to it (no traversal). */
	private serveFile(rel: string, res: http.ServerResponse): void {
		const root = path.resolve(this.dir);
		const target = path.resolve(root, rel);
		if (target !== root && !target.startsWith(root + path.sep)) {
			res.writeHead(403);
			res.end("forbidden");
			return;
		}
		let body: Buffer;
		try {
			body = fs.readFileSync(target);
		} catch {
			res.writeHead(404);
			res.end("artifact not found");
			return;
		}
		res.writeHead(200, { "content-type": mimeFor(target) });
		res.end(body);
	}
}
