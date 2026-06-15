// =============================================================================
// docs.ts — Doc search + snippet tools support
// =============================================================================
//
// Lazy context helpers:
//   - searchDocs(query, cwd) — index of all .md files (one-line descriptions),
//     matches by simple substring scoring
//   - readSnippet(path, offset, limit) — bounded file read for soly_snippet
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { estimateTokens, findMarkdownFiles, readIfExists } from "./core.ts";
import { extractTitleAndPreview, stripHtml } from "./html.ts";

// Re-export the stripHtml helper so existing imports of `stripHtml from
// "./docs.js"` (used by tools.ts) continue to work without churn.
export { stripHtml };

export interface DocIndexEntry {
	relPath: string;
	absPath: string;
	tokens: number;
	title: string;
	preview: string;
	/** Priority bucket: 0=intent, 1=phase-intent, 2=project. Used in search ranking. */
	sourceKind: "intent" | "phase-intent" | "project";
}

const DOC_GLOBS_IGNORE = [
	"node_modules",
	"dist",
	"build",
	"coverage",
	".git",
	"out",
	".next",
	".nuxt",
	"target", // rust
	"__pycache__",
	".venv",
	"venv",
];

// .soly/ IS indexed, but intent docs in .soly/docs/ and .soly/phases/<N>/docs/
// are tagged with higher priority in search results (see buildDocIndex).

const INTENT_DOC_EXTS = [".md", ".html", ".htm"];

/** Build an index of all .md / .html files under cwd, excluding noisy dirs. */
export function buildDocIndex(cwd: string, limit = 5000): DocIndexEntry[] {
	const mdFiles = findMarkdownFiles(cwd);
	const out: DocIndexEntry[] = [];
	const seen = new Set<string>();

	const addFile = (relPath: string, absPath: string, sourceKind: DocIndexEntry["sourceKind"]) => {
		if (seen.has(relPath)) return;
		seen.add(relPath);
		const raw = readIfExists(absPath);
		if (!raw) return;
		const ext = path.extname(relPath).toLowerCase();
		if (ext !== ".md" && ext !== ".html" && ext !== ".htm") return;
		const { title, preview } = extractTitleAndPreview(raw, ext);
		out.push({
			relPath,
			absPath,
			tokens: estimateTokens(raw),
			title,
			preview,
			sourceKind,
		});
	};

	// 1. Intent docs (priority 0)
	const docsRoot = path.join(cwd, ".soly", "docs");
	if (fs.existsSync(docsRoot)) {
		const intentFiles = findIntentFiles(docsRoot);
		for (const f of intentFiles) {
			const rel = path.relative(cwd, f);
			addFile(rel, f, "intent");
			if (out.length >= limit) break;
		}
	}

	// 2. Phase intent docs (priority 1) — only if phases dir exists
	const phasesRoot = path.join(cwd, ".soly", "phases");
	if (out.length < limit && fs.existsSync(phasesRoot)) {
		try {
			const phaseEntries = fs.readdirSync(phasesRoot, { withFileTypes: true });
			for (const pe of phaseEntries) {
				if (!pe.isDirectory()) continue;
				const phaseDocsDir = path.join(phasesRoot, pe.name, "docs");
				if (fs.existsSync(phaseDocsDir)) {
					const phaseFiles = findIntentFiles(phaseDocsDir);
					for (const f of phaseFiles) {
						const rel = path.relative(cwd, f);
						addFile(rel, f, "phase-intent");
						if (out.length >= limit) break;
					}
				}
				if (out.length >= limit) break;
			}
		} catch {
			// best effort
		}
	}

	// 3. Rest of project (priority 2)
	if (out.length < limit) {
		for (const relPath of mdFiles) {
			const segments = relPath.split("/");
			if (segments.some((s) => DOC_GLOBS_IGNORE.includes(s))) continue;
			const absPath = path.join(cwd, relPath);
			addFile(relPath, absPath, "project");
			if (out.length >= limit) break;
		}
	}

	return out;
}

function findIntentFiles(dir: string): string[] {
	const out: string[] = [];
	if (!fs.existsSync(dir)) return out;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		if (e.name.startsWith(".")) continue;
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			out.push(...findIntentFiles(full));
		} else if (e.isFile()) {
			const ext = path.extname(e.name).toLowerCase();
			if (INTENT_DOC_EXTS.includes(ext)) {
				out.push(full);
			}
		}
	}
	return out;
}

export interface DocSearchHit {
	entry: DocIndexEntry;
	score: number;
	/** Substring excerpts where the query matched (up to 3). */
	excerpts: string[];
	/** Source-priority bonus applied (intent > phase-intent > project). */
	priorityBonus: number;
}

const SOURCE_PRIORITY_BONUS: Record<DocIndexEntry["sourceKind"], number> = {
	intent: 5,
	"phase-intent": 3,
	project: 0,
};

const SOURCE_TAG: Record<DocIndexEntry["sourceKind"], string> = {
	intent: "[intent]",
	"phase-intent": "[phase-intent]",
	project: "[project]",
};

/**
 * Search the doc index by substring scoring.
 * Title matches outscore body matches 3:1. Case-insensitive.
 * Intent docs are prioritized over project docs (source-priority bonus).
 */
export function searchDocs(index: DocIndexEntry[], query: string, limit = 10): DocSearchHit[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const tokens = q.split(/\s+/).filter(Boolean);
	const hits: DocSearchHit[] = [];

	for (const entry of index) {
		const titleLower = entry.title.toLowerCase();
		const previewLower = entry.preview.toLowerCase();
		const relPathLower = entry.relPath.toLowerCase();

		let score = 0;
		const excerpts: string[] = [];

		for (const t of tokens) {
			if (titleLower.includes(t)) score += 3;
			if (relPathLower.includes(t)) score += 2;
			const previewMatches = previewLower.split(t).length - 1;
			if (previewMatches > 0) {
				score += previewMatches;
				const idx = previewLower.indexOf(t);
				if (idx >= 0 && excerpts.length < 3) {
					const start = Math.max(0, idx - 40);
					const end = Math.min(entry.preview.length, idx + t.length + 60);
					excerpts.push(
						(start > 0 ? "…" : "") + entry.preview.slice(start, end) + (end < entry.preview.length ? "…" : ""),
					);
				}
			}
		}

		if (score > 0) {
			const priorityBonus = SOURCE_PRIORITY_BONUS[entry.sourceKind];
			hits.push({ entry, score: score + priorityBonus, excerpts, priorityBonus });
		}
	}

	hits.sort((a, b) => b.score - a.score);
	return hits.slice(0, limit);
}

/** Helper: source tag for a DocIndexEntry (used in search output). */
export function sourceTag(entry: DocIndexEntry): string {
	return SOURCE_TAG[entry.sourceKind];
}

/** Bounded file read with line numbers, for soly_snippet. */
export function readSnippet(
	absPath: string,
	offset = 0,
	limit = 100,
): { lines: string[]; totalLines: number; outOfRange: boolean } | null {
	const raw = readIfExists(absPath);
	if (raw === null) return null;
	const allLines = raw.split(/\r?\n/);
	const start = Math.max(0, offset);
	const end = Math.min(allLines.length, start + limit);
	return {
		lines: allLines.slice(start, end),
		totalLines: allLines.length,
		outOfRange: end < allLines.length,
	};
}

