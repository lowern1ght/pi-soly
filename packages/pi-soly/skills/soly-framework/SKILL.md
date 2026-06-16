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

## Quick reference — slash commands

| Command | What it does |
|---|---|
| `/plan [N]` | Generate or update `PLAN.md` for phase N (or current phase) |
| `/execute [N[.MM]]` | Execute plan(s) in phase N. `N` = all plans. `N.MM` = specific plan. The LLM (you) executes directly. |
| `/discuss N` | Discussion-driven scoping for phase N — capture decisions before planning |
| `/inspect` | One-screen summary: position, phases, recent decisions |
| `/pause` | Save handoff (`HANDOFF.json` + `.continue-here.md`) for later resume |
| `/resume` | Restore from a paused handoff |
| `/quick <task>` | One-shot task that doesn't need a full plan — direct dispatch |
| `/soly` | Project state inspection (alias for `/inspect`) |
| `/why` | Show what context the LLM's last turn was based on |
| `/soly-init` | Scaffold a new soly project (interactive template picker) |
| `/soly-migrate` | Move legacy `.soly/` to `.agents/` (atomic) |
| `/soly-status` | Comprehensive one-screen report |
| `/soly-log [N]` | Show last N notifications from the log |

`/soly <verb>` plain-text aliases also work for some verbs (legacy compat).

## No rotors (removed in 1.4.0)

As of 1.4.0, soly no longer ships rotors. No `/rotor` command, no `Ctrl+Tab` cycle, no footer pill. The LLM picks the right subagent based on the task brief — use `subagent(...)` with `agent: "worker"` for implementation, `"oracle"` for decisions, `"scout"` for recon, `"reviewer"` for adversarial review.

**Why drop them?** Rotors were a UX shortcut (Ctrl+Tab) that pi itself doesn't support well. pi has its own subagent system (`worker`, `oracle`, `scout`, `reviewer`); wrapping it in a "cycle" was over-engineering. The LLM in the main session is the executor; pi's subagents are helpers, not cycle modes.

**For soly work**, the LLM does the work itself — it reads PLAN.md, runs commands, commits, writes SUMMARY.md. It does NOT spawn a soly subagent. Use `subagent(...)` only for read-only research (e.g. `agent: "scout"` for "find all files using X").

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
| `soly_intent()` | List 0-point intent docs from `.soly/docs/` |
| `soly_scratchpad(limit)` | Recent conversation recap (one line per turn) |
| `ask_pro(questions)` | Multi-question picker (tabbed, single/multi-select, ⭐, Other…) |
| `todo_update(todos)` | Update task list rendered in footer |

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

`Ctrl+Tab` to see them in the cycle. (Removed in 1.4.0 — use `subagent(...)` directly.)

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
