# Execute Plan

<purpose>Execute one PLAN.md, produce a matching SUMMARY.md, update STATE.md/ROADMAP.md. Single worker — no sub-subagents.</purpose>

<path_discipline>
**All soly-managed files live under `.soly/`.** Never write PLAN.md, CONTEXT.md, RESEARCH.md, SUMMARY.md, iteration files, or handoffs to the project root. All phase files go in `.soly/phases/<NN>-<slug>/`. Use absolute paths (or paths starting with `$SOLY_DIR`) — never bare relative names that could land in cwd.

The iteration context file (path given by the parent in the task prompt) is your single source of truth for intent, STATE, ROADMAP, phase CONTEXT/RESEARCH, prior SUMMARYs, and (section 6) the current PLAN. Read it FIRST.
</path_discipline>

<read_first>`.soly/STATE.md` · `.soly/ROADMAP.md` · `PLAN.md` (the contract) · `<phase>-CONTEXT.md` if exists (honor user decisions) · `<phase>-RESEARCH.md` if exists (use chosen libs/patterns). If `.soly/` missing → stop + error.</read_first>

<atomic_close_out>
**Only legal close-out order:** `production-code commit(s) → SUMMARY commit → STATE/ROADMAP update`.
The only legal half-state is mid-production-commits while still actively working. Once production commits exist, returning without a committed SUMMARY is an **illegal partial-plan state** — the next `soly execute-plan` must detect it before starting a new plan.
</atomic_close_out>

<process>

**1. Init context + partial-plan check.** `bash` only (no SDK):

```bash
PHASE="$1"; PLAN="$2"  # PLAN optional — defaults to next unfinished
# Worker subagent inherits the parent's cwd (the project root), so
# `pwd` IS the project root. The previous `cd .. && pwd` was a bug.
PROJECT_ROOT="$(pwd)"
SOLY_DIR="$PROJECT_ROOT/.soly"
PHASE_DIR=$(ls -d "$SOLY_DIR/phases/"*"-$PHASE-"* 2>/dev/null | head -1) || { echo "Phase $PHASE not found" >&2; exit 1; }
PADDED_PHASE=$(printf "%02d" "$(echo "$PHASE" | grep -oE '^[0-9]+' | sed 's/^0*//')")
PHASE_SLUG=$(basename "$PHASE_DIR")
mapfile -t ALL_PLANS < <(ls "$PHASE_DIR"/${PADDED_PHASE}-*-PLAN.md 2>/dev/null | sort)

# Pick target plan
if [ -n "$PLAN" ]; then
  TARGET_PLAN="$PHASE_DIR/${PADDED_PHASE}-$PLAN-PLAN.md"
else
  for p in "${ALL_PLANS[@]}"; do
    [ ! -f "${p/-PLAN.md/-SUMMARY.md}" ] && { TARGET_PLAN="$p"; break; }
  done
fi
[ -z "$TARGET_PLAN" ] || [ ! -f "$TARGET_PLAN" ] && { echo "No unfinished PLAN.md" >&2; exit 1; }

PLAN_NUM=$(basename "$TARGET_PLAN" | sed -E "s/^${PADDED_PHASE}-([0-9]+)-.*/\1/")
EXPECTED_SUMMARY="${TARGET_PLAN/-PLAN.md/-SUMMARY.md}"
COMMIT_COUNT=$(git log --oneline --all --grep="${PADDED_PHASE}-${PLAN_NUM}" 2>/dev/null | wc -l | tr -d ' ')
SUMMARY_EXISTS=$([ -f "$EXPECTED_SUMMARY" ] && echo true || echo false)
PARTIAL_PLAN=$([ "$COMMIT_COUNT" -gt 0 ] && [ "$SUMMARY_EXISTS" = false ] && echo true || echo false)
```

**If `PARTIAL_PLAN=true`** → return `## Partial Plan Detected` to parent and STOP. Do not silently overwrite. User decides: resume summary-write, rollback, or investigate.

**2. Record start time.** `PLAN_START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")` · `PLAN_START_EPOCH=$(date +%s)`

**3. Parse plan structure.** `grep -cE '^\s*<task' "$PLAN_PATH"` for task count; `grep -nE 'type="checkpoint|<acceptance_criteria>'` for hotspots. Execute all tasks yourself sequentially — no sub-subagent dispatch.

**3.5. Seed pi-todo (cross-extension, optional).** If the `todo_update` tool is available in this session (the `pi-todo` extension is installed), call it NOW with one TodoItem per `<task>` from the plan, all `status: "pending"` with `activeForm` set to the present-continuous form of the task. Then set the first task to `in_progress` before starting work. This gives the user a live checklist in the footer. Clear the list (`todo_update({todos: []})`) after the SUMMARY is committed (step 12) when the plan is fully done.

