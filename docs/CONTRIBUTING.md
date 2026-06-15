# Contributing

## Local setup

```bash
git clone http://git.local.stbl/<org>/pi-soly.framework.git
cd pi-soly.framework
bun install
```

## Workflow

1. Create a feature branch from `main`
2. Make changes
3. Run tests + typecheck locally: `bun run ci`
4. Push branch: `git push origin feature/my-change`
5. Open a PR (or merge request) on Forgejo
6. CI runs `bun test` + `bun run typecheck` on all 4 packages
7. After review + merge, tag a release:

```bash
# Bump version and tag
./scripts/release.sh soly 0.2.1
git push origin --follow-tags
```

The release workflow verifies the version matches the tag, then runs your
npm-publisher agent to push the package to your Forgejo package registry.

## Adding a new extension

1. Create `packages/<name>/` with:
   - `package.json` (use one of the existing as a template)
   - `index.ts` (default-exported `piExtension(pi: ExtensionAPI)`)
   - `tests/`
   - `README.md`
   - `.gitignore`
2. Add it to the root `workspaces` in `package.json`:
   ```json
   "workspaces": ["packages/*"]
   ```
3. Update root `README.md` and `CHANGELOG.md`
4. Submit a PR

## Cross-extension conventions

- **Agent switcher**: `globalThis.__PI_SWITCH_AGENT__` (set by pi-switch, read
  by other extensions that need to know the current subagent). Fall back to
  `"worker"` if pi-switch isn't installed.
- **Todo tracker**: `globalThis.__PI_TODO_AGENT__` (similar pattern, set by
  pi-todo if other extensions want to inject todo updates programmatically).
- **Persistence**: prefer `.soly/agent`, `.soly/todos.json` etc. for soly-aware
  projects. For non-soly contexts, use `~/.pi-<ext>/<file>` as fallback.

## CI

CI runs on every push to `main` and on PRs. The `ci.yml` workflow:
1. Installs workspace deps
2. Runs `bun test` (all 4 packages)
3. Runs `bun run typecheck` (all 4 packages)

A failing CI blocks merge.

## Releases

Releases are tag-based. The `release.yml` workflow:
1. Triggers on tags matching `<package>-v<version>` (e.g. `soly-v0.2.1`)
2. Verifies the package.json version matches the tag
3. Runs the npm-publisher agent (configurable per-forgejo setup)

Per-package versioning: each package versions independently. If you change
both `soly` and `pi-switch`, create two tags.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License (see [LICENSE](../LICENSE)).
