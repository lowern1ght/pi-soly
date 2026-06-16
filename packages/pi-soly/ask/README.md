# pi-ask — Claude Code-style multi-question picker for pi

A small pi-coding-agent extension that registers one tool (`ask_pro`) for
showing a **tabbed, multi-question picker** in pi's TUI. Inspired by Claude
Code's `AskUserQuestion`.

## Features

- **Multi-question** — pass a list of questions; the user navigates between
  them with `Tab` / `Shift+Tab` or arrow keys
- **Numbered options** — `1`–`4` instant-pick
- **Recommended answer** — first option (or the one with `recommended: true`)
  is marked ⭐
- **Single-select** (default) — Enter on an option auto-advances to the next
  question; on the last question, Enter submits
- **Multi-select** — Enter toggles checkboxes; the last question shows a
  visible "Submit" row
- **Cancelled detection** — `Esc` resolves `{cancelled: true}`

## Usage from an LLM

```ts
ask_pro({
  questions: [
    {
      header: "Auth",                         // 1-2 word tab label
      question: "Which auth approach?",
      options: [
        { label: "JWT in httpOnly cookie", description: "Stateless, scales horizontally", recommended: true },
        { label: "JWT in localStorage",     description: "Simpler client, XSS risk" },
        { label: "Server sessions + Redis",  description: "Revocable, but extra dep" },
      ],
      multiSelect: false,
    },
    {
      header: "Tokens",
      question: "Token storage?",
      options: [
        { label: "httpOnly cookie" },
        { label: "Bearer in Authorization" },
      ],
    },
  ],
})
```

Result:

```ts
// user picked "JWT in httpOnly cookie" + "Bearer in Authorization":
{ answers: { 0: 0, 1: 1 } }

// user pressed Esc:
{ cancelled: true }
```

## UX

```
┌─ pi-ask — 2 questions ────────────────────────────────────────┐
│ ◉ Auth    ○ Tokens                                              │
│                                                                 │
│ Q1 of 2: Which auth approach?                                  │
│                                                                 │
│   ❯ ⭐ JWT in httpOnly cookie                                   │
│       Stateless, scales horizontally                            │
│                                                                 │
│     JWT in localStorage                                         │
│     Simpler client, XSS risk                                    │
│                                                                 │
│     Server sessions + Redis                                     │
│     Revocable, but extra dependency                              │
│                                                                 │
│ ↑↓ navigate · 1-3 pick · tab/→ next · ⏎ next · esc cancel      │
└─────────────────────────────────────────────────────────────────┘
```

## Keys

| Key | Action |
|---|---|
| `↑` / `k` | Move option up |
| `↓` / `j` | Move option down |
| `1` – `4` | Instant-pick that option |
| `Tab` / `→` | Next question |
| `Shift+Tab` / `←` / `Backspace` | Previous question |
| `Space` | Multi-select only: toggle the current option. On "Other…", opens the input dialog. |
| `Enter` | **Single-select:** confirm + advance (or submit on last). **Multi-select:** advance to next question (or submit on last + all answered). Does NOT toggle. |
| `Esc` | Cancel (returns `{cancelled: true}`) |

Multi-select follows the Claude Code convention: **Space toggles, Enter
advances/submits**. Single-select uses Enter as the universal action key
(toggle/pick + advance). When you're on the last question and all
questions are answered, the footer shows `⏎ submit` in accent color.

## Limits

- 2–4 options per question (more is bad UX; the picker is meant for focused
  choices, not long lists)
- 1–6 questions per call (more = tab-switching fatigue)
- At most 1 `recommended: true` per question
- TUI and RPC modes only (`hasUI: true`); print mode returns an error

## Setup

Drop the directory in `~/.pi/agent/extensions/`:

```bash
ls ~/.pi/agent/extensions/pi-ask/
# index.ts picker.ts tests/ package.json tsconfig.json README.md
```

pi auto-discovers and loads it on next start. The `ask_pro` tool is then
available to the LLM. No config required.

## Development

```bash
cd ~/.pi/agent/extensions/pi-ask
bun test              # runs tests/picker.test.ts
bun run typecheck     # tsc --noEmit
```

CI: not configured (this is a single-file TUI component, low risk).
Add `.github/workflows/ci.yml` if you want green-tick PRs.

## Why a separate extension?

The picker is **generic** — any pi extension (soly, your own tool, etc.) can
use `ask_pro` to drive multi-question Q&A without re-implementing the TUI.
Keeping it separate from soly means:

- soly stays focused on the plan/execute/discuss workflow
- other extensions can adopt the same UX pattern
- the picker can evolve independently (new key bindings, themes, layouts)
