---
name: soly-framework
description: Use when the user invokes soly workflow commands (`/plan`, `/execute`, `/discuss`, `/inspect`, `/pause`, `/resume`, `/quick`, `/soly-init`, `/soly-migrate`, `/soly-status`, `/soly-log`) or asks how to use soly in pi-coding-agent — phases, plans, tasks, intent docs, ROADMAP/STATE state machine, rules, close-out order, and the available soly_* tools. Loaded as the complete reference for managing a soly project end-to-end (init → plan → execute → summary → state update).
priority: high
---

# soly framework

The **soly** extension adds project-management workflow to [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent): intent docs, ROADMAP/STATE/PHASE state machine, and LLM-driven plan execution. This skill is your complete reference for using it.

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

## Commands

Workflow verbs are **plain text** — type `soly <verb>` (NOT a slash command):

| Verb | What it does |
|---|---|
| `soly discuss <N>` | Discussion-driven scoping for phase N — interactive, uses the `ask_pro` picker |
| `soly plan <N>` | Generate `PLAN.md` for phase N (also `<task-id>`, `--new-task`, `--feature`) |
| `soly execute <N[.MM]>` | Execute a phase / one plan / a task / `--all` / `--feature` |
| `soly verify [N] [fresh]` | Self-review loop until "No issues found." (max N; `verify stop` to exit; `fresh` = fresh-context) |
| `soly pause` · `soly compact` | Save a handoff (compact also compresses the session) |
| `soly resume [N]` | Restore from a handoff |
| `soly status` · `log` · `diff` · `doctor` · `iterations` · `todos` | Quick read-outs (no LLM round-trip) |

**Slash commands** (pi's command surface):

| Command | What it does |
|---|---|
| `/rules` · `/docs` | Open the rules / intent-docs **modal** (fuzzy list + preview; `e/d/r` enable·disable·reload on rules). A subcommand (`/rules stats`, `/docs stats`, …) prints to chat instead of opening the modal. |
| `/soly [<sub>]` | Project-state inspection (position, state, plan, roadmap, phases, tasks, …); bare `/soly` opens the picker |
| `/soly-init` · `/soly-migrate` | Scaffold a project · migrate `.soly/` → `.agents/` |
| `/why` | What rules + state grounded the last turn |
| `/rulewizard` | Rule vs .editorconfig vs linter guide |

## Delegation

`soly plan` and `soly execute` delegate the heavy work to a `worker` subagent
(via the `subagent(...)` tool from pi-subagents); the parent session keeps the
close-out (production commits → `SUMMARY.md` → `STATE.md` → then `soly verify`).
If the `subagent` tool is NOT installed they run **inline** in the main session
instead — `soly doctor` reports which mode is active. First-party delegation is
on the roadmap. Other agents are read-only helpers: `oracle` (second opinion),
`scout` (recon), `reviewer` (adversarial review). `soly discuss` is always
interactive in the main session (not delegated). Rotors / `Ctrl+Tab` cycling
were removed in 1.4.0.

## File structure

```
<project-root>/
├── AGENTS.md                      # vendor-neutral agent context (loaded by pi)
├── agents.md                      # same as AGENTS.md, lowercase accepted
├── .soly/                         # soly state (phases, plans, summaries)
│   ├── ROADMAP.md                 # phase table
│   ├── STATE.md                   # current position + decisions log
│   ├── docs/                      # 0-point intent docs (human-written, locked)
│   │   ├── vision.md
│   │   └── architecture.md
│   ├── rules/                     # soly project rules (version-controlled)
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
├── .agents/                       # vendor-neutral agent config (per project)
│   ├── rules/                     # agent rules (loaded with priority 3, after .soly/rules/)
│   ├── skills/                    # project-scoped skills (pi auto-discovers)
│   │   └── my-skill/
│   │       └── SKILL.md
│   ├── docs/                      # agent-specific docs (intent-style)
│   └── agents/                    # project-specific agent definitions
```

**Two parallel conventions:** `.soly/` is soly-specific state. `.agents/` is vendor-neutral agent config. The two coexist:

- **Use `.soly/`** for soly workflow artifacts (PLAN.md, SUMMARY.md, etc.)
- **Use `.agents/`** for things other AI tools should also see (rules, skills, agents)
- **Use `AGENTS.md`** for top-level project-wide agent conventions

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
| `soly_scratchpad(limit)` | Recent conversation recap (one line per turn) |
| `ask_pro(questions)` | Multi-question picker (tabbed, single/multi-select, ⭐, `preview`, `allowOther`, notes) — preferred |
| `soly_save_discuss_checkpoint(...)` · `soly_finish_discuss(...)` | Save / finalize a `soly discuss` session (writes CONTEXT.md) |
| `soly_ask_user(...)` | Single-question picker — **deprecated**, prefer `ask_pro` |

## Common workflows

### Start a new project

1. `soly init` (or manually create `.soly/`, `docs/`, `rules/`)
2. Write 1-3 intent docs in `.soly/docs/`
3. Optionally write `AGENTS.md` (or `agents.md`) at project root with project conventions
4. Create `ROADMAP.md` with phase table
5. `/plan 1` to start the first phase

### Add project-specific agents

Drop a markdown file in `.agents/agents/<name>.md` (project) or `~/.agents/agents/<name>.md` (user):

```markdown
---
name: data-scientist
description: Reads CSVs, runs pandas, plots results
thinking: medium
tools: read, bash
---

You are a data scientist. ...
```

**Discovered from 4 locations** (priority order):
1. `<project>/.agents/` — project vendor-neutral (preferred)
2. `<project>/.pi/agent/agents/` — project pi native (legacy)
3. `~/.agents/` — user vendor-neutral (preferred)
4. `~/.pi/agent/agents/` — user pi native (legacy)

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

## When in doubt

Call `soly_read(artifact: "state")` and `soly_read(artifact: "roadmap")` first. The system prompt has the layers, but `soly_read` gives you full content. Then check `soly_doc_search` for any other relevant docs.

## Don'ts

- ❌ Edit `.soly/rules/` files you didn't write — those are project invariants
- ❌ Skip the SUMMARY — illegal partial state
- ❌ Spawn `soly-manager` / `soly-worker` / etc. — there are no soly subagents (removed in 1.3.0). Use pi's built-in subagents via the parent LLM's `subagent(...)` call.
- ❌ Edit `.soly/phases/*/PLAN.md` after `status: in_progress` — create a new plan
- ❌ Put intent docs anywhere other than `.soly/docs/`
