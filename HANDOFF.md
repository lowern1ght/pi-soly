# Handoff — pi-soly framework

> **Pickup guide for the next agent session.**
> Written by the current session on 2026-07-19, after closing all 5 known
> mode-system bugs and shipping ROADMAP.md.
> Read `.agents/STATE.md` first for the at-a-glance status.

---

## TL;DR — what to know in 30 seconds

1. **You are on branch `feat/mode-system`** in repo `C:/Users/bradw/source/stbl/pi-soly.framework`.
2. **702/702 unit tests pass**, typecheck clean.
3. **All 5 known bugs** from this branch are fixed. Nothing is broken.
4. **v3.0.0-alpha.2 is ready** — just needs CHANGELOG + tag push + human npm approval.
5. **The user's #1 stated priority** is **rulecheck** — not mode/settings/UI. See §6.
6. **There is uncommitted WIP** in `packages/pi-soly/skin/` (258 lines). Decide what to do with it before committing anything else.

---

## 1. Branch & git state

```
branch:          feat/mode-system (current)
ahead of master: 10 commits
last commit:     6cac069 feat(meta): add ROADMAP.md
uncommitted:     packages/pi-soly/{index.ts, package.json} modified
                 packages/pi-soly/skin/{box,editor,index}.ts new
                 packages/pi-soly/tests/skin-box.test.ts new
stash:           stash@{0} on feat/docs-knowledge-base — intent index + CRUD nav
latest tag:      pi-soly-v3.0.0-alpha.1 (pushed, awaiting npm approval)
```

**Remotes:**
- `github` → `https://github.com/lowern1ght/pi-soly.git` (public publish target)
- `origin` → `http://git.local.stbl/lowern1ght/pi-soly.framework.git` (local mirror)

**Always push to `github`**, not `origin`. `origin` is for local backup only.

---

## 2. Environment

- **OS:** Windows (use `os.tmpdir()`, never `/tmp` literal)
- **Runtime:** Bun (TypeScript loaded directly, no build step)
- **Test:** `bun test` (×Unit, `bun:test`)
- **Typecheck:** `bun run typecheck` (uses root script, both packages)
- **Package manager:** Bun (no npm/pnpm lockfile)
- **npm publish:** via GitHub Actions self-hosted runner

User explicitly forbids the agent from running dev/watch/serve processes
(`.agents/rules/process/agent-runtime-safety.md`). Build + test only.

---

## 3. Project structure

```
pi-soly.framework/                    monorepo root
├── packages/
│   ├── pi-soly/                      the published package (@dot-stbl/soly)
│   │   ├── commands/                 /soly, /sly, /s, /rules, /docs, /why, /artifacts
│   │   ├── workflows/                new, plan, execute, done, discuss, migrate
│   │   ├── mode/                     mode system (picker, branch-prompt, system-prompt)
│   │   ├── settings/                 registry + tools (soly-config, soly-settings-set)
│   │   ├── visual/                   chrome, working, footer, tool-render, list-panel
│   │   ├── quota/                    poller, registry, format
│   │   ├── ask/                      ask_pro picker
│   │   ├── deck/                     decision_deck cards
│   │   ├── artifact/                 html_artifact
│   │   ├── mcp/                      MCP server adapter (separate entry point)
│   │   ├── skills/                   soly-framework, agent-coach (active injection)
│   │   ├── built-in-rules/           release-discipline.md, temp-files.md
│   │   ├── skin/                     ⚠️ UNCOMMITTED WIP — see §5
│   │   └── index.ts                  main extension entry (~2000 LOC, monolithic)
│   └── pi-keyrouter/                 separate package, doesn't depend on soly
├── scripts/                          release.sh, helpers
├── docs/                             CONTRIBUTING.md only
├── .agents/                          rules, skills, docs, plans, STATE.md
│   ├── STATE.md                      ← current state (soly reads this)
│   ├── docs/                         architecture, dependencies, release-process
│   ├── rules/                        non-negotiable code rules (read first)
│   ├── skills/                       step-by-step playbooks
│   └── plans/                        plan branches (scaffolded by `soly new`)
├── .claude/rules/                    thin pointers to .agents/rules/
├── CHANGELOG.md                      full release history
├── ROADMAP.md                        forward design + version timeline
└── HANDOFF.md                        ← this file
```

---

## 4. What's done (recap)

### Shipped releases
- v2.5.0 → v2.6.1 (8 releases, all on master)
- v3.0.0-alpha.1 (tagged, awaiting npm)

