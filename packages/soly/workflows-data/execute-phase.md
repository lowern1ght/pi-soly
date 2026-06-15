# Execute Phase

<purpose>Execute all plans in a phase, wave by wave. Per plan, follow `execute-plan.md` inline. Update STATE.md between plans. Generate a phase-level VERIFICATION.md at the end. You ARE the executor (`maxSubagentDepth: 1` is enforced — no sub-sub-agents). Checkpoint requests return a structured block; parent relays to user; next `soly execute <N>` resumes from `.execute-checkpoint.json`.</purpose>

<path_discipline>
**All soly-managed files live under `.soly/`.** Never write PLAN.md, CONTEXT.md, RESEARCH.md, SUMMARY.md, iteration files, or handoffs to the project root. All phase files go in `.soly/phases/<NN>-<slug>/`. Use absolute paths (or paths starting with `$SOLY_DIR`) — never bare relative names that could land in cwd.

The iteration context file (path given by the parent in the task prompt) is your single source of truth for intent, STATE, ROADMAP, and any existing phase artifacts. Read it FIRST, before any of your own `read` or `ls` calls.
</path_discipline>

<read_first>`.soly/STATE.md` (single source of truth for "where am I") · `.soly/ROADMAP.md` (phase goal + reqs) · `.soly/docs/` (INTENT, re-read before each plan) · the phase directory: list PLAN.md sorted, plus any SUMMARY.md / CONTEXT.md / RESEARCH.md / `.execute-checkpoint.json`. If `.soly/` missing → stop + error.</read_first>

<core_principle>
**Orchestrate, don't re-specify.** Each PLAN.md is the contract; `execute-plan.md` is the per-plan protocol. This file adds: wave grouping, state transitions between plans, phase-level aggregation (VERIFICATION.md), safe resumption from partial state. The full per-plan steps live in `execute-plan.md` — read it once, then apply per plan.
</core_principle>

<process>

**1. Parse args.** `PHASE` (required) plus optional `--plan <M>`, `--wave <W>`, `--from <M>`. If `--plan` is set, `PLAN_MODE=true` — skip wave grouping (defer to `execute-plan.md`).

**2. Initialize.** `bash` only:

```bash
PHASE="$1"
# Worker subagent inherits the parent's cwd (the project root), so
# `pwd` IS the project root. The previous `cd .. && pwd` was a bug
# that sent files to the parent of the project (and then the worker
# would fall back to the `write` tool with a relative path, polluting
# the project root).
PROJECT_ROOT="$(pwd)"
SOLY_DIR="$PROJECT_ROOT/.soly"
PHASE_DIR=$(ls -d "$SOLY_DIR/phases/"*"-$PHASE-"* 2>/dev/null | head -1) || { echo "Phase $PHASE not found" >&2; exit 1; }
PADDED_PHASE=$(printf "%02d" "$(echo "$PHASE" | grep -oE '^[0-9]+' | sed 's/^0*//')")
PHASE_SLUG=$(basename "$PHASE_DIR")
mapfile -t ALL_PLANS < <(ls "$PHASE_DIR"/${PADDED_PHASE}-*-PLAN.md 2>/dev/null | sort)
mapfile -t ALL_SUMMARIES < <(ls "$PHASE_DIR"/${PADDED_PHASE}-*-SUMMARY.md 2>/dev/null | sort)
COMPLETED=$(for p in "${ALL_PLANS[@]}"; do [ -f "${p/-PLAN.md/-SUMMARY.md}" ] && echo 1; done | wc -l)
HAS_CHECKPOINT=$([ -f "$PHASE_DIR/.execute-checkpoint.json" ] && echo true || echo false)
```

If `HAS_CHECKPOINT=true` → read it, resume from `next_task_index`, surface `## Resuming From Checkpoint` in your first output.

**3. Safe-resume gate** (detect illegal partial state BEFORE any new work):

```bash
for p in "${ALL_PLANS[@]}"; do
  s="${p/-PLAN.md/-SUMMARY.md}"
  [ -f "$s" ] && continue
  PLAN_ID=$(basename "$p" | sed -E "s/^${PADDED_PHASE}-([0-9]+)-.*/\1/")
  if git log --oneline --all --grep="${PADDED_PHASE}-${PLAN_ID}" 2>/dev/null | grep -q .; then
    echo "PARTIAL: $p has production commits but no SUMMARY"
  fi
done
```

If any partial state detected → return `## Partial Plans Detected` listing them, **stop**. Do not silently re-execute; user chooses resume-summary-write / rollback / investigate.

**4. Check blocking anti-patterns.** Read `${PHASE_DIR}/.continue-here.md` if it exists; parse its Critical Anti-Patterns table for `severity = blocking`. For each, output `## Blocking Anti-Patterns` with the 3-question format (what / how manifested / structural prevention). If unanswerable from `.continue-here.md` → return `## Clarifications Needed` and stop.

**5. Discover + group plans.** Parse frontmatter of each PLAN.md for `wave:`, `depends-on:`, `requirements:`. Group by wave (1, 2, ...). Within a wave, dependency-driven order; file-name sort for unconstrained ties.

**Validate wave graph:**

| check | rule |
|---|---|
| Acyclic | walk `depends-on:` — no plan depends on itself, transitively or directly |
| Wave-consistent | `plan.wave > max(wave of its deps)` |
| External deps | any `depends-on:` outside this phase points to prior-phase work already Complete in STATE.md |

If validation fails → return `## Wave Graph Invalid`, stop.

**6. Execute waves.** For each wave:

1. List plans in dependency-safe order.
2. For each plan, **run the per-plan loop** (step 7).
3. After the wave, run wave gates (step 8).
4. If `--wave <W>` set and we're past W, stop.

