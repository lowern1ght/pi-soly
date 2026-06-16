# pi-soly

Project management + UI extensions for
[pi-coding-agent](https://github.com/nicobailon/pi-coding-agent), bundled
in a single npm-installable package.

- `pi-soly` core — GSD-style workflow engine: intent docs, ROADMAP/STATE/CONTEXT cycle,
  subagent-driven execution
- `ask/` — multi-question picker (`ask_pro` tool)
- `switch/` — agent switcher with footer pill (F2 to cycle, `/agent` slash command)
- `todo/` — live task list rendered in the footer (`todo_update` tool)

> Originally shipped as four separate packages (`pi-soly`, `pi-asked`,
> `pi-todo-list`, `pi-agented`). Consolidated into one `pi-soly` package
> starting at `v0.4.0`. The old packages are still on npmjs but no
> longer needed — install `pi-soly` and you get everything.

## Install

```bash
pi install npm:pi-soly
```

The first install copies the package into `~/.pi/agent/npm/`. pi
auto-discovers the extension on next session start. Run `/reload` in pi
after upgrading to pick up the new version without a full restart.

### Local install (for development)

```bash
pi install ./packages/pi-soly
```

This adds a relative path to `~/.pi/agent/settings.json`, so edits in
the source are picked up after `/reload`.

## What's included

| Module | Description |
|---|---|
| **Workflow engine** | `soly_plan`, `soly_execute`, `soly_resume`, `soly_inspect`, `soly_quick`, `soly_discuss` slash commands. State in `.soly/STATE.md`, phases in `.soly/phases/<N>-<slug>/`. |
| **Multi-question picker** | `ask_pro` tool — tabbed picker, single/multi-select, recommended ⭐, Other… free text. |
| **Agent switcher** | `F2` to cycle agents, `/agent <name>`, `/agent create`, `/agent doctor`, `/agent recommend <task>`. Footer pill `· ⚡ worker` always visible. |
| **Task list** | `todo_update` tool — renders `todos 2/5` in the footer with the current action highlighted. |
| **Soly agents** | `soly-worker`, `soly-debugger`, `soly-tester`, `soly-reviewer`, `soly-refactor`, `soly-documenter`, `soly-oracle` — installed on first run into `~/.pi/agent/agents/`. |

## Usage

Inside a pi session:

```bash
/agent                # open agent picker
/agent oracle         # switch to oracle
F2                    # cycle to next agent

/plan                 # start planning a new phase
/execute              # execute current plan
/pause                # pause and save context
/resume               # resume a paused session

ask_pro question=…    # multi-question UI (LLM tool)
todo_update todos=…   # update task list (LLM tool)
```

The footer shows the current agent and todo progress at all times:
```
[model]  · ⚡ worker  · todos 2/5: write tests  · [cwd]
```

## Development

### Requirements

- [Bun](https://bun.sh) (latest)
- [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent) (peer dep)

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
pi install ./packages/pi-soly    # one-time
# then edit files → /reload in pi to pick up
```

## Releasing a new version

The package versions as a single unit now (no more per-package versions).
Release workflow runs on **tag push** matching `pi-soly-v*` (e.g.
`pi-soly-v0.5.3`).

```bash
# 1. Bump version in packages/pi-soly/package.json
./scripts/release.sh pi-soly 0.5.3

# 2. Push commit + tag to both remotes
git push origin master
git push github master
git push origin pi-soly-v0.5.3 --force
git push github pi-soly-v0.5.3 --force

# What happens on the GitHub Actions runner:
#   1. ci.yml fires (tag push matches the trigger)
#   2. "test" job: bun install + bun test + bun run typecheck
#   3. "publish" job (only on tag push):
#        - reads NPM_TOKEN from environment "npm-publish" secrets
#        - detect package from tag (pi-soly-v0.5.3 → pi-soly)
#        - verify package.json version matches tag
#        - configure .npmrc at monorepo root with NPM_TOKEN
#        - npm publish --access public
#   4. Package appears at https://www.npmjs.com/package/pi-soly
```

Required GitHub setup:

- **Repository secret** (optional, for repo-wide access):
  none — we use environment-scoped secrets.
- **Environment** `npm-publish` (Settings → Environments) with secret:
  - **`NPM_TOKEN`** — an npmjs.com access token with **Automation** scope
    (or **Publish**). Generate at
    https://www.npmjs.com/settings/~/tokens.

## CI / CD

A single `ci.yml` workflow (`.github/workflows/ci.yml`) handles test
and publish:

| Trigger | Job | Action |
|---|---|---|
| Push to `master` | `test` | `bun install` + `bun test` + `bun run typecheck` |
| PR to `master` | `test` | same |
| Push tag `pi-soly-v*` | `test` → `publish` | tests + verify version + `npm publish` |

Runner is a self-hosted GitHub Actions runner
(`actions.runner.lowern1ght-pi-soly.pi-soly-runner.service`) on
`100.100.100.31` (same host as the old Forgejo runner), with default
labels `self-hosted, linux, x64`. Bun 1.3.14 and Node 20.20.2 are
pre-installed at `/usr/local/bin` — no setup-bun step needed.

The `publish` job is gated by `if: startsWith(github.ref, 'refs/tags/')`
and uses `environment: npm-publish` so `NPM_TOKEN` is only exposed
during the publish step.

## Architecture

```
pi-coding-agent (bundled, peerDep)
└─ pi-soly (single package)
   ├─ Workflow engine
   │   ├─ Intent docs (.soly/docs/) — user's vision
   │   ├─ ROADMAP.md — phases table
   │   ├─ STATE.md — current position + decisions log
   │   ├─ phases/<N>-<slug>/ — CONTEXT, RESEARCH, PLANs
   │   └─ iterations/ — per-execution context bundles
   ├─ ask/ — multi-question picker (ask_pro tool)
   ├─ switch/ — agent switcher (F2, /agent, footer pill)
   ├─ todo/ — live task list (todo_update tool)
   ├─ agents/soly-*.md — 7 subagent definitions
   └─ workflows/ — execute, plan, resume, inspect, quick
```

## License

MIT