**4. Load the plan as contract.** Read PLAN.md fully. **If `<interfaces>` block exists → use those types directly, don't re-read source files. If per-task `<read_first>` exists → read every listed file BEFORE any edit (not optional — ground truth).**

**5. Execute tasks in order.** Per task:

1. **Read first** — open every `<read_first>` file.
2. **Implement** — minimal correct change, follow project patterns. No speculative scaffolding. No `.soly/rules/` edits.
3. **Verify acceptance criteria (HARD GATE):**
   - Run the grep/file-check/CLI for each criterion in `<acceptance_criteria>`.
   - Log PASS/FAIL with output. If ANY fails → fix immediately, re-run ALL.
   - Loop until all pass. If can't pass after 2 fix attempts → log as deviation. **Do NOT silently skip.**
4. **Run `<verification>`** commands (lint, typecheck, scoped tests).
5. **Commit per task:**
   ```bash
   git add <files>
   git commit -m "<type>(${PADDED_PHASE}-${PLAN_NUM}): <task summary>"
   ```
   `<type>` ∈ `feat | fix | refactor | test | chore | docs`. Track commit hash for summary.
6. **On `type="checkpoint:*"`** → STOP, return Checkpoint block (step 6). Do NOT continue.
7. **On `type="tdd"`** → RED (failing test, `test(...)`) → GREEN (impl, `feat(...)`) → REFACTOR (`refactor(...)`). Tests MUST fail before impl, MUST pass after.

**6. Checkpoint protocol** (when you hit `type="checkpoint:*"` or auth gate — see step 7):

Can't talk to user directly. Stop, return structured block, parent relays.

```
## Checkpoint Reached — Phase <P>, Plan <N>
**Type:** <human-verify|decision|human-action>
**Task:** <n> — <name>  **Progress:** <x>/<y>

### Completed so far
- Task 1: <name> (commit <hash>)
- ...

### Checkpoint Content
<type-specific body>

### What I Need From You
<"approved" | "select: <option-id>" | "done" | <question>>

### State Preserved At
`<phase_dir>/.execute-checkpoint.json`
```

| Type | Body | Resume signal |
|---|---|---|
| `human-verify` (90%) | What was built + verification steps (commands/URLs) + expected | "approved" or specific issues |
| `decision` (9%) | Decision + context + 2–3 options with pros/cons | "select: <option-id>" |
| `human-action` (1%) | What was automated + ONE manual step + verify plan | "done" |

**State preservation:** write `${PHASE_DIR}/.execute-checkpoint.json` with `completed_tasks[]`, `commit_hashes{}`, `next_task_index` for deterministic resume. Delete on clean close-out.

**7. Authentication gates** are NOT failures — expected interaction points. Indicators: "Not authenticated", 401/403, "Please run {tool} login", "Set {ENV_VAR}". Protocol: recognize → STOP → write `.execute-checkpoint.json` with `type: "human-action"` + exact auth steps → return Checkpoint block → wait. Document in SUMMARY.md under `## Authentication Gates`, not as a deviation.

**8. Deviation rules:**

| Rule | Trigger | Action |
|---|---|---|
| 1 | Bug found while implementing | Auto-fix, test, verify, track as deviation |
| 2 | Missing critical implementation detail | Auto-fix, test, verify, track as deviation |
| 3 | Blocker in adjacent code | Auto-fix only if scope strictly bounded; else Rule 4 |
| 4 | Architectural change, new dep, scope expansion | **STOP** — write `.execute-checkpoint.json` `type: "decision"`, return to parent. NEVER silently decide. |

- **Scope boundary:** do NOT auto-fix pre-existing issues unrelated to current task — note in SUMMARY "Out-of-Scope Issues".
- **Fix attempt limit:** max 3 retries per deviation before Rule 4.
- **Priority:** Rule 4 (STOP) > Rules 1–3 (auto) > unsure → Rule 4.

**9. Pre-commit hook failure:**
1. `git commit` fails with hook error. 2. Read error — names hook + what failed. 3. Fix (type/lint/secret). 4. `git add` fixed. 5. Retry. 6. Budget 1–2 cycles per commit. If still failing → `type: "human-action"` checkpoint with hook output.
**Do NOT use `--no-verify`** unless project's `.soly/docs/` or ROADMAP.md explicitly opts out.

**10. Verification failure gate:** 1st retry (hooks flake) → 2nd retry (fix obvious cause) → 3rd retry (apply deviation rules) → 3+ fails → `type: "decision"` checkpoint, STOP.

**11. Generate USER-SETUP** (only if PLAN.md frontmatter has `user_setup:`):

