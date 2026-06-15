// =============================================================================
// codemap.ts — Project layout map for the soly extension
// =============================================================================
//
// Walks cwd once at session_start, builds a compact "## project layout" map
// of top-level directories, key config files, and code file counts. Injected
// into the system prompt so the model has immediate awareness of where things
// live without having to `ls` its way around.
//
// Heuristics:
//   - skip noise: node_modules, .git, dist, build, .soly, .next, out, target,
//     coverage, .venv, __pycache__
//   - depth: walk 2 levels deep by default (cwd → dirs → subdirs)
//   - key files: package.json, tsconfig.json, README.md, Cargo.toml, go.mod,
//     pyproject.toml, .env.example, Dockerfile, docker-compose.yml/yaml,
//     Makefile, .github/workflows
//   - code counts: count files by extension at each level
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";

const IGNORE_DIRS = new Set([
	"node_modules",
	".git",
	".soly",
	"dist",
	"build",
	"out",
	"target",
	"coverage",
	".next",
	".nuxt",
	".venv",
	"venv",
	"__pycache__",
	".cache",
	".parcel-cache",
	".turbo",
]);

const KEY_FILES = new Set([
	"package.json",
	"tsconfig.json",
	"tsconfig.base.json",
	"jsconfig.json",
	"README.md",
	"README.rst",
	"Cargo.toml",
	"go.mod",
	"pyproject.toml",
	"setup.py",
	"requirements.txt",
	"Pipfile",
	"Gemfile",
	"pom.xml",
	"build.gradle",
	"build.sbt",
	"Makefile",
	"Dockerfile",
	"docker-compose.yml",
	"docker-compose.yaml",
	".env.example",
	".nvmrc",
	".node-version",
	".tool-versions",
	".editorconfig",
	".prettierrc",
	".eslintrc",
	".eslintrc.js",
	".eslintrc.json",
	"biome.json",
	"vitest.config.ts",
	"jest.config.js",
	"jest.config.ts",
	"vite.config.ts",
	"webpack.config.js",
	"rollup.config.js",
	"index.html",
	".github",
]);

const CODE_EXTS = new Set([
	"ts", "tsx", "js", "jsx", "mjs", "cjs",
	"py", "pyx",
	"go",
	"rs",
	"java", "kt", "scala",
	"rb",
	"php",
	"cs", "fs", "vb",
	"swift", "m",
	"c", "cc", "cpp", "h", "hpp",
	"sh", "bash", "zsh",
]);

export interface CodeMap {
	root: string;
	topLevel: { dirs: string[]; files: string[] };
	/** Sub-tree at depth 2: parent → children (dirs only, capped). */
	tree: Map<string, string[]>;
	/** Key files with brief summaries (first line). */
	keyFiles: { relPath: string; summary: string }[];
	/** Code file counts per top-level dir. */
	codeCounts: Record<string, number>;
	hasGithubWorkflows: boolean;
}

function summarizeKeyFile(absPath: string, maxLen = 100): string {
	try {
		const content = fs.readFileSync(absPath, "utf-8");
		// First non-empty, non-frontmatter line
		const lines = content.split(/\r?\n/);
		let inFrontmatter = false;
		for (const l of lines) {
			const t = l.trim();
			if (!t) continue;
			if (t === "---") {
				inFrontmatter = !inFrontmatter;
				continue;
			}
			if (inFrontmatter) continue;
			return t.slice(0, maxLen);
		}
		return "";
	} catch {
		return "";
	}
}

function listChildren(dir: string): { dirs: string[]; files: string[] } {
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		const dirs: string[] = [];
		const files: string[] = [];
		for (const e of entries) {
			if (e.name.startsWith(".") && e.name !== ".github") continue;
			if (IGNORE_DIRS.has(e.name)) continue;
			if (e.isDirectory()) dirs.push(e.name);
			else if (e.isFile()) files.push(e.name);
		}
		dirs.sort();
		files.sort();
		return { dirs, files };
	} catch {
		return { dirs: [], files: [] };
	}
}

