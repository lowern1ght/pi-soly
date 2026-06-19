# Dependencies

## Runtime dependencies

| Package | Used by | Why |
|---|---|---|
| `@earendil-works/pi-coding-agent` | both | The pi runtime. Provides ExtensionAPI, event bus, slash-command registration, custom component hosting. Peer dep. |
| `@earendil-works/pi-ai` | pi-soly | Underlying AI SDK. Provides `getModel()`, model registry helpers. Dev dep (for type-checking and runtime helpers). |
| `@earendil-works/pi-tui` | both | TUI components (`Box`, `Text`, `Container`, `Markdown`). Used by `ask/`, `notification.ts`. |
| `@modelcontextprotocol/sdk` | pi-soly `mcp/` | MCP client SDK. Used by the bundled `pi-mcp-adapter` fork. Dev dep only — runtime comes from pi-coding-agent's dependency tree. |
| `@modelcontextprotocol/ext-apps` | pi-soly `mcp/` | MCP UI app bridge. Dev dep for type-checking only. |

## External runtime commands

These are NOT npm packages but external tools the user must have installed:

| Tool | Used by | Why |
|---|---|---|
| `bun` | both | Test runner, typecheck runner, dev workflow. Pre-installed on self-hosted GitHub Actions runner. |

## Internal structure (no external deps)

- **No HTTP client** — pi provides it via the OpenAI SDK it already includes
- **No state management library** — plain TypeScript modules + Map
- **No CLI framework** — pi owns the command surface
- **No build step** — TypeScript is loaded directly by pi at runtime

## Adding a new dependency

**Before adding** any dep, answer these questions:

1. **Is it already in pi's dependency tree?** Check `node_modules/@earendil-works/pi-coding-agent/node_modules/`. If yes, import it via re-export (don't add to your package.json).
2. **Is it a TypeScript-only dev dep?** Then add to `devDependencies`, not `dependencies`.
3. **Will it bloat the npm package?** Check the unpacked size. Anything > 100KB needs justification in the commit message.

**Adding procedure**:

```bash
# 1. Add to package.json (manually or via bun add)
bun add --cwd packages/<pkg> [-d] <dep-name>

# 2. Update this file with a new row in the table above

# 3. Verify it doesn't break typecheck
bun run typecheck

# 4. Verify it doesn't break tests
bun test
```

## Version pinning

- We pin **exact versions** for runtime deps (no `^` or `~`)
- This is intentional — pi's API surface changes between minor versions and we need predictable behavior
- Dev deps can use `^` for flexibility

## Self-hosted GitHub Actions runner

`ci.yml` runs on `self-hosted` runner with these pre-installed:

- `bun` ≥ 1.3
- `node` ≥ 20
- `git`
- Standard `npm publish` via `actions/checkout@v4`

The runner is `forgejo.runner-001` (now hosts GitHub Actions, renamed from Forgejo Actions).

## Why no `dependencies` in pi-soly/package.json

Empty by design:

```json
"dependencies": {},
"peerDependencies": {
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*"
}
```

Reason: pi already includes its runtime dependencies. Adding them to our package would bloat the install and risk version conflicts. We only declare **peer dependencies** to signal what's needed at runtime.