### On `feat/mode-system` (10 commits, ready to tag alpha.2)
| Commit | What |
|---|---|
| `92da10f` | Mode system — config loader (chain resolution + auto-detect) |
| `b74d415` | Mode system — resolve + persist + chrome.data + package.json fields |
| `ad7e834` | Mode system — picker semantics fix + system prompt integration |
| `cbd2c82` | OSC fix (`windowsHide: true`) — Windows ConPTY artifact gone |
| `23ef2ce` | Settings registry + LLM config tools |
| `cad98ef` | Working message — removed telemetry, added rotating verbs |
| `6f85a84` | Custom tool rendering (`◈` glyph) + sub-line indent |
| `67b27d7` | Tool rename `_` → `-` (15 tools) |
| `7ba21c8` | Rename propagated to docs/rules/skills/README |
| `1121375` | Mode-based command gating (bug #3) |
| `9a9df64` | `defaultBranchPrefix` removal (bug #4) |
| `6cac069` | ROADMAP.md |

---

## 5. ⚠️ Uncommitted WIP — `skin/`

**THIS NEEDS A DECISION BEFORE YOU COMMIT ANYTHING ELSE.**

`packages/pi-soly/skin/` — 258 lines, 4 files, no commit yet.

**What it is:** Claude-Code-style input chrome — framed input box.
Always-on core soly presentation, independent of the `chrome.enabled`
toggle in `chrome.data`.

**Files:**
| File | Lines | Purpose |
|---|---|---|
| `skin/index.ts` | 32 | entry: `installSkin(ui)` / `disposeSkin(ui)` |
| `skin/box.ts` | 79 | framed box rendering |
| `skin/editor.ts` | 43 | input editor adapter |
| `tests/skin-box.test.ts` | 104 | tests |

**Wiring already done in `index.ts`:**
- `installSkin(ctx.ui)` called in session_start (right after `chrome.install`)
- `disposeSkin(ctx.ui)` called in session_shutdown (right before `chrome.dispose`)
- `package.json` modified (likely new dep or subpath export)

**Tests:** 104 lines in `skin-box.test.ts` — `bun test packages/pi-soly/` should pass.

**Three possible paths:**
1. **Ship it in alpha.2** — if you can verify the tests pass and the code
   is correct. Likely needs a CHANGELOG entry too.
2. **Revert it** — if it's incomplete or the user wants to defer to v3.x.
   `git checkout -- packages/pi-soly/index.ts packages/pi-soly/package.json`
   `rm -rf packages/pi-soly/skin packages/pi-soly/tests/skin-box.test.ts`
3. **Move to a feature branch** — `git checkout -b feat/skin-input-chrome`
   then commit it as a separate unit. Don't merge to alpha.2.

**My recommendation:** path 1 if tests pass and code is clean; path 3
otherwise. Ask the user before reverting (path 2) — they started it.

---

## 6. The user's stated priorities (READ THIS)

User explicitly said (paraphrased from conversation):

> "главная цель soly — это удобство разработки, планы, фазы и ПРАВИЛА!
> соблюдения правил это самое главное"

Translation: **rules compliance is soly's main purpose**, not mode/plans/UI.
The biggest unimplemented feature is **rulecheck**.

### Rulecheck design (high-level)

soly **does not** reimplement linters/analyzers. It ships:
1. `auto_check` frontmatter block in `.agents/rules/*.md` — declares
   which provider(s) to run against which globs.
2. Built-in `kind:grep` provider — regex over files, no deps.
3. `/rules check` command + `soly-check` LLM tool — run the project's
   rule set, report violations with file:line + suggested fix.
4. Skill `rulecheck-coach` — mirrors `agent-coach` pattern via
   `nudge.ts` active injection: when LLM writes code that would
   violate a known rule, surface the rule + severity before code lands.

Plugins for AST providers ship separately (v3.3+):
- `@dot-stbl/rulecheck-cs` (Roslyn-based, .NET projects)
- `@dot-stbl/rulecheck-ts` (typescript-eslint AST)
- `@dot-stbl/rulecheck-ps` (PowerShell AST)

**Where to start:**
1. Look at `packages/pi-soly/skills/agent-coach/SKILL.md` — it's the
   template for `rulecheck-coach` (active injection via `nudge.ts`).
2. Look at `packages/pi-soly/built-in-rules/` — the rule format spec.
3. Look at `packages/pi-soly/settings/registry.ts` — shows the TypeBox
   schema pattern; rulecheck config will follow the same shape.

**If you're about to start rulecheck:** discuss the design with the user
first via `decision_deck` or `claude-delegate`. Don't just start coding.

---

## 7. Tasks by priority (next agent's to-do)

### Immediate (alpha.2 release)
| # | Task | Estimated | Blocker? |
|---|---|---|---|
| 1 | Decide on `skin/` WIP (§5) | 5 min | yes — gates the tag |
| 2 | CHANGELOG entry for `3.0.0-alpha.2` | 15 min | yes |
| 3 | `git tag pi-soly-v3.0.0-alpha.2` + `git push github pi-soly-v3.0.0-alpha.2` | 1 min | yes |
| 4 | Tell user to merge `feat/mode-system` → `master` | — | yes |
| 5 | Tell user to approve npm publish in GitHub UI | — | yes |
| 6 | Tell user to run `npm deprecate pi-soly "Moved to @dot-stbl/soly"` | — | yes |

### Optional for alpha.2
| # | Task | Estimated | Notes |
|---|---|---|---|
| 7 | Fix real-git tests (`git init --initial-branch=master`) | 10 min | pre-existing |
| 8 | Wire `writeSolyConfig` in `settings/tools.ts` deps | 30 min | LLM-writeable settings |

### After alpha.2
| # | Task | Version |
|---|---|---|
| 9 | Logging (NDJSON + rotation + ring buffer) | v3.1.0 |
| 10 | `git stash pop` → finish `feat/docs-knowledge-base` | v3.1.0 |
| 11 | Rulecheck core (`auto_check` + `kind:grep` + `/rules check` + `soly-check`) | v3.2.0 |
| 12 | `rulecheck-coach` skill (mirrors `agent-coach`) | v3.2.0 |
| 13 | Rule authoring wizard (`/rules new` with LLM assist) | v3.3.0 |
| 14 | Plugin architecture (capability-bag split) | v3.3–3.4 |

---

## 8. Key files to know

| File | Why |
|---|---|
| `ROADMAP.md` | Forward design, version timeline, decision log |
| `CHANGELOG.md` | Full release notes since v1.0 |
| `.agents/STATE.md` | Compact current state (this session's output) |
| `.agents/docs/architecture.md` | How soly is put together |
| `.agents/docs/release-process.md` | Tag → CI → npm flow |
| `.agents/docs/dependencies.md` | Why each dep exists |
| `.agents/rules/code-style.md` | **READ FIRST** — non-negotiable TypeScript rules |
| `.agents/rules/testing.md` | **READ FIRST** — how to run tests, write them |
| `.agents/rules/commits.md` | **READ FIRST** — commit format `[.stbl](<feat/...>)` |
| `packages/pi-soly/index.ts` | Main entry, ~2000 LOC, monolithic — biggest refactor target |
| `packages/pi-soly/config.ts` | SolyConfig shape — recently slimmed (removed `plan`) |
| `packages/pi-soly/mode/` | Mode system files (picker, branch-prompt, etc.) |
| `packages/pi-soly/settings/` | Settings registry + tools |
| `packages/pi-soly/visual/` | Chrome, working, footer, tool-render |
| `packages/pi-soly/skills/agent-coach/` | Template for `rulecheck-coach` |

---

## 9. Tool naming convention (locked)

**Dash form, never underscore, never dots.**

Why: LLM APIs (Anthropic, OpenAI) reject dots in function names.
LLMs are more reliable with dashes than underscores.

Examples:
- ✅ `soly-config`, `soly-read`, `soly-snippet`, `soly-doc-search`
- ❌ `soly_config`, `soly.read`, `soly.readFile`

**Exception:** CHANGELOG.md keeps historical underscore names in old
release entries (immutable record). All new docs/code/skills/README
use dash form.

---

## 10. Notification policy (locked)

**Only errors as popups.** Everything else → `└─` sub-line under the
Working indicator (5s TTL, auto-clears on next agent_start).

Use `chrome.recordEvent(text, level)` from `commands/_helpers.ts`.
Do NOT use `ctx.ui.notify(text, "info" | "warning")` — that's the old
popup path. `ctx.ui.notify(text, "error")` is still allowed for errors.

---

## 11. How to verify "done" before committing

```
1. git diff --stat                                # see what changed
2. bun run typecheck                              # must be clean
3. bun test packages/pi-soly/                     # 702/702 unit tests
   # (real-git tests are pre-existing broken — see ROADMAP §"Known issues")
4. git log --oneline -5                            # verify commit chain
5. git push github <branch>                        # not origin
```

If `bun test` fails on `real-git` tests, ignore — pre-existing git 2.49
`main` vs `master` issue. Run `bun test --exclude "**/real-git*" *` to
filter, or just `git init --initial-branch=master` in the test setup.

---

## 12. Final reminders

- **User is in Russian/English mix.** Russian is preferred for casual
  conversation; English for code/commits/docs. Match the user's last
  language.
- **No dev servers, no watch, no serve.** Build + test only.
  (`process/agent-runtime-safety.md`)
- **Push to `github` remote, not `origin`.**
- **Use `soly` tools (`soly-read`, `soly-doc-search`, `soly-snippet`)**
  for context-gathering, not raw file reads. Bounded snippets beat full
  files.
- **For big design discussions** — use `claude-delegate` skill (separate
  headless Claude Code subprocess) for design research. Use `decision_deck`
  for user-facing architecture decisions.
- **Don't add runtime dependencies to `pi-soly/package.json`** — it
  has empty `dependencies` by design. Reuse from pi's dependency tree.

---

## 13. Quick start (for the next agent)

```bash
# 1. Check where you are
cd "C:/Users/bradw/source/stbl/pi-soly.framework"
git status
git log --oneline -5

# 2. Read the state files (in this order)
cat .agents/STATE.md          # compact current state
cat HANDOFF.md                # this file, detailed pickup guide
cat ROADMAP.md                # forward design

# 3. Verify tests are green
bun run typecheck
bun test packages/pi-soly/    # 702/702 unit tests

# 4. Decide on skin/ WIP (§5)

# 5. Start the highest-priority unblocked task (§7)
```

Welcome back. The state is clean — pick up where this session left off.