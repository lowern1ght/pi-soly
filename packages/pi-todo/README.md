# pi-todo — visible, real-time task list for pi

A tiny pi extension that gives the LLM a live, user-visible task list. LLM
calls `todo_update` to track multi-step work, the user sees a compact checklist
in the footer (e.g. `todos 1/5 ⋯ Adding auth middleware`).

Inspired by Claude Code's `TodoWrite`. Generic, reusable by any pi session —
not tied to soly, but **integrates automatically with soly** when both are
installed (todos are written to `.soly/todos.json` and surfaced in soly's
status line).

## Install

Drop the `pi-todo/` directory in `~/.pi/agent/extensions/`. No config
required. No `package.json` deps.

```bash
ls ~/.pi/agent/extensions/pi-todo/
# index.ts  todo-store.ts  prompt.ts  tests/  package.json  tsconfig.json
```

## What it does

### 1. Registers one LLM tool: `todo_update`

The LLM calls this to maintain a live task list. Schema:

```ts
todo_update({
  todos: [
    { content: "Add user model",        status: "in_progress", activeForm: "Adding user model" },
    { content: "Add auth middleware",   status: "pending",     activeForm: "Adding auth middleware" },
    { content: "Wire up routes",        status: "pending",     activeForm: "Wiring up routes" },
  ]
})
```

**Rules** (enforced by validation, error message is precise):
- Max **10** items
- **Exactly 0 or 1** `in_progress` at a time
- `content` + `activeForm` required, non-empty, max 200 chars
- No duplicate `content`
- Status must be `pending` | `in_progress` | `completed`

Empty list (`todo_update({todos: []})`) clears the list.

### 2. Injects a system-prompt section

Tells the LLM **when** to use `todo_update` (multi-step work, ≥3 steps) and
**when not to** (single-step, every tool call). The full guidance is in
`prompt.ts`.

### 3. Renders the list in the footer

`pi.setStatus("pi-todo", "todos 1/5 ⋯ Adding auth middleware")`. Updated on
every `todo_update` call. Pass `undefined` to hide when the list is empty.

### 4. Persists state to disk

- **soly mode** (`.soly/` exists in cwd): writes `.soly/todos.json` — soly
  picks it up and shows the count in its own status line.
- **standalone** (no `.soly/`): writes `.pi-todos.json` in cwd.

On `session_start` pi-todo auto-loads any persisted state so you can resume
mid-task across sessions.

## Soly integration

If **soly** is also installed and you run `soly doctor`, it will report
`pi-todo extension (cross-extension) (pass)` when `todo_update` is in the
active tools list, or `(info)` if not (with a hint to install pi-todo).

If you run `soly execute <plan>`, the workflow template
(`workflows-data/execute-plan.md`) tells the LLM to call `todo_update` at
the start of the plan with one item per `<task>`, and to clear the list
when the SUMMARY is committed. The user sees a live checklist while the
worker executes the plan.

Soly's own status line shows `todos N/M` automatically when
`.soly/todos.json` exists.

## Limits

- Max 10 items per call (more = noise)
- In-memory + disk only (no sharing across machines)
- One extension instance per pi session
- Footer status line is plain text (no TUI widget — keeps it cheap)

## Files

- `index.ts` — extension entry, registers tool + system prompt + status
- `todo-store.ts` — TodoItem / TodoState, validateTodos, buildStatusLine,
  persistTodos, loadTodos, todoFilePath
- `prompt.ts` — buildTodoSection (system-prompt section)
- `tests/todo-store.test.ts` — 28 tests for validation + persistence
- `tests/prompt.test.ts` — 7 tests for system-prompt content

## Development

```bash
cd ~/.pi/agent/extensions/pi-todo
bun test          # 35 tests
bun run typecheck # tsc --noEmit
```
