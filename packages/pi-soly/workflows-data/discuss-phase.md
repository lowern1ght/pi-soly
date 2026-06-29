# Discuss Phase

<purpose>Reference document for the **interactive** `soly discuss <N>` flow. The
discussion is now driven by the interactive LLM (you) directly — no subagent.
You ask questions via a real UI picker — **`ask_pro` (preferred, one batched
call)**, falling back to `soly_ask_user` (deprecated, one question at a time)
when `ask_pro` isn't available — and `soly_finish_discuss` to write the
canonical CONTEXT.md. For design/architecture forks you may reach for
`decision_deck`, and for a rich visual comparison `html_artifact`. This
markdown is background context, not a strict protocol.</purpose>

<path_discipline>
**All soly-managed files live under `.agents/`.** CONTEXT.md, RESEARCH.md, and the discuss checkpoint all go in `.agents/phases/<NN>-<slug>/`. Never write these to the project root. Use absolute paths.

The iteration context file (path given by the parent in the task prompt) is your single source of truth for intent, STATE, ROADMAP, and any existing phase artifacts. Read it FIRST.
</path_discipline>

<interactive_flow>
**The flow is now interactive, not subagent-based.** The parent (extension) hands you a detailed prompt with the UX protocol. You drive the discussion in the same session:

1. **Read the iteration context file** (path given in the task prompt). It's the single source of truth — do NOT re-read STATE.md, ROADMAP.md, CONTEXT.md separately.

2. **Generate 3-5 phase-specific gray areas** grounded in the intent + ROADMAP row. For each, prepare a question with 2-3 CONCRETE options, ⭐ first = recommended answer, with 1-sentence rationale.