```bash
grep -A 50 "^user_setup:" "$PLAN_PATH" | head -50
```

Write `${PHASE_DIR}/${PADDED_PHASE}-${PLAN_NUM}-USER-SETUP.md`:

```markdown
---
phase: <P>  plan: <N>  status: Incomplete  generated: <ISO8601>
---

# User Setup — Phase <P> Plan <N>

## <service-name>
- **Env vars:** `<VAR>` — <description, where to get it>
- **Account setup:** <link + checklist>
- **Dashboard config:** <link + steps>
- **Local dev notes:** <how to verify locally>
- **Verification:** `<command>` should print <expected>

## Verification
Run all verification commands. When all pass, change `status:` to `Complete`.
```

**12. Create SUMMARY.md** (atomic — NO narrative between `write` and `git commit`):

```markdown
---
phase: <P>  plan: <N>  title: "<from PLAN>"  status: complete
duration: "<Xh Ym>"  started: <ISO>  completed: <ISO>
tasks_completed: <N>  files_modified: <N>
tags: [<from PLAN frontmatter>]
key-files:    { created: [<paths>],  modified: [<paths>] }
key-decisions: [<d1>, <d2>]
requirements-completed: [<from PLAN frontmatter, verbatim>]
---

# Phase <P> Plan <N>: <Title> Summary

<one-line substantive — e.g. "JWT auth with refresh rotation using jose", not "Authentication implemented">

## Duration  <duration> (<start> → <end>)

## Tasks
- Task 1: <name> (commit <hash>)
- ...

## Deviations from Plan
If none: `None — plan executed exactly as written.`
Per deviation:
```
**[Rule N — <Cat>] <Title>**
- Found during: Task <X>
- Issue: <what>   Fix: <what you did>
- Files: <paths>   Verification: <how>   Commit: <hash>
```
End with: `**Total deviations:** <N> auto-fixed (Rules 1–3). **Out-of-scope:** <N>. **Escalated:** <N>.`

## Authentication Gates
<none or per-gate entries>

## Out-of-Scope Issues
<issues not in this plan's scope — future phase>

## Verification
<output of <verification> block, or "all criteria passed; see commits">

## Files Touched  - Created: <n>  - Modified: <n>

## Next
<if more plans: "Ready for plan <N+1> — re-invoke `soly execute-plan <P>`">
<if last: "Phase <P> complete. Consider `soly plan <P+1>` or `soly pause`.">
```

```bash
git add "$EXPECTED_SUMMARY"
git commit -m "chore(${PADDED_PHASE}-${PLAN_NUM}): complete plan <N>"
```

**13. Update STATE.md** (read + edit, no CLI):
- Bump `current_plan` in "Current Position".
- Add `key-decisions` to "Decisions" table (skip if trivial).
- Update `last_updated`.
- Keep < 150 lines — archive long-form to `.soly/DECISIONS-INDEX.md` if it grows.

**Update ROADMAP.md** — phase's progress row: increment completed plan count; status → `In Progress` (more plans) or `Complete` (last) with date.

**14. Update requirements** (only if PLAN.md has `requirements:`):

```bash
REQUIREMENTS=$(grep -A1 "^requirements:" "$PLAN_PATH" | tail -1 | sed -E 's/.*\[([^]]+)\].*/\1/' | tr ',' ' ')
```

For each ID, find line in `.soly/REQUIREMENTS.md`, flip status to `Complete`.

**15. Return:**

```
## Plan Complete — Phase <P> Plan <N>
**Title:** <t>  **Duration:** <d>  **Tasks:** <n>  **Files:** <m>  **Deviations:** <n> auto / <m> escalated
<if USER_SETUP>
## ⚠ User Setup Required
<path> generated with <n> service(s) — complete before next plan's external checks.
</if>
### Next
<if more plans: "Re-invoke `soly execute-plan <P>` for plan <N+1>.">
<if last: "Phase <P> complete. Try `soly plan <P+1>` or `soly pause`.">
```

</process>

<hard_rules>
- No `.soly/rules/` edits. No `.soly/docs/` edits without explicit user decision in conversation.
- No subagents (you ARE one). `maxSubagentDepth: 1` is enforced.
- **Never skip `<acceptance_criteria>` HARD GATE.** Not optional.
- **Never emit narrative between SUMMARY `write` and `git commit`** (truncation is a known failure mode).
- **Never silently make architectural decisions** — use Rule 4 + checkpoint.
- Commit messages: Conventional Commits 1.0.0. Per-task: `<type>(<plan-id>): <summary>`.
- Return: SUMMARY path, plan summary, deviation count, next step.
</hard_rules>
