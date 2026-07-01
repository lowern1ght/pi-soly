# Changelog

All notable changes to the monorepo are documented here.

## [Unreleased]

## [1.16.4] — 2026-06-30

### Added
- **"Corporate reviewer" gap-hunt directive** — new point in
  \`nudge.ts\` workflowPoint and new step in \`workflows/execute.ts\`
  worker instruction. Tells the LLM (a) re-read the entire PLAN.md
  before coding, (b) list every material gap (placement, naming,
  boundary cases, errors, existing instances, tests, rollout),
  (c) surface gaps via \`ask_pro\` with a recommended default + 2-3
  alternatives BEFORE editing a single file. Independent of the
  existing \`confirmBeforeCode\` config (\`scope\` / \`ask\` / \`off\`)
  — runs even when the user said "go", as a final filter not the
  first. The point: plans that look complete often aren't, and
  asking 4 sharp questions with defaults saves a 40-minute rebuild.

### Tests
- +1 in \`tests/nudge.test.ts\` covering the corporate reviewer
  directive. 579/579 pass (was 578).

## [1.16.3] — 2026-06-30

### Added
- **"STUDY THE REPO" directive in the workflow instructions** — tells the
  LLM to use \`soly_snippet\`, \`soly_doc_search\`, and the \`## project layout\`
  section from the system prompt to understand the area before writing
  PLAN.md or editing code. No new modules, no new dependencies — just
  prompt engineering in three places:
    - \`nudge.ts\` workflowPoint: LLM is told to study before scaffolding
      a new plan itself
    - \`workflows/planning.ts\`: \`soly plan <slug>\` instructs the model
      to read the relevant files before fleshing out the plan, and
      surface ambiguities as ask_pro questions
    - \`workflows/execute.ts\`: \`soly execute <slug>\` instructs the
      worker to study the area (the module being modified, one
      adjacent feature, the test file) before changing any code
    - \`workflows/planning.ts\` discuss path: same directive for
      \`soly discuss\` so discussion resolves real code ambiguities
      rather than invented ones

  The point: plans that name concrete files and conventions beat plans
  that pick an arbitrary location and rewrite. The LLM already has
  the read tools — this just makes it use them in the right order.

### Tests
- +2 in \`tests/nudge.test.ts\` covering the STUDY directive and the
  embedded \`defaultBranchPrefix\`. 578/578 pass (was 576).

## [1.16.2] — 2026-06-30

### Fixed (audit pass)
- **\`config.ts\` sanitize was case-preserving** — \`/[^a-z0-9-]/gi\` with
  the \`i\` flag broadens \`[a-z]\` to \`[a-zA-Z]\`, so the negated class
  matched everything except alphanumerics + hyphen (uppercase stayed).
  Result: \`plan.defaultBranchPrefix: "Feature"\` in \`.agents/soly.json\`
  became branch \`Feature/foo\` instead of \`feature/foo\`. Fix:
  lowercase first, then filter (no \`i\` flag on the char class).
- **\`planning.ts\` and \`execute.ts\` couldn't read PLAN.md for
  \`<prefix>/<slug>\` plans** — they computed
  \`planDirAbs = .agents/plans/\${target.name}\` (just the slug) but
  the on-disk dir is \`.agents/plans/<prefix>-<slug>/\`. So
  \`soly plan feature/foo\` after \`soly new feature/foo\` silently
  missed the file. Fix: thread \`prefix\` through the PlanTarget /
  ExecuteTarget types and compute the flattened \`dirSlug\` for the
  on-disk path. Same fix for the discuss path (planning.ts:524).
- **\`PlanTarget\` / \`ExecuteTarget\` carried no \`prefix\`** — once
  consumers needed it for the dir lookup, the union types had to
  gain \`prefix: string | null\`. Updated parser.ts and all tests.

### Tests
- +6 regression tests (5 in \`config.test.ts\` for sanitize, 1 in
  \`workflow-plan-mode.test.ts\` for the flattened dir lookup).
  576/576 pass (was 570).

## [1.16.1] — 2026-06-30

### Added
- **Project-local `plan.defaultBranchPrefix` config** — set in
  `.agents/soly.json` (per-project, not global). Default: `""` (no
  prefix). When set, `soly new <slug>` automatically becomes
  `soly new <prefix>/<slug>`. Use case: a project where the team
  convention is to put all feature branches under `feature/`:
  \`\`\`json
  { "plan": { "defaultBranchPrefix": "feature" } }
  \`\`\`
  Now \`soly new statistic-preparation\` → branch \`feature/statistic-preparation\`,
  plan dir \`.agents/plans/feature-statistic-preparation/\`. The LLM
  reads this value and uses it in its ask_pro prompt when it scaffolds
  a new plan itself.
- **Explicit `<prefix>/<slug>` form in `soly new|plan|execute|done`** —
  user can override the project default: \`soly new fix/login-redirect\`
  becomes branch \`fix/login-redirect\` regardless of the project default.
  Plan dir flattens the slash: \`.agents/plans/fix-login-redirect/`.
  Nested paths (\`feature/sub/auth-jwt\`) are rejected.
- **LLM is taught to ask before scaffolding** — the workflow-routing
  point in \`nudge.ts\` now embeds the actual \`defaultBranchPrefix\`
  value and tells the LLM to propose the full branch name (with the
  default prefix + alternates) via ask_pro before typing \`soly new …\`.

### Migration from 1.16.0
The \`feat/auth-jwt\` form is now parsed as a \`<prefix>/<slug>\` plan
(named \`auth-jwt\`, prefix \`feat\`) instead of being rejected. If you
had workflows that intentionally relied on the 1.15.x hard-rejection of
the \`<type>/<name>\` shape, they still work — \`feat/x\` parses as
prefix \`feat\`, slug \`x\`. The change is from "rejected" to "accepted
as prefix form".

## [1.16.0] — 2026-06-30

### Changed (BREAKING for soly plan/workflow verb input)
- **Dropped `<type>/<name>` prefix from plan names** — was `feat/auth-jwt`,
  now just `auth-jwt`. Branch = slug verbatim, no Conventional-Branches
  type prefix. Reason: `soly new` users tend to give a full descriptive
  name already; the type adds noise without information. The branch list
  itself is the registry of in-flight plans, so the prefix doesn't help
  readers pick.
  Migration: rename existing branches `git branch -m feat/auth-jwt auth-jwt`
  and update `.agents/plans/feat-auth-jwt/` → `.agents/plans/auth-jwt/`.

### Added
- **Workflow verbs as `/soly` slash-command subcommands** — `/soly new foo`,
  `/soly plan foo`, `/soly execute foo`, `/soly discuss foo`,
  `/soly done foo`, `/soly migrate`. Same handlers as the text-command
  path; humans can now drive the lifecycle from the slash picker without
  typing natural language and waiting for the LLM to translate.
- **`/soly plan` is dual-purpose** — no args = show current PLAN.md body,
  args = dispatch to the plan-mode workflow. Same key the state picker
  already had; now also works for the workflow.
- **LLM taught to scaffold plans itself** — the `soly behavioral nudge`
  now includes a workflow-routing point that tells the model:
  - The full plan lifecycle (`new → discuss → plan → execute → done`)
  - That it MAY call `soly new <slug>` itself after asking the user
    via `ask_pro` for the slug name
  - That this is the new path; `<N>` phase form is legacy
- **Reject pure-digit plan slugs** — `soly new 11` is ambiguous (phase
  number vs slug) so we require at least one letter. `soly plan 11`
  still works as the legacy phase-number path.

### Fixed
- **Task-id hex suffix is now case-insensitive** —
  `auth-be-login-A3F9` and `auth-be-login-a3f9` both resolve to the
  same task. The parsed `taskId` is normalized to lowercase hex.
- **Task ids checked before plan slugs** — `auth-be-login-a3f9` is a
  task id (specific trailing-4-hex shape) and wins over the kebab-case
  plan-slug regex that used to gobble it up.

## [1.15.1] — 2026-06-29

### Fixed
- **ask_pro crash on numeric answer** — in `AskProComponent.getCustomString`
  (pickers/ask/picker.ts), the type guard at the top of the function only
  covered `undefined` and `string`. Single-pick answers are numbers, so the
  function fell through to `(ans as AskMultiAnswer).find(...)`, which crashes
  with `TypeError: ans.find is not a function` whenever the user picks a
  numbered option and then navigates the cursor to the "Other…" row (or any
  other path that re-renders with a numeric `currentAns`).
  Regression test added at `tests/ask-picker.test.ts` > "regression:
  getCustomString on numeric answer". Triggered in production right after
  the 1.15.0 release: `pi exiting due to uncaughtException: TypeError:
  ans.find is not a function`.
  Fix: add `if (typeof ans === "number") return "";` as a peer guard.
  Peer helpers `isIndexChecked` and `isCustomStringChecked` already had this
  guard — `getCustomString` was the odd one out.

## [1.15.0] — 2026-06-29

### Added
- **Plan-based workflow** — `soly new <type>/<name>`, `soly plan <type>/<name>`,
  `soly execute <type>/<name>`, `soly discuss <type>/<name>`, `soly done <type>/<name>`.
  Each plan = a git branch (`feat/auth-jwt`, `fix/login-redirect`, etc.) with
  `.agents/plans/<name>/PLAN.md` on that branch. Two developers can work on
  different plans without colliding on `PLAN.md` or `STATE.md`. Implementation
  plan at `.agents/plans/feat-plans-instead-of-phases/PLAN.md`.
- **`soly migrate phases-to-plans`** (W5) — one-shot migration of every
  `.agents/phases/<NN>-slug/plans/PLAN.md` into a `migrate/legacy-<NN>-slug`
  branch with `.agents/plans/legacy-<NN>-slug/PLAN.md`. Re-runnable, idempotent
  per phase (skips phases whose branch already exists).
- **`.gitignore`** — `.agents/rule-mtimes.json` (per-session runtime
  cache) and `.claude/` (pi agent runtime) are now ignored.

### Changed
- **Phase mode is legacy** (W6) — `soly plan 3` / `soly execute 5` (numeric
  phase form) still works for backward compat, but the LLM instruction
  is prefixed with a deprecation notice that points the user at
  `soly migrate phases-to-plans` (one-time) and `soly new <type>/<name>`
  (going forward). Phases no longer get new features.
- **Active plans tracked via git branches** (W4) — the plan registry IS
  the branch list. No separate JSON file to maintain, no merge
  conflicts when multiple plans ship in parallel. `git branch -l "feat/*"`
  etc. shows what's in flight.

### Removed
- **JSON plan-registry idea** (early W4 draft) — replaced with branch
  derivation. Cleaner, no concurrency hazards.

## [1.14.0] — 2026-06-29

### Changed
- **BREAKING: soly state now lives only in `.agents/`.** The legacy `.soly/`
  directory is no longer read or written — `solyDirFor()` resolves to `.agents/`
  unconditionally. Projects created before the rename must be moved by hand:
  `mv .soly .agents`. A one-time `session_start` banner warns when a `.soly/`
  dir is found without an `.agents/`. Config moved to `.agents/soly.json`
  (per-project) and `~/.agents/soly.json` (global) — was `.soly/config.json`.
  Rule sources are now `.agents/rules.local/`, `.agents/rules/`, and
  `~/.agents/rules/` (the `.soly/rules*` sources were dropped). All prompts,
  templates, doc-search roots, intent/docs loaders, iteration bundles, the
  notifications log, and the `soly-framework` skill now reference `.agents/`.
- **`soly init` is now a `/soly` subcommand.** Run `/soly init [template]`
  (template: minimal/web-app/library/cli) instead of the removed standalone
  `/soly-init` command. A bare `/soly` in a project-less dir now points to it.
- **Stronger "ask before coding".** `agent.confirmBeforeCode` is now a level —
  `"scope"` (new default), `"ask"`, or `"off"` (booleans still work: `true` →
  `"scope"`, `false` → `"off"`). At `"scope"`, the behavioral nudge tells the
  LLM to stop coding on assumptions and first batch the decisions only the user
  can make — **placement** (where it lives), **architecture/pattern**,
  **scope**, **interface**, **data** — into a single `ask_pro` call (concrete
  options + a ⭐ recommended default) and wait for answers before touching
  files. Triggers on non-trivial tasks only; skips trivial fixes and
  already-scoped follow-ups. `"ask"` keeps the old lighter go/discuss prompt.
- **`ask_pro` always offers "Other…".** Every options question now
  automatically includes a free-text "Other…" choice (the tool forces
  `allowOther: true`; the LLM no longer has to remember it, and can't omit it),
  so the user can always answer in their own words. `freeText` questions are
  unchanged (already free-form). The `allowOther` parameter is now a no-op kept
  for compatibility.

### Removed
- **`migrate` removed entirely.** Both the `/soly-migrate` dir-migration command
  (`.soly/` → `.agents/`) and the `soly migrate` layout-conversion verb
  (`NN-PLAN` files / `features/` → `phases/<N>/tasks/`) are gone, along with
  their source (`migrate.ts`, `workflows/migrate.ts`) and tests. Legacy layouts
  still load and run alongside the unified model; rename a legacy `.soly/` dir
  manually.
- **`/soly-init` standalone command removed** — folded into `/soly init`.

## [1.13.5] — 2026-06-28

### Fixed
- **MCP no longer crashes pi when ext-apps can't load.**
  `@modelcontextprotocol/ext-apps@1.7.4` statically `require`s
  `@modelcontextprotocol/sdk/types.js` — a subpath `sdk@1.29.0` (ext-apps' own
  peer) dropped from its CJS exports — so importing it threw at module-eval and
  the **unguarded** dynamic `import("./mcp/index.ts")` rejected, taking down the
  whole pi agent (`uncaughtException`). Now:
  - `index.ts` wraps the MCP dynamic import in `try/catch` + `.catch` so a load
    failure is logged, never fatal.
  - new `mcp/ext-apps-bridge.ts` loads `ext-apps/app-bridge` **lazily, once,
    behind a guard**, exposing `getToolUiResourceUri` / `buildAllowAttribute` /
    `resourceMimeType` with safe fallbacks; `preloadAppBridge()` is awaited in
    MCP `session_start` before metadata is built. The four static ext-apps
    imports now point at the bridge.
  Core MCP is unaffected; only the app-bridge UI degrades when ext-apps/sdk are
  version-incompatible. (Note: the earlier "missing peer dep / run `npm install`"
  diagnosis was wrong — this is a version/export break `npm install` can't fix.)
- **`/soly` modal ghosted/duplicated rows on ↑↓ navigation.** The subcommand
  icons were astral / VS16 emoji (📍 🗺️ ⚙️ …) that `visibleWidth` mis-measures,
  overflowing the ListPanel width. Replaced with single-width BMP glyphs
  (◎ ▤ ⊙ ★ ↻ …) — the same family as the footer / `/artifacts` markers fixed
  earlier.

## [1.13.4] — 2026-06-24

### Changed
- **README — documented upstream `pi install` bug workaround**. After
  `pi install npm:pi-soly`, transitive `peerDependencies` (notably
  `@modelcontextprotocol/sdk` required by `@modelcontextprotocol/ext-apps`)
  may be missing from `~/.pi/agent/npm/node_modules/`. Symptom:
  `Cannot find module '@modelcontextprotocol/sdk/types.js'` from
  `ext-apps/dist/src/app-bridge.js`. Fix: `cd ~/.pi/agent/npm && npm install`.
  Tracked upstream — this is a `pi install` behaviour, not a
  pi-soly bug. Future users will see the workaround in the install
  section of the README and can resolve it in one line.

## [1.13.3] — 2026-06-24

### Added
- **Peer-dep structural test** — `tests/integration/pi-install-e2e.test.ts`
  gains a second test that walks every non-optional `peerDependency`
  declared by each of pi-soly's `dependencies` (against the npm registry)
  and fails if any peer isn't reachable in pi-soly's full dep tree.
  Catches the class of bug we hit on 1.13.0: a dep declares a peer
  (`@modelcontextprotocol/ext-apps` peer-requires `@modelcontextprotocol/sdk`),
  we forget to declare it, and `npm install --omit=dev` installs only
  the direct dep. Future deps that add a new peer will fail this test
  with a clear "add X to dependencies" message before they ship.
  Bounded BFS (4 levels deep) with a registry cache to keep it fast.

## [1.13.2] — 2026-06-24

### Fixed
- **Missing runtime deps in published tarball** — 7 packages were
  declared in `devDependencies` but imported at runtime by source
  code, so `npm install --omit=dev` (= `pi install npm:pi-soly`)
  skipped them and consumers hit `Cannot find module` on first load.
  Moved to `dependencies`:
  - `@earendil-works/pi-ai` (`tools.ts` imports `StringEnum`;
    `mcp/sampling-handler.ts` imports `complete` + types)
  - `@modelcontextprotocol/ext-apps` (mcp `metadata-cache.ts`,
    `elicitation-handler.ts`, etc. import `app-bridge`)
  - `@modelcontextprotocol/sdk` (mcp OAuth, sampling, server-manager)
  - `open` (mcp OAuth URL opening in 2 files)
  - `recheck` (mcp `proxy-modes.ts`)
  - `typebox` (`deck/index.ts` and 4 other files)
  - `zod` (mcp `ui-stream-types.ts`)

  **Architecture rule deviation**: the project rule says pi-soly should
  have empty `dependencies`. This release deliberately deviates from
  that rule for these 7 deps. The alternative (lazy dynamic imports
  inside MCP) was a bigger refactor with worse UX (silent failures
  until MCP is actually used). Documented here so the next review
  doesn't undo it without understanding why. Track: if MCP becomes
  optional / tree-shakable in the future, consider switching back to
  lazy imports and dropping these from `dependencies`.

### Added
- **`tests/integration/pi-install-e2e.test.ts`** — E2E test that
  catches this entire class of bug going forward. It:
  1. Packs the current pi-soly into a tarball.
  2. Installs it in a fresh tmp dir with `npm install --omit=dev`
     (mirroring real user install via `pi install npm:pi-soly`).
  3. Runs `bun -e 'import("pi-soly")'` and asserts no
     `MODULE_NOT_FOUND` is reported.
  Previously failed with a list of every missing runtime dep; now
  passes. Runs in ~20s as part of `bun test` (CI). If this test
  ever fails, the missing import is right there in the error.

## [1.13.1] — 2026-06-24

### Fixed
- **Missing `context-manager.ts` in published tarball** — `index.ts` (and
  `workflows/index.ts`, `workflows/verify.ts`) imported
  `./context-manager.ts`, but `package.json#files` didn't list it, so
  every published version from before 1.12.0 onward shipped a tarball
  missing that file. Consumers hit `Cannot find module './context-manager.ts'`
  on import. `bun test` and `tsc --noEmit` both ran from source, so the
  bug was invisible to CI until users installed the package. Added the
  file to `files` (alphabetically, between `config.ts` and `core.ts`).
  **Upgrade is required**: 1.13.0 (and all earlier 1.12.x) are broken
  on import — `npm install pi-soly@latest` now resolves to 1.13.1.

### Added
- **`scripts/check-publish-integrity.mjs`** — packs the package to a
  temp dir, lists every file in the tarball, then walks every source
  `.ts` and checks each `from "./..."` import resolves to a packed
  file (or to a directory packed recursively). Exits 1 with a list of
  missing imports. Wired into the publish job in `.github/workflows/ci.yml`
  via `node scripts/check-publish-integrity.mjs packages/<pkg>` so this
  class of bug can never ship again. Handles TS `.js` → `.ts` import
  convention and `npm pack` / `bun pm pack` / Windows tar quirks.

## [1.13.0] — 2026-06-24

### Added
- **Pre-action rule reminder** — for every `edit`/`write` tool call, soly
  now appends a compact list of rules applicable to the file just
  changed to the tool's result. The LLM is asked to confirm in its
  next message which rules were applied (or why not). Closes the gap
  where MANDATORY rules loaded at the start of a turn are forgotten
  by the time the agent actually edits something.
  - Behaviour: top 3 rules by `priority` (high → medium → low →
    unspecified), sorted by `relPath`. Capped to avoid flooding
    per-edit context.
  - Skips when no rules match, when the tool errored, or when
    `agent.preActionRuleReminder` is `false`.
  - Helpers in `core.ts`: `getApplicableRulesForFile(path, rules)`
    and `formatRuleReminder(rules, filePath, cap=3)`.
- **`agent.preActionRuleReminder` config flag** (default `true`) —
  opt-out for projects with very large rule sets that would
  otherwise flood per-edit context.

## [1.12.2] — 2026-06-24

### Changed
- **Added global/local + counterweight vocabulary** to `decision_deck`
  and `ask_pro` descriptions and the per-turn `toolHints` rule. The
  prior 1.12.1 wording ("code + pros/cons per option") was concrete
  but missed the higher-level distinction the user cares about:
  - `decision_deck` = **global** architectural fork with real
    **counterweight** between options (trade-offs that genuinely
    pull in different directions — e.g. consistency vs availability,
    sync vs async).
  - `ask_pro` = **local** sub-question inside an already-decided
    theme, simple label-vs-label «или/или», or 2+ related questions
    in one batch.
- Hint now reads **"Default to `ask_pro` unless the stakes are
  global"** and explicitly mentions `global` / `counterweight` as
  the contrast words.

No API change, no new fields — only the LLM-facing contract strings.

## [1.12.1] — 2026-06-24

### Changed
- **Clarified `decision_deck` vs `ask_pro` tool descriptions** so the LLM
  reaches for the right picker. Hard rules now live in **both** tool
  descriptions and the per-turn `toolHints` rule:
  - `decision_deck` = strictly **ONE question** per call, options need
    code + pros/cons, "for 2+ related questions, use `ask_pro` instead".
  - `ask_pro` = **default** for simple label-vs-label choices and any
    flow with 2+ related questions; names `decision_deck` as the
    contrast for the architectural-fork case.
  - Hint steers with **"default to `ask_pro` unless you have explicit
    code or trade-offs per option"** and **"never use `decision_deck`
    for 2+ questions"**.
- **`tests/tool-hints.test.ts` rewritten** to lock in the new contract
  (deck branch must name `ask_pro` as the contrast even when
  `ask=false`; ask branch must name `decision_deck` as the wrong tool).
  The old test had codified the gap that hid the deck-vs-ask_pro
  distinction from the LLM.

No API change, no new fields, no runtime dependencies — only the
LLM-facing contract strings.

## [1.12.0] — 2026-06-24

### Added
- **Visual chrome** — native, dependency-free status layer: custom footer, top
  bar, equalizer working spinner with live telemetry (elapsed · ↑↓ tokens ·
  tok/s), and a gradient welcome banner. Config under `chrome`.
- **`soly verify`** — self-review loop (re-review until "No issues found." or a
  cap; `fresh`-context mode), built on a new single-owner `context` channel.
- **`/rules` / `/docs` modal** — overlay list panel (fuzzy search, live preview,
  in-place enable/disable/reload) instead of chat dumps.
- **`decision_deck`** — native full-screen TUI deck for design/architecture
  forks: one framed card per option with a syntax-highlighted code snippet and
  pros/cons; flip with ←/→ or 1-N, choose with Enter.
- **`html_artifact`** — render LLM-supplied HTML (full doc or body fragment,
  themed light/dark) and serve it from a per-project **gallery SPA** (sidebar +
  iframe viewer + filter + theme toggle + live SSE updates) on one stable
  localhost URL — soly's local "artifacts". `id` updates an artifact in place;
  `assets` writes sibling files (images/css/json) the HTML can reference; the
  theme is overridable via `.soly/artifact-theme.css`. Falls back to opening the
  file directly when the server is off. Config under `artifacts` (`open`, `dir`,
  `server`, `theme`, `retentionDays`). **`/artifacts`** browses the gallery from
  the terminal (modal: Enter opens, `g` gallery, `x` delete, `clear` all); a
  `▦ N` footer indicator shows the live count. Artifacts persist **per project**
  (stable temp dir keyed by cwd + an `index.json` manifest), so the gallery
  survives `/reload` and pi restarts; `/artifacts` (or the next artifact) restores it.
- **`/soly`** now opens the ListPanel modal (like `/rules`) with a live preview
  per subcommand and Enter-to-open — replacing the plain picker (and its
  duplicated entries).
- **Tool affordance hints** — when a prompt mentions examples/tables or
  options/compare, the LLM is prompted to **ask first** whether to render the
  result in the browser (`html_artifact` / `decision_deck`) or just as text in
  chat, then proceed; clarifying-question wording points at `ask_pro`. Injected
  for that turn only. Bilingual RU/EN triggers; toggle `agent.toolHints` (default on).
- **Confirm before coding** — for non-trivial tasks the behavioral nudge now
  tells the LLM to state its approach + open questions and ask the user via an
  `ask_pro` picker ("Go — implement" / "Discuss / refine" / "Adjust scope")
  before editing files, instead of diving straight into code. Toggle
  `agent.confirmBeforeCode` (default on).
- **`ask_pro`** gained per-option `preview` (side panel, with fenced code
  syntax-highlighted), per-question `allowOther` (free-text "Other…"),
  `freeText` questions (no options — typed answer), multi-select `minSelect`/
  `maxSelect` bounds, `s` to skip a question, and a cursor that starts on the
  ⭐ recommended option.
- **Top bar** lights up for the active workflow verb (execute/plan/discuss/
  resume/verify).

### Fixed
- soly-framework skill now ships via the `pi.skills` manifest (it never loaded
  by default before).
- execute/plan run inline (with a `soly doctor` check) when the `subagent` tool
  isn't installed, instead of asking for a tool that doesn't exist.
- Phase CONTEXT was emitted twice in plan/exec iteration bundles.

### Changed
- Repositioned: the LLM drives execution and delegates to a `worker` subagent
  when available (dropped the "no subagent layer" framing).
- `execute` close-out now suggests `soly verify`.

### Removed
- Inert `useSolyWorkerSubagents` flag + `__PI_SWITCH_AGENT__` plumbing.
- Redundant `soly_intent` tool; `soly_ask_user` deprecated in favor of `ask_pro`.

## [1.9.1] — 2026-06-XX

### Changed
- **Removed spammy post-turn "Rules check" chat notification** — tracking of
  edited files / applicable rules is preserved internally for `/why`.

## [1.9.0] — 2026-06-XX

### Added
- **`/docs stats`** command — Claude-memory-style breakdown for intent docs
  (inline vs preview-only vs phase-specific). Pure helpers in `intent.ts`:
  `buildIntentStats()`, `formatIntentStats()`.

## [1.8.0] — 2026-06-XX

### Added
- **`/rules stats`** command — Claude-memory-style breakdown for rules
  (always-on vs glob-matched vs disabled). Pure helpers in `core.ts`:
  `buildRulesContextStats()`, `formatRulesContextStats()`.

## [1.7.0] — 2026-06-XX

### Added
- **Post-turn rules check** at `turn_end` — surfaces applicable rules for
  files edited in the turn. (Removed in 1.9.1; tracking preserved for `/why`.)
- **`rulesApplicableToFiles()`** pure helper in `core.ts`.

## [1.6.0] — 2026-06-XX

### Added
- **MANDATORY rules header** in `buildRulesSection()` — every turn the
  system prompt opens with:
  `## ⚠️ MANDATORY: soly project rules` + NON-NEGOTIABLE directive.
- **`tool_call` hook** for edit/write — tracks edited files for post-check.

## [1.5.0] — 2026-06-XX

### Added
- **`/soly` interactive picker** — emoji icons (📍📄📋💡🔬🗺️📊📁✅⭐🎯🔄⚙️),
  defaults to picker when called with no args (was: defaulted to `position`
  silently).
- **E2E tests** (`tests/e2e-commands.test.ts`) — mock pi + invoke handlers,
  14 tests for `/soly`, `/rules`, `/why`, `/soly-migrate`, `/soly-init`.
- **`soly_read` cache** (`tools.ts`) — 30s TTL + mtime check.
- **Graceful STATE.md fallback** — `readDecisions` skips empty/corrupt.

## [1.4.2] — 2026-06-XX

### Added
- **Smoke test** (`tests/smoke.test.ts`) — catches broken imports/function
  calls at load time (Proxy-based mock pi).
- Fixed orphaned `piSwitchExtension(pi)` call left after 1.4.0.

## [1.4.0] — 2026-06-XX

### Removed
- **Rotors entirely** — was: 4 cycle agents (worker/oracle/scout/reviewer)
  wrapped in cycle UI. Removed because pi doesn't support mode cycling well;
  over-engineering.
- **`switch/` directory** — Ctrl+Tab footer pill removed (was: unreliable
  Ctrl+Shift+S → Ctrl+Tab → removed).

## [1.3.0] — 2026-06-XX

### Removed
- **soly-manager subagent** — was: 1 agent with 8 modes. pi doesn't
  support Claude-style plan agents; the LLM executes plans directly via
  slash commands + `soly-framework` skill reference.

## [1.2.0] — 2026-05-XX

### Added
- **`/soly-init`** command — scaffolds `.soly/` with 4 templates
  (minimal|web-app|library|cli).
- **`/soly-migrate`** command — atomic `.soly/` → `.agents/` rename
  (vendor-neutral, AGENTS.md standard).
- **`.agents/` convention** — rules/skills/docs/agents, parallel to `.soly/`.

## [1.1.0] — 2026-05-XX

### Added
- **Notification widget** — `notification.ts` with Box widget using
  `theme.bg("customMessageBg")`.
- **`/soly-log`** command — view recent notifications.
- **`/soly-status`** command — comprehensive one-screen report.
- **Notification history log** (`notifications-log.ts`) — JSONL append
  to `.agents/.soly/notifications.log`.

## [1.0.0] — 2026-05-XX

### Added
- **Migrated CI from Forgejo to GitHub Actions** — self-hosted runner
  on `forgejo.runner-001` (renamed to GitHub Actions runner). Tag-based
  publish via GitHub Environment `npm-publish`.
- **Renamed agents → rotors** — user preference at the time. (Reverted
  to no agents/rotors in 1.4.0.)
- **Cycle agents reduced 8→4** — worker/oracle/scout/reviewer.

## [0.4.0] — 2026-XX-XX

### Changed
- **Monorepo consolidated to a single package**: `pi-soly` now bundles all
  features (project management + multi-question picker + agent switcher)
  as built-in sub-features.
- `pi-ask` files merged into `packages/pi-soly/ask/` (multi-question picker
  is now a built-in feature of `pi-soly`).
- `pi-switch` files merged into `packages/pi-soly/switch/` (agent switcher
  is now a built-in feature of `pi-soly`).
- `pi-todo` package removed entirely.

### Removed
- `pi-todo` — live task list (feature not wanted).

### Deprecated on npmjs.com
- `pi-asked`, `pi-agented`, `pi-todo-list` — superseded by `pi-soly` v0.4.0.
  Install with `pi install npm:pi-soly` instead.

## [0.3.0] — earlier

Initial multi-package release (pi-soly, pi-asked, pi-todo-list, pi-agented).
See git history for full commit details.