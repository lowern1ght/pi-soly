<div align="center">

# ⚡ pi-soly

**The project management + workflow engine for [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent).**

Plans · State · Rules · Multi-question picker. One `npm install`. Zero config.

[![npm version](https://img.shields.io/npm/v/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![npm downloads](https://img.shields.io/npm/dm/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![CI](https://img.shields.io/github/actions/workflow/status/lowern1ght/pi-soly/ci.yml)](https://github.com/lowern1ght/pi-soly/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/lowern1ght/pi-soly/blob/master/LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built_with-Bun-f9f1e1?logo=bun)](https://bun.sh)

[Install](#-install) · [Commands](#-commands) · [Rules & Docs](#-rules--docs) · [Architecture](#-architecture) · [Releases](#-releases)

</div>

---

## ⚡ Install

```bash
pi install npm:pi-soly
```

Restart pi (`/reload`), and you have:

- **Project management** — plans, state, phases, decisions
- **Workflow engine** — plain-text verbs: `soly discuss` · `plan` · `execute` · `verify` · `pause`/`resume`
- **Self-review loop** — `soly verify` re-reviews the work until "No issues found."
- **Visual chrome** — native footer, equalizer working spinner with live telemetry, gradient welcome banner
- **Rules & docs modal** — `/rules` and `/docs` open a fuzzy list + preview panel (no chat dumps)
- **Mandatory rules** — strict-mode directives injected every turn
- **Multi-question picker** — `ask_pro` tool for the LLM (single/multi-select, free-text, skip)
- **Decision deck** — `decision_deck` tool: full-screen TUI cards for comparing design options by code shape
- **HTML artifacts** — `html_artifact` tool serves self-contained HTML from a per-session browser gallery (live-updating, one stable URL)
- **Skill-based execution** — LLM reads the `soly-framework` skill on demand

The LLM drives execution; `plan`/`execute` delegate to a `worker` subagent when one is available (via pi-subagents), with first-party delegation on the roadmap. You focus on the work.

---

## 🎯 Why pi-soly?

| Without pi-soly | With pi-soly |
|---|---|
| Re-invent plan/state/resume from scratch | `/plan`, `/execute`, `/resume`, `/inspect` ready |
| Forget rules mid-session | `## ⚠️ MANDATORY` header in every system prompt |
| Wonder which rules eat context | `/rules stats` — Claude-memory-style breakdown |
| Wonder which docs eat context | `/docs stats` — same for intent docs |
| Ask the LLM the same clarifying question 5 times | `ask_pro` multi-question picker |

---

## 📋 Commands

### Workflow — plain-text verbs (type `soly <verb>`, not slash)

```bash
soly discuss 3     # talk through decisions before planning phase 3
soly plan 3        # generate PLAN.md for phase 3
soly execute 3     # execute phase 3 (or `soly execute 3.02` for one plan)
soly verify        # self-review loop until "No issues found." (`soly verify stop` to exit)
soly pause         # save a handoff; `soly resume` to pick it back up
soly status        # current position + progress (no LLM round-trip)
```

### State inspection (`/soly`)

```bash
/soly              # interactive picker (📍📄📋💡🔬🗺️📊📁✅⭐🎯🔄⚙️)
/soly position     # where am I in the plan
/soly state        # current STATE.md content
/soly roadmap      # all phases
/soly progress     # phases/plans/tasks done vs total
/soly phases       # list phases
/soly plan [N]     # show plan for phase N
```

### Rules & Docs

```bash
/rules             # interactive list
/rules stats       # context breakdown (always-on vs glob-matched)
/rules analytics   # token analytics + warnings + duplicates
/rules show <name> # show rule body
/rules reload      # re-read all rules
/rules enable <name> / disable <name>

/docs stats        # context breakdown (inline vs preview vs phase-specific)
```

### Setup

```bash
/soly-init                # scaffold .soly/ (templates: minimal|web-app|library|cli)
/soly-migrate             # atomic .soly/ → .agents/ rename (vendor-neutral)
/soly-status              # one-screen health report
/soly-log                 # recent notifications
```

### Debug

```bash
/why              # rules + project state that grounded the last turn
/rulewizard       # interactive guide: rule vs .editorconfig vs linter
```

---

## 🧠 Rules & Docs

Two system-prompt injections, both **opt-in** and **fully observable**.

### Rules — `.soly/rules/` or `~/.soly/rules/`

Markdown files with frontmatter. Three modes:

```markdown
---
description: TypeScript code style
always: true            # loaded every turn
---

Always use `strict` mode. Never use `any`...
```

```markdown
---
description: React component rules
globs: ["**/*.tsx", "**/*.jsx"]   # loaded only when prompt mentions matching file
---

Hooks only at top level. Use memo only for expensive renders...
```

System prompt injection (every turn, after `before_agent_start`):

```markdown
## ⚠️ MANDATORY: soly project rules

**These rules are NON-NEGOTIABLE. Before writing or editing ANY code,
re-read the rules above that apply to the file path you are about to
modify. If a rule contradicts your instinct, the rule wins.**
```

See context breakdown anytime: `/rules stats`.

### Docs — `.soly/docs/` or `~/.soly/docs/`

Zero-point intent docs (your vision, business context). Loaded as **preview only** (180 chars per doc) — cheap. Add `inline: true` to opt-in to full body injection.

```markdown
---
title: Core principles
inline: true     # full body loaded every turn (expensive!)
---

Our core principles are...
```

See context breakdown: `/docs stats`.

---

## 🎤 Multi-Question Picker

`ask_pro` tool for the LLM. Tabbed UI: single-select, multi-select, recommended ⭐, free-text Other.

```ts
ask_pro({
  questions: [{
    header: "Auth",
    question: "How should we store the OAuth refresh token?",
    options: [
      { label: "Encrypted in SQLite",  description: "Survives restart, single-device.", recommended: true },
      { label: "OS keychain",          description: "Native, multi-device via iCloud." },
      { label: "Plain env var",         description: "Simplest, dev only." }
    ]
  }]
})
```

The LLM calls `ask_pro` when it needs structured input. Tab through questions, pick ⭐ options, confirm.
Per-option `preview` shows a side panel (fenced code is syntax-highlighted); `freeText: true` makes a typed-answer question; multi-select takes `minSelect`/`maxSelect`; press `s` to skip a question.

---

## 🃏 Decision Deck

`decision_deck` tool for the LLM. A full-screen TUI deck — one framed card per option, each with a syntax-highlighted code snippet and pros/cons — for design/architecture forks where the choice hinges on seeing the concrete shape, not a label.

```ts
decision_deck({
  title: "State management",
  prompt: "How should modules communicate?",
  options: [
    { title: "Direct calls", summary: "Call modules directly.", pros: ["simple"], cons: ["coupling"] },
    { title: "Event bus", code: "const bus = new Bus()\nbus.emit('x')", lang: "ts",
      pros: ["decoupled"], cons: ["harder to trace"], recommended: true }
  ]
})
```

Flip cards with ←/→ (or 1-N), choose with Enter, Esc to cancel. Native TUI — no browser, no server.

---

## 🖼 HTML Artifacts

`html_artifact` tool for the LLM — soly's local "artifacts". Renders HTML (a full document or just body content, wrapped in a styled light/dark skeleton with good code-block and table styling) to a self-contained file, then serves it from a **per-session HTTP server** with a **live gallery** of every artifact made this session — one stable localhost URL, opened in your browser. (Falls back to opening the file directly if the server is disabled.)

```ts
html_artifact({
  title: "API examples",
  html: "<h2>Usage</h2><pre><code>client.send(msg)</code></pre>"
})
```

Use it when a visual, rendered result beats terminal text (example galleries, comparisons, diagrams). Self-contained only — inline CSS/JS, no external requests. The gallery URL lives only while the pi session runs. Config under `artifacts` (`open`, `dir`, `server`).

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   pi-coding-agent (peer dep)                 │
└────────────────────────┬─────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
  ┌────────────┐                  ┌─────────────┐
  │  ask_pro   │                  │  soly_read  │
  │  picker    │                  │  soly_log_  │
  │  (tool)    │                  │  decision   │
  └────────────┘                  └─────────────┘
        │                                 │
        └─────────────────┬───────────────┘
                          │
                          ▼
                ┌──────────────────┐
                │  Workflow engine │
                │                  │
                │  /plan /execute  │
                │  /resume /inspect│
                │  /discuss /quick │
                │  /soly /why      │
                │  /rules /docs    │
                └────────┬─────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
       .soly/STATE  phases/<N>/   rules/
       (current     CONTEXT,      docs/
        position)   PLAN,         (system
                    RESEARCH)     prompt)
                         │
                         ▼
                ┌──────────────────┐
                │  soly-framework  │
                │  SKILL.md        │
                │                  │
                │  LLM loads on    │
                │  demand \u2014 no  │
                │  subagent layer  │
                └──────────────────┘
```

State lives in `.soly/` — portable, git-friendly, human-readable. Migrate to vendor-neutral `.agents/` with `/soly-migrate` (both supported, `.soly/` shows deprecation warning).

```
.soly/
├── ROADMAP.md           # phase table
├── STATE.md             # current position + decisions log
├── docs/                # 0-point intent docs (preview-loaded)
├── rules/               # rules (glob-matched or always-on)
└── phases/
    └── 01-foundation/
        ├── 01-CONTEXT.md       # domain + decisions for this phase
        ├── 01-RESEARCH.md      # what we looked up
        └── tasks/              # unified model: one dir per task
            └── auth-login-a3f9/
                ├── PLAN.md     # frontmatter: id, kind, status, depends-on
                └── SUMMARY.md
```

> Legacy projects (standalone `NN-MM-PLAN.md` / a `features/` dir) still work; run `soly migrate` to convert them to this layout.

---

## 📚 Events

| Event | When | What we do |
|---|---|---|
| `session_start` | session opens | Install `soly-framework` skill, build initial state |
| `before_agent_start` | every turn | Inject rules + docs sections into system prompt |
| `tool_call` (edit/write) | LLM edits file | Track edited files (silent — used by `/why`) |
| `turn_end` | turn finishes | Refresh rules/state, hot-reload changes |
| `session_shutdown` | session closes | Flush iterators, cleanup |

---

## 🛠 Development

### Requirements

- [Bun](https://bun.sh) ≥ 1.3
- [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent) ≥ 0.78

### Setup

```bash
git clone https://github.com/lowern1ght/pi-soly.git
cd pi-soly
bun install
```

### Test + typecheck

```bash
bun test          # run the test suite
bun run typecheck # tsc --noEmit
bun run ci        # both
```

### Live-reload in pi

```bash
pi install ./packages/pi-soly
# edit files → /reload in pi to pick up changes
```

---

## 🚢 Releases

Tag-based, fully automated. Push a `pi-soly-v*` tag, get a publish.

```bash
./scripts/release.sh pi-soly 1.9.1
git push github master
git push github pi-soly-v1.9.1 --force
```

CI runs on a self-hosted GitHub Actions runner:

| Trigger | Job | Action |
|---|---|---|
| Push to `master` | `test` | `bun install` + `bun test` + `bun run typecheck` |
| PR to `master` | `test` | same |
| Push tag `pi-soly-v*` | `test` → `publish` | tests + `npm publish` to npmjs |

The `publish` job uses GitHub Environment `npm-publish` so `NPM_TOKEN` is only exposed during the publish step. **Zero secrets in workflow YAML.**

---

## 🤝 Compatibility

- **pi-coding-agent** ≥ 0.78
- **Node** ≥ 20 (pre-installed on the runner)
- **Bun** ≥ 1.3 (pre-installed on the runner)
- **OS** — Linux, macOS, Windows (anywhere Bun runs)

---

## 📜 License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**Built by [@lowern1ght](https://github.com/lowern1ght) · Powered by [pi](https://github.com/nicobailon/pi-coding-agent) + [Bun](https://bun.sh)**

[⭐ Star on GitHub](https://github.com/lowern1ght/pi-soly) · [📦 View on npm](https://www.npmjs.com/package/pi-soly) · [🐛 Report a bug](https://github.com/lowern1ght/pi-soly/issues)

</div>