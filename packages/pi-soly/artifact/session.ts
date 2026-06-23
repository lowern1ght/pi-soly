// =============================================================================
// session.ts — shared handle + paths for the artifact server (per project)
// =============================================================================
//
// The artifact tool, the `/artifacts` command, and the status chrome all need
// the current server (gallery URL, count, list) — and they need it to survive
// /reload, pi restarts, AND having a second pi window open in the same folder.
//
// So the server is PER PROJECT, not per session:
//   • files live in a STABLE per-project dir (hash of the cwd, under the OS temp
//     dir or a configured base) with an on-disk manifest (index.json) — restored
//     on every start;
//   • the server binds a PINNED 127.0.0.1 port + route token derived from the
//     cwd → the SAME gallery URL across windows and restarts;
//   • a registry file (server.json) lets a second window DISCOVER an
//     already-running server and reuse it as a remote client (mutating it over
//     HTTP) instead of starting a second one.
//
// This module owns the discovery (registry + liveness probe), the in-process
// handle (local server OR remote client), and the path math so every surface
// resolves the same directory and the same URL.
// =============================================================================

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import { createHash } from "node:crypto";
import { ArtifactServer, type ArtifactHandle, type ArtifactEntry } from "./server.ts";
import type { GalleryEntry } from "./render.ts";
import { atomicWriteFileSync } from "../util.ts";

/** Pinned ports live just below the OS ephemeral range, in a narrow band so a
 *  project's URL stays stable while keeping collision odds low. */
const PINNED_PORT_BASE = 43120;
const PINNED_PORT_RANGE = 2048;

/** Liveness probe / write timeouts (ms) — short, since everything is 127.0.0.1. */
const PROBE_TIMEOUT_MS = 300;
const WRITE_TIMEOUT_MS = 2000;

let current: ArtifactHandle | null = null;
let currentDir: string | null = null;
/** True when THIS process started (owns) the running server. */
let isOwner = false;

/** The active artifact handle, or null if none has started this run. */
export function getArtifactServer(): ArtifactHandle | null {
	return current;
}

/** Base artifact directory: config override (abs / ~ / relative to cwd) or the
 *  OS temp dir under pi-soly-artifacts/. */
export function resolveArtifactBase(configDir: string, cwd: string): string {
	const d = configDir.trim();
	if (!d) return path.join(os.tmpdir(), "pi-soly-artifacts");
	if (d === "~" || d.startsWith("~/") || d.startsWith("~\\")) {
		return path.join(os.homedir(), d.slice(1).replace(/^[/\\]/, ""));
	}
	return path.isAbsolute(d) ? d : path.join(cwd, d);
}

/** Stable per-project key (hash of the absolute cwd) → same folder across
 *  reloads/restarts, so a project's artifacts persist and stay browsable. */
export function projectKey(cwd: string): string {
	return projectHash(cwd).slice(0, 12);
}

/** Full hex hash of the absolute cwd — the single source for port + token. */
function projectHash(cwd: string): string {
	return createHash("sha1").update(path.resolve(cwd)).digest("hex");
}

/** 16-hex pinned route token derived from cwd (stable across windows/restarts). */
export function pinnedToken(cwd: string): string {
	return projectHash(cwd).slice(0, 16);
}

/** Pinned 127.0.0.1 port for this project (falls back to ephemeral if busy). */
export function pinnedPort(cwd: string): number {
	const buf = createHash("sha1").update(path.resolve(cwd)).digest();
	return PINNED_PORT_BASE + (buf.readUInt32BE(0) % PINNED_PORT_RANGE);
}

/** The stable per-project artifact directory. */
export function artifactDir(configDir: string, cwd: string): string {
	return path.join(resolveArtifactBase(configDir, cwd), projectKey(cwd));
}

// ----------------------------------------------------------------------------
// Registry: lets one pi window discover a server another window already runs
// ----------------------------------------------------------------------------

type Registry = { port: number; token: string; pid: number; startedAt: number };

function registryPath(dir: string): string {
	return path.join(dir, "server.json");
}

