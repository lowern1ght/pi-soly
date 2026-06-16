// =============================================================================
// init.ts — Scaffold a new soly project
// =============================================================================
//
// Creates the initial `.agents/` directory structure for a new project, with
// optional project-type templates. Idempotent — existing files are kept.
//
// Layout created:
//   .agents/
//   ├── ROADMAP.md         (single phase "01-bootstrap" + checklist)
//   ├── STATE.md           (empty template with frontmatter)
//   ├── docs/
//   │   └── vision.md      (placeholder for intent doc)
//   ├── rules/
//   │   └── code-style.md  (TypeScript-friendly defaults)
//   ├── phases/
//   │   └── .gitkeep
//   ├── iterations/
//   │   └── .gitkeep
//   └── HANDOFF.json       ({ "version": 1, "snapshot": null })
//   agents.md              (AGENTS.md standard, top-level)
//
// Templates:
//   "minimal"  — just the structure, no rules/docs
//   "web-app"  — adds routing/, auth/, api/ example rules
//   "library"  — adds publishing/, testing/, breaking-changes/ example rules
//   "cli"      — adds command/, flags/, shell-compat/ example rules
//
// Usage:
//   /soly-init                  # interactive: pick template
//   /soly-init minimal          # no prompts
//   /soly-init web-app --yes
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { SOLY_DIRNAME } from "./core.js";

export type InitTemplate = "minimal" | "web-app" | "library" | "cli";

/** UI primitives. */
export interface InitUI {
	notify: (text: string, level?: "info" | "warning" | "error") => void;
	select: (label: string, options: string[]) => Promise<string | undefined>;
	confirm: (title: string, message: string) => Promise<boolean>;
	input: (label: string, placeholder?: string) => Promise<string | undefined>;
}

export interface InitOptions {
	/** Skip template picker + confirm dialog. */
	autoYes?: boolean;
	/** Force template (otherwise: picker or default 'minimal'). */
	template?: InitTemplate;
	/** Project name (for STATE.md). Defaults to cwd basename. */
	projectName?: string;
}

const ROADMAP_MINIMAL = `# Roadmap

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 01 | bootstrap | pending | Initial setup |

Open \`/plan 1\` to start the first phase.
`;

const STATE_MINIMAL = `---
milestone: 0.1.0
current_position: ready
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Project state

Use \`/soly\` to see current state. Use \`/plan N\` to plan phase N.

## Decisions

| Date | Decision | Why |
|------|----------|-----|
| ${new Date().toISOString().slice(0, 10)} | Initial scaffold | Created by \`soly init\` |
`;

const VISION_DOC = `# Vision

What does this project do? Who is it for? Why does it exist?

Replace this paragraph with 1-2 sentences describing the project's purpose.

## Goals

- Goal 1
- Goal 2

## Non-goals

- Non-goal 1
- Non-goal 2
`;

const CODE_STYLE_RULE = `# Code style

- Prefer \`type\` over \`interface\` for object shapes
- Use \`strict\` mode
- Never use \`any\` — use \`unknown\` and narrow
- Functions under 50 lines; extract helpers beyond
`;

const HANDOFF_INITIAL = JSON.stringify({ version: 1, snapshot: null }, null, 2) + "\n";

/** Template-specific extra rules. Each is a (filename, content) pair. */
const TEMPLATE_EXTRAS: Record<InitTemplate, Array<{ file: string; content: string }>> = {
	minimal: [],
	"web-app": [
		{
			file: "rules/routing.md",
			content: `# Routing

- Each route is a file under \`src/routes/<path>.ts\`
- Loader and action in same file
- Typed params via \`Route.LoaderArgs\`
`,
		},
		{
			file: "rules/auth.md",
			content: `# Auth

- Sessions in HTTP-only cookies
- CSRF tokens on all mutations
- Never trust client-supplied user IDs
`,
		},
	],
	library: [
		{
			file: "rules/publishing.md",
			content: `# Publishing

- Semver strictly: breaking changes bump major
- CHANGELOG.md updated with every release
- Public API = what's in the README + index.ts
`,
		},
		{
			file: "rules/testing.md",
			content: `# Testing

- One assertion per test (ideally)
- Tests live next to source as \`*.test.ts\`
- Run \`bun test\` before every commit
`,
		},
	],
	cli: [
		{
			file: "rules/commands.md",
			content: `# Commands

- Each command is a file under \`src/commands/<name>.ts\`
- Export \`name\`, \`description\`, \`run(args: string[]): Promise<void>\`
- All errors exit non-zero with a message on stderr
`,
		},
		{
			file: "rules/flags.md",
			content: `# Flags

- \`--flag value\` style, not GNU \`-f value\`
- Short aliases only for the 3-4 most common flags
- \`--help\` always supported, auto-generated from command metadata
`,
		},
	],
};

