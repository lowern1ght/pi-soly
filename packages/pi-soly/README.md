<div align="center">

# ⚡ pi-soly

**The project management framework for [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent).**

Plans · State · Subagents · Multi-question picker · Rotor switcher · Live task list.

One `npm install`. Zero config. Pure magic.

[![npm version](https://img.shields.io/npm/v/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![npm downloads](https://img.shields.io/npm/dm/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![CI](https://img.shields.io/github/actions/workflow/status/lowern1ght/pi-soly/ci.yml)](https://github.com/lowern1ght/pi-soly/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/lowern1ght/pi-soly/blob/master/LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built_with-Bun-f9f1e1?logo=bun)](https://bun.sh)

[Install](#-install) · [Features](#-features) · [Docs](#-documentation) · [Architecture](#-architecture) · [Releases](#-releases)

</div>

---

## ⚡ Install

```bash
pi install npm:pi-soly
```

That's it. Restart pi, and you have:

- **A complete project management engine** — plans, state, subagent-driven execution
- **A multi-question picker** — `ask_pro` tool for the LLM
- **A rotor switcher** — `Ctrl+Tab` to cycle, footer pill always visible
- **A live task list** — `todo_update` tool renders in the footer
- **7 soly agents** installed on first run

---

## 🎯 Why pi-soly?

| Without pi-soly | With pi-soly |
|---|---|
| Write your own planning workflow | `/plan`, `/execute`, `/resume`, `/inspect` — ready |
| Manually dispatch subagents | `useSolyWorkerSubagents: true` — automatic routing |
| 3 different packages for pickers/tasks/agents | One package, one config, one install |
| Rotor name as free text in slash commands | Footer pill + `Ctrl+Tab` + `/rotor` picker |
| Re-invent the state machine | `.soly/STATE.md` + auto-managed phases |

---

## 🔥 Features

### 📋 Project Management Engine

GSD-inspired planning and execution. State is the source of truth, not vibes.

```bash
/plan            # generate PLAN.md for the current phase
/execute         # execute plan directly (LLM does the work)
/resume          # pick up a paused session
/inspect         # show current state summary
/discuss 3       # talk through decisions before planning phase 3
```

State lives in `.soly/` — portable, git-friendly, human-readable.

```
.soly/
├── ROADMAP.md           # phase table
├── STATE.md             # current position + decisions log
├── docs/                # 0-point intent docs (your vision, locked)
└── phases/
    └── 01-foundation/
        ├── 01-CONTEXT.md    # domain + decisions for this phase
        ├── 01-RESEARCH.md   # what we looked up
        └── 01-PLAN.md       # ordered steps to execute
```

### 🎤 Multi-Question Picker

Multi-question picker `ask_pro` for the LLM. Tabbed UI: single-select, multi-select, recommended ⭐, free-text Other.

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

### 🎛 Rotor Switcher

Footer pill that's always there. `Ctrl+Tab` to cycle. No popup, no friction.

```
[model]  · ⚡ worker    · todos 2/5: write tests   ← footer, always visible
[model]  ▶ 🐢 oracle    · todos 2/5: write tests   ← after one Ctrl+Tab
[model]  · 🔍 scout     · todos 2/5: write tests   ← after two
```

Agents:
- `worker` — default, full read+write
- `oracle` — read-only decision advisor
- `scout` — codebase reconnaissance
- `researcher` — external docs, ecosystem
- `planner` — architecture and decomposition
- `context-builder` — hands off context to other agents
- `reviewer` — adversarial code review, read-only
- `delegate` — chains agents together

### 📝 Live Task List

`todo_update` tool — renders in the footer as `todos 2/5: current action`.

The LLM can update its own task list mid-turn. You watch progress without re-asking.

```ts
todo_update({
  todos: [
    { content: "Read existing config", status: "completed", priority: "high" },
    { content: "Write new schema",     status: "in_progress", priority: "high" },
    { content: "Add migration",        status: "pending",     priority: "medium" },
    { content: "Update tests",         status: "pending",     priority: "medium" },
    { content: "Run typecheck",        status: "pending",     priority: "low" }
  ]
})
```

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   pi-coding-agent (peer dep)                  │
└────────────────────────┬─────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        ▼                                 ▼
  ┌────────────┐                  ┌─────────────┐
  │  ask_pro   │                  │  todo_      │
  │  picker    │                  │  update     │
  │  (tool)    │                  │  (tool)     │
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
                └────────┬─────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
       .soly/STATE  phases/<N>/   iterations/
       (current     CONTEXT,      (per-exec
        position)   PLAN,         context
                    RESEARCH)     bundle)
                         │
                         ▼
                ┌──────────────────┐
                │  switch/         │
                │  rotor switcher  │
                │                  │
                │  Ctrl+Tab        │
                │  footer pill     │
                │  /rotor picker   │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │  7 soly agents   │
                │                  │
                │  worker (cycle)     │
                │  soly-debugger   │
                │  soly-tester     │
                │  soly-reviewer   │
                │  soly-refactor   │
                │  soly-documenter │
                │  soly-oracle     │
                └──────────────────┘
```

---

## 📚 Documentation

- **Slash commands** — `/plan`, `/execute`, `/resume`, `/inspect`, `/discuss <N>`, `/quick <task>`, `/rotor`
- **Tools** — `ask_pro(question[])` and `todo_update(todo[])`
- **Events** — `session_start`, `before_agent_start`, `message_end`, `tool_call`, `tool_result`
- **State files** — `.soly/STATE.md`, `.soly/ROADMAP.md`, `.soly/phases/<N>-<slug>/<N>-PLAN.md`
- **Soly agents** — installed to `~/.pi/agent/agents/soly-*.md` on first run

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
bun test          # 288 tests
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
./scripts/release.sh pi-soly 0.5.9
git push origin master
git push github master
git push github pi-soly-v0.5.9 --force
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
