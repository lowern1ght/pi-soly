// =============================================================================
// core.ts — Core data types, loaders, and builders for the soly extension
// =============================================================================
//
// Owns:
//   - Rule loading from .soly/rules/ (project + global)
//   - Soly project state loading from .soly/ (STATE.md, ROADMAP.md, phases/)
//   - Status line construction
//   - Shared utility functions and constants
//
// Path convention: <cwd>/.soly/. Pi itself loads AGENTS.md / CLAUDE.md
// from ancestor directories through its own resource loader, so soly
// stays out of that path.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

// ---- Rules ----

export type RuleSource =
  | "project-soly"
  | "global-soly"
  | "phase-soly";

export interface RuleFrontmatter {
  description?: string;
  globs?: string[];
  always?: boolean;
  priority?: "high" | "medium" | "low";
  /** If true, the rule is loaded for interactive LLM sessions but NOT
   *  passed to subagent workers. Use for meta-rules like "ask before
   *  acting", "use background subagents", or rules that describe how
   *  the user-facing conversation should go. */
  interactive?: boolean;
  /** Other rule relPaths to inherit from. Their body is prepended to
   *  this rule's body at render time. Cycles are detected. */
  extends?: string[];
  /** Other rule relPaths to disable when this rule is loaded. Takes
   *  precedence over implicit collision-based overriding. */
  overrides?: string[];
  /** Inline this rule's body into the system prompt (opt-in for
   *  short, critical rules). */
  inline?: boolean;
  [key: string]: unknown;
}

export interface RuleFile {
  relPath: string;
  absPath: string;
  meta: RuleFrontmatter;
  body: string;
  raw: string;
  enabled: boolean;
  mtimeMs: number;
  source: RuleSource;
  sourceLabel: "soly" | "phase" | "local";
  priority: number; // higher wins on relPath collision
  /** Phase number for phase-scoped rules; undefined otherwise. */
  phaseNumber?: number;
  /** True if the rule is interactive-only (filtered out for subagent workers). */
  interactiveOnly: boolean;
}

export interface SourceSpec {
  dir: string;
  source: RuleSource;
  sourceLabel: "soly" | "phase" | "local";
  priority: number; // higher wins on relPath collision
  /** Optional phase number (for phase-scoped sources). */
  phaseNumber?: number;
}

// ---- Project state ----

export interface ProgressInfo {
  totalPhases: number;
  completedPhases: number;
  totalPlans: number;
  completedPlans: number;
  percent: number;
}

export interface SolyPosition {
  phase: string;
  plan: string;
  status: string;
}

export interface PhaseInfo {
  number: number;
  name: string;
  slug: string;
  dir: string;
  planCount: number;
  contextExists: boolean;
  researchExists: boolean;
  plans: string[];
}

/**
 * A feature is a logical grouping of tasks (e.g. "auth", "orders").
 * Dual-mode with phases: features live under `.soly/features/`, phases
 * under `.soly/phases/`. soly supports both simultaneously.
 */
export interface FeatureInfo {
  name: string;
  slug: string;
  dir: string;
  taskCount: number;
  readmeExists: boolean;
  tasks: string[]; // task ids under this feature
}

/**
 * A task is a single atomic unit of work (dual-mode with phases).
 * Frontmatter (parsed from PLAN.md):
 *   id, kind, feature, status, priority, parallelizable, depends-on
 */
export interface TaskInfo {
  id: string;
  feature: string;
  kind: string;
  status: string;
  priority: string;
  parallelizable: boolean;
  dependsOn: string[];
  dir: string;
  planExists: boolean;
  contextExists: boolean;
  summaryExists: boolean;
}

