<div align="center">

# ⚡ pi-soly

### Project management + workflow engine for [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent)

[![npm version](https://img.shields.io/npm/v/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![npm downloads](https://img.shields.io/npm/dm/pi-soly.svg)](https://www.npmjs.com/package/pi-soly)
[![CI](https://img.shields.io/github/actions/workflow/status/lowern1ght/pi-soly/ci.yml)](https://github.com/lowern1ght/pi-soly/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/lowern1ght/pi-soly/blob/master/LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built_with-Bun-f9f1e1?logo=bun)](https://bun.sh)

[Install](#install) · [Commands](packages/pi-soly/README.md#commands) · [Architecture](packages/pi-soly/README.md#architecture) · [Releases](packages/pi-soly/README.md#releases)

</div>

![banner](packages/pi-soly/.assets/banner.png)

> Plans · State · MANDATORY rules · Self-review · Multi-question picker.
> One `npm install`. Zero config. LLM drives the workflow inline.

---

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

That's it. Restart the pi session, then:

```text
/sly                # open the project picker (aliases: /soly, /s)
/sly init           # scaffold a new project (.agents/, docs/, rules/)
```

**Full documentation** (commands, rules engine, architecture, compatibility,
development) lives in [packages/pi-soly/README.md](packages/pi-soly/README.md).

## Layout

```text
pi-soly.framework/                 monorepo root
├── packages/pi-soly/              the published package
│   ├── commands/                  /sly, /soly, /rules, /docs, /why, …
│   ├── workflows/                  soly new / execute / verify / done
│   ├── visual/                     list-panel + chrome primitives
│   ├── built-in-rules/             shipped rules (temp-files.md, …)
│   ├── workflows-data/             prompt markdown the LLM receives
│   └── README.md                  full docs (this page is a landing)
├── README.md                      you are here
└── CHANGELOG.md
```

## Releases

| Version | Highlights |
|---|---|
| **2.2.4** | Hero banner.png in `.assets/` (root README + per-package) |
| **2.2.3** | README reworked (engineer tone); npm description tightened |
| **2.2.2** | `.soly/` legacy removed; `.agents/` is the only path |
| **2.2.1** | `commands.ts` split into per-command modules; `release-discipline.md` rule |
| **2.2.0** | Grouped `/sly` picker; interactive `/sly settings`; aliases `/sly` / `/s` |
| **2.1.5** | Dedicated `## 🔒 Built-in rules (shipped with soly)` block |
| **2.1.4** | Built-in rules system (first rule: `temp-files.md`) |
| **2.1.3** | `ask_pro` read-only summary view before submit |
| **2.1.2** | Info / warning notifications silenced — only errors fire |
| **2.1.1** | Goal-aware verification at end of execute |

Full history: [CHANGELOG.md](./CHANGELOG.md).

## License

MIT — see [LICENSE](./LICENSE).
