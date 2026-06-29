// =============================================================================
// intent.ts — Project intent loader (the "0 point" of every soly project)
// =============================================================================
//
// `.agents/docs/` is the zero-point of the project: documents written BEFORE
// any soly plans, research, or code. It holds the user's vision, business
// context, and architectural intent. Other soly artifacts (STATE, PLANS,
// RESEARCH) flow FROM this input.
//
// Supported files: `.md` (full text) and `.html` (parsed for title + preview).
// Nested directories are supported (e.g. `.agents/docs/api/auth.md`).
//
// Convention: any document in `.agents/docs/` is loaded into the system
// prompt as "project intent". This is separate from:
//   - rules (`.agents/rules/`) — how to behave
//   - state (`.agents/STATE.md`, ROADMAP.md) — where we are
//   - planning (PLAN.md, CONTEXT.md) — what to do next
//
// Optional: `.agents/phases/<N>/docs/` is also scanned if the directory exists
// (for backward compat / phase-specific intent). Not required.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { formatTok, resolveImports, solyDirFor } from "./core.ts";
import { extractTitleAndPreview, stripHtml } from "./html.ts";

const DOC_EXTS = new Set([".md", ".html", ".htm"]);

export type IntentKind = "md" | "html";

export interface IntentDoc {
	relPath: string;
	absPath: string;
	kind: IntentKind;
	title: string;
	preview: string;
	tokens: number;
	/** True if this came from a phase-specific docs dir. */
	phaseNumber?: number;
	/** Size cap, files larger than this are still indexed but flagged. */
	oversized: boolean;
}

const MAX_PREVIEW_CHARS = 200;
const MAX_FILE_BYTES = 256 * 1024; // 256KB cap on indexed files

function readFirstLineOfFile(absPath: string, max = 120): string {
	try {
		const stat = fs.statSync(absPath);
		if (stat.size > MAX_FILE_BYTES) {
			const fd = fs.openSync(absPath, "r");
			try {
				const buf = Buffer.alloc(max);
				fs.readSync(fd, buf, 0, max, 0);
				return buf.toString("utf-8").split(/\r?\n/)[0]?.trim() ?? "";
			} finally {
				fs.closeSync(fd);
			}
		}
		const content = fs.readFileSync(absPath, "utf-8");
		return content.split(/\r?\n/)[0]?.trim() ?? "";
	} catch {
		return "";
	}
}

// ---- Walker ----

function walkIntentDir(
	absDir: string,
	relBase: string,
	phaseNumber: number | undefined,
	out: IntentDoc[],
): void {
	if (!fs.existsSync(absDir)) return;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(absDir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (e.name.startsWith(".")) continue;
		const abs = path.join(absDir, e.name);
		const rel = relBase ? `${relBase}/${e.name}` : e.name;
		if (e.isDirectory()) {
			walkIntentDir(abs, rel, phaseNumber, out);
			continue;
		}
		if (!e.isFile()) continue;
		const ext = path.extname(e.name).toLowerCase();
		if (!DOC_EXTS.has(ext)) continue;

		let stat: fs.Stats;
		try {
			stat = fs.statSync(abs);
		} catch {
			continue;
		}

		const oversized = stat.size > MAX_FILE_BYTES;
		const kind: IntentKind = ext === ".md" ? "md" : "html";

		let title = "";
		let preview = "";
		try {
			// For oversized files, only read the first 64KB
			const readBytes = Math.min(stat.size, 64 * 1024);
			const buf = Buffer.alloc(readBytes);
			const fd = fs.openSync(abs, "r");
			try {
				fs.readSync(fd, buf, 0, readBytes, 0);
			} finally {
				fs.closeSync(fd);
			}
			const content = buf.toString("utf-8");
			// `ext` is `path.extname` output, always lowercased — cast to the
			// narrow literal union the extractor expects.
			const extNorm = (ext === ".md" || ext === ".html" || ext === ".htm" ? ext : ".md") as
				| ".md"
				| ".html"
				| ".htm";
			const extracted = extractTitleAndPreview(content, extNorm, { maxPreview: MAX_PREVIEW_CHARS });
			title = extracted.title;
			preview = extracted.preview || stripHtml(content).slice(0, MAX_PREVIEW_CHARS);
		} catch {
			// best effort
		}

		// Fallback title = filename without extension
		if (!title) {
			title = path.basename(e.name, ext).replace(/[-_]+/g, " ");
		}

		out.push({
			relPath: rel,
			absPath: abs,
			kind,
			title,
			preview,
			tokens: Math.ceil(stat.size / 4),
			phaseNumber,
			oversized,
		});
	}
}

