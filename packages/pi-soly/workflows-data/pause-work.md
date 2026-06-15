# Pause Work

<purpose>Create `.soly/HANDOFF.json` (machine-readable) and a `.continue-here.md` (human-readable) to preserve work state across sessions. `soly resume` consumes both.</purpose>

<read_first>.soly/STATE.md (current position) · the most recent `.soly/phases/*/SUMMARY.md` if any</read_first>

<process>

**1. Detect context.** First match wins; nothing detectable → `.soly/.continue-here.md` (note ambiguity in `<current_state>`).

```bash
phase=$(ls -t .soly/phases/*/PLAN.md 2>/dev/null | head -1)
phase_slug=$(echo "$phase" | grep -oP 'phases/\K[^/]+')
spike=$(ls -td .soly/spikes/*/ 2>/dev/null | head -1)
sketch=$(ls -td .soly/sketches/*/ 2>/dev/null | head -1)
deliberation=$(ls .soly/deliberations/*.md 2>/dev/null | head -1)
```

| detected | handoff path |
|---|---|
| phase_slug | `.soly/phases/<phase_slug>/.continue-here.md` |
| spike | `.soly/spikes/<spike_slug>/.continue-here.md` |
| sketch | `.soly/sketches/<sketch_slug>/.continue-here.md` |
| deliberation | `.soly/deliberations/.continue-here.md` |
| (notes only) | `.soly/.continue-here.md` |

**2. Gather state.** Walk the conversation + recent diffs. Collect: current position (phase/plan/task + paths), work done this session (artifacts, not aspirations), work remaining, decisions (only those future-you must not re-litigate), blockers, human actions pending (API keys, approvals, manual tests), background processes, uncommitted files (`git status --porcelain`), and blocking constraints (anti-patterns discovered through actual failure — each tagged `blocking` or `advisory`).

If anything is ambiguous, return a `## Clarifications Needed` block — do not invent.

**3. Check for false completions.** `grep -l "To be filled\|placeholder\|TBD" .soly/phases/*/*.md 2>/dev/null` — report matches as incomplete.

**4. Write `.soly/HANDOFF.json`.** Timestamp via `date -u +"%Y-%m-%dT%H:%M:%SZ"` (no SDK).

```json
{
  "version": "1.0",
  "timestamp": "<ts>",
  "phase": <n|null>, "phase_name": "<str|null>", "phase_dir": "<path|null>",
  "plan": <n|null>, "task": <n|null>, "total_tasks": <n|null>,
  "status": "paused",
  "completed_tasks":   [{"id": 1, "name": "<n>", "status": "done", "commit": "<hash>"},
                        {"id": 2, "name": "<n>", "status": "in_progress", "progress": "<what>"}],
  "remaining_tasks":   [{"id": 3, "name": "<n>", "status": "not_started"}],
  "blockers":          [{"description": "<x>", "type": "technical|human_action|external", "workaround": "<if any>"}],
  "human_actions_pending": [{"action": "<x>", "context": "<why>", "blocking": true}],
  "decisions":         [{"decision": "<x>", "rationale": "<why>", "phase": <n|null>}],
  "uncommitted_files": [],
  "next_action": "<specific first action when resuming>",
  "context_notes": "<mental state, approach>"
}
```

Use JSON `null`, never the string `"null"`.

**5. Write `<handoff-path>/.continue-here.md`:**

```markdown
---
context: <phase|spike|sketch|deliberation|research|default>
phase: <slug-or-empty>  task: <n>  total_tasks: <m>
status: in_progress  last_updated: <ts>
---

# BLOCKING CONSTRAINTS — read first
> Each was discovered through actual failure. Acknowledge before proceeding.
- [ ] CONSTRAINT: <name> — <what> — <structural mitigation>

_If none, remove this section._

## Critical Anti-Patterns
| Pattern | What + how it manifested | Severity | Structural prevention |
|---|---|---|---|
| <name> | <desc> | blocking | <mechanism — not just acknowledgment> |
| <name> | <desc> | advisory | <guidance> |

`blocking` rows are enforced by discuss-phase / execute-phase as a mandatory understanding check.

<current_state><immediate context, paths, last commits></current_state>

<completed_work>
- Task 1: <name> - done (commit <h>)
- Task 2: <name> - in_progress, <what's done>
</completed_work>

<remaining_work>
- Task 3: <what's left>
- Task 4: not started
</remaining_work>

<decisions_made>
- <decision>: <rationale>
</decisions_made>

<blockers>
- <blocker>: <status/workaround>
</blockers>

## Required Reading (in order)
1. <doc> — <why>
2. `.soly/METHODOLOGY.md` if it exists — project lenses

## Infrastructure State
- <service/env>: <state>

## Pre-Execution Critique Required
<!-- only if pausing between design and execution -->
- Design artifact: <path>
- Critique focus: <questions>
- Gate: do NOT execute until critique complete + design revised

<context><mental state, plan, what you were thinking></context>
<next_action>Start with: <specific first action></next_action>
```

Specific enough that a fresh worker can resume without re-deriving from git history.

**6. Commit:**
```bash
git add .soly/HANDOFF.json <handoff-md-path>
git commit -m "chore(soly): pause work — create handoff"
```

**7. Return:**
```
Handoff created:
  - .soly/HANDOFF.json
  - <handoff-md-path>
State: <context>, <location>, task <x>/<m>, in_progress, <n> blockers (<m> human)
Resume: `soly resume`
```

</process>

<hard_rules>
- No production code. Handoff only.
- A summary with `TBD`/`placeholder`/`To be filled` is incomplete — report it.
- `null` is JSON `null`, not the string `"null"`.
- Do not modify `.soly/rules/`. Do not run subagents (you ARE one).
- Commit message: `chore(soly): pause work — create handoff`.
- Return: paths, state summary, blocker count, `soly resume` command.
</hard_rules>
