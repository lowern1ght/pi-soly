# Execute Task

<purpose>Execute ONE task (atomic unit — a feature slice, one endpoint, one page, one contract wire). Produce SUMMARY.md. Tasks live under `.soly/features/<feature>/tasks/<task-id>/` with PLAN.md as the contract.</purpose>

<path_discipline>
**All soly-managed files live under `.soly/`.** Never write PLAN.md, SUMMARY.md, iteration files, or handoffs to the project root. Task files go in `.soly/features/<feature>/tasks/<task-id>/`. Use absolute paths — never bare relative names that could land in cwd.

The iteration context file (path given by the parent in the task prompt) is your single source of truth for intent, STATE, the feature README, prior task SUMMARYs, and the current task PLAN. Read it FIRST.
</path_discipline>

<read_first>`.soly/STATE.md` · `.soly/docs/` (INTENT, 0-point) · `.soly/features/<feature>/README.md` · `PLAN.md` (the contract) · `.soly/contracts/*` if PLAN.md references it. If `.soly/features/` or task dir missing → error + stop, do not invent paths.</read_first>

<task_frontmatter>
PLAN.md frontmatter (executor must respect all fields; **flag** incomplete ones in your report, don't silently fill):

```yaml
---
id: auth-be-login-a3f9   # slug-4hex, must match the directory name
kind: be                  # be | fe | infra | docs | integration
feature: auth             # parent feature
status: ready             # ready | in-progress | blocked | done
priority: high            # high | medium | low
parallelizable: true
depends-on: []            # list of task ids; each must be status: done
---
```
</task_frontmatter>

<atomic_close_out>
Only legal order: `production-code commit(s) → SUMMARY.md commit → PLAN.md frontmatter status: done → report`.
Once production commits exist, returning without a committed SUMMARY is an illegal partial-task state.
</atomic_close_out>

<process>

**1. Verify ready.** `TASK_DIR` from worker args. Parse `status` from frontmatter:

```bash
TASK_DIR="$1"
[ -d "$TASK_DIR" ] && [ -f "$TASK_DIR/PLAN.md" ] || { echo "task dir or PLAN.md missing" >&2; exit 1; }
STATUS=$(awk '/^---$/{c++; next} c==1{print}' "$TASK_DIR/PLAN.md" | grep -E '^status:' | awk '{print $2}' | tr -d '"')
```

- `status` is `ready` (or `in-progress` for resume).
- Every task in `depends-on:` has `status: done` (its SUMMARY.md is committed).

If not → return `## Blocker` to parent, stop. Do NOT start a blocked task.

**2. Read intent + feature context.** **0-POINT CHECK** — the iteration context file (path given in the task prompt) already contains the intent docs as a summary, the feature README, prior task SUMMARYs, and the current task PLAN. Use that. If intent and PLAN.md conflict, flag it. Read `.soly/contracts/*` (if it exists) only if the task touches API surfaces.

**3. Execute** with standard worker self-audit:

1. Write code.
2. Run build / typecheck / lint — **0 warnings**.
3. Cross-check diff against `.soly/rules/coding/*` (or `.editorconfig`).
4. **Rule gap?** Invoke the project's rule-authoring skill (`analyzer-coach` or equivalent) — it proposes an `.editorconfig` entry, a coding-rule doc addition, or a custom-analyzer rule. Loop until clean, max 3 iterations.
5. Commit production-code changes (one or more commits).

Do NOT skip the audit. "I think I'm fine" is not a check.

**4. Write `SUMMARY.md`** at the absolute path `${TASK_DIR}/SUMMARY.md` (the task dir is the iteration context's `task` frontmatter field, plus the feature subdir). Never a bare relative name:

```markdown
---
id: <task-id>  title: "<from PLAN>"  status: done
started: <ISO>  completed: <ISO>  duration: "<Xm>"
feature: <feature>
---

# <task-id> Summary

<1–2 sentences: what was done>

## Changed files
- `<path>` — <what>

## Validation
- `<cmd>` → exit 0 (output: ...)
- `<cmd>` → exit 0 (output: ...)

## Rule gaps discovered
<none, or per-gap: which skill proposed, which rule added>

## Decisions needing approval
<none, or per-decision: rationale + recommendation>
```

**5. Close out** — atomic, do NOT skip or reorder:

```bash
cd "$PROJECT_ROOT" && git add "$TASK_DIR/SUMMARY.md"
git commit -m "chore(tasks): summary for <task-id>"
cd "$PROJECT_ROOT" && git add "$TASK_DIR/PLAN.md"   # flip status → done
git commit -m "chore(tasks): mark <task-id> done"
```

You may combine into one commit, but the SUMMARY must be on disk before the frontmatter flip. **Do not flip status without a committed SUMMARY.**

**6. Report** to parent: task id, SUMMARY path, commits, validation results, decisions needing approval.

</process>

<hard_rules>
- No `.soly/rules/` edits. No subagents (you ARE one).
- No starting tasks with un-`done` `depends-on:`.
- If rule gap → add via the rule-authoring skill. **No silent workarounds** (`#pragma`, `severity = none`).
- Return: changed files, commands + exit codes, validation evidence, surprises, decisions needing parent approval.
</hard_rules>

<interactive_rules_out_of_scope>
- `interactive: true` rules (describe the conversation, not execution). You're in execute mode, not discuss — surface genuine blockers in the report, don't ask the user.
</interactive_rules_out_of_scope>

<dual_mode_note>
Project may also have `.soly/phases/` (phase-based layout, distinct from task-based). You are only responsible for this task. Don't touch phases. Don't modify ROADMAP.md or STATE.md beyond what your close-out requires (typically nothing for tasks — the parent updates those).
</dual_mode_note>
