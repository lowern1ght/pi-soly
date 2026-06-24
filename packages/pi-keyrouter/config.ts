// =============================================================================
// config.ts — load key router config from disk
// =============================================================================
//
// Config is GLOBAL (user-level), never project-scoped. API keys are personal
// credentials that do not belong inside a project directory (risk of leaking
// via git, shared repos, etc.).
//
// Single location: ~/.pi/keyrouter.json
//   - Windows: %USERPROFILE%\.pi\keyrouter.json
//   - macOS/Linux: ~/.pi/keyrouter.json
//
// Schema:
// {
//   "providers": [
//     {
//       "name": "z-ai",
//       "match": ["api.z.ai", "z.ai"],
//       "keys": [
//         { "name": "primary", "value": "key-1..." },
//         { "name": "backup",  "value": "key-2..." }
//       ]
//     }
//   ],
//   "maxRetries": 3,
//   "cooldownMs": 60000,
//   "overloadedCooldownMs": 30000
// }

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { KeyRouterConfig } from "./types.ts";

export function defaultConfig(): KeyRouterConfig {
	return {
		providers: [],
		maxRetries: 3,
		cooldownMs: 60_000,
		overloadedCooldownMs: 30_000,
	};
}

/**
 * Resolve the config path. Always under the user profile (~/.pi/), never
 * project-scoped. The `cwd` argument is accepted for API symmetry but
 * ignored — keys are global.
 *
 * @param _cwd ignored — config is always user-level
 * @param home override home dir (for testing)
 */
export function configPath(_cwd?: string, home?: string): string {
	const homeDir = home ?? os.homedir();
	return path.join(homeDir, ".pi", "keyrouter.json");
}

/**
 * Path displayed in error messages / /keyrouter status so the user can see
 * exactly where we're looking.
 */
export function configSearchPaths(): string[] {
	return [configPath()];
}

export function loadConfig(_cwd?: string, home?: string): KeyRouterConfig {
	const file = configPath(undefined, home);
	if (!fs.existsSync(file)) return defaultConfig();
	try {
		const raw = fs.readFileSync(file, "utf-8");
		const parsed = JSON.parse(raw) as Partial<KeyRouterConfig>;
		return normalize(parsed);
	} catch {
		// bad config — fall through to default
		return defaultConfig();
	}
}

function normalize(input: Partial<KeyRouterConfig>): KeyRouterConfig {
	const providers = (input.providers ?? []).filter(
		(p): p is { name: string; match: string[]; keys: { name: string; value: string }[] } =>
			typeof p?.name === "string" &&
			Array.isArray(p.match) &&
			Array.isArray(p.keys) &&
			p.keys.every((k) => typeof k?.name === "string" && typeof k?.value === "string"),
	);
	return {
		providers,
		maxRetries: typeof input.maxRetries === "number" ? input.maxRetries : 3,
		cooldownMs: typeof input.cooldownMs === "number" ? input.cooldownMs : 60_000,
		overloadedCooldownMs:
			typeof input.overloadedCooldownMs === "number" ? input.overloadedCooldownMs : 30_000,
	};
}