export function loadIntentDocs(cwd: string, currentPhaseNumber?: number): IntentDoc[] {
	const out: IntentDoc[] = [];
	const docsRoot = path.join(solyDirFor(cwd), "docs");
	walkIntentDir(docsRoot, "", undefined, out);

	// Optional: phase-specific docs (only if current phase is known)
	if (currentPhaseNumber != null) {
		// We don't know the slug here without re-walking phases; scan any
		// directory in .agents/phases/ whose name starts with the phase number.
		// Skip if no phases dir exists.
		const phasesRoot = path.join(solyDirFor(cwd), "phases");
		if (fs.existsSync(phasesRoot)) {
			try {
				const phaseEntries = fs.readdirSync(phasesRoot, { withFileTypes: true });
				for (const pe of phaseEntries) {
					if (!pe.isDirectory()) continue;
					const m = pe.name.match(/^(\d+)/);
					if (!m) continue;
					if (parseInt(m[1], 10) !== currentPhaseNumber) continue;
					const fullPhaseDocsDir = path.join(phasesRoot, pe.name, "docs");
					walkIntentDir(fullPhaseDocsDir, pe.name + "/docs", currentPhaseNumber, out);
				}
			} catch {
				// best effort
			}
		}
	}

	// Sort: top-level files first (depth), then alphabetically
	out.sort((a, b) => {
		const da = a.relPath.split("/").length;
		const db = b.relPath.split("/").length;
		if (da !== db) return da - db;
		return a.relPath.localeCompare(b.relPath);
	});

	return out;
}

export interface IntentSection {
	hasContent: boolean;
	section: string;
}

/** Render the "## project intent" section for the system prompt. */
export function buildIntentSection(intent: IntentDoc[]): IntentSection {
	if (intent.length === 0) {
		return { hasContent: false, section: "" };
	}

	const lines: string[] = ["", "## project intent (from .agents/docs/)", ""];
	lines.push(
		"These documents are the **0 point** of this project — the user's vision, business context, and design intent, written BEFORE any soly plans. Read them first when planning, discussing, or executing. If implementation diverges from intent, fix one or the other — don't let drift compound.",
	);
	lines.push("");

	// Group: always (top-level) vs phase-specific
	const always = intent.filter((d) => d.phaseNumber == null);
	const phaseSpecific = intent.filter((d) => d.phaseNumber != null);

	if (always.length > 0) {
		lines.push("**Always read first:**");
		lines.push("");
		for (const d of always) {
			const title = d.title || d.relPath;
			const tag = d.kind === "html" ? "html" : "md";
			const oversize = d.oversized ? " (large file — use soly_snippet to read)" : "";
			lines.push(`- \`${d.relPath}\` (${tag}, ${formatTok(d.tokens)} tokens)${oversize}`);
			lines.push(`  - **${title}**`);
			if (d.preview) {
				lines.push(`  - ${d.preview.slice(0, 180)}${d.preview.length > 180 ? "…" : ""}`);
			}
		}
		lines.push("");
	}

	if (phaseSpecific.length > 0) {
		lines.push("**Phase-specific** (relevant to active phase):");
		lines.push("");
		for (const d of phaseSpecific) {
			const title = d.title || d.relPath;
			lines.push(`- \`${d.relPath}\` (phase ${d.phaseNumber}) — **${title}**`);
			if (d.preview) {
				lines.push(`  - ${d.preview.slice(0, 180)}${d.preview.length > 180 ? "…" : ""}`);
			}
		}
		lines.push("");
	}

	lines.push(
		"Use `soly_intent` to refresh this list, `soly_doc_search` for keyword search across all docs (including project .md), and `soly_snippet` to read a specific range.",
	);

	return { hasContent: true, section: lines.join("\n") };
}

// ---- Inline body resolution ----
//
// For .md intent docs, optionally inline the FULL body into the system prompt
// (with @import resolution). Off by default — index is usually enough. Turn on
// per-doc via frontmatter `inline: true`.

export interface IntentInlineDoc {
	relPath: string;
	body: string;
	tokens: number;
}

function parseIntentFrontmatter(raw: string): { inline: boolean; body: string } {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) return { inline: false, body: raw };
	const yaml = m[1];
	const body = m[2];
	const inlineMatch = yaml.match(/^\s*inline\s*:\s*true\s*$/m);
	return { inline: !!inlineMatch, body };
}

export function loadInlineIntentBodies(intent: IntentDoc[]): IntentInlineDoc[] {
	const out: IntentInlineDoc[] = [];
	for (const d of intent) {
		if (d.kind !== "md") continue; // Only .md can opt-in to inlining
		try {
			const raw = fs.readFileSync(d.absPath, "utf-8");
			const { inline, body } = parseIntentFrontmatter(raw);
			if (!inline) continue;
			if (d.oversized) continue; // Skip oversized even if opted-in

			// Apply @import resolution (with cycle + depth protection).
			// Inlined docs are read-only, so we use a fresh globalSeen set.
			const globalSeen = new Set<string>([d.absPath]);
			const resolved = resolveImports(body, d.absPath, globalSeen, 0, {
				imported: [],
			});

			// Token cap (defense against accidental huge inlines that slipped
			// past the bytes cap, e.g. dense code with low whitespace).
			const tokens = Math.ceil(resolved.length / 4);
			const TOKEN_CAP = 2000;
			const finalBody =
				tokens > TOKEN_CAP
					? resolved.slice(0, TOKEN_CAP * 4) +
						`\n\n<!-- inlined truncated to ${TOKEN_CAP} tokens (${tokens} total); use soly_snippet for the full file -->`
					: resolved;

			out.push({
				relPath: d.relPath,
				body: finalBody,
				tokens: Math.ceil(finalBody.length / 4),
			});
		} catch {
			// skip unreadable
		}
	}
	return out;
}

