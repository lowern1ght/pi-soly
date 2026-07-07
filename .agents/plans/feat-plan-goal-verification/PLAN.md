# Plan: feat/plan-goal-verification

## Goal

When `soly execute <slug>` finishes its last task, run a goal-aware
verification that reads PLAN.md `## Goal` and `## Acceptance`, compares to
`git diff master..HEAD`, and produces a per-item pass/fail report. If any
acceptance item fails OR the goal is unmet, block the transition to `done`
and append a `## Status` section to PLAN.md with the gap report. Otherwise
write a green `## Status` and let the worker call `soly done`.

Pure LLM review — no `bun/dotnet/pytest`-style mechanical checks (this
plugin is multi-language; mechanical checks would be unreliable). The LLM
walks the diff itself and judges.

## Design decisions (locked from planning)

1. **When** — fires once, at the end of every `soly execute` worker mode
   (task / plan / all-feature), before the worker hands off to `soly done`.
2. **How** — LLM reads PLAN.md + `git diff master..HEAD` and reports each
   acceptance item as `{met, evidence}` plus the goal verdict. No shell
   commands, no test runner, no static analysis tool.
3. **On fail** — block the worker from calling `soly done`. Write a
   `## Status` section to PLAN.md containing `BLOCKED — gaps remain` and
   the per-item report. Worker halts.
4. **Scope** — verification side only. Planning side (`soly plan`'s
   ask_pro gathering) is **not** touched. The stub `## Goal` / `## Steps` /
   `## Acceptance` sections in `new.ts:50–67` are already produced; we
   only read them.
5. **Parsing** — `## Goal` is the first non-empty text block after the
   heading. `## Acceptance` items are `- [ ]` bullets; missing section is
   a hard gap. Unknown sections are ignored.
6. **Status section** — verifier only appends when running. Appended text
   is fenced with a marker comment (`<!-- soly:status:begin -->` /
   `<!-- soly:status:end -->`) so a re-run replaces cleanly without
   duplicating content.

## Steps

1. Add `packages/pi-soly/workflows/goal-verify.ts` with:
   - `parseGoalAndAcceptance(planPath)` → `{ goal, acceptance[] } | { error }`
   - `buildVerificationPrompt(parsed)` → the instruction string to inject
     at the end of the execute worker block
   - `appendStatus(planPath, status)` → idempotent append/replace of the
     `## Status` section between marker comments
   - All exported with their own unit tests (see Acceptance).
2. Wire into `execute.ts` at three sites (task / plan / all-feature worker
   instructions). Each gets the new verification step after the worker's
   own "I'm done" report and before it tells the user to call
   `soly done <slug>`. Use a shared `withGoalCheck(...)` wrapper that
   takes the worker prompt prefix and suffix so we don't diverge by site.
3. Update `packages/pi-soly/workflows/index.ts` only if needed to expose
   the new helper (most likely no change — execute.ts already imports
   from sibling modules).
4. Tests in `packages/pi-soly/tests/goal-verify.test.ts`:
   - parser: happy path, empty Goal, missing Acceptance, malformed
     `- [ ]`, leading whitespace tolerance
   - prompt: contains Goal text, contains every acceptance item as
     `- {item}` line, contains diff instruction
   - status append: idempotent (replace on rerun), preserves user
     content outside the marker comments, appends when marker absent
5. Run `bun test` and `bun run typecheck`. Existing 577 tests stay green;
   new tests cover parser + prompt + append.
6. Update `packages/pi-soly/README.md` "Workflows" section: add a one-line
   mention that execute now performs goal verification on completion.

## Acceptance

- [ ] `parseGoalAndAcceptance` extracts `## Goal` text + each `- [ ]`
      bullet from `## Acceptance` (tests cover: nested imports,
      headings-before-acceptance, multiple Acceptance sections,
      empty/missing Goal and Acceptance sections all return errors)
- [ ] `parseGoalAndAcceptance` returns `{ error: "..." }` (not throws) on
      malformed PLAN.md so the verifier can surface a clean gap report
- [ ] `buildVerificationPrompt` references the Goal text verbatim and
      includes each acceptance item as a verbatim `- <item>` line
- [ ] Verifier instruction is injected at the end of every execute
      worker mode (task / plan / all-feature) — one shared helper,
      three call sites
- [ ] Empty `## Goal` section → verifier writes `BLOCKED` Status and
      halts the worker
- [ ] Missing `## Acceptance` section → verifier writes `BLOCKED` Status
      with reason and halts
- [ ] When all items met: `## Status` is appended showing green verdict,
      nothing blocks, worker can proceed to `soly done`
- [ ] When any item unmet: `## Status` shows `BLOCKED — gaps remain` plus
      per-item `{met, evidence}` report
- [ ] `appendStatus` is idempotent — a second run replaces the previous
      Status block (between marker comments) instead of duplicating it
- [ ] `appendStatus` never touches PLAN.md content outside the marker
      comments
- [ ] No mechanical checks are introduced — no `bun run ci`, no
      `dotnet test`, no `pytest`, no language-specific detection
- [ ] `bun test` passes; existing 577 tests still green
- [ ] `bun run typecheck` passes
- [ ] `## Status` does not exist in the stub `PLAN.md` produced by
      `new.ts` — it's only added by the verifier at end of execute
- [ ] **Headless regression guard**: `goal-verify.ts` MUST NOT import
      `ask_pro`, `decision_deck`, or call `ctx.ui.custom(...)`. Verify
      that the module compiles + a test reads the source and asserts none
      of those symbols appear (string-import grep). Reasoning: in headless
      / RPC / MCP-driver sessions `ctx.hasUI === false` and those tools
      return `{error:"no_ui"}` — the verifier must stay headless-safe by
      construction. A future contributor who adds `import { askPro }`
      to wire a "confirm a gap with the user" path will get a clear
      test failure with the rationale spelled out.

## Status

<!-- soly:status:placeholder — populated by goal-verify.ts at end of execute -->
