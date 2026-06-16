// =============================================================================
// prompt.ts — System-prompt section for the pi-switch extension
// =============================================================================

/** Task-pattern → recommended agent. The LLM reads this and decides
 *  whether to invoke /agent before launching subagent(...). Match is
 *  by keyword (case-insensitive). First match wins; ties broken by order. */
export const TASK_AGENT_HINTS: ReadonlyArray<{
	pattern: RegExp;
	agent: string;
	emoji: string;
	why: string;
}> = [
	// English keywords (use \b — ASCII word boundary works for English)
	{ pattern: /\b(research|investigate|look\s*up|find\s*out|explore|survey|compare\s+libraries|what\s+is\s+the\s+best)\b/i,
	  agent: "researcher", emoji: "\ud83d\udcda",
	  why: "external docs, ecosystem behavior, primary sources" },
	{ pattern: /\b(scout|scan|map|find\s+all|where\s+is|locate|explore\s+codebase|skim)\b/i,
	  agent: "scout", emoji: "\ud83d\udd0d",
	  why: "codebase recon, patterns, file locations" },
	{ pattern: /\b(plan|design|architect|outline|structure|break\s*down|steps|order)\b/i,
	  agent: "worker", emoji: "\ud83d\udccb",
	  why: "decompose into ordered steps, identify risks" },
	{ pattern: /\b(review|audit|check|adversarial|critique|find\s+bugs|qa)\b/i,
	  agent: "reviewer", emoji: "\ud83d\udc40",
	  why: "adversarial review of correctness, security, style" },
	{ pattern: /\b(oracle|decision|tradeoff|compare|which\s+approach|is\s+this\s+wise|drift)\b/i,
	  agent: "oracle", emoji: "\ud83d\udd2e",
	  why: "decision consistency, hidden assumptions, drift detection" },
	{ pattern: /\b(debug|bug|fix|crash|error|stack\s*trace|repro|why\s+is\s+this\s+broken)\b/i,
	  agent: "worker", emoji: "\ud83d\udc1e",
	  why: "isolated bug investigation with minimal repro" },
	{ pattern: /\b(test|tests|coverage|spec|assert)\b/i,
	  agent: "worker", emoji: "\ud83e\uddea",
	  why: "test-only work, never modifies prod code" },
	{ pattern: /\b(refactor|clean\s*up|simplify|extract|rename|restructure|no\s+behavior\s+change)\b/i,
	  agent: "worker", emoji: "\ud83d\udd04",
	  why: "pure refactoring, behavior-preserving" },
	{ pattern: /\b(document|docs|readme|jsdoc|comment|annotate)\b/i,
	  agent: "worker", emoji: "\ud83d\udcdd",
	  why: "doc updates, READMEs, inline annotations" },
	{ pattern: /\b(implement|build|write\s+code|add\s+feature|create\s+the)\b/i,
	  agent: "worker", emoji: "\u26a1",
	  why: "generic implementation with all tools" },
	{ pattern: /\b(orchestrate|coordinate|dispatch|chain|run\s+in\s+parallel|first\s+.+\s+then)\b/i,
	  agent: "worker", emoji: "\ud83e\udd1d",
	  why: "multi-agent orchestration" },
	// Russian keywords (loose match — Russian words inflect heavily; we match
	// word stems, accepting some false positives as the cost of broader coverage)
	{ pattern: /(изуч|исслед|разузн|найди\s+инфу|research|investigate|find\s+out)/i,
	  agent: "researcher", emoji: "\ud83d\udcda",
	  why: "external docs, ecosystem behavior, primary sources" },
	{ pattern: /(где\s+это|где\s+находит|find\s+all|locate)/i,
	  agent: "scout", emoji: "\ud83d\udd0d",
	  why: "codebase recon, patterns, file locations" },
	{ pattern: /(спланир|plan|design|architect)/i,
	  agent: "worker", emoji: "\ud83d\udccb",
	  why: "decompose into ordered steps, identify risks" },
	{ pattern: /(проверь|ревью|аудит|review|audit)/i,
	  agent: "reviewer", emoji: "\ud83d\udc40",
	  why: "adversarial review of correctness, security, style" },
	{ pattern: /(решени|выбор|decision|tradeoff|drift)/i,
	  agent: "oracle", emoji: "\ud83d\udd2e",
	  why: "decision consistency, hidden assumptions, drift detection" },
	{ pattern: /(баг|ошибк|почему\s+(?:падает|ломает)|debug|bug|crash|stack\s*trace|repro)/i,
	  agent: "worker", emoji: "\ud83d\udc1e",
	  why: "isolated bug investigation with minimal repro" },
	{ pattern: /(тест|покрыт|test|coverage|spec|assert)/i,
	  agent: "worker", emoji: "\ud83e\uddea",
	  why: "test-only work, never modifies prod code" },
	{ pattern: /(рефактор|упрост|refactor|simplify|extract|restructure)/i,
	  agent: "worker", emoji: "\ud83d\udd04",
	  why: "pure refactoring, behavior-preserving" },
	{ pattern: /(документ|описани|document|readme|jsdoc)/i,
	  agent: "worker", emoji: "\ud83d\udcdd",
	  why: "doc updates, READMEs, inline annotations" },
	{ pattern: /(реализуй|сделай|напиши|создай|implement|build|add\s+feature|create\s+the)/i,
	  agent: "worker", emoji: "\u26a1",
	  why: "generic implementation with all tools" },
	{ pattern: /(оркестрируй|координируй|orchestrate|coordinate|dispatch|chain)/i,
	  agent: "worker", emoji: "\ud83e\udd1d",
	  why: "multi-agent orchestration" },
];