function readRegistry(dir: string): Registry | null {
	try {
		const raw = JSON.parse(fs.readFileSync(registryPath(dir), "utf-8")) as Partial<Registry>;
		if (raw && typeof raw.port === "number" && typeof raw.token === "string") {
			return { port: raw.port, token: raw.token, pid: raw.pid ?? 0, startedAt: raw.startedAt ?? 0 };
		}
	} catch {
		// missing or corrupt — treat as "no known server"
	}
	return null;
}

function writeRegistry(dir: string, reg: Registry): void {
	try {
		atomicWriteFileSync(registryPath(dir), JSON.stringify(reg));
	} catch {
		// best effort
	}
}

function deleteRegistry(dir: string): void {
	try {
		fs.unlinkSync(registryPath(dir));
	} catch {
		// best effort
	}
}

// ----------------------------------------------------------------------------
// Tiny 127.0.0.1 HTTP helpers used by the probe + the remote client
// ----------------------------------------------------------------------------

function httpGetJson(port: number, token: string, seg: string, timeoutMs: number): Promise<unknown> {
	return new Promise((resolve) => {
		const req = http.get(
			{ hostname: "127.0.0.1", port, path: `/${token}/${seg}`, timeout: timeoutMs },
			(res) => {
				let data = "";
				res.on("data", (c: Buffer | string) => (data += c));
				res.on("end", () => {
					if (res.statusCode && res.statusCode < 300) {
						try {
							resolve(data ? JSON.parse(data) : null);
						} catch {
							resolve(null);
						}
					} else {
						resolve(null);
					}
				});
			},
		);
		req.on("timeout", () => req.destroy());
		req.on("error", () => resolve(null));
	});
}

function httpPostJson(
	port: number,
	token: string,
	seg: string,
	body: unknown,
	timeoutMs: number,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				path: `/${token}/${seg}`,
				method: "POST",
				headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
				timeout: timeoutMs,
			},
			(res) => {
				let d = "";
				res.on("data", (c: Buffer | string) => (d += c));
				res.on("end", () => {
					if (res.statusCode && res.statusCode < 300) {
						try {
							resolve(d ? JSON.parse(d) : null);
						} catch {
							resolve(null);
						}
					} else {
						reject(new Error(`artifact server responded ${res.statusCode}`));
					}
				});
			},
		);
		req.on("timeout", () => req.destroy(new Error("artifact server write timed out")));
		req.on("error", reject);
		req.end(data);
	});
}

/** Probe a server's list endpoint; returns entries if alive, else null. */
async function probeEntries(port: number, token: string): Promise<GalleryEntry[] | null> {
	const r = (await httpGetJson(port, token, "list", PROBE_TIMEOUT_MS)) as GalleryEntry[] | null;
	return Array.isArray(r) ? r : null;
}

// ----------------------------------------------------------------------------
// Remote client: reuse another window's already-running server over HTTP
// ----------------------------------------------------------------------------

/**
 * A {@link ArtifactHandle} backed by ANOTHER pi window's running server. Mutates
 * the owner's list over HTTP; keeps a local cache so sync surfaces (the footer
 * count, `/artifacts` list) keep working without a round-trip on every render.
 */
export class RemoteArtifactClient implements ArtifactHandle {
	private opened = false;
	private cached: GalleryEntry[] = [];

	constructor(
		private readonly port: number,
		private readonly token: string,
		initial: GalleryEntry[],
	) {
		this.cached = initial.slice();
	}

	get count(): number {
		return this.cached.length;
	}

	galleryUrl(): string {
		return `http://127.0.0.1:${this.port}/${this.token}/`;
	}

	private artifactUrl(file: string): string {
		return `http://127.0.0.1:${this.port}/${this.token}/a/${encodeURIComponent(path.basename(file))}`;
	}

	list(): ArtifactEntry[] {
		return this.cached.map((e) => ({ ...e, url: this.artifactUrl(e.file) }));
	}

	/** Re-probe the owner server; refresh the cache if still alive. */
	async refresh(): Promise<boolean> {
		const entries = await probeEntries(this.port, this.token);
		if (!entries) return false;
		this.cached = entries;
		return true;
	}