3. **Pick a picker** (the parent's prompt tells you which one is preferred):
   - **`ask_pro`** — multi-question tabbed picker. **PREFERRED**: call ONCE with all questions, returns all answers in one shot. Per question: `multiSelect` (+ `minSelect`/`maxSelect`), `allowOther` (free-text choice), `freeText` (typed answer, no options), per-option `preview` (side panel, code highlighted); the user can press `s` to skip.
   - **`soly_ask_user`** (deprecated — fallback only when `ask_pro` is unavailable) — single-question picker. Call N times, one per question. No `allowOther` support.
   - **`decision_deck`** (optional) — for an architecture/design fork where the choice hinges on the concrete code shape, present the options as full-screen cards (code snippet + pros/cons) instead of a flat list.

4. **Save a checkpoint after each answer** with `soly_save_discuss_checkpoint` so the user can quit and resume. The final `soly_finish_discuss` will delete the checkpoint and write CONTEXT.md.

5. **After all questions captured**, call `soly_finish_discuss` with all decisions. It writes `<phase>-CONTEXT.md` and deletes the checkpoint.

6. **Tell the user the next step**: `soly plan <N>`.

**Resume:** if a checkpoint file exists, the parent detects it and tells you to resume from where the prior session left off. Acknowledge locked decisions at the top of your output, then continue with the next un-answered gray area.
</interactive_flow>

<read_first>`.agents/docs/` (INTENT, 0-point) · `.agents/STATE.md` · `.agents/ROADMAP.md` · `${PHASE_DIR}/*-CONTEXT.md` if exists (refine, don't re-derive) · `${PHASE_DIR}/*-DISCUSS-CHECKPOINT.json` if exists (resume from `areas_completed`)</read_first>

<philosophy>
**User = visionary. Worker = builder.** The user knows: how it should feel, what's essential vs nice-to-have, specific references. The user doesn't know (don't ask): codebase patterns, technical risks, implementation approach, success metrics.

Ask about vision and implementation choices. Capture for downstream.
</philosophy>

<scope_guardrail>
**No scope creep.** Phase boundary from `ROADMAP.md` is FIXED. Clarify HOW, never WHETHER.
- **Allowed:** "How should posts display?" · "What happens on empty?" · "Pull-to-refresh or manual?"
- **Not allowed:** "Should we also add comments?" · "What about search?" — new capability, its own phase.

If the user suggests scope creep: `"[X] would be a new capability — its own phase. Want me to note it for the backlog? For now, focus on [phase domain]."` Capture in `<deferred_ideas>`.
</scope_guardrail>

<gray_area_identification>
Gray areas are implementation decisions the user cares about — could go multiple ways, would change the result.

1. Read phase goal from `ROADMAP.md`.
2. Identify the domain (something users SEE/CALL/RUN/READ/ORGANIZE).
3. Generate phase-specific gray areas — **not** generic (UI/UX/Behavior).

Examples:
- Auth → Session handling · Error responses · Multi-device policy · Recovery flow
- Photo library → Grouping · Duplicates · Naming · Folder structure
- DB backup CLI → Output format · Flag design · Progress · Error recovery
- API docs → Structure · Example depth · Versioning · Interactivity

**Don't ask about:** implementation details, architecture, performance, scope (roadmap defines).
</gray_area_identification>

<output_protocol>
The `soly_ask_user` tool handles the user interaction. Each call is one round:

- **Picker shows:** title + question + rationale + numbered options. User navigates with ↑/↓/j/k, Enter to confirm, Esc to cancel.
- **Recommended option** (⭐ first) is visually marked so the user can pick it with one keystroke.
- **Rationale** is shown above the picker — this is the most important UX element, it shows the user that you've thought about the trade-off.
- **After answer**: tool returns the chosen option text. You acknowledge, save a checkpoint, and call `soly_ask_user` for the next question.

When all questions are captured, call `soly_finish_discuss` with all the collected decisions. It writes the canonical `<phase>-CONTEXT.md` per the schema below and deletes the checkpoint file.

The OLD subagent output protocol (with `## Gray Areas — Round N`, etc.) is **no longer used**. The picker replaces it.
</output_protocol>

<process>

**1. Initialize.** Compute state via `bash` (no SDK):

```bash
PHASE=$1
# Worker subagent inherits the parent's cwd (the project root), so
# `pwd` IS the project root. The previous `cd .. && pwd` was a bug.
PROJECT_ROOT="$(pwd)"
SOLY_DIR="$PROJECT_ROOT/.agents"
PHASE_DIR=$(ls -d "$SOLY_DIR/phases/"*"-$PHASE-"* 2>/dev/null | head -1) || { echo "Phase $PHASE not found" >&2; exit 1; }
PADDED_PHASE=$(printf "%02d" "$(echo "$PHASE" | grep -oE '^[0-9]+' | sed 's/^0*//')")
PHASE_SLUG=$(basename "$PHASE_DIR")
HAS_CONTEXT=$([ -f "$PHASE_DIR/${PADDED_PHASE}-CONTEXT.md" ] && echo true || echo false)
HAS_RESEARCH=$([ -f "$PHASE_DIR/${PADDED_PHASE}-RESEARCH.md" ] && echo true || echo false)
PLAN_COUNT=$(ls "$PHASE_DIR"/${PADDED_PHASE}-*-PLAN.md 2>/dev/null | wc -l | tr -d ' ')
HAS_CHECKPOINT=$([ -f "$PHASE_DIR/${PADDED_PHASE}-DISCUSS-CHECKPOINT.json" ] && echo true || echo false)
ROADMAP_EXISTS=$([ -f "$SOLY_DIR/ROADMAP.md" ] && echo true || echo false)
```

If `ROADMAP_EXISTS=false` → stop, tell parent "project must be initialized with a roadmap first."

**2. Check blocking anti-patterns.** Read `${PHASE_DIR}/.continue-here.md` if it exists; parse its Critical Anti-Patterns table for `severity = blocking`. For each, include in the next round's output:

```
## Blocking Anti-Patterns (from .continue-here.md)
> Resume agent must demonstrate understanding before proceeding.

### <pattern name>
1. **What is it?** ...
2. **How did it manifest?** ...
3. **Structural prevention:** ...
```

If you cannot answer from `.continue-here.md`, return `## Clarifications Needed` and stop.

**3. Check SPEC.md.** `ls "$PHASE_DIR"/*-SPEC.md 2>/dev/null | grep -v AI-SPEC | head -1`. If exists: read, count `## Requirements`, treat as locked — do NOT re-ask WHAT/WHY, only HOW. Add to `## Decisions Locked`.

**4. Resume / continue / fresh.**

| state | action |
|---|---|
| checkpoint exists | parse `decisions` + `areas_completed`; acknowledge locked; continue from first un-answered area |
| CONTEXT.md exists, no checkpoint | "refine" mode — list existing decisions, surface only uncovered gray areas |
| PLANs exist, no CONTEXT.md | warn in round 1: `## Heads Up — <N> plan(s) exist without user context. Decisions here won't affect them unless you replan. To proceed anyway, just answer. To abort, stop here.` |
| (none) | fresh — initialize phases 5–9 from scratch |

**5. Load prior context.** Read in this order, deduplicating:

```bash
[ -f "$SOLY_DIR/PROJECT.md" ] && echo "PROJECT.md"
[ -f "$SOLY_DIR/REQUIREMENTS.md" ] && echo "REQUIREMENTS.md"
[ -f "$SOLY_DIR/STATE.md" ] && echo "STATE.md"
[ -f "$SOLY_DIR/DECISIONS-INDEX.md" ] && echo "DECISIONS-INDEX.md (prefer over per-phase if present)"
```

Most-recent 3 prior `*-CONTEXT.md` files (prefer DECISIONS-INDEX if present). Extract `<decisions>`, `<specifics>`, and patterns (e.g., "user prefers minimal UI"). If `.agents/spikes/MANIFEST.md` or `.agents/sketches/MANIFEST.md` exist with `WRAPPED: true` frontmatter, read as validated findings.

**6. Cross-reference todos.** (Worker doesn't have `soly_todos`; use `bash` + `grep` with phase-domain keywords.)

```bash
KEYWORDS="<phase-domain-keywords>"  # e.g. "auth|login|session"
grep -rnE "TODO|FIXME|XXX" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.go" "$PROJECT_ROOT" 2>/dev/null \
  | grep -iE "$KEYWORDS" | head -20
```

Present matches; user picks folded (→ CONTEXT.md `<folded_todos>`) vs reviewed-not-folded (→ `<reviewed_todos>`).

**7. Scout codebase.** (No SDK; pure bash/find/grep.)

```bash
ls "$SOLY_DIR/codebase/" 2>/dev/null
find "$PROJECT_ROOT/src" -maxdepth 3 -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.py" \) 2>/dev/null | head -20
```

Build a small `<codebase_context>` block (≤ 10 lines) of reusable assets/patterns. Use to annotate gray areas ("you already have a Card component with shadow/rounded variants — reusing it keeps the app consistent").

**8. Analyze phase.** Grounded in `<prior_decisions>`, `<codebase_context>`, `<locked_requirements>`. Produce:
- **Domain boundary** — what this phase delivers, what it does NOT.
- **Canonical refs accumulator** — every doc/spec/ADR the planner will need (ROADMAP refs, REQUIREMENTS, anything the user references). Full relative paths. MANDATORY in CONTEXT.md.
- **Already-decided gray areas** — skip from `<prior_decisions>` + `<locked_requirements>`.
- **Gray areas** — 1–2 specific ambiguities per relevant category.
- **Skip assessment** — if no meaningful gray areas remain, jump to step 11 with `<no_discussion_needed: true>`.

**9. Present gray areas.** Output `## Gray Areas — Round <N>` per output protocol. **3–5 areas/round sweet spot; > 5 → defer the rest to next round.** No "skip" / "you decide" options — give real choices.

**10. Discuss (interactive, one question at a time).**

**PREFERRED**: call `ask_pro` ONCE with all questions as tabs. Returns all answers in one shot. Per question: `header`, `question`, `options[2-4]`, optional `multiSelect` (+ `minSelect`/`maxSelect`), `allowOther` (text input for custom answer), or `freeText: true` for an open typed answer (no options). For a design/architecture fork where the choice turns on the concrete code shape, `decision_deck` (cards with code + pros/cons) reads better than a flat option list.

**FALLBACK** (only if `ask_pro` is unavailable — it is deprecated): call `soly_ask_user` once per question, one at a time. Pattern:

```
soly_ask_user({
  title: "Q1: <category>",
  question: "<one short sentence>",
  options: [
    "⭐ <recommended option> — <1 sentence why>",
    "<alternative 1>",
    "<alternative 2>",
  ],
  rationale: "<1–2 sentence note>",
})
```

After each answer (or once after all answers, for `ask_pro`), call `soly_save_discuss_checkpoint({phase_number, decisions, areas_total, areas_completed})` to enable resume. The user can quit mid-discussion and the next `soly discuss <N>` will pick up from the checkpoint.

If the user cancels a picker (Esc), defer that question and move on — never loop on the same question.

When all questions captured, call `soly_finish_discuss` with all decisions. It writes the canonical CONTEXT.md and deletes the checkpoint.

**11. Write CONTEXT.md** when all areas decided (or explicitly deferred):

```markdown
---
phase: <N>  phase_slug: <slug>  generated: <ISO8601>
areas_completed: <N>  areas_deferred: <N>
---

# <N>: <Name> — Discussion Context

<domain>What this phase delivers, 1–2 paragraphs grounded in ROADMAP + intent.</domain>

<spec_lock><!-- only if SPEC.md was loaded -->
Requirements locked by SPEC.md. Do not re-litigate.
- <req 1>
</spec_lock>

<decisions>
### <Category>
- **Decision:** <what>
  **Rationale:** <why / "user discretion">
  **Source:** Round <N> of `soly discuss <N>`
</decisions>

<canonical_refs> <!-- MANDATORY -->
- `.agents/docs/<file>` — <why>
- `.agents/features/<feat>/README.md` — <why>
- `.agents/contracts/<file>` — <why>
- (no external docs referenced) <!-- only if literally none -->
</canonical_refs>

<code_context>
Reusable assets/patterns the planner should know:
- <path> — <what, why reuse>
</code_context>

<deferred_ideas>Scope-creep items for future phases.</deferred_ideas>

<folded_todos><!-- only if matches found --></folded_todos>
<reviewed_todos><!-- only if matches found --></reviewed_todos>
```

If `spec_lock` present, do NOT duplicate requirements into `<decisions>` — only implementation decisions.

**12. Report.**

- All decided:
  ```
  ## Discussion Complete — Phase <N>
  Created: <path>
  ### Decisions Captured
  - <Cat>: <one-liner>
  ### Deferred
  - <idea> — future phase
  ### Next Step
  `soly plan <N>`
  ```
- More rounds needed:
  ```
  ## Round <N> Complete — Phase <N>
  ### Decisions Captured This Round
  - <Cat>: <one-liner>
  ### Open Questions (<M> remaining)
  - <Area>: <ambiguity>
  ### Next Step
  Re-invoke `soly discuss <N>` to continue. Your next free-text message will be parsed for answers.
  ```

</process>

<checkpoint_schema>
`${PHASE_DIR}/${PADDED_PHASE}-DISCUSS-CHECKPOINT.json`:

```json
{
  "version": "1.0",
  "phase": <N>, "padded_phase": "<NN>", "phase_slug": "<slug>", "phase_dir": "<path>",
  "round": <N>,
  "areas_total": <M>,
  "areas_completed": [<index>, ...],
  "areas_deferred":  [<index>, ...],
  "decisions": [
    {"area": "<n>", "category": "<c>", "choice": "<what>", "rationale": "<why / 'user discretion'>", "round": <N>}
  ],
  "canonical_refs":   ["<path>", ...],
  "codebase_context": ["<line>", ...],
  "deferred_ideas":   ["<idea>", ...],
  "next_action": "await_user_answers | write_context | no_discussion_needed"
}
```

Update after every round. Delete after `write_context` succeeds.
</checkpoint_schema>

<hard_rules>
- No production code. Discussion/planning only.
- No PLAN.md from this workflow — that's `soly plan`.
- Don't assume missing intent. If `.agents/docs/` is silent, ask.
- No scope creep. Deferred ideas → `<deferred_ideas>`, not decisions.
- No subagents (you ARE one). No `.agents/rules/` edits.
- Return: structured output per output_protocol + checkpoint updates. Parent relays to user.
</hard_rules>
