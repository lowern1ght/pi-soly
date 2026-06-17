<div align="center">

# ⚡ pi-soly

**The project management + workflow engine for [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent).**

Plans · State · Rules · Multi-question picker. One `npm install`. Zero config.

[![npm version](https://img.shields.io/npm/v/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![npm downloads](https://img.shields.io/npm/dm/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![CI](https://img.shields.io/github/actions/workflow/status/lowern1ght/pi-soly/ci.yml)](https://github.com/lowern1ght/pi-soly/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/lowern1ght/pi-soly/blob/master/LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built_with-Bun-f9f1e1?logo=bun)](https://bun.sh)

[Install](#-install) · [Commands](#-commands) · [Rules & Docs](#-rules--docs) · [Releases](#-releases)

</div>

See **[packages/pi-soly/README.md](packages/pi-soly/README.md)** for the full package documentation.

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

## 📋 Quick command reference

| Command | What it does |
|---|---|
| `/plan` / `/execute` / `/resume` / `/inspect` | Core workflow |
| `/soly` | Interactive state picker |
| `/rules stats` | Context breakdown for rules |
| `/docs stats` | Context breakdown for intent docs |
| `/soly-init` / `/soly-migrate` / `/soly-status` | Setup |
| `/why` | Rules + state that grounded the last turn |
| `/rulewizard` | Rule vs .editorconfig vs linter |

See [packages/pi-soly/README.md](packages/pi-soly/README.md) for full details.

---

## 🛠 Development (monorepo)

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