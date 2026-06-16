---
name: soly-framework
description: Use when the user asks how to do anything with the soly framework for pi — start a new project, plan or execute a phase, pause and resume sessions, add rules, add intent docs, write PLAN.md or SUMMARY.md, troubleshoot issues. Triggers on "how do I", "what's the command for", "soly help", "soly framework", and any practical question about using the soly extension. NOT loaded for generic code questions — only when the user is working with the soly workflow.
---

# soly framework

The **soly** extension adds project-management workflow to [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent): intent docs, ROADMAP/STATE/PHASE state machine, and subagent-driven plan execution. This skill is your complete reference for using it.

## Quick start (read first if new)

**Mental model — three layers, always in system prompt, in this order:**

1. **Project intent** (`.soly/docs/`) — the 0-point. What the user wants the app to be. Written BEFORE plans, by humans.
2. **Project state** (`.soly/STATE.md`, `ROADMAP.md`) — where we are, current phase, recent decisions.
3. **Project rules** (`.soly/rules/`, `~/.soly/rules/`) — how to behave in this project.

**Workflow model — phases and plans:**

- A **phase** is a milestone (e.g. "01-foundation"). Has one or more `PLAN.md` files.
- A **plan** is one ordered execution unit. Has `<task>` blocks.
- A **task** is the smallest unit. Has type, description, verify, accept.
- **Close-out**: production code commits → `SUMMARY.md` → `STATE.md` updated → ROADMAP check.

## Slash commands (interactive mode)

| Command | What it does |
|---|---|
| `/plan [N]` | Generate or update `PLAN.md` for phase N (or current phase) |
| `/execute [N[.MM]]` | Dispatch plan(s) to `soly-manager` subagent. `N` = all plans in phase. `N.MM` = specific plan. |
| `/discuss N` | Discussion-driven scoping for phase N — capture decisions before planning |
| `/inspect` | One-screen summary: position, phases, recent decisions |
| `/pause` | Save handoff (`HANDOFF.json` + `.continue-here.md`) for later resume |
| `/resume` | Restore from a paused handoff |
| `/quick <task>` | One-shot task that doesn't need a full plan — direct dispatch |
| `/soly` | Project state inspection (alias for `/inspect`) |
| `/why` | Show what context the LLM's last turn was based on |
| `/agent [name]` | Switch the current cycle agent (or open picker) |

`/soly <verb>` plain-text aliases also work for some verbs (legacy compat).

## File structure

```
<project-root>/
├── .soly/
│   ├── ROADMAP.md                 # phase table
│   ├── STATE.md                   # current position + decisions log
│   ├── docs/                      # 0-point intent docs (human-written, locked)
│   │   ├── vision.md
│   │   └── architecture.md
│   ├── rules/                     # project rules (version-controlled)
│   │   ├── code-style.md
│   │   └── testing.md
│   ├── phases/
│   │   ├── 01-foundation/
│   │   │   ├── 01-CONTEXT.md     # domain + decisions for phase 1
│   │   │   ├── 01-RESEARCH.md    # what we looked up
│   │   │   ├── 01-PLAN-01.md     # plan 1
│   │   │   ├── 01-PLAN-01-SUMMARY.md
│   │   │   ├── 01-PLAN-02.md
│   │   │   └── 01-PLAN-02-SUMMARY.md
│   │   └── 02-feature-x/
│   │       └── ...
│   ├── iterations/                # per-execution context bundles (auto)
│   ├── HANDOFF.json               # pause snapshot
│   └── .continue-here.md          # pause resume marker
```

## Frontmatter conventions

### PLAN.md frontmatter (required)

```markdown
---
id: 01-02                    # phase-plan, zero-padded
title: Add OAuth flow
status: pending              # pending | in_progress | done
phase: 1
depends-on: []               # other plan ids
parallelizable: true         # can run alongside siblings
---

# Add OAuth flow

## read_first
- .soly/STATE.md
- .soly/ROADMAP.md
- .soly/rules/code-style.md

## tasks
- [ ] **type: implement**, description: Add token refresh logic
  - files: src/auth/refresh.ts
  - verify: bun test src/auth/refresh.test.ts
  - accept: Refresh succeeds when token is expired; fails when refresh_token is also expired

- [ ] **type: tdd**, description: Write integration test for the auth flow
  - verify: bun test src/auth/

- [ ] **type: checkpoint**, description: Pause for human review of UX

## verification
- bun test
- bun run typecheck
- bun run lint

## risks
- Token storage depends on the encryption scheme (see .soly/docs/architecture.md)
```