/** Heuristic: which agent does the task look like? Returns null if no
 *  pattern matches (caller should leave the current agent as-is). */
export function recommendAgent(taskText: string): { agent: string; emoji: string; why: string } | null {
	for (const hint of TASK_AGENT_HINTS) {
		if (hint.pattern.test(taskText)) {
			return { agent: hint.agent, emoji: hint.emoji, why: hint.why };
		}
	}
	return null;
}

export function buildPiSwitchSection(): string {
	return `

## pi-switch — when to use \`/agent\`

The \`/agent\` slash command + \`Ctrl+Tab\` shortcut cycle through 4 built-in cycle agents. Use the right one for the job:

- **Read-only / no edits** (oracle, scout, reviewer): for analysis, planning, review. They won't modify files.
- **Write tools** (worker): for implementation.
- **User-defined** in \`~/.pi/agent/agents/\`: any agent the user has added — drop a markdown file with YAML frontmatter (name, description) and it joins the cycle automatically.

The current agent is shown in the footer status line as \`[emoji name]\`.

When you need a specialist for a sub-task, use the right agent via the parent LLM's \`subagent(...)\` call.

**No soly subagent.** As of 1.3.0, soly no longer ships a subagent. The LLM in the main session executes plans directly using the slash commands (\`/plan\`, \`/execute\`, etc.) and the \`soly-framework\` skill. Use pi's built-in subagents (\`worker\`, \`oracle\`, \`scout\`, \`reviewer\`) for read-only research.

**Task → agent heuristics.** Before launching a generic \`subagent(...)\`, scan the request for these keywords:

| Keywords in request | Suggested agent | Why |
|---|---|---|
| scout, scan, map, find all, where is, locate, explore codebase, skim | 🔍 scout | codebase recon, patterns, file locations |
| review, audit, check, adversarial, critique, find bugs, qa | 👀 reviewer | adversarial correctness, security, style review |
| oracle, decision, tradeoff, compare, which approach, is this wise, drift | 🔮 oracle | decision consistency, hidden assumptions |
| (anything else, including implement, debug, fix, test, refactor, document, plan) | ⚡ worker | generic implementation, all tools — prefer to do it yourself |

For multi-step tasks, the orchestrator (you) decides which agents run and in what order. You can chain agents via \`subagent({ chain: [...] })\` or run them in parallel via parallel tasks.

DON'T:
- Launch a worker for analysis (use oracle/scout/reviewer)
- Launch an oracle for implementation (it has no write tools)
- Spawn \`soly-manager\` / \`soly-worker\` / etc. — there are no soly subagents anymore (as of 1.3.0)
- Spawn soly-worker / soly-debugger / soly-tester — there is only \`soly-manager\`
- Manually edit \`.soly/agent\` or \`~/.pi-switch/agent\` — use the slash command
`;
}
