![banner](./packages/pi-soly/.assets/banner.png)

<div align="center">

# ⚡ pi-soly

[![npm version](https://img.shields.io/npm/v/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![npm downloads](https://img.shields.io/npm/dm/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![CI](https://img.shields.io/github/actions/workflow/status/lowern1ght/pi-soly/ci.yml)](https://github.com/lowern1ght/pi-soly/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/lowern1ght/pi-soly/blob/master/LICENSE)

[Install](#install) · [Commands](#commands) · [Rules & Docs](#rules--docs) · [Architecture](#architecture) · [Releases](#releases)

</div>

## What it is

pi-soly turns a plain pi-coding-agent session into a structured project:
**plans** become git branches, **state** lives in `.agents/STATE.md` (visible
to the LLM every turn), and **rules** load automatically into a
`## ⚠️ MANDATORY` block in the system prompt. Workflows (plan / execute /
verify / pause / resume) are first-class slash commands — no LLM round-trip
needed, no external subagent plugin.

The LLM doesn't drive the workflow — *you* do, via `/sly` /
`soly new` / `soly execute`. The LLM is the executor inside that frame,
following the rules and writing to the agreed paths.

## Install

```bash
pi install npm:pi-soly
```

That registers the extension in your current pi session. Restart pi
(`/reload` won't work for a fresh install — you need a session restart
to pick up the new package's `session_start` event), then:

```bash
# inside a pi session:
/sly                # open the project picker (aliases: /soly, /s)
/sly init           # scaffold a new project (.agents/, docs/, rules/)
```

### Manual install (no `pi`)

```bash
cd ~/.pi/agent/npm
npm install pi-soly
```

Then add `"pi-soly"` to your project's `~/.pi/agent/extensions.json` (or
just to `.pi/extensions.json` for project-local).

## Quick start

```text
# 1. Start a project
/sly init
# 2. Scaffold a plan
soly new feat/auth-jwt
# 3. Discuss / flesh out the plan (interactive)
/sly
→ click "plan" → /sly fills out PLAN.md via ask_pro
# 4. Execute (the LLM runs the plan, follows rules, writes SUMMARY.md)
soly execute feat/auth-jwt
# 5. Self-review until clean
soly verify
# 6. Commit + push + open draft PR
soly done feat/auth-jwt
```

![sly picker](./packages/pi-soly/.assets/soly-picker.png)

## Commands

| Slash command | Plain-text verb | What it does |
|---|---|---|
| `/sly` · `/soly` · `/s` | `soly <sub>` | Project state inspection + picker (Status / Inspect / Manage groups) |
| `/rules` | — | Toggle / disable / reload rules; show token breakdown |
| `/docs` | — | Toggle / show intent docs |
| `/why` | — | What rules + state grounded the LLM's last turn |
| `/artifacts` | — | Browse this session's `html_artifact` gallery |
| `/rulewizard` | — | Decide whether a constraint should be a rule, .editorconfig, or linter |
| `/sly settings` | — | Interactive config editor (toggles, enums, numbers) |

| Text verb | What it does |
|---|---|
| `soly init` | Scaffold `.agents/` (templates: minimal / web-app / library / cli) |
| `soly new <slug>` | Create branch + `.agents/plans/<slug>/PLAN.md` |
| `soly discuss <slug>` | Interactive discussion of a plan (uses `ask_pro`) |
| `soly plan <slug>` | Fill out `PLAN.md` via `ask_pro` |
| `soly execute <slug>` | Run the plan (production commits → SUMMARY.md → `status: done`) |
| `soly verify [N]` | Self-review loop until "No issues found" (max N; `soly verify stop`) |
| `soly pause` · `soly resume` | Save / restore a HANDOFF.json snapshot |
| `soly status` · `soly log` | Read-only, no LLM round-trip |
| `soly done <slug>` | Commit + push + open draft PR via `gh` |

## Rules & Docs

**Rules** are markdown files with optional frontmatter. Two locations,
project wins over global:

```text
.agents/rules/             # project — version-controlled
~/.agents/rules/            # global — per-user
.agents/rules.local/        # project-local — gitignored
```

Glob-scoped rules load conditionally (only when the prompt mentions
matching file paths). `always: true` rules load every turn. See the
`.agents/rules/` directory in your soly project for live examples.

![ask_pro picker](./packages/pi-soly/.assets/ask-pro.png)

The `ask_pro` multi-question picker is built into the extension — the
LLM uses it (not the LLM-driven `soly_ask_user`) for `discuss` flow
when the config flag `agent.preferAskPro: true` is set. Single-pick
options get a ⭐ recommended default, multi-select supports
`min/max` bounds, every options question has a free-text "Other…"
escape hatch.

![decision deck](./packages/pi-soly/.assets/decision-deck.png)

The `decision_deck` is for architectural forks — when the LLM needs
to compare global-shape options by code, not by paragraph. Full-screen
cards, side-by-side previews, ⭐ marks the recommended.

## The mandatory block

Every system prompt gets a `## ⚠️ MANDATORY: soly project rules`
section injected after the user's prompt. The LLM is told, in plain
text: these rules are non-negotiable; if a rule contradicts the
LLM's instinct, the rule wins.

```text
## ⚠️ MANDATORY: soly project rules

**These rules are NON-NEGOTIABLE. If a rule contradicts
your instinct, the rule wins.**

### [soly] {10} temp-files.md
# Temporary Files Rule
> **OS-aware temp paths.** Never hardcode `/tmp` — use `os.tmpdir()` …
```

Built-in rules (the `soly` sourceLabel) ship with the extension and have
highest priority — user rules can't override them. `/sly settings` is
the interactive config editor that drives everything else.

![settings panel](./packages/pi-soly/.assets/soly-settings.png)

## Architecture

```text
                      ┌─────────────────────────────────────────┐
                      │            pi-coding-agent               │
                      │  ┌────────────────────────────────────┐  │
   user input  ─────► │  │  soly extension                     │  │ ───► LLM
                      │  │  • session_start  → load state       │  │
                      │  │  • agent_start   → inject rules      │  │
   /sly  ────────────►│  │  • slash commands /sly, /rules, ... │  │
   soly new ────────► │  │  • soly_workflow tool  (LLM-side)   │  │
                      │  │  • built-in rules  (soly/*)          │  │
                      │  │  • visual chrome (top bar, footer)   │  │
                      │  └────────────────────────────────────┘  │
                      │  ┌────────────────────────────────────┐  │
                      │  │  .agents/  (project state)          │  │
                      │  │  STATE.md  ROADMAP.md  plans/         │  │
                      │  │  rules/    docs/    iterations/     │  │
                      │  └────────────────────────────────────┘  │
                      └─────────────────────────────────────────┘
```

State lives in `.agents/`. Files are plain markdown, git-friendly,
human-readable. The LLM reads them, the extension writes them, the
chrome shows them. No external DB, no migrations, no lock file.

For event names and the full dependency list, see
[Architecture](packages/pi-soly/.docs/architecture.md).

## Releases

| Version | Highlights |
|---|---|
| **2.2.2** | `.soly/` legacy removed; `.agents/` is the only path |
| **2.2.1** | `commands.ts` split into per-command modules; `release-discipline.md` built-in rule |
| **2.2.0** | Grouped `/sly` picker (Status / Inspect / Manage); interactive `/sly settings`; aliases `/sly` / `/s` |
| **2.1.5** | Dedicated `## 🔒 Built-in rules (shipped with soly)` system-prompt block |
| **2.1.4** | Built-in rules system (first rule: `temp-files.md` — never hardcode `/tmp`) |
| **2.1.3** | `ask_pro` read-only summary view before submit |
| **2.1.2** | Info / warning notifications silenced — only errors fire |
| **2.1.1** | Goal-aware verification at end of execute |
| **2.0.x → 2.1.0** | `soly_workflow` first-party tool; `soly migrate` verb; `~/.agents/` global config |

Full history: [CHANGELOG.md](./CHANGELOG.md).

## Compatibility

- **pi-coding-agent** `>= 0.78`
- **Node** `>= 20` (we test on 24)
- **Bun** `>= 1.3` for dev — `bun test`, `bun run typecheck`
- **npm** `>= 8` for the published package
- **No OS-specific code** — works on macOS / Linux / Windows (uses
  `os.tmpdir()` etc., never hardcodes `/tmp`)

## Development

```bash
git clone https://github.com/lowern1ght/pi-soly.git
cd pi-soly
bun install
bun test                 # all 600+ tests
bun run typecheck         # tsc --noEmit, both packages
```

Edit a file, then in pi: `/reload` to pick up changes. Live-reload
handles the chrome, rules, and intent-doc watchers.

## License

MIT — see [LICENSE](./LICENSE).
