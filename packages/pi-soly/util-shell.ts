// =============================================================================
// util-shell.ts — Windows-safe subprocess helpers
// =============================================================================
//
// Wraps `child_process` so every spawn on Windows passes `windowsHide: true`.
// This prevents subprocesses (mmx.cmd, npm.cmd, git.exe, etc.) from
// inheriting pi's console and emitting OSC-0 title sequences + CSI cursor
// housekeeping into the shared ConPTY. Those sequences would otherwise
// leak into pi's input area as visible artifacts
// (e.g. `]0;Administrator:  C:\WINDOWS\system32\cmd.exe` and `[1G`).
//
// `windowsHide` is a no-op off-Windows, so the same code works on macOS
// and Linux without changes.
//
// We re-export promisified execFile / execFileSync with the option baked
// in. Callers don't need to remember the platform — they use the helper
// and get correct behavior everywhere.
// =============================================================================

import {
	execFile as nodeExecFile,
	execFileSync as nodeExecFileSync,
	spawn as nodeSpawn,
	type ExecFileOptions,
	type ExecFileOptionsWithStringEncoding,
	type SpawnOptions,
	type ChildProcess,
} from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const IS_WIN = platform() === "win32";

/** Apply Windows-specific hardening. Stripped on non-Windows.
 *  Type-only cast: TS infers the spread result wider than the input, which
 *  drops the literal type of `encoding` etc. The `as T` preserves call-site
 *  type inference. */
function harden<T extends ExecFileOptions | SpawnOptions>(opts: T = {} as T): T {
	if (!IS_WIN) return opts;
	const hardened = {
		...opts,
		windowsHide: true,
	} as T;
	return hardened;
}

const execFileAsync = promisify(nodeExecFile);

/** Promise-based execFile with Windows hardening. */
export function execFileSafe(
	cmd: string,
	args: ReadonlyArray<string> = [],
	opts: ExecFileOptions = {},
): ReturnType<typeof execFileAsync> {
	const hardened = harden(opts);
	return execFileAsync(cmd, args as string[], hardened);
}

/** Synchronous execFile with Windows hardening. Defaults to string
 *  encoding (matches the most common usage in soly; callers needing
 *  Buffer output can pass `encoding: "buffer"` explicitly through opts). */
export function execFileSyncSafe(
	cmd: string,
	args: ReadonlyArray<string> = [],
	opts: ExecFileOptionsWithStringEncoding = {},
): ReturnType<typeof nodeExecFileSync> {
	const hardened = harden(opts);
	return nodeExecFileSync(cmd, args as string[], hardened);
}

/** Spawn with Windows hardening. */
export function spawnSafe(
	cmd: string,
	args: ReadonlyArray<string> = [],
	opts: SpawnOptions = {},
): ChildProcess {
	return nodeSpawn(cmd, args as string[], harden(opts));
}
