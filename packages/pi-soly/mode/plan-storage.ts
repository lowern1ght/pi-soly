// =============================================================================
// mode/plan-storage.ts — plans directory resolution
// =============================================================================
//
// The plans dir is mode-dependent:
//   - plans mode:  default .pi/plans/   (config-overridable, gitignored)
//   - phases mode: .agents/phases/      (existing convention, shared)
//
// This module resolves the absolute path AND ensures the directory exists
// when writing. It does NOT gitignore — that's the caller's job (called
// once on first write by writeModeConfig, see config-mode.ts).
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { type SolyMode, type ResolvedMode } from "../config-mode.ts";

/** Resolve the absolute plans directory for the given mode + config. */
export function resolvePlansDir(cwd: string, resolved: ResolvedMode): string {
	const rel = resolved.plansDir;
	return path.isAbsolute(rel) ? rel : path.join(cwd, rel);
}

/** Ensure the plans directory exists (idempotent — mkdir recursive).
 *  Returns the absolute path. */
export function ensurePlansDir(cwd: string, resolved: ResolvedMode): string {
	const abs = resolvePlansDir(cwd, resolved);
	fs.mkdirSync(abs, { recursive: true });
	return abs;
}

/** Compute the plan subdir for a given branch slug, e.g.
 *  resolvePlansDir() + "/" + slug. Slug is passed through unchanged —
 *  caller is responsible for slugifying. */
export function planDirFor(cwd: string, resolved: ResolvedMode, slug: string): string {
	return path.join(resolvePlansDir(cwd, resolved), slug);
}

/** True if the given mode actually uses a plans/ subdirectory. phases mode
 *  doesn't — its plan lives at .agents/phases/<NN>-<slug>/. This helper
 *  lets the caller decide whether to use planDirFor() or fall through
 *  to legacy phase path resolution. */
export function usesPlanDir(mode: SolyMode): boolean {
	return mode === "plans";
}