export interface SolyState {
  solyDir: string;
  exists: boolean;
  milestone: string;
  milestoneName: string;
  status: string;
  lastUpdated: string;
  progress: ProgressInfo;
  position: SolyPosition | null;
  currentPhase: PhaseInfo | null;
  currentPlanPath: string | null;
  stateBody: string;
  roadmapBody: string;
  phases: PhaseInfo[];
  // Dual-mode: tasks live alongside phases. soly reads both directories;
  // they do not interfere with each other. Empty arrays when the project
  // uses phases only.
  features: FeatureInfo[];
  tasks: TaskInfo[];
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_PROGRESS: ProgressInfo = {
  totalPhases: 0,
  completedPhases: 0,
  totalPlans: 0,
  completedPlans: 0,
  percent: 0,
};

export const STATUS_ID = "soly";
export const STATUS_BAR_WIDTH = 10;

// Default model context window for analytics %-of-context calculation.
// M3 Plus tier = 524288 (512k). If you run a different model / tier, adjust.
export const CONTEXT_WINDOW_TOKENS = 524288;

// ANSI colors — used only in the footer status line.
// "lower register" palette: dim gray for everything, white only for the
// progress bar (the single focal point). No loud accents.
export const C = {
  dim: "\x1b[2m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
} as const;

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

// ============================================================================
// Rules
// ============================================================================

function loadRulesFromSource(spec: SourceSpec): RuleFile[] {
  const files = findMarkdownFiles(spec.dir);
  const rules: RuleFile[] = [];

  for (const relPath of files) {
    const absPath = path.join(spec.dir, relPath);
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) continue;
      const raw = fs.readFileSync(absPath, "utf-8");
      const { meta, body } = parseRuleFrontmatter(raw);
      rules.push({
        relPath,
        absPath,
        meta,
        body: body.trim(),
        raw,
        enabled: true,
        mtimeMs: stat.mtimeMs,
        source: spec.source,
        sourceLabel: spec.sourceLabel,
        priority: spec.priority,
        interactiveOnly: meta.interactive === true,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return rules;
}

export function loadAllRules(sources: SourceSpec[]): {
  rules: RuleFile[];
  overridden: string[];
  explicitOverrides: string[];
} {
  const all: RuleFile[] = [];
  for (const spec of sources) {
    for (const rule of loadRulesFromSource(spec)) {
      rule.priority = spec.priority;
      all.push(rule);
    }
  }
  // Sort by priority desc (highest first), then by relPath asc for stable order.
  // After this sort, the first occurrence of a given relPath in the list is
  // the highest-priority version, so a single dedup pass below is enough.
  all.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.relPath.localeCompare(b.relPath);
  });

  // Build a lookup for the highest-priority version of each relPath
  const firstByPath = new Map<string, RuleFile>();
  for (const r of all) {
    if (!firstByPath.has(r.relPath)) firstByPath.set(r.relPath, r);
  }

  const seen = new Set<string>();
  const result: RuleFile[] = [];
  const overridden: string[] = [];
  const explicitOverrides: string[] = [];
  for (const rule of all) {
    if (seen.has(rule.relPath)) {
      overridden.push(rule.relPath);
      continue;
    }
    seen.add(rule.relPath);
    result.push(rule);
  }

  // Apply explicit `overrides:` from frontmatter. Each override either
  // targets a specific relPath or a glob. When a rule with overrides is
  // loaded, the matched targets are disabled (enabled=false) — unless
  // the override is itself disabled.
  const explicitOverridePaths = new Set<string>();
  for (const rule of result) {
    if (!rule.enabled) continue;
    const targets = rule.meta.overrides;
    if (!Array.isArray(targets) || targets.length === 0) continue;
    for (const t of targets) {
      // Try exact match first, then glob match
      for (const other of result) {
        if (other === rule) continue;
        if (!other.enabled) continue;
        const match =
          other.relPath === t ||
          other.relPath.endsWith(t) ||
          (other.relPath.includes("/") &&
            t === other.relPath.split("/").pop()) ||
          matchesGlob(other.relPath, t);
        if (match) {
          other.enabled = false;
          explicitOverridePaths.add(other.relPath);
          explicitOverrides.push(`${rule.relPath} → ${other.relPath}`);
        }
      }
    }
  }

  // Apply `extends:` from frontmatter. Each rule's body is prepended with
  // the bodies of its parent rules (recursively, with cycle detection).
  // The result is recomputed body, kept on the rule.
  for (const rule of result) {
    const extendsList = rule.meta.extends;
    if (!Array.isArray(extendsList) || extendsList.length === 0) continue;
    const parts: string[] = [];
    const visited = new Set<string>([rule.absPath]);
    const collect = (ref: string): boolean => {
      // Resolve ref to a loaded rule
      let parent: RuleFile | undefined;
      for (const r of result) {
        if (r.relPath === ref || r.relPath.endsWith(ref)) {
          parent = r;
          break;
        }
      }
      if (!parent) {
        parts.push(`<!-- extends: not found: ${ref} -->`);
        return false;
      }
      if (visited.has(parent.absPath)) {
        parts.push(`<!-- extends: cycle detected: ${ref} -->`);
        return false;
      }
      visited.add(parent.absPath);
      // Recurse first (so parents come first)
      const parentExtends = parent.meta.extends;
      if (Array.isArray(parentExtends)) {
        for (const pe of parentExtends) {
          collect(pe);
        }
      }
      parts.push(`### from: ${parent.relPath}\n\n${parent.body}`);
      return true;
    };
    for (const ref of extendsList) collect(ref);
    rule.body = [...parts, `\n---\n\n${rule.body}`].join("\n");
  }

  return { rules: result, overridden, explicitOverrides };
}

export function ruleKey(rule: RuleFile): string {
  return `${rule.source}::${rule.relPath}`;
}

// ============================================================================
// Inline @see resolution
// ============================================================================
//
// A rule body can reference another rule with a standalone `@see <relpath>`
// line (soly convention). We resolve those references inline
// — the referenced rule's body is appended under a `> See: <relpath>`
// sub-block. Cycles and missing references are skipped with a comment.
//
// Reference path semantics:
//   @see ./sibling.md       — relative to the current rule's dir
//   @see ../other/note.md   — relative (parent dir)
//   @see ~/rules/foo.md     — under $HOME
//   @see /abs/path.md       — absolute
//
// We cap recursion at 2 levels to avoid blowing up the prompt.

const SEE_PATTERN = /^\s*@see\s+((?:\.{0,2}\/|~\/|\/)[^\s]+\.md)\s*$/;
const SEE_MAX_DEPTH = 2;

function resolveSeeReferences(
  body: string,
  ruleAbsPath: string,
  allRulesByPath: Map<string, RuleFile>,
  depth: number,
  visited: Set<string>,
): string {
  if (depth >= SEE_MAX_DEPTH) return body;
  const fileDir = path.dirname(ruleAbsPath);
  const lines = body.split(/\r?\n/);
  const result: string[] = [];
  const seen = new Set<string>(visited);
  seen.add(path.resolve(ruleAbsPath));

  for (const line of lines) {
    const m = line.match(SEE_PATTERN);
    if (!m) {
      result.push(line);
      continue;
    }
    const ref = m[1];
    let target: string;
    if (ref.startsWith("/")) {
      target = ref;
    } else if (ref.startsWith("~/")) {
      target = path.join(os.homedir(), ref.slice(2));
    } else {
      target = path.resolve(fileDir, ref);
    }
    const resolved = path.resolve(target);
    if (seen.has(resolved)) {
      result.push(`<!-- @see skipped (cycle): ${ref} -->`);
      continue;
    }
    seen.add(resolved);
    const refRule = allRulesByPath.get(resolved);
    if (!refRule || !refRule.enabled) {
      result.push(`<!-- @see not found: ${ref} -->`);
      continue;
    }
    const refBody = resolveSeeReferences(
      refRule.body,
      refRule.absPath,
      allRulesByPath,
      depth + 1,
      seen,
    );
    result.push(`> See: ${refRule.relPath}\n`);
    result.push(refBody);
    result.push("\n---");
  }
  return result.join("\n");
}

export function buildRulesSection(
  rules: RuleFile[],
  activeGlobs?: string[],
  options?: {
    phaseNumber?: number;
    groupByPhase?: boolean;
    /** Filter out rules with `interactive: true` frontmatter.
     *  Use for subagent workers — those rules describe how the user-facing
     *  conversation should go, not how to execute work. */
    excludeInteractive?: boolean;
  },
): { section: string; loaded: string[]; interactive: string[] } {
  const applicable: RuleFile[] = [];
  const skipped: { rule: RuleFile; reason: string }[] = [];
  const interactive: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      skipped.push({ rule, reason: "disabled" });
      continue;
    }

    const globs = rule.meta.globs;
    const always = rule.meta.always === true;

    if (always || !globs || globs.length === 0) {
      applicable.push(rule);
      continue;
    }

