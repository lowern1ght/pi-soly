# soly — Project rules, intent, state, and project context for Pi

A single pi extension that loads project context into the agent's system
prompt and exposes workflow verbs for a plan → execute → close-out loop
on phases (and features/tasks). Replaces gsd.

> **Note.** This README describes the *current* source tree. If you came
> here from an older install, the layout moved from a single `soly.ts`
> file (and `.planning/` paths) to a modular `soly/` directory using
> `.soly/`. Old `soly.ts`-based installs are no longer shipped.

## What it shows

Footer status line, set via `ctx.ui.setStatus("soly", ...)`:

```
soly · v1.6.1 p10 0/2 [░░░░░░░░░░] 0%   rules 6 · 2.4k
─────   ───────────────────────────      ────────────────
prefix              project state              rules
```

The progress bar is the only white element (focal point). Everything else
is dim gray. Segments that don't apply are omitted silently — no empty
`p10` if there's no current phase, no `rules` if there are no rules, etc.

| Segment | Example | Source |
|---|---|---|
| `soly ·` | (literal) | prefix |
| `<milestone>` | `v1.6.1` | `.soly/STATE.md` frontmatter |
| `p<N>` | `p10` | current phase number |
| `<done>/<total>` | `0/2` | completed plans / total plans |
| `[<bar>]` | `[█████░░░░░]` | progress bar (10 block chars) — **only white** |
| `<pct>%` | `50%` | progress percent (dim) |
| `rules <n>` | `rules 6` (or `rules 3/6`) | active rules / total rules |
| `· <tok>` (rules) | `· 2.4k` | estimated tokens for the rules section |
| `session <n>t <tok>` | `session 12t 18.4k` | assistant-turn count + rough token usage |

Status is change-detected — `setStatus` is only called when the rendered
line differs from the previous one (anti-flicker).

## What it loads

### Rules (priority order, higher wins on duplicate `relPath`)

| Priority | Source | Path | Label |
|---|---|---|---|
| 5 (highest) | Project local | `<cwd>/.soly/rules.local/` | `[local]` |
| 4 | Project soly | `<cwd>/.soly/rules/` | `[soly]` |
| 3 | Phase-scoped | `<phase-dir>/rules/` | `[phase]` (loaded only when that phase is active) |
| 2 (lowest) | Global soly | `~/.soly/rules/` | `[soly]` |

**Override rules**:
- **Project always beats global** — same `relPath` in `.soly/rules/foo.md` overrides `~/.soly/rules/foo.md`.
- **Local beats project** — `.soly/rules.local/foo.md` overrides `.soly/rules/foo.md` (gitignored personal overrides).
- **Soly beats phase** within the same scope, **phase beats project** when active.

When a rule is overridden, it is **not** loaded into the system prompt
(no duplication) and appears in `/rules list` with a `⊘` marker.

Rules with `globs:` in frontmatter are only included when the active
prompt or context files match. Rules with `always: true` always load.

### Intent docs (the "0-point")

`.soly/docs/` is loaded as project intent — the user's vision written
*BEFORE* any soly plans. `.md` and `.html` are both supported (parsed
for `<title>` / `<h1>` / `<meta name="description">`). Nested directories
are scanned (e.g. `.soly/docs/api/auth.md`).

Per-phase intent (`.soly/phases/<NN>/docs/`) is loaded only when that
phase is currently active. Phase intent is tagged separately in the
system prompt.

### Project state

`.soly/` layout (dual-mode — phases AND features+tasks can coexist):

```
your-project/
├── .soly/
│   ├── STATE.md                              ← current position, decisions log
│   ├── ROADMAP.md                            ← phases / milestones
│   ├── REQUIREMENTS.md                       ← requirement IDs
│   ├── PROJECT.md                            ← project overview
│   ├── docs/                                 ← 0-point intent (.md / .html)
│   ├── rules/                                ← project rules
│   │   ├── code-style.md
│   │   └── ...
│   ├── rules.local/                          ← gitignored personal overrides
│   ├── phases/
│   │   └── 10-foo/
│   │       ├── 10-CONTEXT.md
│   │       ├── 10-RESEARCH.md
│   │       ├── 10-01-PLAN.md
│   │       ├── 10-01-SUMMARY.md
│   │       ├── 10-02-PLAN.md
│   │       ├── rules/                        ← phase-scoped rules (priority 3)
│   │       └── docs/                         ← phase-specific intent
│   ├── features/                             ← feature-mode (dual with phases)
│   │   └── auth/
│   │       ├── README.md
│   │       └── tasks/
│   │           ├── auth-be-login-a3f9/
│   │           │   ├── PLAN.md
│   │           │   └── SUMMARY.md
│   │           └── ...
│   ├── HANDOFF.json                          ← written by `soly pause`
│   ├── .continue-here.md                     ← written by `soly pause`
│   └── milestones/
│       └── v1.6.1.md
```

