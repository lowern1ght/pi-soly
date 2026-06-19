# Skill: Extend pi-soly with a new sub-feature

> **When to use**: You want to add a feature that ships inside `pi-soly` (e.g., a new slash command, a new tool, a new system-prompt section). If you want a SEPARATE package, see `new-pi-plugin.md` instead.

## Before you start

Answer these questions:

1. **Is this the right package?** Or should it be a separate `pi-*` plugin in `packages/`?
   - Sub-feature of soly (uses soly state, integrates with rules) → here
   - Standalone functionality (could work without soly) → `new-pi-plugin.md`
2. **What user problem does this solve?** If you can't explain in one sentence, don't build it.
3. **What existing patterns does it follow?** Look at similar features in `packages/pi-soly/`.

## Step-by-step

### 1. Decide where the code lives

```
packages/pi-soly/
├── core.ts               # shared types and builders (extend if new types needed)
├── commands.ts           # add slash command
├── tools.ts              # add LLM tool
├── notification.ts       # use existing Box widget helpers
├── intent.ts             # extend intent doc loading
├── workflows/            # add /soly <verb> handler
├── ask/                  # separate sub-feature (don't mix)
├── mcp/                  # separate sub-feature (don't mix)
└── <new-folder>/         # create new if significant
```

### 2. Add the feature

Example: adding a new tool `soly_my_thing`:

```ts
// packages/pi-soly/tools.ts
export function registerMyThingTools(
  pi: ExtensionAPI,
  getState: () => SolyState,
): void {
  pi.registerTool({
    name: "soly_my_thing",
    label: "My Thing",
    description: "Does the thing. Use when...",
    parameters: Type.Object({
      input: Type.String({ description: "What to do" }),
    }),
    execute: async (_toolCallId, params) => {
      // ... logic ...
      return {
        content: [{ type: "text", text: `Done: ${params.input}` }],
        details: { result: "..." },
      };
    },
  });
}
```

### 3. Wire it up in `index.ts`

```ts
// packages/pi-soly/index.ts
import { registerMyThingTools } from "./tools.ts";

export default function solyExtension(pi: ExtensionAPI) {
  // ... existing code ...
  registerMyThingTools(pi, () => state);
}
```

### 4. Update `package.json` if needed

If you added a new npm dep (rare — usually not needed):

```json
{
  "dependencies": {},         // usually stays empty
  "peerDependencies": { ... }
}
```

If you added new files in a new folder, update `files`:

```json
{
  "files": [
    ...,
    "my-folder/"
  ]
}
```

### 5. Write tests

Add tests next to your code:

```
packages/pi-soly/tools.test.ts        # or <new-folder>/<file>.test.ts
packages/pi-soly/tests/<name>.test.ts
```

Follow `rules/testing.md`. Aim for 80%+ coverage of new code.

### 6. Verify locally

```bash
# Tests pass
bun test packages/pi-soly/

# Typecheck clean
bun run typecheck

# Live reload in pi
# Edit files → /reload in pi → /soly status or whatever command you added
```

### 7. Update docs

If you added a slash command, tool, or workflow:
- Update `packages/pi-soly/README.md` — add to the Commands or Tools section
- Update `CHANGELOG.md` — add an entry under the next version
- Update `.agents/docs/architecture.md` if the feature crosses module boundaries

### 8. Commit and release

Follow `rules/commits.md`:

```bash
git add packages/pi-soly/tools.ts packages/pi-soly/index.ts packages/pi-soly/tools.test.ts
git commit -m "feat: add soly_my_thing tool for doing the thing"
```

Then see `release.md` for how to publish.

## Examples in this codebase

- **Adding a notification widget** (`1.7.0` → `1.8.0`): added `commands.ts` entry + `notification.ts` helper + tests
- **Adding /rules stats** (`1.8.0`): added a `subcommand` to existing `/rules` command + new tests
- **Adding /docs stats** (`1.9.0`): same pattern as /rules stats
- **Bundling MCP** (`1.11.0`): larger refactor — added `mcp/` subfolder + dynamic import in `index.ts`

Look at the commit history for these as reference implementations.

## Checklist before committing

- [ ] Tests pass (`bun test`)
- [ ] Typecheck clean (`bun run typecheck`)
- [ ] Code follows `rules/code-style.md`
- [ ] No new runtime deps in `package.json` (unless justified)
- [ ] Docs updated (README, CHANGELOG)
- [ ] Commit message follows conventional format
