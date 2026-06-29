# Plan Phase

<purpose>Produce one or more PLAN.md files for a phase — each a self-contained contract (requirements, must_haves, tasks with runnable acceptance criteria) the executor can run standalone. Pre-compute wave numbers encoding the dependency graph. Update STATE.md.</purpose>

<path_discipline>
**All soly-managed files live under `.agents/`.** Never write PLAN.md, CONTEXT.md, RESEARCH.md, SUMMARY.md, iteration files, or handoffs to the project root. All phase files go in `.agents/phases/<NN>-<slug>/`. Use absolute paths (or paths starting with `$SOLY_DIR`) — never bare relative names that could land in cwd.

The iteration context file (path given by the parent in the task prompt) is your single source of truth for intent, STATE, ROADMAP, and any existing phase artifacts. Read it FIRST, before any of your own `read` or `ls` calls.
</path_discipline>

<read_first>`.agents/docs/` (INTENT, 0-point) · `.agents/STATE.md` (current position) · `.agents/ROADMAP.md` (this phase's row) · `.agents/REQUIREMENTS.md` if exists · `<phase>-CONTEXT.md` if exists (user decisions from `soly discuss`) · `<phase>-RESEARCH.md` if exists (chosen libs/patterns) · up to 3 most recent prior `*-SUMMARY.md` (avoid re-implementing). If `.agents/` missing → stop + error.</read_first>

<git_branch_invariant>
**Do not create, rename, or switch git branches.** The branch was established at `soly discuss` and is owned by the user's git workflow. Verify the current branch matches expectations, but do NOT change it.
</git_branch_invariant>

<plan_frontmatter_spec>
Every PLAN.md frontmatter (executor depends on it):

```yaml
---
id: <NN>-<M>-<slug>     # padded-phase, plan-number, slug (matches filename)
phase: <N>  plan: <M>
title: "<short title>"
wave: <W>                # 1 = first to run; 2 = depends on wave 1; etc.
depends-on: [<id-1>, <id-2>, ...]
requirements: [<REQ-ID-1>, <REQ-ID-2>, ...]
tags: [be, api, auth]
---
```

Body MUST include `## Must Haves`:

```markdown
## Must Haves
### truths      — user-observable behaviors (incl. error paths)
- [ ] <observable behavior>
### artifacts   — files created/modified
- `<path>` — <what>
### key_links   — concrete file→file wirings the executor preserves
- <src>:<symbol> → <consumer>:<symbol> — <wired>
```

Per-task structure (after Must Haves):

```markdown
### Task 1: <name>
<task type="auto" tdd="false">

**Read first:** `<path>` — <why> · `<path>` — <why>
**Implementation:** <1–2 paragraphs>
**Acceptance criteria:** (every one RUNNABLE — grep/file-check/test/HTTP-probe, NOT "works correctly")
- [ ] <criterion>
**Verification:** `<command>` → <expected>
**Files to touch:** `<path>` — <change>
**Commit:** `<type>(<plan-id>): <imperative>`
</task>
```

Checkpoint task template (when user input is required mid-plan):

```markdown
### Task 3: <name> — checkpoint:human-verify
<task type="checkpoint:human-verify">
**Builds on Task 1+2.**
**Verification steps for user:** 1. `<cmd>` should print `<expected>` · 2. Open `<URL>` and confirm `<behavior>`
**What I need:** "approved" or specific issues to fix.
</task>
```
</plan_frontmatter_spec>

<process>

**1. Initialize.** `bash` only (no SDK):

```bash
PHASE="$1"
# Worker subagent inherits the parent's cwd (the project root), so
# `pwd` IS the project root. The previous `cd .. && pwd` was a bug
# that sent files to the parent of the project (and then the worker
# would fall back to the `write` tool with a relative path, polluting
# the project root).
PROJECT_ROOT="$(pwd)"
SOLY_DIR="$PROJECT_ROOT/.agents"
PHASE_DIR=$(ls -d "$SOLY_DIR/phases/"*"-$PHASE-"* 2>/dev/null | head -1) || { echo "Phase $PHASE not found" >&2; exit 1; }
PADDED_PHASE=$(printf "%02d" "$(echo "$PHASE" | grep -oE '^[0-9]+' | sed 's/^0*//')")
PHASE_SLUG=$(basename "$PHASE_DIR")
mapfile -t EXISTING_PLANS < <(ls "$PHASE_DIR"/${PADDED_PHASE}-*-PLAN.md 2>/dev/null | sort)
NEXT_PLAN_NUM=$((${#EXISTING_PLANS[@]} + 1))
HAS_CONTEXT=$([ -f "$PHASE_DIR/${PADDED_PHASE}-CONTEXT.md" ] && echo true || echo false)
HAS_RESEARCH=$([ -f "$PHASE_DIR/${PADDED_PHASE}-RESEARCH.md" ] && echo true || echo false)
HAS_SUMMARIES=$(ls "$PHASE_DIR"/${PADDED_PHASE}-*-SUMMARY.md 2>/dev/null | wc -l | tr -d ' ')
```

| state | action |
|---|---|
| plans > 0 AND summaries > 0 | **Re-plan** — return `## Re-Plan Detected` to parent, ask user to confirm before overwriting |
| plans > 0 AND summaries = 0 | draft plans exist; you may ADD plans using existing files as context. **Do NOT overwrite** existing PLAN.md unless user asks |
| plans = 0 | fresh planning |

**2. Read intent (0-POINT).** The iteration context file (path given in the task prompt) already contains the intent docs as a summary. Use that. If you need a specific doc in full, read it directly from its path (listed in section 0 of the bundle). Capture 3–5 intent bullets that bear on this phase. If intent and ROADMAP conflict, surface before writing plans.

**3. Read phase context** (also in the iteration file) in priority order:
1. `<phase>-CONTEXT.md` if exists — user decisions, honor them. Missing decision in an area you need to plan → surface in report.
2. `<phase>-RESEARCH.md` if exists — chosen libs/patterns. Pitfalls → Must Haves or task body.
3. `.agents/ROADMAP.md` — this phase's row: goal, requirements, deps on other phases.
4. `.agents/REQUIREMENTS.md` if exists — full text + acceptance criteria for each `phase_req_ids`. Every requirement → some plan's `requirements:` array.
5. Up to 3 most recent prior `*-SUMMARY.md` — what was already built.

**4. Decompose into plans.**

**Heuristic:** 1 plan ≈ 2–8 tasks, fits in one executor session without context overflow. > 8 tasks → split at natural seams (foundational → feature → polish; or BE → FE → integration).

**Wave rules:**
- Wave 1: no deps (or only on prior-phase plans already Complete).
- Wave N: deps only on plans in waves 1..N-1 of this phase.
- Graph MUST be acyclic.
- Default split: wave 1 ≈ half the work; subsequent waves in dependency order.

Internal accumulator:

```
PLAN STRUCTURE:
- Plan 1: <title> (wave 1) — covers REQ-01, REQ-02
- Plan 2: <title> (wave 1) — covers REQ-03
- Plan 3: <title> (wave 2, deps: 1, 2) — covers REQ-04, REQ-05
```

**Coverage:** every requirement → exactly one plan. Uncoverable → `## Uncovered Requirements` in report.

**5. Write plans.** Naming: `${PADDED_PHASE}-${M}-<slug>-PLAN.md` (slug = 3–5 kebab-case words). **Write the file at `${PHASE_DIR}/${PADDED_PHASE}-${M}-<slug>-PLAN.md`** — absolute path. Use the frontmatter spec above.

**Content rules:**
- Body must have `## Must Haves` (truths / artifacts / key_links).
- Acceptance criteria must be RUNNABLE (grep, file-check, test, HTTP probe) — not "works correctly".
- `must_haves.truths` = user-observable, not implementation details.
- `must_haves.key_links` = concrete file→file wirings the executor preserves.
- ≤ 8 tasks per plan (more → split).

**6. Validate plan graph.**

1. **Acyclic** — walk `depends-on:`. No plan depends on itself, transitively or directly. Cycle → restructure.
2. **Waves consistent** — `plan.wave > max(wave of its deps)`. If not, fix.
3. **Requirements covered** — every phase requirement → some plan's `requirements:`. If not, add a task or surface as `## Uncovered Requirements`.
4. **Files plausible** — each `key_links` source exists OR is created in an earlier plan. Note if unsure, don't fail.

**7. Commit plans:**

```bash
# Use absolute paths in the add — `git add` interprets them relative to cwd otherwise.
cd "$PROJECT_ROOT" && git add "$PHASE_DIR"/${PADDED_PHASE}-*-PLAN.md
git commit -m "chore(${PADDED_PHASE}): plan phase <N> — <M> plan(s)"
```

**8. Update STATE.md** (read + edit, no CLI):
- Phase status → `Planned`, `current_plan` → 1.
- `last_updated` → `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- If STATE.md has `progress:`, increment `total_plans` by new plan count.
- Keep < 150 lines — archive to `.agents/DECISIONS-INDEX.md` if it grows.

**9. Report:**

```
## Plan Complete — Phase <N> (<slug>)
### Plans Created
- Plan 1: <title> (wave 1) — <N> reqs, <M> tasks
- Plan 2: <title> (wave 1) — ...
- Plan 3: <title> (wave 2, deps: 1, 2) — ...

### Wave Breakdown
- Wave 1: <count> plan(s) — <one-line summary>
- Wave 2: <count> plan(s) — <one-line summary>

### Coverage
- Requirements: <N>/<M> covered<if uncovered: list>

### Files
- Plans: <paths> · STATE.md updated

### Open Questions
<none, or per-question needing user decision>

### Next Step
Parent summarizes + asks confirmation. On confirm: `soly execute-plan <N>` (or `soly execute <N>` for full phase).
```

</process>

<hard_rules>
- No production code. Planning only.
- No subagents (you ARE one). No `.agents/rules/` edits. No `.agents/docs/` edits without surfacing to parent.
- No git branch create/rename/switch.
- `must_haves` (truths/artifacts/key_links) is NOT optional — executor relies on it for self-verification.
- Every acceptance criterion is RUNNABLE — command/check/test, not "works correctly" or "feels right".
- Wave numbers pre-computed; dependency graph acyclic.
- Every phase requirement → some plan (coverage = 100% or surface).
- Conventional Commits 1.0.0.
- Return: created files, plan count, wave breakdown, open questions.
</hard_rules>