## System prompt composition

On `before_agent_start`, six sections are appended to the system prompt
in this order (all optional — missing input just omits the section):

1. `## soly project rules` — all applicable rules, filtered by `globs:` match against active prompt + pi context files
2. `## soly project state` — milestone, phase, plan, progress, current plan objective, working agreement
3. `## project intent (from .soly/docs/)` — always-on intent docs (titles + previews + token sizes)
4. `### intent: <relpath>` (per-doc) — full body of intent docs with `inline: true` frontmatter (with `@import` resolution)
5. `## current git state` — branch, working tree status, last 5 commits
6. `## project env` — package manager, runtimes, scripts, services, tooling flags
7. `## project layout` — top-level tree + key files + CI hint
8. `## soly behavioral nudge` — always-on; tells the LLM to ask clarifying questions for non-trivial prompts and to prefer background subagents for research

All sections chain — they combine with other extensions' system-prompt
contributions without conflict.

## Workflow verbs (plain text — NOT slash)

Type them in interactive mode. The extension intercepts via the `input`
event and either:

- **transforms** the input into a detailed LLM instruction (the LLM still sees it, but with full workflow context, and calls `subagent(...)` itself)
- **handles** directly (no LLM round-trip; immediate UI notify)

| Verb | Mode | Purpose |
|---|---|---|
| `soly execute <N>` | transform | Execute all plans in phase N (wave-based parallel) |
| `soly execute <N.MM>` | transform | Execute one plan in phase N |
| `soly execute <task-id>` | transform | Execute one task (feature-mode) |
| `soly execute --all` | transform | Execute all ready tasks (sequential in v0.1) |
| `soly execute --feature <name>` | transform | Execute all tasks in a feature |
| `soly plan <N>` | transform | Produce PLAN.md for phase N |
| `soly plan <task-id>` | transform | Refine PLAN.md for existing task |
| `soly plan --new-task <slug> --feature <n>` | transform | Create new task + PLAN.md |
| `soly plan --feature <n>` | transform | Plan all ready tasks in a feature |
| `soly discuss <N>` | transform | Scoping discussion for phase N |
| `soly pause` | transform | Write HANDOFF.json + .continue-here.md (no compaction) |
| `soly compact` | transform + auto-compact | Same as pause, then `ctx.compact()` at end of turn |
| `soly resume [N]` | transform | Restore from handoff (optionally scoped to phase N) |
| `soly status` | handled | One-screen position summary + recent iteration activity |
| `soly log [N]` | handled | Last N rows from STATE.md Decisions table |
| `soly diff` | handled | git status + uncommitted `.soly/` changes |
| `soly diff iterations <a> <b>` | handled | Diff two iteration files (line-level) |
| `soly iterations [N]` | handled | List N most recent `.soly/iterations/*.md` files (default 10) |
| `soly doctor` | handled | Health check: missing files, broken refs, stale iterations |
| `soly phase delete <N>` | handled | Soft-delete phase N (moves to `.soly/phases/.trash/<slug>-<ts>/`) |
| `soly help` | handled | Show all available verbs |

When transforming, the prompt template is built from `.md` files in
`workflows-data/` (plan-phase, plan-task, execute-phase, execute-plan,
execute-task, discuss-phase, pause-work). The LLM launches a `worker`
subagent with `context: "fresh"` and `maxSubagentDepth: 1`.

## Slash commands

| Command | Subcommands |
|---|---|
| `/rules` | `list`, `show <path>`, `analytics`, `reload`, `enable <path>`, `disable <path>`, `enable-all`, `disable-all`, `add <url>`, `new` |
| `/soly` | `position` (default), `state`, `plan`, `context`, `research`, `roadmap`, `progress`, `phases`, `tasks`, `task <id>`, `features`, `milestone`, `config`, `reload`, `help` |
| `/rulewizard` | (interactive guide, no subcommands) |
| `/why` | (no subcommands — shows the basis for the last turn, incl. loaded rule files) |

## Tools (LLM-callable)

The agent can call these directly without the user typing a command.
The `soly_*` tools are the primary way the LLM explores project state
without bloating the system prompt.

| Tool | Purpose |
|---|---|
| `soly_read` | Read any `.soly/` artifact (state / plan / context / research / roadmap / requirements / project / milestone / task) |
| `soly_log_decision` | Append a row to STATE.md Decisions table |
| `soly_list_phases` | List phases with C/R markers and current-position arrow |
| `soly_list_tasks` | List tasks across all features with kind/status/priority/deps |
| `soly_intent` | List the 0-point intent docs (always present, even when empty) |
| `soly_doc_search` | Search `.md` / `.html` files with intent/phase-intent/project priority |
| `soly_snippet` | Bounded file read with line numbers, HTML strip option |
| `soly_env` | Detect package manager / scripts / services / tooling flags |
| `soly_todos` | Scan for `TODO`/`FIXME`/`HACK`/`XXX`/`NOTE` comments (requires `rg`) |
| `soly_scratchpad` | Compact summary of recent conversation turns |

