# .agents — Development Guide for pi-soly monorepo

> **For AI agents (and humans) working on this codebase.**
> This folder is the single source of truth for **how to develop, test, and release** the pi-soly monorepo and its packages.

## What's here

| Folder | Purpose | When to read |
|---|---|---|
| [`docs/`](docs/) | Architecture, deep dives | When you need to understand **how** something works |
| [`rules/`](rules/) | Hard constraints | Before writing any code — these are non-negotiable |
| [`skills/`](skills/) | Step-by-step playbooks | When you're about to do a specific task (add feature, release, etc.) |

## Read order for new agents

1. **`rules/code-style.md`** — TypeScript rules, naming, imports
2. **`rules/testing.md`** — how to run tests, typecheck, smoke tests
3. **`rules/commits.md`** — commit format, version bumping
4. **`docs/architecture.md`** — what each package does, how they fit together
5. **`docs/dependencies.md`** — what each dep is for, when to add new ones
6. **`skills/extend-soly.md`** — when adding a feature to `pi-soly`
7. **`skills/new-pi-plugin.md`** — when creating a new standalone pi plugin
8. **`skills/release.md`** — before publishing any version

## Quick commands

```bash
# Run all tests
bun test

# Typecheck both packages
bun run typecheck

# Build (no build step — TypeScript is loaded directly by pi)
# No `bun build` needed

# Live reload in pi
# Edit files → `/reload` in pi to pick up changes

# Release new version (see skills/release.md)
./scripts/release.sh <package-name> <version>
# e.g. ./scripts/release.sh pi-soly 1.12.0
```

## Repository layout

```
pi-soly.framework/
├── packages/
│   ├── pi-soly/        — main extension (bundles ask + mcp + intent + workflows + ...)
│   └── pi-keyrouter/   — separate package: API key rotation for any provider
├── scripts/
│   └── release.sh      — tag-based version bump + publish
├── .github/
│   └── workflows/
│       └── ci.yml      — self-hosted runner: test + publish on tag
├── docs/               — user-facing docs (README, CONTRIBUTING)
└── .agents/            — you are here — agent/dev docs
```

## Philosophy

- **Lean by default.** Every feature must justify its existence. If you can't explain why a user needs it in one sentence, it doesn't ship.
- **Native integration preferred.** Use pi's documented APIs (system prompt, slash commands, tools, events) instead of hacking around them.
- **Tests are required.** 366+ tests pass today. Your change shouldn't reduce that number.
- **Typecheck is required.** Both packages use strict TypeScript with `tsc --noEmit` in CI.
- **Vendor-neutral when possible.** soly uses `.agents/` as vendor-neutral convention; `.soly/` is legacy.
