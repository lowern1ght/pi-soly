# Release Discipline Rule

> **Every version bump = a CHANGELOG entry.** Soly ships with a release
> workflow that publishes a tagged version to npm on push. If the
> workflow fires for a commit that bumped the version but didn't touch
> `CHANGELOG.md`, the release is shipped blind — users have no way to
> know what changed. **Always update CHANGELOG.md in the same commit that
> bumps the version.**

## The rule

When `package.json` `version` is incremented (any field under `version`):

1. **Open `CHANGELOG.md` first** (or via `soly_snippet` / `soly_doc_search`).
2. **Move the entry out of `[Unreleased]`** into a new section with the
   new version as the header: `## [<new-ver>] — <YYYY-MM-DD>`.
3. **Group changes under standard subsections** — pick only what applies:
   - `### Added` — new feature visible to users
   - `### Changed` — behavior change in existing feature
   - `### Deprecated` — feature still works but slated for removal
   - `### Removed` — feature gone
   - `### Fixed` — bug fix
   - `### Security` — security-relevant change
4. **Each bullet = one user-visible change** (not "touched X file" —
   that belongs in the commit message, not the changelog).
5. **Reference the function / command / file** the change is in
   (e.g., `soly execute`, `goal-verify.ts`, `settings UI`).
6. **Semantic Versioning** rules:
   - **PATCH** (x.y.**Z+1**) — bug fix, no API change, no behavior change.
   - **MINOR** (x.**Y+1**.0) — new feature visible to user; existing
     commands behave the same.
   - **MAJOR** (**X+1**.0.0) — breaking change: command renamed,
     output format changed, file moved, default config changed.
7. **No empty version blocks** — if the section is empty, don't add the
   header. Leave it in `[Unreleased]`.

## Why this matters

- Users `npm update` and read the changelog to decide whether to upgrade.
- The soly release workflow (`ci.yml` → `publish` job) runs the same
  pipeline as `bun test` and `bun run typecheck`. A clean CHANGELOG
  alongside a version bump is the user's signal that the bump was
  intentional, not a typo.
- Search engines / GitHub release notes auto-render the `[X.Y.Z]`
  headers — empty or missing entries = "garbage release".

## Examples

### Good

```markdown
## [2.2.0] — 2026-07-05

### Added
- **`/sly` and `/s` aliases** for the `/soly` picker. Same body, three
  command names. The `/soly` modal header shows `· /sly · /s` as a hint.

### Changed
- **`mcp/panel-keys.ts` → `visual/panel-keys.ts`.** The keybindings
  primitive used by `ListPanel`, `McpPanel`, and `McpSetupPanel` is
  now its own visual-UI module.
```

### Bad

```markdown
## [2.2.0] — 2026-07-05

### Changed
- refactored
```

(Too vague to be useful; the user can't tell what changed or whether
it matters to them.)

### Worse

```markdown
## [2.2.0] — 2026-07-05
```

(Empty section — the bump is real, the user has no idea why.)

## Workflow

When `soly done <plan>` (or any version-bump commit) lands:

1. The `package.json` bump should be in the **same commit** as the
   CHANGELOG edit. If you forgot, the release workflow still passes —
   it doesn't enforce this rule. (We could add a CI check: `git diff
   ${prev-tag}..HEAD -- package.json | grep version && ! git diff
   ${prev-tag}..HEAD -- CHANGELOG.md | head -1` — but for now it's
   convention.)
2. The release CI runs `ci.yml` → publishes to npm. It does NOT lint
   CHANGELOG.
3. The GitHub release auto-renders from the tag's commit message
   (`release: pi-soly v2.2.0`); the CHANGELOG entry is the canonical
   "what changed" surface.

## Override

This rule is built-in to the soly extension and ships with every
install. If your project ships a `.agents/rules/release-discipline.md`
that adds (or contradicts) the rules above, the project rule wins per
the standard soly priority rules (project > global > built-in).