## Interactive vs worker rules

Rules with `interactive: true` in frontmatter load for the interactive
LLM session (you typing in pi) but **NOT** for the `worker` subagent
that runs in `soly execute` / `soly plan`. Use this for meta-rules like
"ask before acting" or "use background subagents" that describe the
**user-facing conversation**, not the execution work.

The worker subagent task explicitly lists which rules are out of scope:

```
- Interactive-only rules are NOT in scope for you:
  process/ask-first.md, process/use-subagents.md
```

## Display rules

1. **Footer status only** — `ctx.ui.setStatus("soly", ...)`. No chat
   popups for passive info (chat shows errors and explicit command output).
2. **No widget** — the multi-line widget above the editor was removed.
3. **No flicker** — the status line is change-detected.
4. **Static progress bar** — `█` / `░` block characters, no animation.

## Startup analytics

On `session_start`, if rules are loaded, the extension shows a one-line
breakdown (e.g. `soly rules: 6 (4 soly + 2 phase-10)`). If a rule is
overridden, you also see `soly: 2 rule(s) overridden by project (...)`.
If rules changed since the last session, you see `soly: rules changed
since last session (+1 ~2)`. If rules use >5% of the context window,
you see a budget warning. Run `/rules analytics` any time for the full
breakdown (per-file sizes, %-of-context, missing descriptions, duplicates).

## Cross-extension integrations (soly as a platform)

soly composes with sibling pi-extensions when they're loaded. The registry
lives in `integrations.ts` — add a new entry there to make soly aware of
another extension's tool.

| Extension | Tool | What it adds | Auto-detected? |
|---|---|---|---|
| **`pi-ask`** | `ask_pro` | Tabbed multi-question picker (Claude Code style). `soly discuss` uses it as PREFERRED over the built-in `soly_ask_user` fallback. | yes (via `pi.getActiveTools()`) |
| **`pi-todo`** | `todo_update` | Live, user-visible task list in the footer. `soly execute` workflow template seeds todos from `<task>` blocks. soly shows `todos N/M` in its own status line. | yes |

