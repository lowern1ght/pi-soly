// =============================================================================
// session.ts — shared handle to the current session's ArtifactServer
// =============================================================================
//
// The artifact tool owns the server, but the `/artifacts` command and the
// status chrome also need to read it (gallery URL, artifact count, list) and
// act on it (clear). This tiny module holds the single current instance so
// those surfaces don't have to thread it through everywhere.
// =============================================================================

import type { ArtifactServer } from "./server.ts";

let current: ArtifactServer | null = null;

/** Set (or clear, with null) the active session artifact server. */
export function setArtifactServer(server: ArtifactServer | null): void {
	current = server;
}

/** The active session artifact server, or null if none has started. */
export function getArtifactServer(): ArtifactServer | null {
	return current;
}