### SUMMARY.md frontmatter

```markdown
---
plan: 01-02
completed: 2026-06-15
duration: 47min
files-touched: 7
---

# Summary

## Tasks
- [x] Add token refresh logic
- [x] Write integration test
- [x] Pause for human review

## Deviations
- Refactored `auth/refresh.ts` to use singleton pattern (was factory). Documented in `architecture.md`.

## Verification
- `bun test`: 142 passing
- `bun run typecheck`: clean
- `bun run lint`: 0 warnings

## Next
- Phase 02 plan 01: User profile page
```

### Rules file frontmatter (optional)

```markdown
---
applyTo: "src/**/*.ts"        # glob (optional, default: all)
priority: 50                   # higher wins on conflict (default: 0)
---

# TypeScript style

- Strict mode required
- Never use `any` — use `unknown` and narrow
```

## Path discipline (NON-NEGOTIABLE)

**All soly-managed files live under `.soly/`.** Source code lives in the project's normal source tree.

| File kind | Goes to |
|---|---|
| `PLAN.md`, `SUMMARY.md`, `CONTEXT.md`, `RESEARCH.md` | `.soly/phases/<NN>-<slug>/` |
| Intent docs (0-point) | `.soly/docs/` |
| Rules | `.soly/rules/` (project) or `~/.soly/rules/` (user) |
| Handoff | `.soly/HANDOFF.json`, `.soly/.continue-here.md` |
| Iteration context | `.soly/iterations/` (auto-generated) |
| Production code, tests | project's normal `src/`, `tests/`, `app/`, etc. |

Use absolute paths (or paths starting with `$SOLY_DIR`) when calling tools. Never bare relative names that could land in cwd.

## Close-out order

The only legal sequence for finishing a plan:

1. Production code commits (1+)
2. `SUMMARY.md` committed
3. `STATE.md` "Current Position" block updated
4. `ROADMAP.md` phase checkbox updated
5. `PLAN.md` frontmatter `status: done`

Once production commits exist, returning without a committed `SUMMARY.md` is an **illegal partial-plan state** — the next `/execute` will detect it and refuse to start.

## Cycle agents (4 built-in)

| Agent | Writes | Use for |
|---|---|---|
| `worker` | ✅ | Generic implementation, full tools |
| `oracle` | ❌ | Decision-consistency, no file edits |
| `scout` | ❌ | Codebase recon, read-only |
| `reviewer` | ❌ | Adversarial code review |

Switch with `/agent <name>` or `Ctrl+Tab` (cycles through). Footer pill shows current: `· ⚡ worker` / `▶ 🐢 oracle`.

## Subagent: soly-manager (single, mode-switching)

Spawn via `subagent({ agent: "soly-manager", task: ... })`. The task brief tells it which mode to be in:

| Task brief mentions | Mode |
|---|---|
| implement, build, write code, add feature, create | **worker** |
| debug, bug, fix, crash, error, repro, broken | **debugger** |
| test, coverage, spec, assert, only modify tests | **tester** |
| review, audit, adversarial, find bugs, qa | **reviewer** |
| refactor, simplify, extract, rename, no behavior change | **refactor** |
| document, readme, jsdoc, comment, intent doc | **documenter** |
| validate, scope, drift, decision, before committing | **oracle** |
| plan, design, outline, structure, decompose | **planner** |

**soly-manager is ONE agent that switches modes. Don't spawn soly-worker / soly-debugger / etc. — those don't exist anymore.**

## Tools the LLM can call

