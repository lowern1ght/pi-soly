// =============================================================================
// workflows/parser.ts — Shared `soly <verb> <args>` parser
// =============================================================================
//
// Parses user input like "soly execute 11" or "soly pause" into a structured
// command that each workflow handler can dispatch on.
//
// Convention:
//   - User types exactly "soly <verb> <args...>" (lowercase required for match)
//   - The extension intercepts via the `input` event (no slash-command needed)
//   - The handler transforms the input into a detailed LLM instruction that
//     delegates to the `subagent(...)` tool (provided by pi-subagents)
//
// This module is pure parsing — no I/O, no extension state. Trivial to unit
// test in isolation.
// =============================================================================

/** Verbs currently supported by the workflow handlers. */
export type WorkflowVerb =
	| "execute" | "pause" | "compact" | "resume" | "status" | "log" | "diff"
	| "plan" | "discuss" | "help" | "doctor" | "iterations" | "phase" | "todos" | "verify"
	| "new";

export interface SolyCommand {
	verb: WorkflowVerb;
	args: string[];
	/** Original input, for logging/debugging. */
	raw: string;
}

/**
 * Try to parse `text` as a `soly <verb> <args>` command.
 * Returns null if the text doesn't match the convention.
 *
 * Whitespace is normalized; case is preserved for args but verb is matched
 * case-insensitively to be friendly.
 */
export function parseSolyCommand(text: string): SolyCommand | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	// Reject the slash-command form ("/soly ...") — that's pi's territory;
	// we want plain "soly ..." text input only.
	if (trimmed.startsWith("/")) return null;
	const lower = trimmed.toLowerCase();
	// Plain "soly" (no verb) → "help" picker
	if (lower === "soly" || lower === "soly ") {
		return { verb: "help", args: [], raw: trimmed };
	}
	// Case-insensitive `soly` prefix (so "SOLY Execute 11" matches).
	if (!lower.startsWith("soly ")) return null;

	const tokens = trimmed.split(/\s+/);
	// tokens[0] === "soly"
	const verbRaw = (tokens[1] ?? "").toLowerCase();
	const verb = verbRaw as WorkflowVerb;
	if (
		verb !== "execute" &&
		verb !== "pause" &&
		verb !== "compact" &&
		verb !== "resume" &&
		verb !== "status" &&
		verb !== "log" &&
		verb !== "diff" &&
		verb !== "plan" &&
		verb !== "discuss" &&
		verb !== "help" &&
		verb !== "doctor" &&
		verb !== "iterations" &&
		verb !== "phase" &&
		verb !== "todos" &&
		verb !== "verify" &&
		verb !== "new"
	) {
		return null;
	}

	return {
		verb,
		args: tokens.slice(2),
		raw: trimmed,
	};
}

// =============================================================================
// Shared target-parsing helpers
// =============================================================================
//
// These are used by both `describeExecuteTarget` and `describePlanTarget` to
// avoid duplicating the regex / flag-extraction logic. Pure functions, no
// I/O, no extension state.
// =============================================================================

/** Shape of an already-tokenized `soly <verb> ...` args list. */
interface ArgsShape {
	raw: string;
	flags: string[];
	positional: string;
}

function parseArgsShape(args: string[]): ArgsShape {
	const raw = args.join(" ").trim();
	if (!raw) return { raw: "", flags: [], positional: "" };
	return {
		raw,
		flags: args.filter((a) => a.startsWith("--")),
		positional: args.find((a) => !a.startsWith("--")) ?? "",
	};
}

/** Match `<N>` or `<N.MM>` (phase / plan). Returns null if not a phase shape. */
function parsePhaseShape(s: string): { phase: number; plan: number | null } | null {
	const m = s.match(/^(\d+)(?:\.(\d+))?$/);
	if (!m) return null;
	return {
		phase: parseInt(m[1], 10),
		plan: m[2] != null ? parseInt(m[2], 10) : null,
	};
}

/** Match `<N>` only — for `soly plan`, which never has a plan sub-index. */
function parsePhaseOnlyShape(s: string): { phase: number } | null {
	const m = s.match(/^(\d+)$/);
	if (!m) return null;
	return { phase: parseInt(m[1], 10) };
}

/** Match task-id `<slug>-<4hex>`, case-insensitive. */
function parseTaskIdShape(s: string): string | null {
	return s.match(/^[a-z0-9][a-z0-9-]*-[a-f0-9]{4}$/i) ? s : null;
}

