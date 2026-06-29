# Plan: feat/plans-instead-of-phases

## Goal

Replace soly's phase-based workflow with a **plan-based** one. Each plan is
identified by a git branch name (`<type>/<name>`, Conventional Branches style)
and lives in its own directory under `.agents/plans/<name>/`. Two developers
can work on different plans without colliding on PLAN.md or `STATE.md`; each
plan is isolated by its branch.

## Why this matters

Today, plans live under `.soly/phases/<N>-<slug>/plans/PLAN.md` with a
**global phase counter**. Two devs who both start a "phase 11" end up writing
to the same path with conflicting content; merges are not meaningful because
they are different plans sharing a number. Workflow also happens on the
current branch with no per-plan isolation, so mid-work files leak across
plans.

## Approach

- Identity of a plan = its git branch name (e.g. `feat/auth-jwt`). No global
  counter; the branch **is** the id.
- Storage: `.agents/plans/<name>/PLAN.md` (one dir per plan, one PLAN.md per
  plan). Replaces `.soly/phases/<N>-<slug>/plans/PLAN.md`.
- Workflow commands (same verbs, new argument):
  - `soly new <type>/<name>` — **NEW**. `git checkout -b <type>/<name>`, create
    `.agents/plans/<name>/`, scaffold PLAN.md via `ask_pro` (goals / steps /
    acceptance criteria).
  - `soly discuss <type>/<name>` — was `soly discuss <phase-number>`.
  - `soly plan <type>/<name>` — was `soly plan <phase-number>`.
  - `soly execute <type>/<name>` — was `soly execute <phase-number>`.
  - `soly verify <type>/<name>` — was `soly verify` (default) / `verify stop`.
  - `soly done <type>/<name>` — **NEW**. `git commit`, `git push -u origin
    <type>/<name>`, open draft PR via `gh pr create` (skip with warning if
    `gh` not on PATH), update `.agents/STATE.md` in main.
- Global `.agents/STATE.md` in `main` tracks all plans (active / merged /
  paused). Each branch/worktree reads it; only `soly new` and `soly done`
  write to it.
- Phases are **legacy**: existing projects keep working; a
  `soly migrate phases-to-plans` script converts them on demand. New
  `soly plan <phase-number>` form yields a clear error + migration hint.

## Work items

| # | Item | Verification |
|---|---|---|
| **W1** | `soly new <type>/<name>` command (slash + plain-verb): git checkout -b, mkdir `.agents/plans/<name>/`, run `ask_pro` scaffold, write PLAN.md. Validates `<type>` ∈ Conventional types. | Unit: branch created, dir exists, PLAN.md scaffolded; conflict detection (existing branch → ask user). |
| **W2** | Refactor `discuss` / `plan` / `execute` / `verify` to accept `<type>/<name>` instead of phase number. They now read/write `.agents/plans/<name>/PLAN.md`. | Unit: each workflow resolves the plan from branch; integration: run on fixture project. |
| **W3** | `soly done <type>/<name>`: commit (if dirty), `git push -u origin`, `gh pr create --draft` (graceful skip if `gh` missing), update `STATE.md` in main to mark plan as `merged`. | Unit: commit hash recorded, push mocked, PR URL captured or "gh missing" warning; integration: end-to-end on fixture repo. |
| **W4** | Global `STATE.md` sync: `soly new` adds plan entry (`active`); `soly done` updates status (`merged`/`draft`); conflict policy = last-write-wins (acceptable for v1). | Integration: two sequential plans show up correctly in STATE.md. |
| **W5** | `soly migrate phases-to-plans` — opt-in command. Reads `.soly/phases/*`, creates one branch per phase (`.soly/phases/03-foo` → `migrate/legacy-03-foo`), copies PLAN.md to `.agents/plans/legacy-03-foo/PLAN.md`. | Smoke: 2-phase fixture becomes 2 branches + 2 plan dirs. |
| **W6** | Backward-compat error: `soly plan 3` (numeric form) → clear error: "phases are legacy; run `soly migrate phases-to-plans` or use `soly new feat/<name>`". | Unit: error message + hint. |
| **W7** | Docs: README (replace "phase" terminology with "plan"), CHANGELOG `[1.15.0]`, `soly-framework` skill updated. | Doc review. |

## Risks

1. **STATE.md merge conflicts** when two plans complete simultaneously
   against `main`. Acceptable for v1 (last-write-wins); document.
2. **`soly_status` regressions** — STATE.md shape change may break status
   rendering. Mitigate: W4 writes through a single helper used by both
   `soly new` and `soly done`; existing tests cover status.
3. **`soly-framework` skill load** — descriptions in tool list reference
   "phase". W7 must update the skill alongside README.
4. **Existing user projects** — running new commands on a phase-era project
   should not silently corrupt state. Mitigate: W6's clear error path.

## Acceptance

- All seven W items green in `bun test` + `bun x tsc --noEmit`.
- `check:publish-integrity` (CI) green.
- Manual smoke on a fresh fixture: `soly new feat/demo` → branch + PLAN.md
  → `soly execute` runs → `soly done` commits, pushes, opens PR (or warns on
  no `gh`) → STATE.md reflects plan as `merged`.
- README + CHANGELOG + skill updated.
- Migration script covered by smoke test.

## Out of scope (v1)

- Git worktrees (sequential branches only — switch via `git checkout`).
- Auto-merge on `soly done` (manual PR review for now).
- Cross-repo plans (single-repo only).
- Phase counter retention (we don't carry it forward; phases are read-only
  legacy).