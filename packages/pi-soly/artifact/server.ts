// =============================================================================
// server.ts — per-project HTTP server for browsing artifacts (shared)
// =============================================================================
//
// One lightweight HTTP server PER PROJECT (not per session): it binds a pinned
// 127.0.0.1 port + route token derived from the cwd, so every pi window opened
// in the same folder resolves the SAME gallery URL. A second window discovers
// the already-running server via the on-disk registry (see session.ts) and
// reuses it as a remote client instead of starting its own — it mutates the
// owner's list over HTTP (POST register/remove/clear).
//
// Routes (all under the pinned `/<token>/`): a vanilla-JS gallery SPA at `/`,
// the entry list as JSON at `/list`, write endpoints `/register` `/remove`
// `/clear`, a live SSE stream at `/events`, and any file in the project dir at
// `/a/<path>` with a proper MIME type (so artifacts pull sibling CSS/JS/images).
// Built on node:http (no deps).
//
// Security: binds 127.0.0.1 only, namespaces routes under the project `token`,
// and confines file serving to the project dir. Lifecycle: started lazily on
// the first artifact; the owning window stops it on session_shutdown (other
// windows are just clients and leave it alone). Survives owner hand-off: the
// next window re-binds the same pinned port → same URL.
// =============================================================================

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { atomicWriteFileSync } from "../util.ts";
import { buildGalleryShell, type GalleryEntry } from "./render.ts";

/** A gallery entry together with its served URL. */
export type ArtifactEntry = GalleryEntry & { url: string };

/**
 * What every surface (the tool, `/artifacts`, the footer) needs from the
 * artifact server — implemented by the local {@link ArtifactServer} (this
 * process owns it) and by a remote client (another pi window owns it). Lets a
 * second window in the same project reuse the first's already-running server.
 */
export interface ArtifactHandle {
	/** Number of artifacts currently registered. */
	readonly count: number;
	/** Stable gallery URL (sidebar + iframe SPA). */
	galleryUrl(): string;
	/** Snapshot of entries (newest first), each with its served URL. */
	list(): ArtifactEntry[];
	/** Add (or update by `id`) an artifact; returns its served URL. */
	register(title: string, file: string, id?: string): Promise<string>;
	/** Remove an artifact by id (and delete its file). Returns whether it existed. */
	remove(id: string): boolean;
	/** Remove every artifact. Returns how many. */
	clear(): number;
	/** One-shot latch — true the first call only (for "open gallery once"). */
	consumeFirstOpen(): boolean;
}

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

/** Read + parse a small JSON request body (capped at 1 MiB; null on any error). */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (c: Buffer | string) => {
			data += c;
			if (data.length > 1 << 20) {
				req.destroy();
				resolve(null);
			}
		});
		req.on("end", () => {
			try {
				resolve(data ? JSON.parse(data) : null);
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => resolve(null));
	});
}

export class ArtifactServer implements ArtifactHandle {
	private server: http.Server | null = null;
	private port: number;
	private readonly token: string;
	private readonly entries: GalleryEntry[] = [];
	private readonly clients = new Set<http.ServerResponse>();
	private opened = false;
	private readonly manifestPath: string;

	/**
	 * @param dir absolute artifact directory (files are served from here)
	 * @param preferredPort pinned per-project port (falls back to ephemeral if busy)
	 * @param token pinned per-project route token (namespaces every route)
	 */
	constructor(private readonly dir: string, preferredPort: number, token: string) {
		this.manifestPath = path.join(dir, "index.json");
		this.port = preferredPort;
		this.token = token;
		// Restore artifacts persisted by a previous session/reload for this project.
		this.entries.push(...this.loadManifest());
	}

	/** Actual bound port (== preferredPort unless it was busy and we fell back). */
	get boundPort(): number {
		return this.port;
	}

	/** Read the on-disk manifest, keeping only entries whose file still exists. */
	private loadManifest(): GalleryEntry[] {
		try {
			const raw = JSON.parse(fs.readFileSync(this.manifestPath, "utf-8")) as GalleryEntry[];
			if (!Array.isArray(raw)) return [];
			return raw
				.filter((e) => e && typeof e.file === "string" && fs.existsSync(path.join(this.dir, e.file)))
				.sort((a, b) => b.createdAt - a.createdAt);
		} catch {
			return [];
		}
	}

	/** Persist the entry list so it survives /reload and pi restarts. */
	private persist(): void {
		try {
			atomicWriteFileSync(this.manifestPath, JSON.stringify(this.entries));
		} catch {
			// best effort
		}
	}

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
		this.persist();
		this.broadcast();
		return true;
	}

	/** Remove every artifact (and delete the files). Returns how many. */
	clear(): number {
		const n = this.entries.length;
		for (const e of this.entries) this.deleteFile(e.file);
		this.entries.length = 0;
		this.persist();
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

	/** Start listening on 127.0.0.1 — the pinned project port if free, else an
	 *  ephemeral fallback (URL won't be stable that session, but the registry
	 *  still points other windows here). Idempotent. */
	async ensureStarted(): Promise<void> {
		if (this.server) return;
		const server = http.createServer((req, res) => this.handle(req, res));
		try {
			await this.bind(server, this.port);
		} catch {
			this.port = 0; // pinned port busy → ephemeral
			await this.bind(server, 0);
		}
		this.server = server;
	}

	/** Listen on `port` and record the address actually bound. */
	private bind(server: http.Server, port: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const onError = (err: NodeJS.ErrnoException) => reject(err);
			server.once("error", onError);
			server.listen(port, "127.0.0.1", () => {
				server.off("error", onError);
				const addr = server.address();
				this.port = typeof addr === "object" && addr ? addr.port : 0;
				resolve();
			});
		});
	}

	/** Record (or, when `id` matches an existing entry, update in place) an
	 *  artifact and notify open gallery tabs. Returns its URL. Async so the
	 *  shared {@link ArtifactHandle} contract also covers a remote client. */
	async register(title: string, file: string, id?: string): Promise<string> {
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
		this.persist();
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

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
		// Write endpoints — let other pi windows in this project mutate the one
		// running server (register/remove/clear) over HTTP.
		if (req.method === "POST" && rest[0] === "register") return this.apiRegister(req, res);
		if (req.method === "POST" && rest[0] === "remove") return this.apiMutate(req, res, (b) => this.remove(String(b.id)));
		if (req.method === "POST" && rest[0] === "clear") return this.apiMutate(req, res, () => this.clear());
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

	/** POST /<token>/register {title, file, id?} → add/update + return entries. */
	private async apiRegister(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const b = (await readJsonBody(req)) as { title?: string; file?: string; id?: string } | null;
		if (!b || typeof b.title !== "string" || typeof b.file !== "string") {
			res.writeHead(400);
			res.end("bad request");
			return;
		}
		await this.register(b.title, b.file, b.id);
		this.jsonEntries(res);
	}

	/** POST /<token>/(remove|clear) → apply mutation + return entries. */
	private async apiMutate(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		fn: (b: Record<string, unknown>) => void,
	): Promise<void> {
		const b = ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
		fn(b);
		this.jsonEntries(res);
	}

	private jsonEntries(res: http.ServerResponse): void {
		res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ entries: this.entries }));
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
