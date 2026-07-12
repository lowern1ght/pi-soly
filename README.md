![banner](packages/pi-soly/.assets/banner.png)

<div align="center">

# ⚡ pi-soly

[![npm version](https://img.shields.io/npm/v/@dot-stbl/soly.svg)](https://www.npmjs.com/package/@dot-stbl/soly)
[![npm downloads](https://img.shields.io/npm/dm/@dot-stbl/soly.svg)](https://www.npmjs.com/package/@dot-stbl/soly)
[![CI](https://img.shields.io/github/actions/workflow/status/lowern1ght/pi-soly/ci.yml)](https://github.com/lowern1ght/pi-soly.framework/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/lowern1ght/pi-soly.framework/blob/master/LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built_with-Bun-f9f1e1?logo=bun)](https://bun.sh)

[Install](#install) · [Commands](packages/pi-soly/README.md#commands) · [Architecture](packages/pi-soly/README.md#architecture) · [Releases](packages/pi-soly/README.md#releases)

</div>

## Install

```bash
pi install npm:pi-soly
```

Then in pi:

```text
/sly init           # scaffold a new project (.agents/, docs/, rules/)
soly new feat/foo   # create a plan branch
soly execute feat/foo
soly done feat/foo  # commit + push + open draft PR
```

Full documentation (commands, rules engine, architecture, compatibility,
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
| **2.2.5** | Root README is a clean landing page (banner visible) |
| **2.2.4** | Hero `banner.png` in `.assets/` |
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
