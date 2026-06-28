#!/usr/bin/env node
// scripts/check-publish-integrity.mjs — fails the build if any source
// import wouldn't resolve inside the actual npm tarball.
//
// Why this exists: `bun test` and `tsc --noEmit` run against source files,
// not against what's published. We once shipped pi-soly@1.13.0 where
// `index.ts` imported `./context-manager.ts` but `package.json#files`
// didn't list it — so the tarball was missing the file and consumers
// crashed on import. Source tests passed because source ≠ tarball.
//
// This script: `npm pack`s the package, lists every file in the tarball,
// then walks every source .ts and checks that each `from "./..."` import
// resolves to a packed file (or to a directory that was packed
// recursively). Exits 1 with a clear list of missing imports.
//
// Usage: node scripts/check-publish-integrity.mjs <package-dir>
//   e.g. node scripts/check-publish-integrity.mjs packages/pi-soly

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const pkgDir = process.argv[2] ?? "packages/pi-soly";
const abs = (...p) => path.resolve(pkgDir, ...p);

function log(label, msg) {
	console.log(`[check-publish-integrity] ${label} ${msg}`);
}

function die(msg) {
	console.error(`[check-publish-integrity] FAIL: ${msg}`);
	process.exit(1);
}

// 1. Pack the package to a temp dir. We don't want the tarball in the repo.
//    Prefer `npm pack` (universal). Fall back to `bun pm pack` when npm isn't
//    on PATH (e.g. Windows self-hosted runners with PATH quirks around
//    "Program Files").
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-integrity-"));
log("pack", `${pkgDir} → ${tmpDir}`);

function packWith(cmd, args) {
	return execFileSync(cmd, args, {
		cwd: abs(),
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

let tarballName;
const packers = [
	{ cmd: "npm", args: ["pack", "--pack-destination", tmpDir, "--silent"] },
	{ cmd: "bun", args: ["pm", "pack", "--destination", tmpDir] },
];
let packErr;
for (const { cmd, args } of packers) {
	try {
		packWith(cmd, args); // stdout differs per packer; we discover the file via readdir below
	} catch (err) {
		packErr = err;
		continue;
	}
	const found = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tgz"));
	if (found.length === 1) {
		tarballName = found[0];
		break;
	}
	if (found.length > 1) {
		die(`multiple tarballs in ${tmpDir}: ${found.join(", ")}`);
	}
}
if (!tarballName) {
	die(`pack failed (tried ${packers.map((p) => p.cmd).join(", ")}): ${packErr?.stderr?.toString() ?? packErr?.message}`);
}
const tarballPath = path.join(tmpDir, tarballName);
log("packed", tarballName);

// 2. List tarball contents, strip the leading `package/` segment.
//    On Windows, libarchive's tar chokes on drive letters in the path
//    (it tries to interpret "C:" as a remote host), so we cd into tmpDir
//    and use just the filename. Works on Linux runners too.
let tarLines;
try {
	tarLines = execFileSync("tar", ["-tzf", tarballName], {
		cwd: tmpDir,
		encoding: "utf-8",
	}).split("\n");
} catch (err) {
	die(`tar -tzf failed: ${err.message}`);
}
const packed = new Set();
for (const line of tarLines) {
	const trimmed = line.trim();
	if (!trimmed) continue;
	// npm tarballs wrap content in `package/`. Strip that prefix.
	const stripped = trimmed.replace(/^package\//, "");
	packed.add(stripped.replace(/\\/g, "/"));
}
log("tarball", `${packed.size} files`);

// 3. Walk source .ts (skip tests) and collect relative imports.
const SOURCE_EXT = /\.ts$/;
const SKIP_DIRS = new Set(["node_modules", "tests", "__tests__", ".git", "dist", "build"]);
const sourceFiles = [];
(function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			walk(full);
		} else if (entry.isFile() && SOURCE_EXT.test(entry.name) && !entry.name.endsWith(".test.ts")) {
			sourceFiles.push(full);
		}
	}
})(abs());

const importRe = /from\s+["'](\.\.?\/[^"']+)["']/g;
const missing = new Set();

function inTarball(candidate) {
	// Normalize Windows separators.
	const c = candidate.replace(/\\/g, "/");
	// Exact file match.
	if (packed.has(c)) return true;
	// TypeScript convention: source files import "./foo.js" (the would-be
	// compiled output) but the runtime resolver maps it to ./foo.ts. Try
	// both extensions.
	if (packed.has(c.replace(/\.js$/, ".ts"))) return true;
	// `from "./foo"` resolves to `./foo.ts` if foo.ts exists in source.
	const withTs = c.endsWith(".ts") ? c : `${c}.ts`;
	if (packed.has(withTs)) return true;
	// `from "./foo"` also resolves to `./foo/index.ts` if foo/index.ts exists.
	const idxTs = `${c}/index.ts`;
	if (packed.has(idxTs)) return true;
	// Directory recursion: if `candidate/` is in packed files (because the
	// directory itself is listed in `files`), every file under it is too.
	const dir = c.endsWith("/") ? c : `${c}/`;
	for (const p of packed) {
		if (p.startsWith(dir)) return true;
	}
	return false;
}

for (const file of sourceFiles) {
	const content = fs.readFileSync(file, "utf-8");
	let m;
	while ((m = importRe.exec(content))) {
		const imp = m[1];
		// Normalize Windows separators in the import itself (rare but possible).
		const normalized = imp.replace(/\\/g, "/");
		const resolved = path
			.relative(abs(), path.resolve(path.dirname(file), normalized))
			.replace(/\\/g, "/");
		if (!inTarball(resolved)) missing.add(`${imp}  (resolved: ${resolved})  ← in ${path.relative(process.cwd(), file).replace(/\\/g, "/")}`);
	}
}

if (missing.size > 0) {
	console.error(`[check-publish-integrity] ${missing.size} import(s) won't resolve inside the tarball:\n`);
	for (const m of [...missing].sort()) console.error(`  - ${m}`);
	console.error(
		`\nFix: add the missing path to \`files\` in ${path.basename(pkgDir)}/package.json, or list its parent directory.`,
	);
	process.exit(1);
}

log("ok", `all imports resolve (${sourceFiles.length} files scanned)`);
