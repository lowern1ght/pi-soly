# Architecture Rules

> **Hard constraints on how features fit together.** Breaking these rules requires explicit justification in the PR/commit message.

## Don't break existing public APIs

If a function is exported and documented, **changing its signature is a breaking change** and requires a MAJOR version bump.

```ts
// Before (1.x)
// ✓ Adding optional parameter — OK in minor
export function loadConfig(cwd: string): Config;

// After (1.x+1)
export function loadConfig(cwd: string, options?: { strict?: boolean }): Config;

// ❌ Bad: removing a parameter or changing its type — MAJOR
export function loadConfig(cwd: string, strict: boolean): Config;
```

For internal helpers, you have more flexibility, but still prefer additive changes.

## Don't add runtime dependencies to pi-soly

`pi-soly/package.json` has **empty dependencies**. This is intentional:

```json
"dependencies": {},
"peerDependencies": {
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*"
}
```

Why:
- pi already includes its runtime dependencies (OpenAI SDK, etc.)
- Adding deps to our package would bloat user installs
- Version conflicts with pi's internal deps are painful

**If you need a new runtime dep**, first check if it's already in pi's dependency tree:
```bash
ls node_modules/@earendil-works/pi-coding-agent/node_modules/
```

If yes, import from there. If no, add to devDependencies (for type-checking only) and load it lazily at runtime via dynamic import.

## Don't introduce build steps

We have **no build step**. TypeScript is loaded directly by pi and bun at runtime. Adding `tsc --build`, `esbuild`, `webpack`, `vite`, etc. would:
- Slow down iteration
- Add complexity to release process
- Make `/reload` not pick up changes (since compiled output would be cached)

If you really need a build step, propose it in a separate doc first and get sign-off.

## Don't change package names after first publish

The package name on npm is permanent. `pi-soly` will always be `pi-soly` on npmjs. Renaming locally without renaming on npm would break users' settings.json paths.

If you want to rename:
1. Pick the new name
2. Reserve it on npmjs (npm publish with new name, no code yet)
3. Update package.json
4. Document the migration in CHANGELOG
5. Coordinate with users via a MAJOR version

## Don't break the message protocol

If you change the structure of messages injected into the system prompt (rules section, status line, etc.), existing rules/sections in user projects may stop working or behave differently.

Changes to system prompt format should:
1. Be backward-compatible (add new sections, don't remove old ones)
2. Be tested with representative rule sets
3. Be documented in CHANGELOG

## Single source of truth for state

Each piece of state should live in **one place**. If the same data is in `STATE.md`, `ROADMAP.md`, and a config file, you have a bug waiting to happen.

```
✓ Good: rules/ in .soly/rules/ is canonical, soly_read returns cached parse
✓ Good: .soly/STATE.md is canonical, all status queries derive from it
❌ Bad: rules in both .soly/rules/ and ~/.pi/agent/rules/ — sync breaks
```

## No side effects on import

Module-level code in `*.ts` files should NOT do I/O or have side effects:

```ts
// ❌ Bad
console.log("loading config");
const config = loadConfig();

// ✓ Good
export function loadConfig(): Config { ... }
```

Exception: pi extension entry points (`index.ts`) — they register handlers, which is a side effect by design.

## Favor composition over inheritance

If a feature could be a separate module/function, make it one. Don't create deep inheritance chains.

```ts
// ❌ Bad: 3-level inheritance for "rotates keys"
class KeyManager extends RotationStrategy extends AbstractConfig { ... }

// ✓ Good: small composable functions
export function pickNextKey(state: KeyState[]): number { ... }
export function rotate(state: KeyState, reason: RotationReason): void { ... }
```

## Fail fast, fail loud

Errors should surface immediately and clearly. No silent fallbacks:

```ts
// ❌ Bad
const config = loadConfig() ?? defaultConfig();

// ✓ Good
const config = loadConfig();
if (!config) throw new Error("Config not found — run /soly-init first");
```

If you must have a fallback (e.g., for graceful degradation), document it explicitly.

## Test what's user-facing

Integration tests should cover the user's perspective:
- "When I run /soly plan, the LLM gets a plan section in system prompt"
- "When MCP server returns 429, pi sees auto-retry"

Don't only test internal functions — they can all be correct but the user-facing flow can still be broken.
