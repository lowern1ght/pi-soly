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
- **Workflow engine** — `/plan`, `/execute`, `/resume`, `/inspect`, `/discuss`, `/quick`
- **Mandatory rules** — strict-mode directives injected every turn
- **Multi-question picker** — `ask_pro` tool for the LLM
- **Skill-based execution** — LLM reads the `soly-framework` skill on demand

No agents, no rotors, no mode cycling. The LLM is the executor. You focus on the work.

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

### Workflow

```bash
/plan              # generate PLAN.md for the current phase
/execute           # execute plan directly (LLM does the work)
/resume            # pick up a paused session
/inspect           # show current state summary
/discuss 3         # talk through decisions before planning phase 3
/quick "fix typo"  # one-shot task with HANDOFF-style context
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
        ├── 01-CONTEXT.md    # domain + decisions for this phase
        ├── 01-RESEARCH.md   # what we looked up
        └── 01-PLAN.md       # ordered steps to execute
```

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
bun test          # 366 tests across 24 files
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