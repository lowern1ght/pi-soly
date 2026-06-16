# pi-switch — generic subagent switcher for pi

A tiny pi extension that gives you a **persistent indicator of the current subagent** (footer pill) and lets you **cycle / set / create** agents. Generic — works with any agent in `~/.pi/agent/agents/`.

## Features

- **Footer pill** — always shows current agent with emoji + description
- **Ctrl+Tab** to cycle to next agent (Shift+Tab is taken by pi's thinking-level cycler)
- **F2** as fallback for terminals that don't pass Ctrl+Tab through
- **`/agent`** slash command to show current + available
- **`/agent <name>`** to set explicitly
- **`/agent create <name>`** to scaffold a new user agent
- **`/agent doctor`** to diagnose
- **`/agent recommend <task>`** to suggest the right agent for a task
- **Task → agent heuristics** baked into the system prompt so the LLM picks the right agent for the task
- Persists to `.soly/agent` (if soly project) or `~/.pi-switch/agent` (standalone)
- Reads user agents from `~/.pi/agent/agents/*.md` on every cycle — drop a file and Ctrl+Tab to see it
- Silent switch — only the pill updates, chat stays clean

## How agents work

Agents are markdown files with YAML frontmatter. pi-subagents (and pi-switch) discover them from these locations:

| Path | Type | Editable |
|---|---|---|
| `~/.pi/agent/npm/node_modules/pi-subagents/agents/*.md` | built-in (worker, oracle, scout, reviewer) | ❌ |
| `~/.pi/agent/agents/*.md` | user-defined | ✅ |
| `~/.pi/agent/extensions/pi-soly/agents/*.md` (auto-installed if `useSolyWorkerSubagents: true` in `.soly/config.json`) | soly-manager (mode-switching subagent) | ✅ source |

### Frontmatter schema

```markdown
---
name: my-reviewer              # required, unique, [a-zA-Z0-9_-]{1,64}
description: One-liner shown in picker
thinking: medium               # off | minimal | low | medium | high | xhigh
systemPromptMode: replace      # replace | append
inheritProjectContext: true
inheritSkills: false
tools: read, grep, find, ls, bash, edit, write
defaultContext: fork           # fresh | fork
---

You are `my-reviewer`. The system prompt goes here.
```

## Create a new agent

### Option A: manually
Drop a markdown file in `~/.pi/agent/agents/<name>.md` (see schema above). Press `Ctrl+Tab` in pi — it joins the cycle.

### Option B: via slash command
```
/agent create my-debugger
```
You'll be prompted for a one-liner description. Then edit the file to specialize the system prompt.

## Test agents

| Action | How |
|---|---|
| See current + available | `/agent` |
| Cycle | `Ctrl+Tab` (or `F2`) |
| Set explicitly | `/agent soly-manager` |
| Diagnose | `/agent doctor` |
| Recommend for a task | `/agent recommend investigate React Server Components` |

The LLM can also auto-pick — see "Task → agent" below.

## Task → agent heuristics

The LLM's system prompt includes a table mapping task keywords to agents. When the user request matches, the LLM should call `/agent <name>` first, then `subagent({ agent: <name>, ... })`.

| Keywords | Agent | Why |
|---|---|---|
| scout, scan, map, where is, locate, skim | 🔍 scout | codebase recon |
| review, audit, check, adversarial, critique, qa | 👀 reviewer | adversarial review |
| oracle, decision, tradeoff, which approach, drift | 🔮 oracle | decision consistency |
| implement, build, write code, add feature, debug, fix, test, refactor, document, plan, validate | ⚡ soly-manager | workflow executor, mode-switches from task brief |
| (anything else) | ⚡ worker | generic implementation |

Same keywords in Russian work (изучи, баг, тест, etc.).

## Integration with other extensions

- **pi-soly** reads `globalThis.__PI_SWITCH_AGENT__` to know which cycle agent is active. Falls back to `"worker"` if pi-switch isn't loaded.
- **pi-soly** also auto-installs `soly-manager.md` (single mode-switching subagent) to `~/.pi/agent/agents/` when `useSolyWorkerSubagents: true` in `.soly/config.json`.

## Files

- `core.ts` — agent metadata, discovery, cycling, persistence
- `prompt.ts` — system-prompt section + task→agent heuristics + `recommendAgent`
- `index.ts` — footer pill, Ctrl+Tab / F2, `/agent` slash command, `/agent create`/`/agent doctor`/`/agent recommend`
- `tests/core.test.ts` — tests for core logic
- `tests/prompt.test.ts` — tests for prompt + recommendAgent
- `tests/index.test.ts` — tests for slash command parsing

## Development

```bash
cd packages/pi-soly/switch
bun test          # switch tests
bun run typecheck # tsc --noEmit
```
