# Architecture

## Monorepo layout

```
pi-soly.framework/
├── packages/
│   ├── pi-soly/          # v1.x — main extension
│   └── pi-keyrouter/     # v0.x — separate package
├── scripts/release.sh     # tag-based version + publish
├── .github/workflows/
│   └── ci.yml             # self-hosted runner, test+publish
└── .agents/               # agent-facing docs (this folder)
```

## pi-soly package

`packages/pi-soly/` is the main extension. Single `npm` package, single pi extension entry (`./index.ts`). Bundles several sub-features:

```
packages/pi-soly/
├── index.ts              # main entry — solyExtension(pi)
├── core.ts               # types, loaders (rules/docs/intent), builders
├── commands.ts           # /rules /soly /soly-migrate /soly-init /soly-status /why /rulewizard
├── tools.ts              # soly_read, soly_log_decision, soly_list_phases
├── notification.ts       # Box widget for framed messages
├── notifications-log.ts  # JSONL append to .soly/notifications.log
├── nudge.ts              # soft behavioral hint (pre-action gate)
├── intent.ts             # intent doc loader + section builder
├── workflows/            # /soly execute|pause|resume|compact|discuss|plan|inspect|quick
├── ask/                  # ask_pro tool (multi-question picker)
├── mcp/                  # pi-mcp-adapter fork (UE5 session-retry + framed notifs)
├── skills/soly-framework/  # SKILL.md loaded by LLM on demand
├── docs.ts               # builds system-prompt sections (rules, status, hints)
├── status.ts             # one-screen status report
├── integrate.ts          # cross-extension integrations (pi-todo, ...)
├── env.ts                # env detection (bun, node, docker, git)
├── git.ts                # git context (branch, status)
├── migrate.ts            # .soly/ → .agents/ atomic rename
├── init.ts / hotreload.ts / iteration.ts / codemap.ts / scratchpad.ts
│   └── supporting subsystems
└── agents-install.ts    # installs soly-framework SKILL.md into ~/.pi/agent/skills/
```

## pi-keyrouter package

`packages/pi-keyrouter/` — separate package, separate extension. API key rotation across multiple keys per provider. Hooks `message_end` extension event to detect 429/401 and swap runtime API key via `setRuntimeApiKey`. Independent release cycle.

## Extension lifecycle (when pi loads soly)

```
1. pi starts → reads settings.json "packages" array
2. For each package path → loads main entry as ES module
3. Calls default export as ExtensionFactory: (pi: ExtensionAPI) => void
4. Our solyExtension(pi) runs:
   a. Initializes state (rules, intent, project state)
   b. Registers event hooks (session_start, before_agent_start, etc.)
   c. Registers slash commands
   d. Registers LLM tools
   e. Mounts sub-features (ask, mcp)
5. Extension is "live" — events flow to our handlers
```

## Key extension events we use

| Event | When it fires | What soly does |
|---|---|---|
| `session_start` | Session opens | Reset state, install skill |
| `before_agent_start` | Every turn | Inject rules/intent/status into system prompt |
| `tool_call` (edit/write) | LLM edits file | Track edited files for post-work rules check |
| `turn_end` | Turn finishes | Refresh state from disk, run hooks |
| `session_shutdown` | Session closes | Cleanup, flush iterators |
| `message_end` | Message finalized | pi-keyrouter checks for 429/401 |

## Key APIs we use

- `pi.ui.setWidget(key, factory, opts)` — Box widgets in editor area
- `pi.ui.notify(text, level)` — quick text notification
- `pi.ui.setStatus(key, text)` — footer/status bar (what MCP footer uses)
- `pi.ui.custom(factory)` — fullscreen custom component with focus (what ask_pro uses)
- `pi.ui.input(title, placeholder)` — single-line text input dialog (ask_pro "Other…" + notes)
- `pi.registerCommand(name, { description, handler })` — slash commands
- `pi.registerTool({ name, label, description, parameters, execute })` — LLM tools
- `pi.on(event, handler)` — event subscriptions

## System prompt architecture

`pi-soly` injects sections into the system prompt via `before_agent_start`:

1. **Rules section** (`buildRulesSection`) — MANDATORY header + rule bodies (always-on + glob-matched)
2. **Intent section** (`buildIntentSection`) — preview of intent docs (or full body if `inline: true`)
3. **Status section** (`buildStatusLine`) — one-line summary: phase, rules count, todos, next hint
4. **Git section** (`buildGitSection`) — branch, dirty files (if in git repo)
5. **Env section** (`buildEnvSection`) — runtime detection (bun, node, docker)
6. **Project layout** (`buildCodeMapSection`) — directory tree summary
7. **Integrations section** (`buildIntegrationsSection`) — pi-todo progress (if present)
8. **Nudge section** (`buildNudgeSection`) — soft behavioral hint (only when triggered)

Each section is independently skippable, cheap to compute, and cached where possible.

## Data flow

```
.cursorrules/.agents/rules/  →  loadAllRules()  →  buildRulesSection()
                                              ↓
.soly/STATE.md, ROADMAP.md  →  loadProjectState()  →  buildProjectStateSection()
                                              ↓
                       before_agent_start
                                              ↓
                              system prompt
                                              ↓
                                 LLM turn
                                              ↓
                            tools + commands
```

The LLM never reads files directly — it goes through `soly_read` tool which respects intent docs and rules.

## Vendoring

- **`.soly/`** — legacy soly-specific directory (still supported, deprecation warning)
- **`.agents/`** — vendor-neutral (AGENTS.md standard convention)
- **Migration path**: `/soly-migrate` command atomically renames `.soly/` → `.agents/`

The user-level directory (`~/.pi/agent/`) is always vendor-neutral. Project-level can be either.
