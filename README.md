# pi-soly.framework

A monorepo for the **pi-soly framework** — project management + UI extensions
on top of [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent),
built with **bun workspaces**.

The main product is **`soly`** (project management with plans, state, and
subagent-driven execution). The other three are UI extensions that
complement soly: `pi-ask` (multi-question picker), `pi-todo` (live task list),
`pi-switch` (agent switcher).

## Packages

| Package | Description | Status |
|---|---|---|
| [`soly`](./packages/soly) | Project management with plans, state, and subagent-driven execution | stable |
| [`pi-ask`](./packages/pi-ask) | Claude Code-style multi-question picker (`ask_pro` tool) | stable |
| [`pi-todo`](./packages/pi-todo) | Live, user-visible task list rendered in the footer (`todo_update` tool) | stable |
| [`pi-switch`](./packages/pi-switch) | Subagent switcher with header bar, `/agent` slash command, task→agent heuristics | stable |

## Installation

Each extension can be installed independently:

```bash
# Install all four (one time)
pi install http://git.local.stbl/<org>/pi-soly.framework/raw/branch/main/packages/soly
pi install http://git.local.stbl/<org>/pi-soly.framework/raw/branch/main/packages/pi-ask
pi install http://git.local.stbl/<org>/pi-soly.framework/raw/branch/main/packages/pi-todo
pi install http://git.local.stbl/<org>/pi-soly.framework/raw/branch/main/packages/pi-switch

# Or just the ones you need
pi install http://git.local.stbl/<org>/pi-soly.framework/raw/branch/main/packages/pi-switch
```

(Replace `<org>` with your forgejo org/user. If your forgejo exposes a
download endpoint via `pip`-style `/raw/...`, the URL above works. If it
uses a different layout — e.g. `/api/v1/repos/<org>/<repo>/raw/...` —
adjust accordingly.)

## Cross-extension compatibility

Some extensions depend on others:

- **`soly` ↔ `pi-switch`**: soly reads the current agent from `globalThis.__PI_SWITCH_AGENT__` (set by pi-switch) when launching subagents for plan execution. If pi-switch isn't loaded, soly falls back to `"worker"`.
- **`soly` ↔ `pi-todo`**: soly workflow templates tell the LLM to call `todo_update` (from pi-todo) when it's available. Optional — soly works without pi-todo.
- **`pi-switch` discovers soly agents**: when `useSolyWorkerSubagents: true` in `.soly/config.json`, soly installs `soly-worker.md`, `soly-debugger.md`, etc. into `~/.pi/agent/agents/`. pi-switch then includes them in its cycle.

## Development

```bash
# Install workspace deps
bun install

# Run all tests
bun test
# or
bun run test

# Typecheck all packages
bun run typecheck

# CI (tests + typecheck)
bun run ci
```

### Symlink to pi for live development

```bash
# From the monorepo root, symlink each package into pi's extensions dir
# so pi auto-discovers them on session_start
mkdir -p ~/.pi/agent/extensions
for pkg in packages/*/; do
  name=$(basename "$pkg")
  ln -sfn "$(pwd)/$pkg" "~/.pi/agent/extensions/$name"
done
```

Now edits in `~/code/pi-extensions/packages/soly/` are immediately picked up by pi.

## Versioning

Each package versions independently. We use [semver](https://semver.org/):

- `0.x.y` — pre-1.0, breaking changes are fine
- `1.0.0` — stable API
- `1.x.y` — additive features, backwards compatible
- `2.0.0` — breaking changes

When one package changes in a way that affects another (e.g. soly needs a new pi-switch field), bump both.

## License

MIT
