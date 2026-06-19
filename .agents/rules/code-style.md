# Code Style Rules

> **Non-negotiable.** Linter-friendly. Followed everywhere unless explicitly noted.

## TypeScript

### Strict mode required

`tsconfig.json` has `"strict": true`. All code must compile cleanly with:

```bash
bun run typecheck
```

This includes: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`.

### No `any` — use `unknown` and narrow

```ts
// ❌ Bad
function parseConfig(raw: any): any {
  return JSON.parse(raw);
}

// ✓ Good
function parseConfig(raw: string): Config {
  const parsed: unknown = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}
```

Exception: when interfacing with external libraries that have incomplete types, use `unknown` at the boundary and cast in a single, documented place.

### Prefer `type` aliases over `interface`

```ts
// ✓ Preferred
export type AskProResult = {
  cancelled?: boolean;
  answers?: Record<number, AskAnswer | AskMultiAnswer>;
};

// ✓ Also fine when extension/declaration merging is needed
export interface Component {
  render(width: number): string[];
}
```

### Named exports only

```ts
// ❌ Bad
export default function askPro() { ... }

// ✓ Good (unless pi expects default export for extension entry)
export function askPro() { ... }
```

Exception: pi extension **entry points** (the function passed to `pi`) use `export default` because pi loads them as ES module defaults.

### All public APIs must have JSDoc comments

```ts
/**
 * Parse a raw JSON string into a validated Config object.
 *
 * @param raw - the raw JSON text (must be valid JSON)
 * @returns the parsed and validated config
 * @throws if raw is not valid JSON
 * @throws if raw JSON doesn't match ConfigSchema
 */
export function parseConfig(raw: string): Config {
  // ...
}
```

This applies to exported functions, types, and interfaces. Internal helpers don't need JSDoc but should have a one-line comment explaining non-obvious logic.

### Functions under 50 lines

If a function exceeds 50 lines, extract helpers. Long functions are a code smell — they usually mean the function does multiple things.

```ts
// ❌ Bad: 80-line function doing parsing + validation + transformation
function processConfig(raw: string): Config {
  // ... 30 lines of parsing
  // ... 30 lines of validation
  // ... 20 lines of transformation
}

// ✓ Good: each step is a named function
function processConfig(raw: string): Config {
  const parsed = parseJson(raw);
  const validated = validateConfig(parsed);
  return transformConfig(validated);
}
```

### Strict null checks — always handle `undefined`/`null` explicitly

```ts
// ❌ Bad
const value = map.get(key);
return value.toString(); // crashes if missing

// ✓ Good
const value = map.get(key);
if (value === undefined) throw new Error(`Missing key: ${key}`);
return value.toString();
```

Or with explicit fallback:

```ts
const value = map.get(key) ?? defaultValue;
```

### No non-null assertions (`!`) unless absolutely necessary

```ts
// ❌ Bad
const value = map.get(key)!; // why is this safe?

// ✓ Good (with justification)
const value = map.get(key)!; // checked above on line 42
```

If you must use `!`, leave a comment explaining why it's safe.

## Naming

| Element | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` | `mcp-adapter.ts` |
| Variables | `camelCase` | `keyRouterConfig` |
| Constants | `UPPER_SNAKE_CASE` for module-level | `MAX_RETRIES`, `DEFAULT_KEY` |
| Functions | `camelCase`, verb-first | `loadConfig`, `markKeyBad` |
| Types | `PascalCase` | `KeyRouterConfig` |
| Interfaces | `PascalCase`, no `I` prefix | `AskProResult`, not `IAskProResult` |
| Booleans | `is`/`has`/`can` prefix | `isAvailable`, `hasFailed` |
| Acronyms | 2-letter caps, 3+ pascal | `URL` → `Url`, `API` → `Api`, `HTTP` → `Http` |

## Imports

### Group imports: stdlib → external → internal

```ts
import * as fs from "node:fs";
import * as path from "node:path";

import { Container } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "./config.ts";
import { initKeyStates } from "./rotation.ts";
```

Separate groups with blank line. Sort within each group alphabetically (most editors do this automatically).

### Use `.ts` extensions in imports

```ts
// ✓ Good
import { foo } from "./bar.ts";

// ❌ Bad
import { foo } from "./bar";
```

This works because `tsconfig.json` has `"allowImportingTsExtensions": true`. Bun loads `.ts` directly so the extension is required.

### Prefer `import type` for type-only imports

```ts
// ✓ Good — no runtime overhead
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommand } from "./commands.ts";

// ❌ Bad — type is in runtime import
import { ExtensionAPI, registerCommand } from "./...";
```

## Comments

- Comments explain **why**, not **what**
- Use `//` for single-line, `/* */` for multi-line
- TODO comments must include a person/issue: `// TODO(bradw): fix this in v1.13`
- FIXME comments are reserved for actual bugs, not "could be nicer"
- Don't leave commented-out code — git history has it

## File structure

```ts
// 1. License/header comment (if needed)
// 2. File-level JSDoc explaining purpose
// 3. Imports (grouped)
// 4. Constants
// 5. Types/interfaces
// 6. Helper functions (private)
// 7. Public functions
// 8. Default export (if any)
```

For pi extensions, the default export is the entry function called by pi on extension load.