/** Extract `--feature <name>` from args. Returns null if not present or invalid. */
function parseFeatureFlag(args: string[]): string | null {
	const idx = args.indexOf("--feature");
	if (idx === -1) return null;
	const feature = args[idx + 1];
	return feature && !feature.startsWith("--") ? feature : null;
}

/** Extract `--new-task <slug>` together with `--feature <name>`. */
function parseNewTaskFlag(
	args: string[],
): { slug: string; feature: string } | null {
	const idx = args.indexOf("--new-task");
	const feature = parseFeatureFlag(args);
	if (idx === -1 || !feature) return null;
	const slug = args[idx + 1];
	if (!slug || slug.startsWith("--")) return null;
	return { slug, feature };
}

// =============================================================================
// execute target
// =============================================================================

/**
 * What `soly execute ...` should target. Dual-mode: phases and tasks
 * live side by side.
 */
export type ExecuteTarget =
	| { kind: "phase"; phase: number; plan: number | null; raw: string }
	| { kind: "task"; taskId: string; raw: string }
	| { kind: "all"; raw: string }
	| { kind: "feature"; feature: string; raw: string };

/**
 * Parse `soly execute <args>` into a structured target.
 *
 * Recognized forms:
 *   <N>           — execute all plans in phase N
 *   <N.MM>        — execute a specific plan
 *   <task-id>     — execute a specific task (slug-hash, e.g. auth-be-login-a3f9)
 *   --all         — execute all ready tasks (sequential in v0.1)
 *   --feature <n> — execute all tasks in a feature (sequential in v0.1)
 *
 * Returns null when args are missing or malformed.
 */
export function describeExecuteTarget(args: string[]): ExecuteTarget | null {
	const { raw, flags, positional } = parseArgsShape(args);
	if (!raw) return null;

	// --all / --all-ready
	if (flags.includes("--all") || flags.includes("--all-ready")) {
		return { kind: "all", raw };
	}

	// --feature <name>
	const feature = parseFeatureFlag(args);
	if (feature) {
		return { kind: "feature", feature, raw };
	}

	const target = positional.trim();
	if (!target) return null;

	const phase = parsePhaseShape(target);
	if (phase) {
		return { kind: "phase", phase: phase.phase, plan: phase.plan, raw };
	}

	const taskId = parseTaskIdShape(target);
	if (taskId) {
		return { kind: "task", taskId, raw };
	}

	return null;
}

// =============================================================================
// plan target
// =============================================================================

/**
 * What `soly plan ...` should target. Dual-mode with execute.
 *
 *   phase    — plan a phase
 *   task     — plan (write/flesh out PLAN.md for) an existing task
 *   new-task — create a brand-new task dir + PLAN.md (with frontmatter)
 *   feature  — plan all ready tasks in a feature
 */
export type PlanTarget =
	| { kind: "phase"; phase: number; raw: string }
	| { kind: "task"; taskId: string; raw: string }
	| { kind: "new-task"; slug: string; feature: string; raw: string }
	| { kind: "feature"; feature: string; raw: string };

/**
 * Parse `soly plan <args>` into a structured target.
 *
 * Recognized forms:
 *   <N>                          — plan phase N
 *   <task-id>                    — plan existing task (PLAN.md already exists, flesh it out)
 *   --new-task <slug> --feature <n>  — create new task dir + PLAN.md skeleton
 *   --feature <n>                — plan all ready tasks in a feature
 *
 * Returns null when args are missing or malformed.
 */
export function describePlanTarget(args: string[]): PlanTarget | null {
	const { raw, positional } = parseArgsShape(args);
	if (!raw) return null;

	// --new-task <slug> --feature <name>  (order-independent)
	const newTask = parseNewTaskFlag(args);
	if (newTask) {
		return { kind: "new-task", slug: newTask.slug, feature: newTask.feature, raw };
	}

	// --feature <name>  (only when it's the only flag — disambiguate from
	// the new-task case above where --feature is also present)
	const feature = parseFeatureFlag(args);
	if (feature) {
		return { kind: "feature", feature, raw };
	}

	const target = positional.trim();
	if (!target) return null;

	// Plan target only matches plain N (no .MM — plan is per-phase, executed
	// at the phase level by `soly execute <N.MM>`).
	const phase = parsePhaseOnlyShape(target);
	if (phase) {
		return { kind: "phase", phase: phase.phase, raw };
	}

	const taskId = parseTaskIdShape(target);
	if (taskId) {
		return { kind: "task", taskId, raw };
	}

	return null;
}
