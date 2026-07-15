---
name: agent-coach
description: Use when the user complains about how the agent wrote code or behaves — phrases like "переделай X по-другому", "мне не нравится что agent делает Y", "почему опять Z", "не делай так", "меня напрягает", "кринж", "убирай", "бесит", "agent keeps doing X", "I don't like the agent doing X", "заставь agent-а не делать X", "опять этот god switch", "redo differently", "annoying". Analyzes the complaint, identifies the missing rule that would have prevented it, and proposes a soly rule draft (.agents/rules/*.md) for the user to confirm via ask_pro. Language-agnostic — works for any codebase. NOT for C#/.NET analyzer rules (use analyzer-coach for that).
priority: high
---

# agent-coach

Convert a user complaint about agent behavior into a **soly rule** — a
markdown instruction file in `.agents/rules/` that goes into the system
prompt and prevents the agent from repeating the mistake.

The feedback loop: user corrects → rule persists → agent doesn't repeat.
Each complaint is a signal that a rule is **missing** (or exists but the
agent ignored it — investigate which).

## When to use me

| Symptom in user's message | Use this skill? |
|---|---|
| "переделай X по-другому" / "redo X differently" | **Yes** |
| "мне не нравится что agent делает Y" / "I don't like the agent doing Y" | **Yes** |
| "почему опять Z" / "why does it keep doing Z" | **Yes** |
| "не делай так" / "don't do that" | **Yes** |
| "agent keeps doing X" / "заставь agent-а не делать X" | **Yes** |
| Complaint about code style, naming, structure, approach | **Yes** |
| C#/.NET style complaint (Roslynator/Meziantou/CA-*) | **No** — use `analyzer-coach` |
| Formatting (indent, EOL, trailing whitespace) | **No** — `.editorconfig` |
| Code style a linter can check (eslint/biome/prettier) | **No** — linter config |
| Logic bug in the code | **No** — tests |
| "this rule fires too much" | **Yes, but inverted** — the rule should go, not be added |

## Mental model

A complaint means the agent did X, and the user wanted Y. The rule's job is
to make the agent do Y next time **without the user having to say it**.

**Good rule:** "Use `cancellationToken` not `ct` for C# cancellation tokens.
The short form is ambiguous in logs and stack traces." → Prevents the mistake.

**Bad rule:** "Don't write bad code." → Too vague, not actionable, ignored.

The rule must be **specific enough to act on** and **general enough to
recurring**. One complaint → one rule about the pattern, not about the
specific instance.

## Workflow (always follow these steps in order)

### Step 1 — Read the complaint + the code

Before analyzing, **read**:
- The user's complaint (what specifically bothers them — extract the
  concrete behavior, not the emotion)
- The code the agent wrote (the file(s) that triggered the complaint) —
  use `read` / `soly-snippet`
- The conversation context (what was the agent trying to do?)

**Extract the pattern.** "переделай god switch по-другому" is about a
specific instance, but the underlying pattern might be:
- "Don't create God classes/switches" (architecture)
- "Prefer polymorphism over giant switch statements" (design pattern)
- "Split switches with >5 cases into a dispatch table" (specific threshold)

Ask yourself: **what general principle, if the agent had known it, would
have prevented this?**

### Step 2 — Check existing rules (dedup)

Before proposing, **read existing rules** to avoid duplication:
- Use `soly-doc-search` with keywords from the complaint
- Or `/rules list` to see all rule files
- Or `soly-snippet` on `.agents/rules/*.md` files

If a rule already covers this but the agent ignored it:
- The rule may be too vague → propose **strengthening** it (edit, not new)
- The rule may not apply to the file's glob → propose adding globs
- The agent may have genuinely missed it → don't create a duplicate

If no rule covers it → proceed to Step 3.

### Step 3 — Categorize

Pick **one** category (auto-detect from the complaint content):

| Category | Path | Complaint is about |
|---|---|---|
| `coding` | `.agents/rules/coding/` | Code style, patterns, idioms, language conventions |
| `architecture` | `.agents/rules/architecture/` | Structure, layering, coupling, dependencies |
| `process` | `.agents/rules/process/` | Workflow, git hygiene, commit format, review process |
| `testing` | `.agents/rules/testing/` | Test structure, coverage, naming, fixtures |
| `naming` | `.agents/rules/naming/` | Identifier names, file names, conventions |

If unsure, default to `coding/` — it's the catch-all for code-level rules.

If the category directory doesn't exist, the `write` tool creates it
automatically (it creates parent directories).

### Step 4 — Draft the rule

Write the rule in **soly rule format**. Structure:

```markdown
---
description: "[one-line summary — what this rule enforces]"
globs: ["**/*.ts", "**/*.tsx"]  # optional: file patterns this applies to
priority: high  # high | medium | low (default medium)
---

# [Rule Name]

> **[One-line imperative.]** [Why it matters — the cost of violating.]

## The rule

[Concrete, actionable instruction. "Do X" not "consider X".
Reference the specific pattern. Include a threshold if applicable.]

[✓ Good example — code block showing the right way]
[✗ Bad example — code block showing what to avoid]

## Why

[The reasoning. Why does the user care? What goes wrong without this rule?
This section is what convinces the LLM to follow it, not just obey it.]

## Self-audit grep  # optional — only for grep-checkable rules

[If the violation is detectable by grep/rg, include a command the agent
can run to self-check. Skip for behavioral/process rules.]
```

**Writing principles:**
- **Imperative mood:** "Use X" not "You should use X" or "X is preferred"
- **Concrete threshold:** "Functions under 50 lines" not "Keep functions short"
- **Show both sides:** ✓ good + ✗ bad code blocks make it unambiguous
- **Explain why:** the "## Why" section is what makes the LLM internalize it
- **No filler:** every line earns its place; rules eat system prompt budget

### Step 5 — Propose via ask_pro

**Do not write the file yet.** Show the draft to the user via `ask_pro`:

```
ask_pro({
  questions: [{
    header: "New rule",
    question: "Create this rule to prevent the agent from repeating the issue?",
    options: [
      {
        label: "Create rule",
        description: "Write to .agents/rules/[category]/[name].md",
        recommended: true,
        preview: "<the full draft markdown in a fenced code block>"
      },
      {
        label: "Edit existing",
        description: "A similar rule exists — strengthen it instead",
        preview: "<diff showing what to add>"
      },
      {
        label: "Skip",
        description: "Don't create a rule — just fix the code this time"
      }
    ]
  }]
})
```

The `preview` field is key — it shows the user exactly what they're approving
in a side panel, formatted as code.

### Step 6 — Write (if confirmed)

If the user confirms "Create rule":
1. Use `write` to create the file at the chosen path
2. The hot-reload watcher picks it up automatically — no `/rules reload` needed
3. Emit a confirmation via `emit()` (if in soly context) or just tell the user

**File naming:** `kebab-case.md`, descriptive. `no-god-switches.md` not
`rule1.md` or `architecture-rule.md`.

## Anti-patterns (don't do these)

- ❌ **Don't create a rule for a one-off.** If the issue is specific to one
  file and unlikely to recur, just fix the code. Rules are for patterns.
- ❌ **Don't create vague rules.** "Write clean code" is useless. "Functions
  under 50 lines, extract helpers" is useful.
- ❌ **Don't duplicate linters.** If eslint/biome/prettier can enforce it,
  point the user there instead. Use `/rulewizard` to decide.
- ❌ **Don't skip the "## Why" section.** Without reasoning, the LLM treats
  the rule as arbitrary and may argue with it.
- ❌ **Don't auto-write without confirmation.** The user may want to rephrase,
  recategorize, or decide it's not rule-worthy. Always ask_pro first.
- ❌ **Don't create multiple rules from one complaint.** One complaint → one
  rule about the underlying pattern. Not five rules about symptoms.

## Integration with soly

- Rules created here are loaded by `loadAllRules()` on next session_start
  (or immediately via hot-reload if soly's watcher is active)
- They appear in `/rules list` and the system prompt's `## ⚠️ MANDATORY` block
- Priority: project rules (`.agents/rules/`) = 3, local overrides
  (`.agents/rules.local/`) = 5. Suggest `.agents/rules/` for team-shared
  conventions, `.agents/rules.local/` for personal preferences
- Frontmatter `globs` makes the rule apply only to matching files (saves
  prompt budget — a C# rule doesn't need to load for .ts files)

## Example session

**User:** "переделай god switch в customer-service.ts, мне не нравится"

**Agent (using this skill):**

1. Reads `customer-service.ts` — finds a 200-line switch on customer type
2. Searches existing rules — `/rules list` shows no switch-related rule
3. Categorizes → `architecture/` (structural issue, not just style)
4. Drafts:

```markdown
---
description: "Avoid giant switch statements — use dispatch maps or polymorphism"
globs: ["**/*.ts"]
priority: medium
---

# No God Switches

> **Switches with >5 cases must be refactored to a dispatch table.** Giant
> switches are unmaintainable and violate the open-closed principle.

## The rule

When a `switch` statement exceeds 5 cases (or a single case exceeds 20
lines), refactor to:
- A `Record<Case, Handler>` dispatch map (for simple dispatch)
- Polymorphism (when cases share behavior — subclasses + virtual method)

[✓ good: dispatch map example]
[✗ bad: 50-case switch example]

## Why

Giant switches grow linearly with new cases, are hard to test in isolation,
and make the agent tend to add "just one more case" instead of refactoring.
The user has to review the entire switch to verify one case is safe.
```

5. Shows via ask_pro with the full draft in `preview`
6. User confirms → writes to `.agents/rules/architecture/no-god-switches.md`
7. Hot-reload picks it up → rule is active for the next turn
