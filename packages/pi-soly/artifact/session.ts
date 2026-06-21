// =============================================================================
// session.ts — shared handle + paths for the artifact server
// =============================================================================
//
// The artifact tool, the `/artifacts` command, and the status chrome all need
// the current ArtifactServer (gallery URL, count, list) — and they need it to
// survive `/reload` and pi restarts. So artifacts live in a STABLE per-project
// directory (keyed by a hash of the cwd, under the OS temp dir) with an on-disk
// manifest (index.json). This module owns the single server instance + the path
// math so every surface resolves the same directory and restores the same list.
// =============================================================================

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { ArtifactServer } from "./server.ts";

let current: ArtifactServer | null = null;

/** Set (or clear, with null) the active artifact server. */
export function setArtifactServer(server: ArtifactServer | null): void {
	current = server;
}

/** The active artifact server, or null if none has started this run. */
export function getArtifactServer(): ArtifactServer | null {
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
	return createHash("sha1").update(path.resolve(cwd)).digest("hex").slice(0, 12);
}

/** The stable per-project artifact directory. */
export function artifactDir(configDir: string, cwd: string): string {
	return path.join(resolveArtifactBase(configDir, cwd), projectKey(cwd));
}

/** Get-or-create the server for `dir` and start it (loads the manifest in its
 *  constructor). Idempotent; reused across the tool and `/artifacts`. */
export async function ensureArtifactServer(dir: string): Promise<ArtifactServer> {
	fs.mkdirSync(dir, { recursive: true });
	if (!current) current = new ArtifactServer(dir);
	await current.ensureStarted();
	return current;
}