    if (activeGlobs && activeGlobs.length > 0) {
      const matches = globs.some((g) =>
        activeGlobs.some((p) => matchesGlob(p, g)),
      );
      if (matches) {
        applicable.push(rule);
      } else {
        skipped.push({ rule, reason: `globs ${JSON.stringify(globs)}` });
      }
    } else {
      applicable.push(rule);
    }
  }

  if (applicable.length === 0) {
    return { section: "", loaded: [], interactive };
  }

  // Filter out interactive-only rules if requested (for subagent workers)
  if (options?.excludeInteractive) {
    const before = applicable.length;
    const filtered = applicable.filter((r) => !r.interactiveOnly);
    applicable.length = 0;
    applicable.push(...filtered);
    if (applicable.length === 0) {
      return { section: "", loaded: [], interactive };
    }
    // If filtering removed everything, fall back to the original set with
    // a note. (Better to give worker some rules than none.)
    if (applicable.length === 0) {
      // unreachable
    }
  }

  // Build a lookup map of all loaded rules (including disabled — @see can
  // reference them, but only enabled ones get inlined).
  const rulesByPath = new Map<string, RuleFile>();
  for (const r of rules) rulesByPath.set(path.resolve(r.absPath), r);

  const render = (r: RuleFile) => {
    const desc = r.meta.description ? ` — ${r.meta.description}` : "";
    const pri = r.meta.priority ? ` {${r.meta.priority}}` : "";
    const interactiveTag = r.interactiveOnly ? " {interactive-only}" : "";
    const body = resolveSeeReferences(
      r.body,
      r.absPath,
      rulesByPath,
      0,
      new Set(),
    );
    return `### [${r.sourceLabel}${pri}${interactiveTag}] ${r.relPath}${desc}\n\n${body}`;
  };

  // Track which rules are interactive (for the returned list, so callers
  // can pass them to a subagent task as "do NOT include these").
  for (const r of rules) {
    if (r.interactiveOnly) interactive.push(r.relPath);
  }

  // Optional grouping: phase rules in their own group, then everything else.
  let blocks: string[];
  let headerHint: string;
  if (options?.groupByPhase) {
    const phase = options.phaseNumber;
    const phaseRules = applicable.filter((r) => r.phaseNumber === phase);
    const otherRules = applicable.filter((r) => r.phaseNumber !== phase);
    blocks = [...phaseRules.map(render), ...otherRules.map(render)];
    headerHint = `Phase ${phase} rules are loaded for the currently active phase; all other rules are always-on. Inline @see references are resolved recursively.`;
  } else {
    blocks = applicable.map(render);
    headerHint = `The following rules are loaded from \`.soly/rules/\` and \`~/.soly/rules/\` and are mandatory. Follow them strictly. Inline @see references are resolved recursively.`;
  }

  const skippedNote = skipped.length
    ? `\n\n_Skipped (not applicable or disabled): ${skipped
        .map((s) => `${s.rule.sourceLabel}/${s.rule.relPath} (${s.reason})`)
        .join(", ")}_`
    : "";

  const section = `

## ⚠️ MANDATORY: soly project rules

**These rules are NON-NEGOTIABLE. Before writing or editing ANY code, re-read the rules above that apply to the file path you are about to modify. If a rule contradicts your instinct, the rule wins.**

${headerHint}

${blocks.join("\n\n---\n\n")}${skippedNote}
`;

  return { section, loaded: applicable.map(ruleKey), interactive };
}

// ============================================================================
// Phase-scoped rules loader
// ============================================================================
//
// Phase rules live under <phase-dir>/rules/<anything>.md and are loaded
// alongside the always-on rules when the matching phase is active. They
// receive priority 5 (above project rules) so they always win on relPath
// collision within a phase, but don't shadow global rules in other phases.

