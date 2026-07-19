# Project State

> **Generated:** 2026-07-19
> **Branch:** `feat/mode-system` (10 commits ahead of `master`)
> **Latest published:** `pi-soly-v3.0.0-alpha.1` (pending npm approval)
> **Next planned:** `pi-soly-v3.0.0-alpha.2` (mode + settings + tool render)

---

## At a glance

| | Status |
|---|---|
| Last commit | `6cac069 feat(meta): add ROADMAP.md` |
| Branch ahead of master | 10 commits |
| Unit tests | 702/702 pass |
| Typecheck | clean |
| Open uncommitted work | `skin/` WIP (Claude-Code-style input chrome, 258 lines) |
| Git stash | `stash@{0}: feat/docs-knowledge-base WIP` |
| Pending npm publish | `pi-soly-v3.0.0-alpha.1` (tag pushed, awaits GH approval) |
| Open tags in queue | `pi-soly-v3.0.0-alpha.2` (ready to push) |

---

## What's done

### Shipped releases (master)
- v2.5.0–v2.6.1 (8 releases) — agent-coach skill, OSC fix on Windows,
  quota USED%, events to sub-line, mode system foundations
- v3.0.0-alpha.1 (tagged) — rename `pi-soly` → `@dot-stbl/soly`

### On `feat/mode-system` → planned v3.0.0-alpha.2
All 5 bugs fixed, all features complete:

- Mode system (config loader, resolve, persist, picker, system prompt)
- Settings registry (20 settings, TypeBox, sensitivity tiers)
- LLM config tools (`soly-config` read, `soly-settings-set` write)
- Custom tool rendering (`◈` glyph, one-line `format`)
- Tool rename `_` → `-` (15 tools)
- Working indicator: rotating verbs, no token telemetry
- OSC fix: `windowsHide: true` on subprocess
- Sub-line auto-clear after 5s
- ROADMAP.md created

### Bug status (from this branch)
| # | Status | Commit |
|---|---|---|
| #1 Picker semantics (auto-pin phases) | ✅ Fixed | `ad7e834` |
| #2 System prompt integration | ✅ Fixed | `ad7e834` |
| #3 Command gating (plans-vs-phases) | ✅ Fixed | `1121375` |
| #4 `defaultBranchPrefix` removal | ✅ Fixed | `9a9df64` |
| #5 Picker timeout | ✅ Fixed | `b74d415` |

---

## What's next (priority order)

### Blockers for alpha.2 (human steps only)
1. **CHANGELOG entry** for `3.0.0-alpha.2` — ~30 lines covering mode +
   settings + tool render + 4 bug fixes
2. **Push tag** `pi-soly-v3.0.0-alpha.2`
3. **Merge** `feat/mode-system` → `master` (or cut release branch)
4. **Approve npm publish** in GitHub Environments (`npm-publish`)
5. **Deprecate** old `pi-soly`: `npm deprecate pi-soly "Moved to @dot-stbl/soly"`

### Optional for alpha.2
- **`writeSolyConfig` wiring** in `settings/tools.ts` deps — LLM can
  read all 20 settings, but write only the mode layer (~5 settings).
  Not blocking — UI exists via `/soly settings`.
- **Fix real-git integration tests** — pre-existing failure on git ≥2.49
  (default branch `main` instead of `master`). Affects 2 tests in
  `tests/workflow-{new,done,migrate}.test.ts`. Easy: change `git init`
  to `--initial-branch=master`.

### After alpha.2
| Version | Scope |
|---|---|
| v3.0.0-stable | drop `-alpha` after 1 week, no code changes |
| v3.1.0 | Logging (NDJSON + rotation) + recall `feat/docs-knowledge-base` from stash |
| v3.2.0 | **Rulecheck** (user's stated main feature): `auto_check` frontmatter, `kind:grep` provider, `/rules check`, `soly-check` tool, `rulecheck-coach` skill |
| v3.3.0 | Rule authoring wizard (`/rules new` with LLM assist) |
| v3.3–3.4 | Plugin architecture (incremental split of monolithic `index.ts`) |

---

## Uncommitted WIP — `skin/`

`packages/pi-soly/skin/` — new module, 258 lines, **no commit yet**.

**What it is:** Claude-Code-style input chrome (framed input box).
Always-on core soly presentation, independent of `chrome.enabled` toggle.

**Files:**
- `skin/index.ts` (32 lines) — entry: `installSkin(ui)` / `disposeSkin(ui)`
- `skin/box.ts` (79 lines) — framed box rendering
- `skin/editor.ts` (43 lines) — input editor adapter
- `tests/skin-box.test.ts` (104 lines) — tests

**Wiring:** `index.ts` calls `installSkin(ctx.ui)` in session_start,
`disposeSkin(ctx.ui)` in session_shutdown.

**Status:** code complete (presumably), not committed, not part of any
release plan in this handoff. **Decision needed** — finish & commit
as part of alpha.2, or revert and re-design.

---

## Git state

### Branches
- `master` — latest published (alpha.1 base)
- `feat/mode-system` — current, 10 commits ahead, ready for alpha.2 tag
- `feat/docs-knowledge-base` — older branch, has work in `git stash@{0}`

### Tags
- `pi-soly-v2.5.0` … `pi-soly-v2.6.1` — published
- `pi-soly-v3.0.0-alpha.1` — pushed, awaiting npm approval

### Stash
- `stash@{0}` on `feat/docs-knowledge-base` — intent docs grouped index
  + CRUD navigator for `/docs` and `/rules` commands. Recall with
  `git stash pop` when ready (planned for v3.1.0).

---

## References

- [ROADMAP.md](../../ROADMAP.md) — long-form design + version timeline
- [CHANGELOG.md](../../CHANGELOG.md) — full release notes since v1.0
- [HANDOFF.md](../../HANDOFF.md) — detailed handoff for next agent
- [.agents/docs/architecture.md](docs/architecture.md) — system architecture
- [.agents/docs/release-process.md](docs/release-process.md) — tag → CI → npm flow
- [packages/pi-soly/README.md](../packages/pi-soly/README.md) — user-facing docs

---

## Decision log (recent)

- **2026-07-19** — Mode system shipped on `feat/mode-system` (5 bugs
  fixed, 702/702 tests pass). Decision: ship as alpha.2, no split.
- **2026-07-19** — `defaultBranchPrefix` removed from config. LLM now
  asks user via `ask_pro` at scaffold time (see `mode/branch-prompt.ts`).
- **2026-07-12** — Package renamed `pi-soly` → `@dot-stbl/soly`. Org
  `dot-stbl` reserved for future packages (rulecheck, keyrouter, etc.).
- **2026-07-05** — Non-error notifications moved from popups to
  sub-line under Working indicator (5s TTL).
- **2026-06-30** — Tool naming convention locked: dash form
  (`soly-config`), never underscore, never dots — LLM APIs reject dots.