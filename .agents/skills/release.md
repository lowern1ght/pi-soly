# Skill: Release a new version

> **When to use**: You're ready to publish a new version to npm. This is a multi-step process — follow carefully.

## Pre-release checklist

Before running the release script, verify:

- [ ] All tests pass: `bun test`
- [ ] Typecheck clean: `bun run typecheck`
- [ ] No uncommitted changes: `git status`
- [ ] On master branch: `git branch --show-current`
- [ ] Latest changes pulled: `git pull github master`
- [ ] CHANGELOG.md updated for this version (write the entry before tagging)
- [ ] `package.json` version NOT yet bumped (the script does it)
- [ ] No `console.log` debug statements in code paths
- [ ] No TODO/FIXME comments in shipped code

If any check fails, fix before proceeding.

## Step 1: Update CHANGELOG.md

Edit `CHANGELOG.md` and add an entry at the top:

```markdown
## [<version>] — <YYYY-MM-DD or "unreleased">

### Added
- feat: new thing users can do

### Changed
- feat: changed behavior (not breaking)

### Fixed
- fix: bug users reported

### Removed
- chore: removed deprecated feature (MAJOR only)
```

The date can be `unreleased` initially — CI will replace it during publish.

## Step 2: Commit CHANGELOG

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for <version>"
git push github master
```

This ensures CHANGELOG is updated before the version-bump commit.

## Step 3: Run the release script

```bash
./scripts/release.sh <package-name> <version>

# Examples:
./scripts/release.sh pi-soly 1.12.0
./scripts/release.sh pi-keyrouter 0.4.0
```

The script:
1. Updates `packages/<pkg>/package.json` version
2. Creates commit: `release: <pkg> v<version>`
3. Creates tag: `<pkg>-v<version>`
4. Prints push commands

**You must run the push manually** (the script doesn't push to avoid accidental publishes):

```bash
git push github master
git push github <pkg>-v<version> --force
```

The `--force` is for tags only — it overwrites a tag if a previous attempt left one. Branches are pushed normally.

## Step 4: Wait for CI

Watch the CI run:

- GitHub UI: `https://github.com/lowern1ght/pi-soly/actions`
- Or via CLI: `gh run watch` (if installed)

The CI flow:

```
push to master / push tag
  ↓
test job (always)
  ├─ bun install --frozen-lockfile
  ├─ bun test
  └─ bun run typecheck
  ↓ (only if push was a tag matching *-v*)
publish job
  ├─ detect package from tag name (e.g. pi-soly → packages/pi-soly)
  ├─ verify package.json version matches tag
  ├─ npm publish --access public
  └─ cleanup
```

If any step fails, the publish doesn't happen. Fix and re-tag.

## Step 5: Verify on npm

After CI succeeds:

```bash
# Check latest version
curl -s "https://registry.npmjs.org/pi-soly" | jq .['dist-tags'].latest

# Should match what you just published
```

## Step 6: Install and smoke-test

```bash
# Install the new version
pi install npm:pi-soly

# Or for local path testing (faster):
# Settings.json entry already pointing at monorepo path

# In pi:
/reload
/soly status
# Or /keyrouter status
```

## Step 7: Copying to local .pi directory

There are three scenarios. Pick the right one:

### A. User installs via `pi install npm:pi-soly`

Automatically downloaded to `~/.pi/agent/npm/pi-soly/`. **No action needed**.

### B. User installs via local path (developer mode)

In `settings.json`:
```json
"packages": [
  "..\\..\\source\\stbl\\pi-soly.framework\\packages\\pi-soly"
]
```

Path is read at every `/reload`. **No copy needed**.

### C. User wants the exact published version locally without using npm

This is for offline testing. Two options:

**Option C1: Symlink** (recommended for dev iteration):

```bash
# From your user home
cd ~/.pi/agent/npm
ln -s C:/Users/bradw/source/stbl/pi-soly.framework/packages/pi-soly pi-soly

# Then in settings.json:
"packages": ["npm:pi-soly"]
```

This way `/reload` uses the symlinked package — but you need to run `npm pack` first to populate the symlink with a versioned directory. Actually, simpler: just use path mode (option B).

**Option C2: npm pack and copy**:

```bash
# In the monorepo
cd packages/pi-soly
npm pack
# Creates pi-soly-1.12.0.tgz

# Extract to pi's local npm cache
mkdir -p ~/.pi/agent/npm/pi-soly
tar -xzf pi-soly-1.12.0.tgz -C ~/.pi/agent/npm/pi-soly --strip-components=1

# Then in settings.json:
"packages": ["npm:pi-soly"]
```

This gives you the exact published version locally without going through npm install.

**Most users only need option A or B**. Option C is for testing the exact published artifact.

## Reverting a bad release

If you publish a broken version:

```bash
# Option 1: Publish a patch immediately
./scripts/release.sh pi-soly 1.12.1
# Fix the bug, commit, tag, push

# Option 2: Unpublish (only within 72h of publish)
npm unpublish pi-soly@1.12.0
# ⚠️ Don't do this lightly — breaks anyone who installed it
```

## Post-release

- [ ] Update version badges in `README.md` (if any)
- [ ] Announce in commit message / CHANGELOG
- [ ] Update user docs if feature changed

## Common mistakes

- ❌ Forgot to update CHANGELOG before tagging
- ❌ Tagged wrong version (1.12 vs 12.0)
- ❌ Forgot to push the tag (CI didn't run publish)
- ❌ Didn't wait for CI before announcing
- ❌ Published with `console.log` debug code
- ❌ Forgot to update package.json `files` array when adding new folders