export function loadPhaseRules(
  phaseDir: string,
  phaseNumber: number,
): RuleFile[] {
  const rulesDir = path.join(phaseDir, "rules");
  if (!fs.existsSync(rulesDir)) return [];
  const files = findMarkdownFiles(rulesDir);
  const out: RuleFile[] = [];
  for (const relPath of files) {
    const absPath = path.join(rulesDir, relPath);
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) continue;
      const raw = fs.readFileSync(absPath, "utf-8");
      const { meta, body } = parseRuleFrontmatter(raw);
      out.push({
        relPath: `phase-${phaseNumber}/${relPath}`,
        absPath,
        meta,
        body: body.trim(),
        raw,
        enabled: true,
        mtimeMs: stat.mtimeMs,
        source: "phase-soly",
        sourceLabel: "phase",
        priority: 5,
        phaseNumber,
        interactiveOnly: meta.interactive === true,
      });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

// ============================================================================
// Rule analytics
// ============================================================================

const RULE_WARN_THRESHOLD_TOKENS = 5000;
const DUPLICATE_NORMALIZE_RE = /\s+/g;

export interface RuleAnalytics {
  fileCount: number;
  totalTokens: number;
  contextWindowTokens: number;
  contextBudgetPct: number; // totalTokens / contextWindowTokens * 100
  topFiles: { relPath: string; tokens: number; sourceLabel: string }[];
  warnings: string[];
  duplicates: string[][];
  /** Lint-style issues: missing frontmatter fields, invalid priority, etc. */
  lint: { relPath: string; message: string }[];
}

export function analyzeRules(
  rules: RuleFile[],
  contextWindowTokens: number,
): RuleAnalytics {
  const enabled = rules.filter((r) => r.enabled);
  const fileCount = enabled.length;

  const tokensByPath = new Map<string, number>();
  for (const rule of enabled) {
    tokensByPath.set(rule.relPath, estimateTokens(rule.body));
  }

  const totalTokens = Array.from(tokensByPath.values()).reduce(
    (a, b) => a + b,
    0,
  );

  const topFiles = enabled
    .map((r) => ({
      relPath: r.relPath,
      tokens: tokensByPath.get(r.relPath) ?? 0,
      sourceLabel: r.sourceLabel,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);

  const warnings: string[] = [];
  const lint: { relPath: string; message: string }[] = [];

  // Oversized files
  for (const file of topFiles) {
    if (file.tokens > RULE_WARN_THRESHOLD_TOKENS) {
      warnings.push(
        `${file.relPath}: ${formatTok(file.tokens)} (oversized, consider splitting)`,
      );
    }
  }

  // Missing frontmatter description
  for (const rule of enabled) {
    if (!rule.meta.description) {
      lint.push({
        relPath: rule.relPath,
        message: "missing frontmatter description",
      });
    }

    // Validate priority field
    if (rule.meta.priority != null) {
      const valid = ["high", "medium", "low"];
      if (!valid.includes(String(rule.meta.priority))) {
        lint.push({
          relPath: rule.relPath,
          message: `invalid priority "${rule.meta.priority}" (expected: high | medium | low)`,
        });
      }
    }

    // Validate globs
    if (rule.meta.globs != null && !Array.isArray(rule.meta.globs)) {
      lint.push({
        relPath: rule.relPath,
        message: `globs must be an array, got ${typeof rule.meta.globs}`,
      });
    }

    // Empty body warning
    if (rule.body.trim().length === 0) {
      lint.push({
        relPath: rule.relPath,
        message: "empty body",
      });
    }
  }

  // Duplicate content (normalized whitespace)
  const normalizedToPaths = new Map<string, string[]>();
  for (const rule of enabled) {
    const normalized = rule.body.replace(DUPLICATE_NORMALIZE_RE, " ").trim();
    if (normalized.length === 0) continue;
    const list = normalizedToPaths.get(normalized) ?? [];
    list.push(rule.relPath);
    normalizedToPaths.set(normalized, list);
  }
  const duplicates: string[][] = [];
  for (const list of normalizedToPaths.values()) {
    if (list.length > 1) duplicates.push(list);
  }
  for (const dup of duplicates) {
    warnings.push(`duplicate content: ${dup.join(", ")}`);
  }

  // Promote lint to warnings so existing analytics output surfaces them
  for (const l of lint) {
    warnings.push(`${l.relPath}: ${l.message}`);
  }

  return {
    fileCount,
    totalTokens,
    contextWindowTokens,
    contextBudgetPct:
      contextWindowTokens > 0 ? (totalTokens / contextWindowTokens) * 100 : 0,
    topFiles,
    warnings,
    duplicates,
    lint,
  };
}

export function formatAnalyticsCompact(analytics: RuleAnalytics): string {
  if (analytics.fileCount === 0) return "";
  const pct = (
    (analytics.totalTokens / analytics.contextWindowTokens) *
    100
  ).toFixed(2);
  const parts: string[] = [
    `${analytics.fileCount} file(s), ${formatTok(analytics.totalTokens)} (${pct}% of context)`,
  ];
  if (analytics.warnings.length > 0) {
    parts.push(`⚠ ${analytics.warnings.length} warning(s)`);
  }
  return parts.join(" · ");
}

export function formatAnalyticsFull(analytics: RuleAnalytics): string {
  const pct = (
    (analytics.totalTokens / analytics.contextWindowTokens) *
    100
  ).toFixed(2);
  const lines: string[] = [];
  lines.push(`soly rules analytics:`);
  lines.push(
    `  ${analytics.fileCount} file(s), ${formatTok(analytics.totalTokens)} (${pct}% of context)`,
  );

  if (analytics.topFiles.length > 0) {
    const topStr = analytics.topFiles
      .slice(0, 5)
      .map((f) => `${f.relPath} (${formatTok(f.tokens)})`)
      .join(", ");
    lines.push(`  top: ${topStr}`);
  }

  if (analytics.warnings.length > 0) {
    lines.push(`  ⚠ ${analytics.warnings.length} warning(s):`);
    for (const w of analytics.warnings.slice(0, 10)) {
      lines.push(`    - ${w}`);
    }
    if (analytics.warnings.length > 10) {
      lines.push(`    - ... and ${analytics.warnings.length - 10} more`);
    }
  } else {
    lines.push(`  ✓ no issues detected`);
  }

  return lines.join("\n");
}

// =============================================================================
// Rules context stats — Claude-memory-style breakdown
// =============================================================================
//
// Shows which rules are "always-on" (loaded every turn) vs "glob-matched"
// (loaded only when file paths in prompt match). Useful for spotting
// context bloat and verifying rules will actually fire.

export interface RuleStat {
  relPath: string;
  tokens: number;
  sourceLabel: string;
  description?: string;
  always: boolean;
  globs: string[];
  loadedLastTurn: boolean;
}

export interface RulesContextStats {
  totalLoaded: number;
  totalTokens: number;
  contextBudgetPct: number;
  alwaysOn: RuleStat[];
  globMatched: RuleStat[];
  disabled: RuleStat[];
  lastTurn: {
    promptFiles: string[];
    matchedRulePaths: string[];
  };
}

export function buildRulesContextStats(
  rules: RuleFile[],
  contextWindowTokens: number,
  lastTurn?: { promptFiles: string[]; matchedRelPaths: string[] },
): RulesContextStats {
  const enabled = rules.filter((r) => r.enabled);
  const disabled = rules.filter((r) => !r.enabled);
  const lastTurnMatched = new Set(lastTurn?.matchedRelPaths ?? []);
  const stat = (r: RuleFile, loadedLastTurn: boolean): RuleStat => ({
    relPath: r.relPath,
    tokens: estimateTokens(r.body),
    sourceLabel: r.sourceLabel,
    description: r.meta.description,
    always: r.meta.always === true,
    globs: r.meta.globs ?? [],
    loadedLastTurn,
  });
  const alwaysOn: RuleStat[] = [];
  const globMatched: RuleStat[] = [];
  for (const r of enabled) {
    const isAlways = r.meta.always === true;
    const isLoadedLastTurn = lastTurnMatched.has(r.relPath) || isAlways;
    const s = stat(r, isLoadedLastTurn);
    if (isAlways) alwaysOn.push(s);
    else globMatched.push(s);
  }
  const totalTokens = [...alwaysOn, ...globMatched].reduce((a, b) => a + b.tokens, 0);
  return {
    totalLoaded: enabled.length,
    totalTokens,
    contextBudgetPct:
      contextWindowTokens > 0 ? (totalTokens / contextWindowTokens) * 100 : 0,
    alwaysOn,
    globMatched,
    disabled: disabled.map((r) => stat(r, false)),
    lastTurn: {
      promptFiles: lastTurn?.promptFiles ?? [],
      matchedRulePaths: lastTurn?.matchedRelPaths ?? [],
    },
  };
}

export function formatRulesContextStats(stats: RulesContextStats): string {
  const lines: string[] = [];
  lines.push(`📊 Rules context stats`);
  lines.push(``);
  const ctxWindow = stats.contextBudgetPct > 0
    ? Math.round(stats.totalTokens / (stats.contextBudgetPct / 100))
    : 0;
  lines.push(
    `Loaded: ${stats.totalLoaded} rule(s) · ${formatTok(stats.totalTokens)} · ${stats.contextBudgetPct.toFixed(1)}% of ${formatTok(ctxWindow)} context`,
  );
  lines.push(``);
  if (stats.alwaysOn.length > 0) {
    lines.push(`ALWAYS-ON (loaded every turn):`);
    for (const r of stats.alwaysOn) {
      const last = r.loadedLastTurn ? " ✓" : "";
      const desc = r.description ? ` — "${r.description}"` : "";
      lines.push(`  ● ${r.relPath}  ${formatTok(r.tokens)}${desc}${last}`);
    }
    lines.push(``);
  }
  if (stats.globMatched.length > 0) {
    lines.push(`GLOB-MATCHED (loaded when prompt file matches):`);
    for (const r of stats.globMatched) {
      const last = r.loadedLastTurn ? " ✓" : "";
      const desc = r.description ? ` — "${r.description}"` : "";
      const globs = r.globs.length > 0 ? `  [globs: ${r.globs.join(", ")}]` : "";
      lines.push(`  ◐ ${r.relPath}  ${formatTok(r.tokens)}${desc}${globs}${last}`);
    }
    lines.push(``);
  }
  if (stats.disabled.length > 0) {
    lines.push(`DISABLED:`);
    for (const r of stats.disabled) {
      lines.push(`  ○ ${r.relPath}  ${formatTok(r.tokens)} — disabled`);
    }
    lines.push(``);
  }
  if (stats.lastTurn.promptFiles.length > 0) {
    lines.push(`Last turn: ${stats.lastTurn.promptFiles.length} file path(s) in prompt`);
    for (const f of stats.lastTurn.promptFiles) {
      lines.push(`  → ${f}`);
    }
  } else {
    lines.push(`Last turn: no file paths in prompt (only always-on rules loaded)`);
  }
  return lines.join("\n");
}

// ============================================================================
// @import resolver (markdown only)
// ============================================================================
//
// Used by intent docs (`.soly/docs/*.md`) to inline other markdown files
// via `@import path/to/file.md` lines. Cycles and > MAX_IMPORT_DEPTH
// are skipped with a comment.
//
// Supports:
//   @./relative.md         — relative to the current file
//   @../parent.md          — relative (parent dir)
//   @/abs/path.md          — absolute
//   @~/user/path.md        — under $HOME
//   @./file.md:LSTART-LEND   — line range within a file (1-indexed, inclusive)
const MAX_IMPORT_DEPTH = 5;

// Three forms: with-range, plain
const IMPORT_RANGE_PATTERN =
  /^\s*@((?:\.{0,2}\/|~\/|\/)[^\s]+?\.[A-Za-z0-9]{1,5}):(\d+)(?:-(\d+))?\s*$/;
const IMPORT_PATTERN =
  /^\s*@((?:\.{0,2}\/|~\/|\/)[^\s]+\.[A-Za-z0-9]{1,5})\s*$/;

/** Read a line range [start, end] (1-indexed, inclusive) from a file. */
function readLineRange(file: string, start: number, end: number): string | null {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const lines = raw.split(/\r?\n/);
    if (start < 1 || start > lines.length) return null;
    const last = Math.min(end, lines.length);
    return lines.slice(start - 1, last).join("\n");
  } catch {
    return null;
  }
}

/** Recursively resolve @import lines in a markdown document.
 *  - Cycles and > MAX_IMPORT_DEPTH are skipped with a comment.
 *  - Already-imported files are tracked in globalSeen (caller-owned). */
export function resolveImports(
  raw: string,
  filePath: string,
  globalSeen: Set<string>,
  depth: number,
  out: { imported: string[] },
): string {
  if (depth > MAX_IMPORT_DEPTH) {
    return raw + `\n<!-- import depth ${MAX_IMPORT_DEPTH} exceeded -->\n`;
  }
  const fileDir = path.dirname(filePath);
  const lines = raw.split(/\r?\n/);
  const result: string[] = [];
  const localSeen = new Set<string>();

  for (const line of lines) {
    // @<file>:START-END (line range)
    const rangeMatch = line.match(IMPORT_RANGE_PATTERN);
    if (rangeMatch) {
      const ref = rangeMatch[1];
      const start = parseInt(rangeMatch[2], 10);
      const end = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : start;
      let target: string;
      if (ref.startsWith("/")) {
        target = ref;
      } else if (ref.startsWith("~/")) {
        target = path.join(os.homedir(), ref.slice(2));
      } else {
        target = path.resolve(fileDir, ref);
      }
      const targetResolved = path.resolve(target);
      if (localSeen.has(targetResolved) || globalSeen.has(targetResolved)) {
        result.push(
          `<!-- import skipped (cycle or already loaded): ${ref}:${start}-${end} -->`,
        );
        continue;
      }
      localSeen.add(targetResolved);
      globalSeen.add(targetResolved);
      out.imported.push(`${ref}:${start}-${end}`);
      if (!fs.existsSync(targetResolved)) {
        result.push(`<!-- import not found: ${ref}:${start}-${end} -->`);
        continue;
      }
      const range = readLineRange(targetResolved, start, end);
      if (range === null) {
        result.push(`<!-- import read error: ${ref}:${start}-${end} -->`);
        continue;
      }
      result.push(`<!-- imported from ${ref} (lines ${start}-${end}) -->`);
      result.push(range);
      continue;
    }

    const m = line.match(IMPORT_PATTERN);
    if (!m) {
      result.push(line);
      continue;
    }

    const ref = m[1];
    let target: string;
    if (ref.startsWith("/")) {
      target = ref;
    } else if (ref.startsWith("~/")) {
      target = path.join(os.homedir(), ref.slice(2));
    } else {
      target = path.resolve(fileDir, ref);
    }

    const targetResolved = path.resolve(target);
    if (localSeen.has(targetResolved) || globalSeen.has(targetResolved)) {
      result.push(`<!-- import skipped (cycle or already loaded): ${ref} -->`);
      continue;
    }
    localSeen.add(targetResolved);
    globalSeen.add(targetResolved);
    out.imported.push(ref);

    if (!fs.existsSync(targetResolved)) {
      result.push(`<!-- import not found: ${ref} -->`);
      continue;
    }

    try {
      const importedRaw = fs.readFileSync(targetResolved, "utf-8");
      const importedResolved = resolveImports(
        importedRaw,
        targetResolved,
        globalSeen,
        depth + 1,
        out,
      );
      result.push(`<!-- imported from ${ref} -->`);
      result.push(importedResolved);
    } catch (err) {
      result.push(
        `<!-- import read error: ${ref} (${(err as Error).message}) -->`,
      );
    }
  }

  return result.join("\n");
}

// ============================================================================
// Project state (.soly/)
// ============================================================================

function extractCurrentPosition(body: string): SolyPosition | null {
  const m = body.match(/##\s*Current Position\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/);
  if (!m) return null;
  const section = m[1];
  const phase = section.match(/Phase:\s*([^\n]+)/)?.[1]?.trim();
  const plan = section.match(/Plan:\s*([^\n]+)/)?.[1]?.trim();
  const status = section.match(/Status:\s*([^\n]+)/)?.[1]?.trim();
  if (!phase) return null;
  return { phase, plan: plan ?? "?", status: status ?? "unknown" };
}

function loadPhaseDir(phaseDir: string): PhaseInfo {
  const slug = path.basename(phaseDir);
  const numMatch = slug.match(/^(\d+)-?(.*)$/);
  const number = numMatch?.[1] ? parseInt(numMatch[1], 10) : 0;
  const name = numMatch?.[2]?.replace(/-/g, " ").trim() ?? slug;

  const files = findMarkdownFiles(phaseDir);
  // Soly layout: <phase>-<plan>-PLAN.md (e.g. "01-02-PLAN.md")
  const plans = files.filter((f) => /-\d{2,}-PLAN\.md$/.test(f)).sort();

  return {
    number,
    name,
    slug,
    dir: phaseDir,
    planCount: plans.length,
    contextExists: files.some((f) => /-CONTEXT\.md$/.test(f)),
    researchExists: files.some((f) => /-RESEARCH\.md$/.test(f)),
    plans,
  };
}

function listPhases(solyDir: string): PhaseInfo[] {
  const phasesDir = path.join(solyDir, "phases");
  if (!fs.existsSync(phasesDir)) return [];
  return fs
    .readdirSync(phasesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => loadPhaseDir(path.join(phasesDir, e.name)))
    .filter((p) => p.number > 0)
    .sort((a, b) => a.number - b.number);
}

// ----------------------------------------------------------------------------
// Tasks (dual-mode with phases). Discovery + frontmatter parsing.
// ----------------------------------------------------------------------------

/**
 * Parse the subset of YAML frontmatter we use for tasks. Lightweight — no
 * full YAML parser. Supports scalar values and JSON-style arrays.
 *
 *   ---
 *   id: auth-be-login-a3f9
 *   kind: be
 *   feature: auth
 *   status: ready
 *   priority: high
 *   parallelizable: true
 *   depends-on: ["other-task-id"]
 *   ---
 */
function parseTaskFrontmatter(raw: string): {
  kind: string;
  feature: string;
  status: string;
  priority: string;
  parallelizable: boolean;
  dependsOn: string[];
} | null {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) return null;
  const yaml = m[1];
  const get = (key: string): string | undefined => {
    const line = yaml.split("\n").find((l) => l.startsWith(`${key}:`));
    return line?.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
  };
  const kind = get("kind") ?? "be";
  const feature = get("feature") ?? "";
  const status = get("status") ?? "ready";
  const priority = get("priority") ?? "medium";
  const parallelizable = get("parallelizable") === "true";
  const depsRaw = get("depends-on") ?? "[]";
  let dependsOn: string[] = [];
  try {
    const parsed = JSON.parse(depsRaw.replace(/'/g, '"'));
    if (Array.isArray(parsed)) dependsOn = parsed.map(String);
  } catch {
    // Fallback: comma-separated
    dependsOn = depsRaw
      .replace(/[\[\]]/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { kind, feature, status, priority, parallelizable, dependsOn };
}

function loadFeatureDir(featureDir: string): FeatureInfo | null {
  const name = path.basename(featureDir);
  const tasksDir = path.join(featureDir, "tasks");
  const taskIds: string[] = [];
  if (fs.existsSync(tasksDir)) {
    taskIds.push(
      ...fs
        .readdirSync(tasksDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(),
    );
  }
  return {
    name,
    slug: name,
    dir: featureDir,
    taskCount: taskIds.length,
    readmeExists: fs.existsSync(path.join(featureDir, "README.md")),
    tasks: taskIds,
  };
}

function listFeatures(solyDir: string): FeatureInfo[] {
  const featuresDir = path.join(solyDir, "features");
  if (!fs.existsSync(featuresDir)) return [];
  return fs
    .readdirSync(featuresDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => loadFeatureDir(path.join(featuresDir, e.name)))
    .filter((f): f is FeatureInfo => f !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loadTaskDir(taskDir: string): TaskInfo | null {
  const id = path.basename(taskDir);
  const planPath = path.join(taskDir, "PLAN.md");
  const planRaw = readIfExists(planPath) ?? "";
  const fm = parseTaskFrontmatter(planRaw);
  if (!fm) return null; // No frontmatter — malformed task, skip silently
  const files = findMarkdownFiles(taskDir);
  return {
    id,
    feature: fm.feature || path.basename(path.dirname(path.dirname(taskDir))),
    kind: fm.kind,
    status: fm.status,
    priority: fm.priority,
    parallelizable: fm.parallelizable,
    dependsOn: fm.dependsOn,
    dir: taskDir,
    planExists: files.some((f) => f === "PLAN.md"),
    contextExists: files.some((f) => f === "CONTEXT.md"),
    summaryExists: files.some((f) => f === "SUMMARY.md"),
  };
}

function listTasks(solyDir: string): TaskInfo[] {
  const tasks: TaskInfo[] = [];
  const featuresDir = path.join(solyDir, "features");
  if (!fs.existsSync(featuresDir)) return tasks;
  for (const featureEntry of fs.readdirSync(featuresDir, { withFileTypes: true })) {
    if (!featureEntry.isDirectory()) continue;
    const tasksDir = path.join(featuresDir, featureEntry.name, "tasks");
    if (!fs.existsSync(tasksDir)) continue;
    for (const taskEntry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
      if (!taskEntry.isDirectory()) continue;
      const task = loadTaskDir(path.join(tasksDir, taskEntry.name));
      if (task) tasks.push(task);
    }
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

function findCurrentPhase(
  position: SolyPosition | null,
  phases: PhaseInfo[],
): PhaseInfo | null {
  if (!position) return null;
  const numMatch = position.phase.match(/(\d+)/);
  if (!numMatch) return null;
  const num = parseInt(numMatch[1], 10);
  return phases.find((p) => p.number === num) ?? null;
}

function resolveCurrentPlanPath(
  position: SolyPosition,
  phase: PhaseInfo,
): string | null {
  const ofMatch = position.plan.match(/(\d+)\s+of\s+\d+/);
  if (ofMatch) {
    const idx = parseInt(ofMatch[1], 10);
    const planRel = phase.plans[idx - 1];
    if (planRel) return path.join(phase.dir, planRel);
  }
  const slugMatch = position.plan.match(/\((\d{2,}-[\w-]+)\)/);
  if (slugMatch) {
    const planRel = phase.plans.find((p) => p.startsWith(slugMatch[1]));
    if (planRel) return path.join(phase.dir, planRel);
  }
  return phase.plans[0] ? path.join(phase.dir, phase.plans[0]) : null;
}

export function loadProjectState(solyDir: string): SolyState {
  const statePath = path.join(solyDir, "STATE.md");
  const roadmapPath = path.join(solyDir, "ROADMAP.md");

  const stateRaw = readIfExists(statePath) ?? "";
  const roadmapBody = readIfExists(roadmapPath) ?? "";

  const fm = splitFrontmatter(stateRaw);
  const { meta, progress } = fm
    ? parseStateFrontmatter(fm.yaml)
    : {
        meta: {} as Record<string, unknown>,
        progress: { ...DEFAULT_PROGRESS },
      };
  const stateBody = (fm?.body ?? stateRaw).trim();

  const position = extractCurrentPosition(stateBody);
  const phases = listPhases(solyDir);
  const features = listFeatures(solyDir);
  const tasks = listTasks(solyDir);
  const currentPhase = findCurrentPhase(position, phases);
  const currentPlanPath =
    position && currentPhase
      ? resolveCurrentPlanPath(position, currentPhase)
      : null;

  return {
    solyDir,
    exists: fs.existsSync(solyDir),
    milestone: String(meta.milestone ?? "—"),
    milestoneName: String(meta.milestone_name ?? ""),
    status: String(meta.status ?? "unknown"),
    lastUpdated: String(meta.last_updated ?? ""),
    progress,
    position,
    currentPhase,
    currentPlanPath,
    stateBody,
    roadmapBody,
    phases,
    features,
    tasks,
  };
}

export function buildProjectStateSection(state: SolyState): string {
  if (!state.exists) return "";

  const lines: string[] = [
    "",
    "## soly project state",
    "",
    `- **milestone**: ${state.milestone}${state.milestoneName ? ` — ${state.milestoneName}` : ""}`,
    `- **status**: ${state.status}`,
  ];
  if (state.position) {
    lines.push(`- **phase**: ${state.position.phase}`);
    lines.push(`- **plan**: ${state.position.plan}`);
    lines.push(`- **position status**: ${state.position.status}`);
  }
  lines.push(
    `- **progress**: ${state.progress.completedPhases}/${state.progress.totalPhases} phases, ${state.progress.completedPlans}/${state.progress.totalPlans} plans — ${state.progress.percent}%`,
  );

  if (state.currentPlanPath) {
    const planContent = readIfExists(state.currentPlanPath);
    if (planContent) {
      const { body } = splitFrontmatter(planContent) ?? { body: planContent };
      const objective = body
        .match(/<objective>([\s\S]*?)<\/objective>/)?.[1]
        ?.trim();
      if (objective) {
        const short =
          objective.length > 700 ? `${objective.slice(0, 700)}…` : objective;
        lines.push("", "### current plan objective", "", short);
      }
    }
  }

  lines.push(
    "",
    "**working agreement**:",
    "- Follow the current PLAN.md. Each task has acceptance criteria — implement them exactly.",
    "- Do not skip ahead. Do not rewrite the plan without discussing.",
    "- After each task: verify the must_haves.truths from the plan frontmatter still hold.",
    "- When the plan is complete: update STATE.md progress and create a SUMMARY.md.",
    "- Full state available via the `soly_read` tool. Decisions loggable via `soly_log_decision`.",
  );

  return lines.join("\n");
}

// ============================================================================
// Status bar (combined)
// ============================================================================

export function buildProgressBar(
  percent: number,
  width = STATUS_BAR_WIDTH,
): string {
  const filled = Math.max(
    0,
    Math.min(width, Math.round((percent / 100) * width)),
  );
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  // Bar is the focal point: always white, framed by brackets.
  return `${C.white}[${bar}]${C.reset}`;
}

function dim(text: string): string {
  return `${C.dim}${text}${C.reset}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Build a single status line combining project state, rules, and context files.
 * Returns "" if none has anything to show.
 *
 * Layout (two visual groups separated by wide whitespace):
 *
 *   soly · v1.6.1 p10 0/2 [bar] 0%   rules 6 · 2.4k   context 2 · 1.1k
 *   ────   ─────────────────────────  ────────────────  ──────────────────
 *   prefix       project state              rules            context
 *
 * The `·` only appears where it logically connects two pieces (prefix→state,
 * count→tokens). Whitespace separates unrelated groups.
 */
export function buildStatusLine(
  rulesTotal: number,
  rulesLoadedCount: number,
  rulesTokens: number,
  state: SolyState,
): string {
  // ---- Group 1: project state ----
  const stateParts: string[] = [];
  if (state.exists) {
    const milestone =
      state.milestone && state.milestone !== "—" ? state.milestone : "";
    if (milestone) stateParts.push(dim(truncate(milestone, 20)));

    const phase = state.currentPhase?.number;
    if (phase !== undefined && phase !== null) {
      const planInfo =
        state.progress.totalPlans > 0
          ? ` ${state.progress.completedPlans}/${state.progress.totalPlans}`
          : "";
      stateParts.push(dim(`p${phase}${planInfo}`));
    }
    if (state.progress.totalPhases > 0 || state.progress.totalPlans > 0) {
      // bar is the only white element (focal point); percent stays dim
      stateParts.push(
        `${buildProgressBar(state.progress.percent)} ${dim(state.progress.percent + "%")}`,
      );
    }
  }

  // ---- Group 2: counts (rules) ----
  const countParts: string[] = [];
  if (rulesTotal > 0) {
    const n =
      rulesLoadedCount === rulesTotal
        ? `${rulesTotal}`
        : `${rulesLoadedCount}/${rulesTotal}`;
    const tokens = rulesTokens > 0 ? ` · ${formatTok(rulesTokens)}` : "";
    countParts.push(dim(`rules ${n}${tokens}`));
  }

  // ---- Assemble ----
  const groups: string[] = [];
  if (stateParts.length > 0) groups.push(stateParts.join(" "));
  if (countParts.length > 0) groups.push(countParts.join("   "));

  if (groups.length === 0) return "";
  return `${dim("soly")} · ${groups.join("   ")}`;
}

// ============================================================================
// Soly dir helper
// ============================================================================

/** Preferred soly dir name (vendor-neutral). */
export const SOLY_DIRNAME = ".agents";

/** Legacy soly dir name. Kept for backward compat with existing projects. */
export const LEGACY_SOLY_DIRNAME = ".soly";

/** Which project subdir name is currently in use. Returns the first
 *  one that exists, preferring `.agents/`. Falls back to `.soly/` if
 *  no `.agents/` exists. If neither exists, returns `.agents/` (so
 *  new writes go to the new location). */
export function solyDirFor(cwd: string): string {
	if (fs.existsSync(path.join(cwd, SOLY_DIRNAME))) return path.join(cwd, SOLY_DIRNAME);
	if (fs.existsSync(path.join(cwd, LEGACY_SOLY_DIRNAME))) return path.join(cwd, LEGACY_SOLY_DIRNAME);
	return path.join(cwd, SOLY_DIRNAME); // default to new for new projects
}

/** True if the legacy `.soly/` dir is in active use (and `.agents/` isn't). */
export function isLegacySolyDir(cwd: string): boolean {
	const newPath = path.join(cwd, SOLY_DIRNAME);
	const oldPath = path.join(cwd, LEGACY_SOLY_DIRNAME);
	return !fs.existsSync(newPath) && fs.existsSync(oldPath);
}

// ============================================================================
// buildNextHint — "what should the user run next?" footer hint
// ============================================================================
//
// Derives a `→ next: <verb> <args>` suggestion from project state. Returned
// string is appended (dimmed) to the status line so the user always sees
// the next sensible soly action without needing to read STATE.md.
//
// Returns null when:
//   - there is no .soly/ in cwd (nothing to suggest)
//   - every phase is already complete
//
// Heuristic priority (first match wins):
//   1. state.position is set + status="complete" → suggest the next phase
//   2. state.position is set + status="in-progress" → "soly execute N" (continue)
//   3. no position + latest phase has no CONTEXT → "soly discuss N" (scope first)
//   4. no position + latest phase has CONTEXT but no PLAN → "soly plan N"
//   5. no position + phases exist with unfinished plans → "soly execute N"
//   6. no phases → "soly plan 1"
export function buildNextHint(state: SolyState): string | null {
	if (!state.exists) return null;

	// Find the most recently numbered phase (whether or not it has plans).
	const latest = state.phases.length > 0
		? state.phases[state.phases.length - 1]!
		: null;

	// Case 1+2: a position is recorded in STATE.md
	if (state.position) {
		const n = parseInt(state.position.phase, 10);
		if (state.position.status === "complete") {
			// All done — no hint, or suggest next phase.
			const next = n + 1;
			if (!Number.isFinite(next) || next > 99) return null;
			return `→ next: soly plan ${next}`;
		}
		// in-progress / ready / blocked — keep going
		if (Number.isFinite(n)) {
			return `→ next: soly execute ${n}`;
		}
		return `→ next: soly status`;
	}

	// Case 3-5: no recorded position — derive from phases list
	if (latest) {
		const n = latest.number;
		if (!latest.contextExists) {
			return `→ next: soly discuss ${n}`;
		}
		if (latest.planCount === 0) {
			return `→ next: soly plan ${n}`;
		}
		// Has CONTEXT and at least one plan — assume not all done.
		return `→ next: soly execute ${n}`;
	}

	// Case 6: no phases at all — start at 1
	return `→ next: soly plan 1`;
}

/** Human-friendly reminder line for the "soly drift" nudge. Returns a short
 *  string the LLM can quote in its response, or null if no drift detected. */
export function buildDriftReminder(turnsSinceLastVerb: number): string | null {
	if (turnsSinceLastVerb < 5) return null;
	const verb = turnsSinceLastVerb >= 10 ? "soly pause" : "soly status";
	const when = turnsSinceLastVerb === 1 ? "1 turn" : `${turnsSinceLastVerb} turns`;
	return `soly drift hint: ${when} since last soly verb. Consider \`${verb}\` to sync state (pause saves HANDOFF for resume across compactions).`;
}

// =============================================================================
// Post-work rules check: which rules apply to a set of edited files?
// =============================================================================
//
// Used by the turn_end hook to surface a checklist of rules that SHOULD have
// been followed during this turn. Honest post-hook — does not claim to detect
// violations, just lists what was applicable so the user can verify.

export function rulesApplicableToFiles(
  rules: RuleFile[],
  editedFiles: string[],
): string[] {
  const applicable = new Set<string>();
  for (const filePath of editedFiles) {
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const globs = rule.meta.globs;
      const always = rule.meta.always === true;
      if (always) {
        applicable.add(rule.relPath);
        continue;
      }
      if (globs && globs.some((g) => matchesGlob(filePath, g))) {
        applicable.add(rule.relPath);
      }
    }
  }
  return [...applicable];
}
