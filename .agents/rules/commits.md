# Commit & Version Rules

## Commit message format

We use **Conventional Commits** style:

```
<type>(<scope>): <short summary>

<optional body — explain WHY, not WHAT>

<optional footer — references, breaking changes>
```

### Types

| Type | When | Example |
|---|---|---|
| `feat` | New feature visible to user | `feat: add /keyrouter command for status` |
| `fix` | Bug fix | `fix: parse empty config file without crashing` |
| `chore` | Maintenance, no behavior change | `chore: bump typescript to 6.0.3` |
| `docs` | Documentation only | `docs: add .agents README` |
| `refactor` | Code change, no behavior change | `refactor: extract helper from long function` |
| `test` | Add or fix tests | `test: cover rotation edge cases` |
| `perf` | Performance improvement | `perf: cache parsed rules` |
| `style` | Formatting only | `style: reformat with prettier` |

### Scope (optional)

The package or area affected:

- `feat(mcp): add session-retry`
- `fix(keyrouter): handle missing config gracefully`
- `docs(readme): add install instructions`

### Short summary

- **Imperative mood**: "add", not "added" or "adds"
- **No period at the end**
- **< 72 chars total line length**
- **Lowercase** (except proper nouns)

### Body (when needed)

Explain WHY this change was made. The diff shows WHAT; the body shows WHY.

```
feat: cache parsed rules

Previously, rules were re-parsed on every before_agent_start event.
With 50+ rules in a project, this caused a 200ms spike per turn.

Cache parsed rules by mtime — file watcher invalidates on change.
Turn-overhead dropped to <5ms.
```

### Footer (when needed)

Reference issues, mark breaking changes:

```
feat: redesign MCP footer with per-server icons

Breaking change: removed `MCP: <connected>/<total> servers` summary.
Replaced with `unreal ✓ · github ✗` per-server list.
Resolves #42.
```

## Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): breaking changes — user must change something
- **MINOR** (x.Y.0): new features — backward-compatible
- **PATCH** (x.y.Z): bug fixes — backward-compatible

For pre-1.0 packages (like `pi-keyrouter`):

- **MINOR** (0.X.0): breaking changes
- **PATCH** (0.x.Y): bug fixes

### When to bump

| Change | Bump |
|---|---|
| New slash command | MINOR |
| New pi-extension event handler | MINOR |
| Bug fix (no API change) | PATCH |
| Removed deprecated feature | MAJOR |
| Renamed public function | MAJOR |
| New optional field in returned object | PATCH (additive) |
| Changed required field in returned object | MAJOR |

### Pre-1.0 exception

`pi-keyrouter` is at 0.x. While at 0.x, MINOR versions can include breaking changes (the standard exception). Once it hits 1.0, breaking changes require MAJOR.

## Commit hygiene

### Atomic commits

One commit = one logical change. Don't mix features with refactors:

```
❌ Bad: single commit "feat: add new command, refactor: clean up old code"
✓ Good: two commits — one per change
```

### Don't commit broken state

Every commit should pass tests and typecheck. If you're mid-refactor, use `git stash` or commit on a branch.

### Don't commit generated files

Generated files (`node_modules/`, `dist/`, `*.d.ts` for non-published code) belong in `.gitignore`.

### Commit authorship

The release script uses `git -c user.name=...` to attribute releases to a bot. Don't impersonate other contributors.

## Pull requests (if you use them)

We don't currently use PRs heavily (single-maintainer flow). But if you do:

- Title follows commit format: `feat(scope): summary`
- Description includes: what changed, why, how to test
- Reference any related issues
- Squash-merge with the PR title as the commit message
