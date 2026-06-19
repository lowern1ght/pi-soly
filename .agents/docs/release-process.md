# Release Process

## Tag-based publish

We use tag-based publishing. The flow:

```
1. Bump version in packages/<pkg>/package.json
2. Commit with message "release: <pkg> v<version>"
3. Create tag "<pkg>-v<version>" (e.g. pi-soly-v1.12.0)
4. Push tag → triggers .github/workflows/ci.yml "publish" job
5. CI verifies version matches tag
6. CI runs `npm publish --access public`
7. Package appears on npmjs.com
```

## scripts/release.sh

The script automates steps 1-3:

```bash
./scripts/release.sh <package-name> <version>

# Examples:
./scripts/release.sh pi-soly 1.12.0
./scripts/release.sh pi-keyrouter 0.4.0
```

It:
- Updates `packages/<pkg>/package.json` version field
- Creates a single commit: `release: <pkg> v<version>`
- Creates tag `<pkg>-v<version>`
- Prints git push commands

You must run the push manually:

```bash
git push github master
git push github <pkg>-v<version> --force
```

(The `--force` is needed because the release script creates the tag with `git tag` which can fail if a tag with the same name was deleted earlier. Use `--force` for tags only.)

## Copying to local .pi directory

After publishing to npm, the new version needs to be **available locally** for pi to pick up. There are two scenarios:

### Scenario A: User installs via npm command

```bash
pi install npm:pi-soly
```

This downloads the version from npmjs.com into `~/.pi/agent/npm/pi-soly/` automatically. No manual copy needed.

### Scenario B: User installs via local path (developer mode)

```bash
# In settings.json:
"packages": [
  "..\\..\\source\\stbl\\pi-soly.framework\\packages\\pi-soly"
]
```

Path is read at every `/reload` — no copy needed.

### Scenario C: User installs from local npm cache (offline mode)

If you want to test the **exact published version** without npm publish (e.g. while waiting for CI to finish), you can copy the package directly:

```bash
# After running bun install in the monorepo
# Or after npm pack:
bun run pack:pi-soly  # if you have a custom pack script

# Copy to pi's local npm cache
cp -r packages/pi-soly ~/.pi/agent/npm/pi-soly-<version>
# Or symlink (recommended for dev iteration):
ln -s $(pwd)/packages/pi-soly ~/.pi/agent/npm/pi-soly
```

Then in `settings.json`:

```json
{
  "packages": [
    "npm:pi-soly"
  ]
}
```

The symlink approach lets you iterate without copying on every change.

## Post-release verification

After pushing the tag:

```bash
# 1. Wait for CI to finish (~1 minute)
# 2. Verify on npmjs:
curl -s "https://registry.npmjs.org/pi-soly" | jq .['dist-tags'].latest

# 3. Verify install works:
pi install npm:pi-soly
# Then in pi:
/reload
/soly status   # or /keyrouter status etc.

# 4. If something is broken, revert:
git revert <commit-hash>
git push github master
# Tag stays but doesn't matter — CI won't re-publish
```

## Versioning rules

- **Major** (1.x → 2.x): breaking changes (public API changes, removed features, migration required)
- **Minor** (1.x → 1.x+1): new features, backward-compatible
- **Patch** (1.x.y → 1.x.y+1): bug fixes only

For pi-soly (1.x):
- 1.x.y — bug fix
- 1.x.0 — feature release

For pi-keyrouter (0.x):
- 0.x.y — bug fix
- 0.x.0 — breaking change OR significant feature

## What NOT to release

- ❌ Don't release a version that doesn't typecheck
- ❌ Don't release a version with failing tests
- ❌ Don't release a version with TODO/FIXME comments in code paths
- ❌ Don't release a version with debug `console.log` statements

If you need to push something in-progress, use a `wip/` branch tag and don't publish to npm.
