// =============================================================================
// util.ts — shared leaf utilities (frontmatter parsers, fs/glob/format helpers)
// =============================================================================
//
// Extracted from core.ts to keep it focused. These are dependency-light helpers
// used across the extension; core.ts re-exports them so existing
// `import { ... } from "./core.ts"` call sites keep working. Only type-only
// imports point back at core.ts (erased at runtime — no import cycle).
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { ProgressInfo, RuleFrontmatter } from "./core.ts";

// ============================================================================
// Frontmatter parsers
// ============================================================================

// Simple parser for .soly/rules/ frontmatter.
export function parseRuleFrontmatter(raw: string): {
  meta: RuleFrontmatter;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const yamlText = match[1];
  const body = match[2];
  const meta: RuleFrontmatter = {};

  for (const line of yamlText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: string | string[] | boolean = trimmed.slice(colonIdx + 1).trim();

    if (
      typeof value === "string" &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (
      typeof value === "string" &&
      value.startsWith("[") &&
      value.endsWith("]")
    ) {
      const inner = value.slice(1, -1).trim();
      value =
        inner.length === 0
          ? []
          : inner.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    }

    (meta as Record<string, unknown>)[key] = value;
  }

  return { meta, body };
}

// YAML-ish parser for .soly/STATE.md. Handles 2-level nested objects (for `progress:`).
export function parseStateFrontmatter(yaml: string): {
  meta: Record<string, unknown>;
  progress: ProgressInfo;
} {
  const root: Record<string, unknown> = {};
  const stack: { indent: number; obj: Record<string, unknown> }[] = [
    { indent: -1, obj: root },
  ];

  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    const content = line.trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj as Record<string, unknown>;

    const colonIdx = content.indexOf(":");
    if (colonIdx === -1) continue;
    const key = content.slice(0, colonIdx).trim();
    let value: unknown = content.slice(colonIdx + 1).trim();

    if (value === "") {
      const newObj: Record<string, unknown> = {};
      parent[key] = newObj;
      stack.push({ indent, obj: newObj });
      continue;
    }

    if (typeof value === "string") {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else if (value === "true") {
        value = true;
      } else if (value === "false") {
        value = false;
      } else if (/^-?\d+(\.\d+)?$/.test(value)) {
        const n = Number(value);
        if (!Number.isNaN(n)) value = n;
      }
    }
    parent[key] = value;
  }

  const progressObj =
    (root.progress as Record<string, unknown> | undefined) ?? {};
  return {
    meta: root,
    progress: {
      totalPhases: Number(progressObj.total_phases ?? 0),
      completedPhases: Number(progressObj.completed_phases ?? 0),
      totalPlans: Number(progressObj.total_plans ?? 0),
      completedPlans: Number(progressObj.completed_plans ?? 0),
      percent: Number(progressObj.percent ?? 0),
    },
  };
}

export function splitFrontmatter(
  raw: string,
): { yaml: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { yaml: m[1], body: m[2] } : null;
}

// ============================================================================
// File helpers
// ============================================================================

export function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Atomic file write: write to a tmp file in the same directory, then rename
 * to the target. Avoids partial writes when concurrent readers/processes
 * (hot reload, another tool, git status) would otherwise see a half-written
 * file. Best-effort: if rename fails, falls back to a direct write.
 */
export function atomicWriteFileSync(
  target: string,
  content: string,
  encoding: BufferEncoding = "utf-8",
): void {
  const dir = path.dirname(target);
  const base = path.basename(target);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, content, encoding);
    fs.renameSync(tmp, target);
  } catch {
    // Fallback: direct write (e.g. cross-device rename on some systems)
    try {
      fs.writeFileSync(target, content, encoding);
    } catch {
      // best effort — caller handles errors
    }
  }
}

export function findMarkdownFiles(dir: string, basePath = ""): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath, relPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(relPath);
    }
  }
  return results;
}

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".()+|^${}\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

export function matchesGlob(pathStr: string, glob: string): boolean {
  return globToRegExp(glob).test(pathStr);
}

export function extractFilePathsFromPrompt(prompt: string): string[] {
  // Only match paths that look like real file references: must contain a slash
  // or start with ./ and end with a short extension. Avoids catching "1.5",
  // "i.e.", etc.
  const matches =
    prompt.match(
      /(?:\.{0,2}\/)?(?:[A-Za-z0-9_\-]+\/)+[A-Za-z0-9_\-.]+\.[A-Za-z0-9]{1,5}/g,
    ) ||
    prompt.match(/[A-Za-z0-9_\-.]+\.[a-z]{1,5}/g) ||
    [];
  return matches;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatTok(n: number): string {
  if (n <= 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