| Tool | Purpose |
|---|---|
| `soly_read(artifact, phase, taskId)` | Read soly artifacts: STATE, plan, context, research, ROADMAP, requirements, project, milestone, task |
| `soly_log_decision(decision, rationale, phase)` | Append to STATE.md Decisions table |
| `soly_list_phases()` | List all phases with plan counts, C/R markers |
| `soly_list_tasks()` | List all tasks across features (kind, status, priority, deps) |
| `soly_todos(paths, limit)` | Scan working tree for TODO/FIXME/HACK/XXX/NOTE |
| `soly_env()` | Detect runtime (package manager, runtimes, services, scripts) |
| `soly_snippet(path, offset, limit)` | Read bounded line range with line numbers |
| `soly_doc_search(query, limit)` | Search .md/.html under cwd (prioritizes intent docs) |
| `soly_intent()` | List 0-point intent docs from `.soly/docs/` |
| `soly_scratchpad(limit)` | Recent conversation recap (one line per turn) |
| `ask_pro(questions)` | Multi-question picker (tabbed, single/multi-select, ⭐, Other…) |
| `todo_update(todos)` | Update task list rendered in footer |

## Add a new rule (most common task)

Three places, in priority order:

1. **Project rule** — `~/.pi/agent/agents/soly/rules/<name>.md` (version-controlled, shared with team)
2. **User rule** — `~/.soly/rules/<name>.md` (per-user, not committed)
3. **Phase rule** — `<phase-dir>/<plan>.md.rules/<name>.md` (active only for that plan)

Use `/rulewizard` slash command to scaffold a new rule with the right frontmatter.

A rule file looks like:

```markdown
---
applyTo: "src/**/*.ts"
priority: 50
---

# TypeScript style

- Strict mode required
- Never use `any`
- Prefer `type` over `interface`
```

## Add a new intent doc

Create a file in `.soly/docs/`:

```markdown
# Architecture

## Goal

Build a CLI tool that...

## Non-obvious constraints

- Must work offline (no network calls)
- Must be a single static binary
- Must integrate with the existing `~/.config/x` schema
```

Intent docs are 0-point — written BEFORE any plan, by humans. They define the "why", not the "how".

## Common workflows

### Start a new project

1. `soly init` (or manually create `.soly/`, `docs/`, `rules/`)
2. Write 1-3 intent docs in `.soly/docs/`
3. Create `ROADMAP.md` with phase table
4. `/plan 1` to start phase 1

### Add a feature to an existing phase

1. `/plan 1.05` (next plan number)
2. Edit the generated `PLAN.md`
3. `/execute 1.05`

### Pause a long session

1. `/pause` → writes `HANDOFF.json` + `.continue-here.md`
2. Later, in a new session: `/resume`

### Troubleshoot a partial plan

If `/execute` complains about illegal partial state:

1. `cat .soly/iterations/<latest>.md` — see what the last run did
2. Check if `SUMMARY.md` exists for the last plan
3. If yes, finish close-out: update `STATE.md` + `ROADMAP.md`
4. If no, either commit the SUMMARY or revert the production commits

## Where to look for answers

- **"What command does X"** → this skill, Slash commands section
- **"What does PLAN.md look like"** → this skill, Frontmatter section
- **"How to add a rule"** → this skill, Add a new rule section
- **"Why did the LLM do Y"** → `/why`
- **"What context is loaded"** → `soly_read(artifact: "state")` + `soly_doc_search(...)`
- **"What was the recent conversation"** → `soly_scratchpad()`

## Don'ts

- ❌ Edit `.soly/rules/` files you didn't write — those are project invariants
- ❌ Skip the SUMMARY — illegal partial state
- ❌ Spawn `soly-worker` or `soly-debugger` — use `soly-manager` (mode-switches)
- ❌ Write rules in code comments — use `.soly/rules/*.md` files
- ❌ Edit `.soly/phases/*/PLAN.md` after `status: in_progress` — create a new plan
- ❌ Put intent docs anywhere other than `.soly/docs/`

## When in doubt

Call `soly_read(artifact: "state")` and `soly_read(artifact: "roadmap")` first. The system prompt has the layers, but `soly_read` gives you full content. Then check `soly_doc_search` for any other relevant docs.
