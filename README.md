# pi-soly.framework

A monorepo for the **pi-soly framework** — a project management system for
[pi-coding-agent](https://github.com/nicobailon/pi-coding-agent), plus three
companion UI extensions. Built with **bun workspaces**, CI on a self-hosted
[Forgejo](https://forgejo.org/) runner, packages distributed via
[npmjs.com](https://www.npmjs.com/).

The main product is **`pi-soly`** — a GSD-inspired workflow engine with
intent docs, ROADMAP/STATE/CONTEXT/SUMMARY cycle, and subagent-driven
execution. The other three are UI extensions that complement it:
`pi-asked` (multi-question picker), `pi-todo-list` (live task list),
`pi-agented` (agent switcher + task-routing heuristics).

## Packages

| Package | npm name | Description |
|---|---|---|
| [`packages/pi-soly`](./packages/pi-soly) | `pi-soly` | Project management — plans, state, subagent-driven execution. |
| [`packages/pi-ask`](./packages/pi-ask) | `pi-asked` | Claude Code-style multi-question picker (`ask_pro` tool). |
| [`packages/pi-todo`](./packages/pi-todo) | `pi-todo-list` | Live, user-visible task list rendered in the footer (`todo_update` tool). |
| [`packages/pi-switch`](./packages/pi-switch) | `pi-agented` | Subagent switcher (header bar, `Ctrl+Shift+S` cycle, `/agent` slash command). |

> Directory names (`pi-ask`, `pi-todo`, `pi-switch`) are the **forgejo tag
> prefixes**; npm package names are the published form (`pi-asked`,
> `pi-todo-list`, `pi-agented`). The release workflow reads the **directory**
> from the tag and the **npm name** from `package.json`.

## Installation

Each extension is a standard **pi package** (declared in the `pi` field of
its `package.json`) and installs via the npm registry:

```bash
# Install any subset
pi install npm:pi-soly
pi install npm:pi-asked
pi install npm:pi-todo-list
pi install npm:pi-agented
```

The first install copies the package into `~/.pi/agent/npm/` (user scope)
or `.pi/npm/` (project scope, when added to `.pi/settings.json`). pi
auto-discovers the extension on next session start.

## Cross-extension compatibility

Extensions are loosely coupled and degrade gracefully:

- **`pi-soly` ↔ `pi-agented`**: `pi-soly` reads the current agent from
  `globalThis.__PI_SWITCH_AGENT__` (set by `pi-agented`) when launching
  subagents for plan execution. If `pi-agented` isn't installed, `pi-soly`
  falls back to the built-in `"worker"` agent.
- **`pi-soly` ↔ `pi-todo-list`**: `pi-soly` workflow templates tell the
  LLM to call `todo_update` (from `pi-todo-list`) when it's available.
  Optional — `pi-soly` works without it.
- **`pi-agented` discovers soly agents**: when
  `useSolyWorkerSubagents: true` in `.soly/config.json`, `pi-soly`
  installs `soly-worker.md`, `soly-debugger.md`, etc. into
  `~/.pi/agent/agents/`. `pi-agented` then includes them in its cycle.

## Development

### Requirements

- [Bun](https://bun.sh) (latest)
- [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent)

### Setup

```bash
git clone http://git.local.stbl/lowern1ght/pi-soly.framework.git
cd pi-soly.framework
bun install
```

### Run all tests + typecheck

```bash
bun test          # 320+ tests across 4 packages
bun run typecheck # tsc --noEmit via root tsconfig (project references)
bun run ci        # both
```

### Live-reload in pi (no rebuild)

```bash
# From the monorepo root — symlink each package into pi's extension dir
mkdir -p ~/.pi/agent/extensions
for pkg in packages/*/; do
  name=$(basename "$pkg")
  ln -sfn "$(pwd)/$pkg" "$HOME/.pi/agent/extensions/$name"
done
```

> Note: Windows symlinks need admin/Developer Mode. On Windows, prefer
> the bundled `pi install ./packages/<pkg>` instead, then re-run
> `pi install ./packages/<pkg>` after edits to refresh.

After edits in `packages/<name>/`, run `pi install ./packages/<name>` to
re-copy, or restart the pi session to pick up changes.

## Releasing a new version

Each package versions independently. The release workflow runs on **tag
push** matching `*-v*` (e.g. `pi-soly-v0.2.2`).

```bash
# 1. Bump version in the package's package.json
./scripts/release.sh pi-soly 0.2.2

# 2. Push the commit and force-push the tag
git push origin master
git push origin pi-soly-v0.2.2 --force

# What happens on the runner:
#   1. ci.yml fires (tag push matches the trigger)
#   2. "test" job: bun install + bun test + bun run typecheck
#   3. "publish" job (only on tag push):
#        - detect package from tag (pi-soly-v0.2.2 → pi-soly)
#        - verify package.json version matches tag
#        - configure .npmrc at monorepo root with NPM_TOKEN
#        - npm publish --access public
#   4. Package appears at https://www.npmjs.com/package/<name>
```

Required forgejo secret (Settings → Secrets → Actions):
- **`NPM_TOKEN`**: an npmjs.com access token with **Automation** scope (or
  "Publish" for the `pi-*` packages). Generate at
  https://www.npmjs.com/settings/~/tokens.

## Architecture

```
┌─ pi-coding-agent (bundled, peerDep)
│
├─ pi-soly (project management)
│   ├─ Intent docs (.soly/docs/) — user's vision, locked
│   ├─ ROADMAP.md — phases table
│   ├─ STATE.md — current position + decisions log
│   ├─ phases/<N>-<slug>/ — CONTEXT, RESEARCH, PLANs, SUMMARYs
│   └─ iterations/ — per-execution context bundles (LLM input)
│
├─ pi-asked (multi-question picker, ask_pro tool)
│   └─ Tabbed UI: single-select, multi-select, recommended ⭐, Other… input
│
├─ pi-todo-list (live task list, todo_update tool)
│   └─ Renders in pi's footer as: todos 2/5 (current action)
│
└─ pi-agented (agent switcher)
    ├─ Header bar shows current agent
    ├─ Ctrl+Shift+S to cycle
    ├─ /agent create/doctor/recommend slash commands
    └─ Reads ~/.pi/agent/agents/*.md for cycle order
```

## CI / CD

A single `ci.yml` workflow (`.forgejo/workflows/ci.yml`) handles both test
and publish:

| Trigger | Job | Action |
|---|---|---|
| Push to `master` | `test` | `bun install` + `bun test` + `bun run typecheck` |
| Push tag `*-v*` | `test` → `publish` | tests + verify version + `npm publish` to npmjs |

The `publish` job is gated by `if: startsWith(github.ref, 'refs/tags/')` —
it only runs on tag pushes.

Runner is a self-hosted forgejo runner on `100.100.100.31` with the
label `docker:docker://node:lts`. Container jobs run in
`node:lts` images; `bun` is installed via the
`https://code.forgejo.org/oven-sh/setup-bun@v1` action.

## Versioning

Each package versions independently. We use [semver](https://semver.org/):

- `0.x.y` — pre-1.0, breaking changes are fine
- `1.0.0` — stable API
- `1.x.y` — additive features, backwards compatible
- `2.0.0` — breaking changes

When one package changes in a way that affects another (e.g. pi-soly
reads a new `__PI_SWITCH_AGENT__` field), bump both in the same release.

## License

MIT