When any registered tool is loaded, soly injects a `## Cross-extension
integrations (active in this session)` section into the system prompt
explaining when to reach for it. When none are loaded, the section is
omitted entirely (no noise about extensions the user hasn't installed).

`soly doctor` also reports each known extension as a check — `(pass)` if
loaded, `(info)` if not (it's optional, not a warn).

## Opt-in: soly-aware subagents

Soly ships two soly-specialized agent configs in `soly/agents/`:

- **`soly-worker`** — implementation agent that knows soly path discipline
  (everything under `.soly/`), plan/task structure, close-out order, and
  auto-tracks plan sub-tasks via `todo_update` when pi-todo is installed.
- **`soly-oracle`** — decision-consistency agent that validates plans
  against existing STATE.md commitments (catches drift, scope creep,
  hidden assumptions).

By default, `soly execute` workflows use pi-subagents' generic `worker`
(because the soly workflow template already contains all soly instructions
in the task prompt). To switch to the soly-specialized agents:

1. Set `agent.useSolyWorkerSubagents: true` in `.soly/config.json`
2. Reload pi (or wait for next `session_start`)
3. Soly auto-installs `soly-worker.md` and `soly-oracle.md` to
   `~/.pi/agent/agents/` (idempotent — won't overwrite user-customized copies)
4. `soly execute` now launches `agent: "soly-worker"` instead of `worker`
5. `soly doctor` shows `soly-aware subagents` as `(pass)`

`soly doctor` reports current state of these agents. The install is
opt-in to keep the default install minimal — most users don't need them.

To add a new integration, append a `KnownIntegration` entry in
`integrations.ts`. No other code changes needed.

## Agent switcher (Shift+Tab)

soly lets you pick which subagent `soly execute` launches, and you can
cycle through the available ones with **Shift+Tab** (Claude Code-style
shortcut, but for AGENTS not modes — pi handles plan/auto-accept itself).

The cycle order is deterministic and discoverable:

1. **Built-in pi-subagents** (always available): `worker` → `oracle` →
   `scout` → `researcher` → `planner` → `context-builder` → `reviewer` →
   `delegate`
2. **Soly-augmented agents** (only if `useSolyWorkerSubagents: true`):
   `soly-worker` → `soly-oracle`
3. **User-defined agents** (from `~/.pi/agent/agents/*.md`): anything you
   add yourself with a YAML `name:` frontmatter

The active agent shows in the status line as `[agent: name]`, except for
`worker` (the default — silent). Cycle or set explicitly:

- **Shift+Tab** — cycle to next agent
- **`/soly agent`** — show current + available
- **`/soly agent soly-worker`** — set explicitly
- **`.soly/agent` file** — persisted across sessions (auto-managed)

**Add your own agent.** Drop a markdown file with YAML frontmatter into
`~/.pi/agent/agents/`:

```markdown
---
name: my-reviewer
description: Security-focused reviewer for auth code
tools: read, grep, bash
---

You are a security reviewer. Focus on auth, input validation, and secrets…
```

Restart pi (or Shift+Tab) — `my-reviewer` shows up in the cycle. Soly
discovers agents on every Shift+Tab, so no install step required.

## Setup

Drop the `soly/` directory in `~/.pi/agent/extensions/`. Both `.soly/`
(or `~/.soly/`) and `.soly/rules/` are auto-discovered. The extension
also depends on the `pi-subagents` package (already in
`~/.pi/agent/settings.json` `packages` if you used the recommended
install) — `soly execute` / `soly plan` workflows call `subagent(...)`.

```bash
ls ~/.pi/agent/extensions/soly/
# codemap.ts commands.ts config.ts core.ts docs.ts env.ts git.ts hotreload.ts
# html.ts index.ts integrations.ts intent.ts iteration.ts nudge.ts scratchpad.ts tools.ts
# agents/ workflows/ workflows-data/ tests/ package.json tsconfig.json
# agents/soly-worker.md, agents/soly-oracle.md  (opt-in; installed on session_start if config flag set)
```

## Configuration (soly)

Two-layer config, merged with defaults:

- **Per-project** `.soly/config.json` — version-controlled, project-specific
- **Global** `~/.soly/config.json` — machine-specific, user-specific

Use `/soly config` to see the resolved (merged) config + schema. Key knobs:

| Path | Default | Purpose |
|---|---|---|
| `iteration.retentionDays` | `14` | Stale iteration files pruned on `session_start`. `0` = never. |
| `iteration.includeResearch` | `true` | Bundle phase research in iteration context |
| `iteration.includeAntiPatterns` | `true` | Bundle anti-patterns doc in iteration context |
| `agent.preferAskPro` | `true` | If `pi-ask` is installed, use `ask_pro` picker for `soly discuss` |
| `agent.autoCheckpointOnPause` | `true` | Write iteration context bundle on `soly pause` |
| `agent.useSolyWorkerSubagents` | `false` | Opt-in: install soly-aware subagent configs (`soly-worker`, `soly-oracle`) to `~/.pi/agent/agents/` on `session_start` and use them in `soly execute` instead of the generic `worker`. Off by default because the soly workflow template already contains all soly instructions. Enable if you want a soly-specialized subagent system prompt. |
| `display.maxPhasesInStatus` | `20` | Cap on phases shown in `soly status` |
| `display.defaultRecommendedFirst` | `true` | Default first option is the ⭐ in pickers |
| `paths.excludeGlobs` | `["**/node_modules/**","**/dist/**"]` | Extra globs to exclude from code map |
| `hotReload.pollMs` | `2000` | Windows/network-mount polling fallback |
| `notifyOnRuleChange` | `true` | Notify on rule hot-reload |
| `editor.command` | `"code"` | Editor for `soly edit` (future) |

## How it works

1. **`session_start`** — builds rule source list (project-local → project → global), loads all rules, loads project state from `.soly/`, runs `detectEnv` + `buildCodeMap` + `readGitContext` (one-time, cached), starts the hot-reload watcher.
2. **`before_agent_start`** — composes the system-prompt sections (rules filtered by globs, project state, intent, inline-intent, git, env, code map, behavioral nudge) and computes per-section token estimates.
3. **`turn_end`** — re-reads rules and state; if either changed, refreshes the status line.
4. **Status update** — every render compares to the previous line and only calls `setStatus` on change.
5. **Hot reload** — `fs.watch` with 100 ms debounce + 2 s polling fallback (Windows / network mounts). The user-facing notify is coalesced over 500 ms to absorb editor save-bursts (`.tmp` → rename → touch).
6. **Workflow input** — the `input` event intercepts plain text matching `soly <verb> ...`, then either transforms the prompt (with a workflow markdown template + worker subagent task) or shows a direct result.

## Development

```bash
cd ~/.pi/agent/extensions/soly
bun test              # runs tests/parser.test.ts, tests/nudge.test.ts, tests/html.test.ts
bun run typecheck     # tsc --noEmit
```

CI: `.github/workflows/ci.yml` runs both on push and PR.
