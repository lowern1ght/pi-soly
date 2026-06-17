// =============================================================================
// config.ts — load key router config from disk
// =============================================================================
//
// Looks in this order (first hit wins):
// 1. <cwd>/.pi/keyrouter.json      — project override
// 2. <cwd>/.soly/keyrouter.json    — soly convention
// 3. ~/.pi/keyrouter.json          — user-level default
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
//   "cooldownMs": 60000
// }

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { KeyRouterConfig } from "./types.ts";

const CONFIG_FILENAMES = ["keyrouter.json"];

export function defaultConfig(): KeyRouterConfig {
	return {
		providers: [],
		maxRetries: 3,
		cooldownMs: 60_000,
	};
}

export function loadConfig(cwd: string, home?: string): KeyRouterConfig {
	const homeDir = home ?? os.homedir();
	const candidates: string[] = [];
	for (const dir of [
		path.join(cwd, ".soly"),
		path.join(cwd, ".pi"),
		cwd,
		path.join(homeDir, ".soly"),
		path.join(homeDir, ".pi"),
		homeDir,
	]) {
		for (const name of CONFIG_FILENAMES) {
			candidates.push(path.join(dir, name));
		}
	}
	for (const file of candidates) {
		if (fs.existsSync(file)) {
			try {
				const raw = fs.readFileSync(file, "utf-8");
				const parsed = JSON.parse(raw) as Partial<KeyRouterConfig>;
				return normalize(parsed);
			} catch {
				// bad config — fall through to default
			}
		}
	}
	return defaultConfig();
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
	};
}