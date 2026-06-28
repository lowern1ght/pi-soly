// =============================================================================
// tests/integration/pi-install-e2e.test.ts — real-install E2E
// =============================================================================
//
// Catches the class of bug that `bun test` (run from source) misses:
//   - Runtime imports that resolve at dev time but fail at user install
//     time because the dep is only in `devDependencies`.
//
// Concrete example: `mcp/metadata-cache.ts:6` imports
// `@modelcontextprotocol/ext-apps/app-bridge`. That dep is in
// pi-soly's `devDependencies`. Real users do `pi install npm:pi-soly`,
// which is effectively `npm install --omit=dev` — so the dep is never
// installed, and the plugin crashes on first load with
// `Cannot find module '@modelcontextprotocol/ext-apps/app-bridge'`.
//
// This test simulates that user flow exactly:
//   1. Pack the current pi-soly into a tarball.
//   2. In a fresh tmp dir, install the tarball + only the declared deps
//      (peerDeps + deps — i.e. what an end user would get).
//   3. Try to load the entry point via `bun -e 'import("pi-soly")'`. Any
//      MODULE_NOT_FOUND surfaces here.
//
// On the current source this test FAILS, listing every runtime dep that
// is missing from the install. Once those deps are moved to
// `dependencies` (or `peerDependenciesMeta.optional` + lazy import),
// the test passes — and any future regression of the same shape is caught.
//
// Run via: bun test tests/integration/pi-install-e2e.test.ts

import { describe, test, expect } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PKG_DIR = path.resolve(__dirname, "..", "..");
const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf-8"));

describe("pi-soly e2e: real install + load", () => {
	test("plugin loads cleanly via import() after `npm install --omit=dev`", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-soly-e2e-"));
		try {
			// 1. Pack pi-soly → tmp. This is the tarball npm would publish.
			execFileSync("npm", ["pack", "--pack-destination", tmp, "--silent"], {
				cwd: PKG_DIR,
				stdio: "pipe",
			});
			const tarballName = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
			if (!tarballName) throw new Error("npm pack produced no tarball");
			const tarballPath = path.join(tmp, tarballName).replace(/\\/g, "/");

			// 2. Consumer project: install pi-soly + peerDeps (npm 7+ auto-installs
			//    peer deps). Crucially: --omit=dev, so devDependencies of pi-soly
			//    are NOT installed. This is what `pi install npm:pi-soly` does.
			const proj = path.join(tmp, "consumer");
			fs.mkdirSync(proj);
			const peerResolved: Record<string, string> = {};
			for (const [name, range] of Object.entries(pkgJson.peerDependencies ?? {})) {
				// Use the version we know is installed locally (devDeps pin one).
				const devVer =
					(pkgJson.devDependencies ?? {})[name] ??
					(pkgJson.dependencies ?? {})[name];
				peerResolved[name] = devVer ?? (range as string);
			}
			fs.writeFileSync(
				path.join(proj, "package.json"),
				JSON.stringify(
					{
						name: "pi-soly-e2e-consumer",
						type: "module",
						private: true,
						dependencies: {
							"pi-soly": "file:" + tarballPath,
							...peerResolved,
						},
					},
					null,
					2,
				),
			);

			execFileSync("npm", ["install", "--omit=dev", "--silent"], {
				cwd: proj,
				stdio: "pipe",
				timeout: 120_000,
			});

			// 3. Load the plugin. import() evaluates top-level imports; any
			//    MODULE_NOT_FOUND surfaces here.
			const result = spawnSync(
				"bun",
				[
					"-e",
					'import("pi-soly").then(m => { console.log("LOADED:default=" + (typeof m.default)); process.exit(0); }).catch(e => { console.error("FAIL:" + (e.code || "") + ":" + e.message); process.exit(1); });',
				],
				{
					cwd: proj,
					encoding: "utf-8",
					timeout: 60_000,
				},
			);

			const combined = (result.stdout ?? "") + "\n" + (result.stderr ?? "");
			const missing = combined.match(/Cannot find module ['"]([^'"]+)['"]/g) ?? [];

			if (result.status !== 0 || missing.length > 0) {
				console.error("=== STDOUT ===\n" + result.stdout);
				console.error("=== STDERR ===\n" + result.stderr);
				if (missing.length > 0) {
					console.error(
						"\nMissing runtime imports — these packages must be in pi-soly's `dependencies`\n" +
							"(or imported lazily via dynamic import()). Currently they're in `devDependencies`,\n" +
							"so `npm install --omit=dev` (= `pi install npm:pi-soly`) skips them.",
					);
					for (const m of missing) console.error("  - " + m);
				}
			}

			expect(missing).toEqual([]);
			expect(combined).toMatch(/^LOADED:/m);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	}, 180_000);
});