Within a wave, plans are "parallel" in name but you do the work sequentially in this worker context. **Skip rule:** if a plan already has SUMMARY.md, skip — it's done from a prior invocation. Update `completed` count.

**7. Per-plan loop** (apply `execute-plan.md` inline — don't re-specify its steps):

```
For plan P:
  1. record_start_time
  2. parse_plan (count tasks, find acceptance criteria, checkpoints)
  3. load_prompt (read PLAN.md fully; honor CONTEXT.md, RESEARCH.md)
  4. execute tasks sequentially: read read_first → implement → verify
     acceptance criteria (HARD GATE) → commit per task
  5. if checkpoint:* reached → write .execute-checkpoint.json,
     return Checkpoint block to parent, STOP
  6. create_summary + commit SUMMARY.md (atomic — no narrative between;
     write to `${PHASE_DIR}/${PADDED_PHASE}-${M}-<slug>-SUMMARY.md` — absolute path)
  7. update_state: bump current_plan in STATE.md; mark plan row in
     ROADMAP.md
  8. update_requirements if PLAN.md has `requirements:`
  9. delete .execute-checkpoint.json (if any)
 10. record result for wave aggregation
```

**8. Wave gates (after each wave).**

**Regression check** — run the project's test suite (`npm test` / `bun test` / `dotnet test` / `pytest` / `go test ./...`). All previously-passing tests must still pass.

- Regression detected → STOP, return `## ⚠ Regression Detected` (failing tests, wave that introduced them, recommendation: revert / fix / continue with acknowledged breakage).
- Regression in CONTEXT.md as "expected" (e.g., "Wave 2 breaks test X; fixed in Wave 3") → continue.

**Cross-plan wiring check** — for each `must_haves.key_links` in each plan's SUMMARY, spot-check the link exists. If missing, log in wave summary; do NOT fail the wave.

These gates are intentionally lighter than a full external verifier — soly on pi trusts the executor's `acceptance_criteria` HARD GATE.

**9. Checkpoint handling.** When a plan hits `type="checkpoint:*"` or auth gate → follow `execute-plan.md`'s checkpoint protocol: write `.execute-checkpoint.json`, return `## Checkpoint` to parent. Parent presents, gathers response, re-invokes `soly execute <N>`. Next invocation picks up from the JSON.

**10. Aggregate + VERIFICATION.md.** After all waves:

```
## Phase <N>: <Name> Execution Complete
### Plans
- Plan 1: <title> — <duration> — <tasks>/<total> — <files mod> — <commit range>
### Wave Summary
- Wave 1: <n> plan(s), <dur>, <f> files · Wave 2: ...
### Total  Plans <X>/<Y> · Duration <T> · Files <N> created, <M> modified · Deviations <K>
### Issues Encountered  <aggregated from each SUMMARY "Issues Encountered">
### Next  `soly status` · `<project verify cmd>` · `soly plan <N+1>` or `soly pause`
```

Write `${PHASE_DIR}/${PADDED_PHASE}-VERIFICATION.md` (the canonical "did the phase deliver what ROADMAP said" check). Use the absolute path — never a bare relative name.

```markdown
---
phase: <N>  phase_slug: <slug>  status: pending  generated: <ISO>
---

# Phase <N>: <Name> — Verification

## Phase Goal
<one-line from ROADMAP.md>

## Requirements Coverage
| Req ID | Plan | Status | Notes |
|---|---|---|---|
| REQ-01 | Plan 2 | complete | see SUMMARY § Verification |

## Test Results
- <verify cmd> → <result>

## Manual Verification
<URLs to open, behaviors to confirm>

## Gaps
- [ ] <not yet verified>
- [ ] <another gap>

## Status
`pending` until the user (or a verifier) flips to `passed` / `failed`. Phase is "Complete" when this file exists AND `status: passed`.
```

**Do NOT flip status to `passed` yourself** — that decision belongs to the user or a verifier.

**11. Update ROADMAP.md** (read + edit at `${SOLY_DIR}/ROADMAP.md` — absolute path):
- Phase row status → `Complete` if VERIFICATION.md `status: passed`, else `In Progress`.
- Update `completed_plans` count.

**12. Update STATE.md** (at `${SOLY_DIR}/STATE.md` — absolute path):
- Phase status → `Complete` (if VERIFICATION passed) or `Needs Review` (if not).
- Reset `current_plan` → 0. Update `last_updated`. Update `progress:` block.
- Keep < 150 lines.

**13. Return:**

- Complete:
  ```
  ## ✓ Phase <N>: <Name> Complete
  ### What Shipped  <2–3 sentences>
  ### Stats  Plans: <n> · Files: <c> created / <m> modified · Reqs: <c>/<t> · Deviations: <d>
  ### Verification  <path> created (status: pending — flip after smoke test)
  ### Next  `soly plan <N+1>` · `soly status` · `soly pause`
  ```
- Incomplete (some plans unshipped / checkpoint pending):
  ```
  ## ⚠ Phase <N>: <Name> Incomplete
  ### Shipped
  - Plan 1: <title> — <dur>
  ### Outstanding
  - Plan 3: <title> — checkpoint reached, awaiting user input
  - Plan 5: <title> — not started
  ### Next  Re-invoke `soly execute <N>` to continue.
  ```

</process>

<hard_rules>
- No `.soly/rules/` edits. No subagents (`maxSubagentDepth: 1`).
- No silent skip of partial-state plans — surface and stop.
- No flipping VERIFICATION.md to `passed` yourself.
- No silent architectural decisions — use `execute-plan.md`'s Rule 4 + checkpoint.
- Wave graph acyclic; validate before executing.
- Conventional Commits 1.0.0. Per-plan: `<type>(<plan-id>): <summary>`.
- Return: phase summary, per-plan rollup, verification status, next step.
</hard_rules>