	async register(title: string, file: string, id?: string): Promise<string> {
		const res = (await httpPostJson(
			this.port,
			this.token,
			"register",
			{ title, file: path.basename(file), id },
			WRITE_TIMEOUT_MS,
		)) as { entries?: GalleryEntry[] } | null;
		if (res?.entries) this.cached = res.entries;
		return this.artifactUrl(file);
	}

	remove(id: string): boolean {
		const i = this.cached.findIndex((e) => e.id === id);
		if (i < 0) return false;
		this.cached.splice(i, 1);
		void httpPostJson(this.port, this.token, "remove", { id }, WRITE_TIMEOUT_MS).catch(() => {});
		return true;
	}

	clear(): number {
		const n = this.cached.length;
		this.cached = [];
		void httpPostJson(this.port, this.token, "clear", {}, WRITE_TIMEOUT_MS).catch(() => {});
		return n;
	}

	consumeFirstOpen(): boolean {
		if (this.opened) return false;
		this.opened = true;
		return true;
	}
}

// ----------------------------------------------------------------------------
// Discovery + lifecycle
// ----------------------------------------------------------------------------

/**
 * Get-or-resolve the artifact handle for `dir`/`cwd`:
 *   1. if already resolved this run, return it;
 *   2. if another window's server is alive (registry or pinned port), reuse it
 *      as a {@link RemoteArtifactClient};
 *   3. otherwise start our own {@link ArtifactServer} on the pinned port and
 *      become its owner (writing the registry so later windows find us).
 */
export async function ensureArtifactServer(dir: string, cwd: string): Promise<ArtifactHandle> {
	fs.mkdirSync(dir, { recursive: true });
	if (current) {
		if (current instanceof RemoteArtifactClient) {
			// Another window's server may have died since we resolved — re-probe
			// before trusting the cache; if it's gone, start our own below.
			if (await current.refresh()) return current;
			current = null;
			currentDir = null;
			isOwner = false;
		} else {
			return current; // we own it → valid for this whole run
		}
	}

	const token = pinnedToken(cwd);
	const port = pinnedPort(cwd);

	// Reuse path A: a registry written by another window points at a live server.
	const reg = readRegistry(dir);
	if (reg && reg.token === token) {
		const entries = await probeEntries(reg.port, token);
		if (entries) {
			current = new RemoteArtifactClient(reg.port, token, entries);
			currentDir = dir;
			isOwner = false;
			return current;
		}
	}

	// Reuse path B: no (matching) registry, but a server with our token may still
	// be up on the pinned port — probe it directly before starting our own.
	if (!reg || reg.port !== port || reg.token !== token) {
		const entries = await probeEntries(port, token);
		if (entries) {
			writeRegistry(dir, { port, token, pid: process.pid, startedAt: Date.now() });
			current = new RemoteArtifactClient(port, token, entries);
			currentDir = dir;
			isOwner = false;
			return current;
		}
	}

	// Start path: no live server — own one on the pinned port.
	const server = new ArtifactServer(dir, port, token);
	await server.ensureStarted();
	writeRegistry(dir, { port: server.boundPort, token, pid: process.pid, startedAt: Date.now() });
	current = server;
	currentDir = dir;
	isOwner = true;
	return current;
}

/** Drop the cached handle so the next {@link ensureArtifactServer} re-probes.
 *  Used when a register call fails (the owner likely died) before a retry. */
export function invalidateArtifactServer(): void {
	current = null;
	currentDir = null;
	isOwner = false;
}

/**
 * Stop the server if THIS process owns it (frees the pinned port + removes the
 * registry so a later window starts fresh). If we were only a client, leave the
 * owner's server and registry untouched. Safe to call when nothing is running.
 */
export function disposeArtifactServer(): void {
	if (isOwner && current instanceof ArtifactServer) {
		current.stop();
		if (currentDir) deleteRegistry(currentDir);
	}
	current = null;
	currentDir = null;
	isOwner = false;
}
