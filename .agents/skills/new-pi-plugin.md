# Skill: Create a new standalone pi plugin

> **When to use**: You want to build a plugin that ships as its OWN npm package (`pi-<name>`) and can be installed independently of soly. Example: `pi-keyrouter`, the original `pi-mcp-adapter`.

## When to make a separate plugin vs. extend soly

| Concern | Separate plugin | Extend soly |
|---|---|---|
| Works without soly | ✓ | ✗ (depends on soly state) |
| User might want this but not soly | ✓ | ✗ |
| Uses pi's APIs only (no soly internals) | ✓ | ✗ |
| Shares rules/intent with soly | ✗ | ✓ |
| Small standalone tool | ✓ | depends |

If unsure: **start as separate plugin**. You can always bundle it into soly later (we did this with mcp/ in 1.11.0).

## Step-by-step

### 1. Create the package structure

```bash
mkdir -p packages/pi-<name>/tests
```

```
packages/pi-<name>/
├── index.ts                  # entry: default export ExtensionFactory
├── core.ts                   # (optional) shared types
├── <feature>.ts              # main logic
├── config.ts                 # (optional) config loading
├── types.ts                  # types/interfaces
├── tests/
│   ├── core.test.ts
│   └── smoke.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

### 2. Create package.json

```json
{
  "name": "pi-<name>",
  "version": "0.1.0",
  "description": "<one-line description>",
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "bun x tsc --noEmit"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "0.78.1",
    "@types/node": "^25.9.1",
    "bun-types": "^1.3.14",
    "typescript": "^6.0.3"
  },
  "files": ["README.md", "index.ts", "<feature>.ts", "types.ts"],
  "keywords": ["pi", "pi-extension", "pi-package", "<your-feature>"],
  "license": "MIT",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "publishConfig": {
    "registry": "https://registry.npmjs.org/"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/lowern1ght/pi-soly.git",
    "directory": "packages/pi-<name>"
  }
}
```

### 3. Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["esnext"],
    "types": ["node"],
    "skipLibCheck": true,
    "noEmit": true,
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": false,
    "allowImportingTsExtensions": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 4. Write the entry point

```ts
// packages/pi-<name>/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function <name>Extension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    // setup
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    // inject into system prompt
  });

  pi.registerCommand("<name>", {
    description: "...",
    handler: async (args, ctx) => { ... },
  });
}
```

### 5. Add to monorepo typecheck

Update `tsconfig.json` (root) to include the new package:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/pi-soly" },
    { "path": "./packages/pi-<name>" }
  ]
}
```

Update root `package.json` `typecheck` script if needed.

### 6. Wire local install in user's settings.json

User (developer) adds to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "..\\..\\source\\stbl\\pi-soly.framework\\packages\\pi-<name>"
  ]
}
```

Or via npm after publish:

```bash
pi install npm:pi-<name>
```

### 7. Write tests + README

Tests per `rules/testing.md`. README must include:
- What it does (one paragraph)
- Install (`pi install npm:pi-<name>`)
- Usage (commands, tools, events)
- Config (if any)
- License

### 8. Commit + release

```bash
git add packages/pi-<name>/
git commit -m "feat: create pi-<name> package for <feature>"
# See release.md
./scripts/release.sh pi-<name> 0.1.0
```

## Example: pi-keyrouter

`pi-keyrouter` is the canonical example. Look at:

```
packages/pi-keyrouter/
├── index.ts          # extension entry
├── rotation.ts       # pure rotation logic
├── config.ts         # config loader
├── notification.ts   # Box widget
├── types.ts          # types
└── tests/
    ├── rotation.test.ts
    ├── config.test.ts
    ├── notification.test.ts
    └── smoke.test.ts
```

Key lessons from pi-keyrouter:
1. **Pure logic in separate files** — `rotation.ts` is testable without pi
2. **Native API integration** — uses `setRuntimeApiKey()` instead of `fetch` wrapping
3. **Config in user-level only** — `~/.pi/keyrouter.json`, never project-scoped (security)
4. **Lazy bootstrap** — re-initialize on every `before_agent_start` (handles /reload edge case)

## Bundling into soly later

If your plugin becomes popular and "everyone using soly also wants this", consider bundling:

```bash
# 1. Move package contents into packages/pi-soly/<feature>/
mv packages/pi-<name>/* packages/pi-soly/<feature>/

# 2. Update soly/index.ts to dynamically import
void import("./<feature>/index.ts").then((m) => m.default(pi));

# 3. Remove the standalone package
rm -rf packages/pi-<name>

# 4. Bump soly MINOR version
# 5. Communicate to users: standalone plugin is now bundled
```

Example: we bundled `pi-mcp-adapter` into `pi-soly/mcp/` in v1.11.0.
