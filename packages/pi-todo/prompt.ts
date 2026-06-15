// =============================================================================
// prompt.ts — System-prompt section for the pi-todo extension
// =============================================================================
//
// Injected via `before_agent_start`. Tells the LLM when (and when not) to
// use `todo_update`, plus the rules (one in_progress, max 10, etc.).
// =============================================================================

export function buildTodoSection(): string {
	return `

## pi-todo — visible task list (footer)

\`todo_update\` renders a live checklist in the footer that the user can see in real time. Use it for any multi-step work (≥3 steps, or any plan with sub-tasks).

DO:
- Seed todos at the START of a multi-step task (before any code changes)
- Mark \`in_progress\` → \`completed\` as you work (one at a time)
- Set \`activeForm\` ("Adding user model", not "Add user model") so the user sees the live action
- Keep \`content\` short (1 short line, imperative form)

DON'T:
- Use for single-step tasks (just do it)
- Update for every tool call — batch related steps into one todo
- Add more than 10 todos (overhead > signal after that)
- Leave multiple items \`in_progress\` at once (exactly 1, or 0 if all done)
- Forget to clear the list (\`todo_update({todos: []})\`) when the work is done

Schema: \`todo_update({ todos: [{ content, status: "pending"|"in_progress"|"completed", activeForm }] })\`. Status transitions:
- \`pending\` → \`in_progress\` (starting work)
- \`in_progress\` → \`completed\` (finished)
- \`pending\` → \`completed\` (skip — was trivial in the end)
`;
}