export function buildCodeMap(cwd: string, maxDepth = 2): CodeMap {
	const top = listChildren(cwd);
	const tree = new Map<string, string[]>();
	const codeCounts: Record<string, number> = {};
	const keyFiles: { relPath: string; summary: string }[] = [];
	let hasGithubWorkflows = false;

	// Top-level key files
	for (const f of top.files) {
		if (KEY_FILES.has(f) || KEY_FILES.has(`-${f}`)) {
			const summary = summarizeKeyFile(path.join(cwd, f));
			keyFiles.push({ relPath: f, summary });
		}
	}

	// Walk dirs at depth 1
	for (const d of top.dirs) {
		const subPath = path.join(cwd, d);
		const sub = listChildren(subPath);
		tree.set(d, sub.dirs);

		// Key files inside top-level dirs (e.g. src/index.ts, src/package.json)
		for (const f of sub.files) {
			if (KEY_FILES.has(f)) {
				keyFiles.push({
					relPath: `${d}/${f}`,
					summary: summarizeKeyFile(path.join(subPath, f)),
				});
			}
		}

		// Code count: walk this dir, count by extension
		let count = 0;
		try {
			const stack = [subPath];
			let depth = 0;
			while (stack.length > 0 && depth <= maxDepth) {
				const cur = stack.pop()!;
				const entries = fs.readdirSync(cur, { withFileTypes: true });
				for (const e of entries) {
					if (e.name.startsWith(".")) continue;
					if (IGNORE_DIRS.has(e.name)) continue;
					if (e.isDirectory()) {
						stack.push(path.join(cur, e.name));
					} else if (e.isFile()) {
						const ext = e.name.split(".").pop()?.toLowerCase();
						if (ext && CODE_EXTS.has(ext)) count++;
					}
				}
				depth++;
			}
		} catch {
			// best effort
		}
		codeCounts[d] = count;

		// .github/workflows detection
		if (d === ".github") {
			const wfDir = path.join(subPath, "workflows");
			if (fs.existsSync(wfDir)) {
				try {
					const wfEntries = fs.readdirSync(wfDir);
					if (wfEntries.length > 0) hasGithubWorkflows = true;
				} catch {
					// ignore
				}
			}
		}
	}

	return {
		root: cwd,
		topLevel: top,
		tree,
		keyFiles,
		codeCounts,
		hasGithubWorkflows,
	};
}

/** Render a compact "## project layout" section for the system prompt. */
export function buildCodeMapSection(map: CodeMap): string {
	if (map.topLevel.dirs.length === 0 && map.topLevel.files.length === 0) {
		return "";
	}

	const lines: string[] = ["", "## project layout", ""];

	// Top-level tree (1-line ASCII)
	const allTop = [...map.topLevel.dirs, ...map.topLevel.files].slice(0, 20);
	lines.push(`\`\`\``);
	lines.push(`${path.basename(map.root)}/`);
	for (const name of allTop) {
		const isDir = map.topLevel.dirs.includes(name);
		const count = map.codeCounts[name];
		const suffix = isDir && count ? `  (${count} code file${count === 1 ? "" : "s"})` : "";
		lines.push(`├── ${name}${isDir ? "/" : ""}${suffix}`);
	}
	if (map.topLevel.dirs.length + map.topLevel.files.length > 20) {
		lines.push(`└── … (${map.topLevel.dirs.length + map.topLevel.files.length - 20} more)`);
	}
	lines.push(`\`\`\``);
	lines.push("");

	// Key files
	if (map.keyFiles.length > 0) {
		lines.push("**Key files:**");
		for (const kf of map.keyFiles.slice(0, 8)) {
			lines.push(`- \`${kf.relPath}\`${kf.summary ? ` — ${kf.summary}` : ""}`);
		}
		if (map.keyFiles.length > 8) {
			lines.push(`- … and ${map.keyFiles.length - 8} more`);
		}
		lines.push("");
	}

	// CI hint
	if (map.hasGithubWorkflows) {
		lines.push("- **CI**: GitHub Actions workflows present");
	}

	lines.push(
		"Use `soly_snippet(path, offset, limit)` or `soly_doc_search(query)` to read specific files without loading the whole tree.",
	);

	return lines.join("\n");
}
