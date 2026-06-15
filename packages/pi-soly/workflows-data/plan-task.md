# Plan Task Workflow

# Всегда соблюдай правила проекта из .soly/rules/
# Не используй shortcuts ради скорости

<path_discipline>
**All soly-managed files live under `.soly/`.** PLAN.md lives at `.soly/features/<feature>/tasks/<task-id>/PLAN.md`. Never write plan files to the project root. Use absolute paths.

The iteration context file (path given by the parent in the task prompt) is your single source of truth for intent, STATE, the feature README, prior task SUMMARYs, and the current task PLAN (for refinement). Read it FIRST.
</path_discipline>

<purpose>
Create or refine PLAN.md for a single task. A task is a small atomic unit
of work — a feature slice, a contract change, a single endpoint, a single
UI page. Smaller than a phase plan; carries its own frontmatter so the
executor can pick it up standalone.
</purpose>

<required_reading>
Before any planning, read:
1. .soly/docs/ — INTENT (0-point)
2. .soly/STATE.md — current state
3. .soly/ROADMAP.md — high-level requirements
4. .soly/features/<feature>/README.md — feature context
5. .soly/contracts/* — shared API schemas (if any)
6. The task's existing PLAN.md (if refining) or relevant sibling tasks (if creating)

If `.soly/features/` is empty for the target feature, error and stop.
Do not invent feature paths.
</required_reading>

<task_frontmatter_spec>
PLAN.md starts with a YAML frontmatter block. The executor depends on it.

```yaml
---
id: auth-be-login-a3f9   # slug-4hex, must match the directory name
kind: be                  # be | fe | infra | docs | integration
feature: auth             # parent feature name (must match .soly/features/<feature>/)
status: ready             # ready | in-progress | blocked | done
priority: high            # high | medium | low
parallelizable: true      # whether this task can run alongside other parallel tasks
depends-on: []            # list of task ids; each must be status: done before this runs
---

# Task: <title>

[body]
```

Defaults if unsure:
- kind: pick from the values above based on the work being planned
- priority: medium
- parallelizable: false
- depends-on: []  (only fill if you have a clear dep on an existing task)
</task_frontmatter_spec>

<process>

<step name="verify_target" priority="first">
Confirm what kind of planning this is:

- **new-task** — create the dir + write PLAN.md from scratch
- **existing-task** — refine an existing PLAN.md (do NOT rewrite from scratch;
  preserve frontmatter, improve body)

If unclear, error and ask the parent.
</step>

<step name="read_intent" priority="first">
**0-POINT CHECK.** Re-read `.soly/docs/` (intent docs) before any planning.
The task PLAN.md is the contract; intent docs are the WHY. If you find
a conflict, flag it instead of silently choosing.

The iteration context file (path given in the task prompt) bundles the
intent docs as a summary, the feature README, and prior task SUMMARYs.
Use that as your starting point. If you need a specific doc in full,
read it directly from its path.
</step>

<step name="read_feature">
Read `.soly/features/<feature>/README.md` for feature-level context.
If missing, note it but proceed (the parent may not have written one yet).
</step>

<step name="check_contracts">
If the task touches API surfaces (BE endpoints, FE request shapes, shared
types), read `.soly/contracts/<feature>.openapi.yaml` or similar. Contracts
are the synchronizing artifact between parallel BE and FE tasks.
</step>

<step name="check_siblings">
For new-task: look at existing tasks in the same feature (if any) to
match style and identify natural dependencies. If a sibling task already
implements something this task depends on, add to `depends-on:`.

For existing-task: read sibling tasks only if the plan needs to be aware
of them (e.g., shared types, sequential ordering).
</step>

<step name="write_plan">
For new-task, structure the PLAN.md body like:

```
# Task: <title>

## What
<1-2 paragraphs: what this task does, in plain language>

## Why
<1-2 sentences: what user-visible outcome / contract this enables>

## Acceptance criteria
- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] ...

## Files to touch
- <path> — <what changes>
- ...

## Edge cases
- <edge case 1>
- <edge case 2>

## Out of scope
- <explicitly NOT doing X>
```

For existing-task, preserve the frontmatter. Refine the body to make
acceptance criteria testable, edge cases concrete, and "out of scope"
explicit. Do NOT bloat — a tight plan is better than an exhaustive one.
</step>

<step name="commit">
For new-task, commit the new PLAN.md:
```
# Use absolute path with `cd "$PROJECT_ROOT"` so git doesn't interpret
# a bare relative path as cwd-relative.
cd "$PROJECT_ROOT" && git add .soly/features/<feature>/tasks/<id>/PLAN.md
git commit -m "chore(tasks): plan <id>"
```

For existing-task refinement, commit only if material change:
```
cd "$PROJECT_ROOT" && git add .soly/features/<feature>/tasks/<id>/PLAN.md
git commit -m "chore(tasks): refine plan <id>"
```

If nothing material changed, do not commit.

**Worker bash setup (when you do need it):**
```bash
PROJECT_ROOT="$(pwd)"  # worker inherits parent cwd = project root
SOLY_DIR="$PROJECT_ROOT/.soly"
```
</step>

<step name="report">
Return to parent:
- Created or refined path
- Task id (for new-task)
- Plan summary (1-3 bullets)
- Any open questions / decisions needing parent approval
- Any deps discovered (sibling tasks that should also be planned)
</step>

</process>

<hard_rules>
- Do not write production code. Planning only.
- Preserve existing frontmatter on refinement. Only update if you find a bug.
- For new-task, generate the id as `<slug>-<4hex>` (lowercase).
- Commit messages follow Conventional Commits 1.0.0 — `chore(tasks): ...`.
- Do not modify `.soly/rules/`.
- Do not run subagents yourself.
- **PATH DISCIPLINE:** PLAN.md goes to `.soly/features/<feature>/tasks/<id>/PLAN.md`. Never to the project root.
- Return: created/refined path, task id, plan summary, open questions.
</hard_rules>

<dual_mode_note>
Tasks are part of soly's dual-mode system. The project may also have
`.soly/phases/` (phase-based layout, distinct from task-based). You are only planning a specific task.
Do not touch phases. Do not modify ROADMAP.md or STATE.md.
</dual_mode_note>
