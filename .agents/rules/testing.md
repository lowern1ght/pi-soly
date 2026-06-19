# Testing Rules

> **Required.** Every code change must pass `bun test` and `bun run typecheck`. CI runs both — no exceptions.

## Run the tests

```bash
# All tests in the monorepo
bun test

# Tests for a specific package
bun test packages/pi-soly/

# Single test file
bun test packages/pi-soly/tests/smoke.test.ts

# With filter
bun test packages/pi-soly -t "extracts file paths"

# Watch mode (re-runs on save)
bun test --watch packages/pi-soly
```

## Run typecheck

```bash
# Both packages (uses the root typecheck script)
bun run typecheck

# Or per-package:
cd packages/pi-soly && bun x tsc --noEmit
cd packages/pi-keyrouter && bun x tsc --noEmit
```

CI does this too. If CI fails locally, fix before pushing.

## What to test

Every module that has **non-trivial logic** needs tests. Pure types and trivial re-exports don't.

Things that MUST have tests:

- Pure functions (rotation.ts, config.ts, anything in `*.ts` that exports functions)
- State transitions (e.g., `ask_pro` state machine)
- Error handling paths
- Edge cases (empty input, missing config, malformed JSON)
- Public APIs that users will call directly

Things that DON'T need tests:

- Type re-exports
- Trivial getters/setters
- Pi-specific event handlers (hard to unit test; rely on smoke tests)

## Test structure

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("moduleName — feature being tested", () => {
  beforeEach(() => {
    // setup
  });

  afterEach(() => {
    // cleanup (e.g., delete temp files)
  });

  test("does X when Y", () => {
    // Arrange
    const input = ...;
    // Act
    const result = doSomething(input);
    // Assert
    expect(result).toBe(expectedValue);
  });
});
```

Prefer many small focused tests over few large ones. Tests should read like documentation.

## Naming tests

```ts
// Pattern: <subject> — <behavior> when <condition>
test("rotation picks next available key when current is on cooldown");
test("ask_pro handles empty questions array without crashing");
test("config loader ignores project-local keyrouter.json (security)");
```

Good names let you read the test list and understand coverage without opening each test.

## Smoke tests

For complex extensions, add a smoke test that loads the extension with a mock pi and verifies it doesn't crash:

```ts
test("default export accepts a mock pi", async () => {
  const mod = await import("../index.ts");
  const mockPi = new Proxy({}, {
    get: (_t, prop) => () => {}, // all methods are no-ops
  });
  expect(() => mod.default(mockPi as never)).not.toThrow();
});
```

This catches import errors and runtime exceptions at extension load time.

## Integration tests

For features that interact with multiple modules (e.g., the keyrouter extension), write end-to-end tests that exercise the full flow with mocked dependencies:

```ts
test("rotation works end-to-end", async () => {
  // Setup
  const { extension, mockPi } = setupMockExtension();
  // Trigger flow
  await mockPi.simulateEvent("after_provider_response", { status: 429 });
  // Verify behavior
  expect(mockPi.notifications).toContain("keyrouter: ... rotated ...");
});
```

Integration tests are slower than unit tests but catch real bugs. Aim for ~20% integration / 80% unit.

## Test fixtures

Use `beforeEach` to create fresh fixtures per test. Don't share state between tests — order-dependence is a bug magnet.

```ts
// ✓ Good
describe("config loader", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  test("...", () => {
    fs.writeFileSync(path.join(tmpDir, "config.json"), "...");
    // ...
  });
});
```

## Coverage goals

- **Critical paths** (session lifecycle, error handling, rotation): 100% line coverage
- **Public APIs**: 80%+ line coverage
- **Internal helpers**: as much as practical, but don't block on it
- **Type definitions**: not measurable, but review for completeness

## What NOT to do

- ❌ Don't write tests that test the test framework (e.g., `expect(1).toBe(1)`)
- ❌ Don't write flaky tests (time-dependent, order-dependent, network-dependent)
- ❌ Don't mock what you can test directly
- ❌ Don't skip tests with `.skip` to make CI green — fix the test or the code

## CI pipeline

`.github/workflows/ci.yml` runs on every push to master and every tag:

```yaml
jobs:
  test:
    steps:
      - bun install --frozen-lockfile
      - bun test
      - bun run typecheck
  publish:
    if: startsWith(github.ref, 'refs/tags/')
    needs: test
    steps:
      - bun install
      - bun test
      - verify version matches tag
      - npm publish
```

The test job blocks the publish job. If tests fail, no publish happens.