const AGENTS_MD_TOP = `# Agent conventions

This project uses [soly](https://github.com/lowern1ght/pi-soly) for project management.

## Quick reference

- \`/plan N\` — plan phase N
- \`/execute N.MM\` — execute plan MM in phase N
- \`/inspect\` — see current state
- \`/pause\` — save handoff for later
- \`/resume\` — restore from handoff
- \`/rotor <name>\` — switch cycle agent (or Ctrl+Tab)
- \`Ctrl+Tab\` — cycle to next agent

## State

- \`.agents/ROADMAP.md\` — phase table
- \`.agents/STATE.md\` — current position + decisions
- \`.agents/docs/\` — intent docs (vision, architecture, ...)
- \`.agents/rules/\` — project rules (style, testing, ...)
- \`.agents/phases/<NN>-<slug>/\` — one dir per phase
- \`.agents/HANDOFF.json\` — pause snapshot
`;

/** Run the init flow. Returns true if project was created. */
export async function initSolyProject(
	cwd: string,
	ui: InitUI,
	options: InitOptions = {},
): Promise<{ created: boolean; template: InitTemplate | null; projectName: string }> {
	const projectName = options.projectName ?? path.basename(cwd);
	const safeProjectName = projectName || "project";
	const agentsDir = path.join(cwd, SOLY_DIRNAME);

	// Preconditions
	if (fs.existsSync(agentsDir) || fs.existsSync(path.join(cwd, ".soly"))) {
		ui.notify(
			`soly-init: project already initialized (found ${SOLY_DIRNAME}/ or .soly/). ` +
				`Aborting to avoid overwriting.`,
			"error",
		);
		return { created: false, template: null, projectName };
	}

	// Pick template
	let template: InitTemplate | null = options.template ?? null;
	if (!template && !options.autoYes) {
		const pick = await ui.select(
			"template:",
			["minimal", "web-app", "library", "cli"],
		);
		if (!pick) {
			ui.notify("soly-init: cancelled", "info");
			return { created: false, template: null, projectName };
		}
		template = pick as InitTemplate;
	}
	if (!template) template = "minimal";

	// Confirm (unless --yes)
	if (!options.autoYes) {
		const ok = await ui.confirm(
			`soly init (${template})`,
			`Create .agents/ structure in:\n  ${cwd}\n\nProject name: ${projectName}`,
		);
		if (!ok) {
			ui.notify("soly-init: cancelled", "info");
			return { created: false, template: null, projectName };
		}
	}

	// Build
	fs.mkdirSync(path.join(agentsDir, "docs"), { recursive: true });
	fs.mkdirSync(path.join(agentsDir, "rules"), { recursive: true });
	fs.mkdirSync(path.join(agentsDir, "phases"), { recursive: true });
	fs.mkdirSync(path.join(agentsDir, "iterations"), { recursive: true });

	writeIfMissing(path.join(agentsDir, "ROADMAP.md"), ROADMAP_MINIMAL);
	writeIfMissing(path.join(agentsDir, "STATE.md"), STATE_MINIMAL);
	writeIfMissing(path.join(agentsDir, "docs", "vision.md"), VISION_DOC);
	writeIfMissing(path.join(agentsDir, "rules", "code-style.md"), CODE_STYLE_RULE);
	writeIfMissing(path.join(agentsDir, "HANDOFF.json"), HANDOFF_INITIAL);
	fs.writeFileSync(path.join(agentsDir, "phases", ".gitkeep"), "");
	fs.writeFileSync(path.join(agentsDir, "iterations", ".gitkeep"), "");

	// Top-level AGENTS.md
	writeIfMissing(path.join(cwd, "AGENTS.md"), AGENTS_MD_TOP);

	// Template extras
	for (const extra of TEMPLATE_EXTRAS[template]) {
		writeIfMissing(path.join(agentsDir, extra.file), extra.content);
	}

	// Optional project name in STATE.md
	if (safeProjectName !== "project") {
		try {
			const statePath = path.join(agentsDir, "STATE.md");
			const cur = fs.readFileSync(statePath, "utf-8");
			const updated = cur.replace(/^# Project state$/m, `# Project state — ${projectName}`);
			fs.writeFileSync(statePath, updated, "utf-8");
		} catch { /* best-effort */ }
	}

	// Report
	const created: string[] = [
		".agents/ROADMAP.md",
		".agents/STATE.md",
		".agents/HANDOFF.json",
		".agents/docs/vision.md",
		".agents/rules/code-style.md",
		".agents/phases/.gitkeep",
		".agents/iterations/.gitkeep",
		"AGENTS.md",
	];
	for (const extra of TEMPLATE_EXTRAS[template]) {
		created.push(`.agents/${extra.file}`);
	}
	ui.notify(
		`soly-init: done (${template}). Created:\n  - ${created.join("\n  - ")}\n\n` +
			`Next:\n  1. Edit \`.agents/docs/vision.md\`\n  2. \`/plan 1\` to start the first phase`,
		"info",
	);
	return { created: true, template, projectName: safeProjectName };
}

function writeIfMissing(file: string, content: string): void {
	if (fs.existsSync(file)) return;
	fs.writeFileSync(file, content, "utf-8");
}