// =============================================================================
// Intent stats — Claude-memory-style breakdown for docs
// =============================================================================
//
// Shows how docs consume context. Most docs are preview-only (cheap),
// only `inline: true` docs inject their full body (expensive).

export interface IntentDocStat {
  relPath: string;
  kind: "md" | "html";
  title: string;
  tokens: number;       // full file tokens (what would be loaded if inline)
  previewTokens: number; // preview tokens (what's actually loaded by default)
  inline: boolean;      // true if `inline: true` frontmatter — body is injected
  oversized: boolean;
  phaseNumber?: number;
}

export interface IntentStats {
  totalDocs: number;
  totalInlineTokens: number;     // tokens from inline: true docs (full body)
  totalPreviewTokens: number;    // tokens from preview-only docs (always loaded)
  totalPerTurnTokens: number;    // sum of what's actually in system prompt
  inlineDocs: IntentDocStat[];
  previewDocs: IntentDocStat[];
  phaseSpecificDocs: IntentDocStat[];
}

export function buildIntentStats(
  docs: IntentDoc[],
  inlineBodies: IntentInlineDoc[],
): IntentStats {
  const inlineRelPaths = new Set(inlineBodies.map((d) => d.relPath));
  const inlineBodyTokens = new Map(inlineBodies.map((d) => [d.relPath, d.tokens]));
  const stat = (d: IntentDoc): IntentDocStat => ({
    relPath: d.relPath,
    kind: d.kind,
    title: d.title,
    tokens: d.tokens,
    previewTokens: Math.ceil(d.preview.length / 4),
    inline: inlineRelPaths.has(d.relPath),
    oversized: d.oversized,
    phaseNumber: d.phaseNumber,
  });
  const all = docs.map(stat);
  const inlineDocs = all.filter((d) => d.inline);
  const previewDocs = all.filter((d) => !d.inline);
  const phaseSpecificDocs = all.filter((d) => d.phaseNumber != null);
  const totalInlineTokens = inlineDocs.reduce(
    (a, b) => a + (inlineBodyTokens.get(b.relPath) ?? b.tokens),
    0,
  );
  const totalPreviewTokens = previewDocs.reduce((a, b) => a + b.previewTokens, 0);
  return {
    totalDocs: all.length,
    totalInlineTokens,
    totalPreviewTokens,
    totalPerTurnTokens: totalInlineTokens + totalPreviewTokens,
    inlineDocs,
    previewDocs,
    phaseSpecificDocs,
  };
}

export function formatIntentStats(stats: IntentStats): string {
  const lines: string[] = [];
  lines.push(`📚 Docs context stats`);
  lines.push(``);
  lines.push(
    `Loaded: ${stats.totalDocs} doc(s) · ${stats.totalPerTurnTokens} tok every turn`,
  );
  lines.push(
    `  (${stats.totalInlineTokens} from inline bodies + ${stats.totalPreviewTokens} from previews)`,
  );
  lines.push(``);
  if (stats.inlineDocs.length > 0) {
    lines.push(`INLINE (full body loaded every turn):`);
    for (const d of stats.inlineDocs) {
      const title = d.title ? ` — "${d.title}"` : "";
      lines.push(`  ● ${d.relPath}  ${d.tokens} tok${title}`);
    }
    lines.push(``);
  }
  if (stats.previewDocs.length > 0) {
    lines.push(`PREVIEW-ONLY (only title + 180-char preview loaded):`);
    for (const d of stats.previewDocs) {
      const title = d.title ? ` — "${d.title}"` : "";
      const size = d.oversized ? " (oversized)" : "";
      lines.push(`  ○ ${d.relPath}  ${d.previewTokens} tok preview${title}${size}`);
    }
    lines.push(``);
  }
  if (stats.phaseSpecificDocs.length > 0) {
    lines.push(`PHASE-SPECIFIC (only loaded for matching phase):`);
    for (const d of stats.phaseSpecificDocs) {
      const title = d.title ? ` — "${d.title}"` : "";
      lines.push(`  ◐ phase ${d.phaseNumber}: ${d.relPath}${title}`);
    }
    lines.push(``);
  }
  if (stats.totalDocs === 0) {
    lines.push(`No intent docs found in .agents/docs/ or ~/.agents/docs/`);
  }
  return lines.join("\n");
}
