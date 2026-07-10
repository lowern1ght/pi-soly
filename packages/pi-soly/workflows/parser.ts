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
//   - The handler transforms the input into a detailed LLM instruction the
//     model follows INLINE, in this session (the same instruction the
//     `soly_workflow` tool returns). No external subagent plugin.
//
// This module is pure parsing — no I/O, no extension state. Trivial to unit
// test in isolation.
// =============================================================================

/** Verbs currently supported by the workflow handlers. */
export type WorkflowVerb =
	| "execute" | "pause" | "compact" | "resume" | "status" | "log" | "diff"
	| "plan" | "discuss" | "help" | "doctor" | "iterations" | "phase" | "todos" | "verify"
	| "new" | "done" | "migrate";

/**
 * Validate `<slug>` (e.g. `statistic-preparation`). Returns parsed parts or
 * an error message. Pure — no I/O. Shared by `soly new` (workflows/new.ts)
 * and the plan-mode dispatch in `describePlanTarget` / `describeExecuteTarget`.
 *
 * Convention: a plan is a kebab-case slug that doubles as the git branch
 * name. No type prefix — we dropped the Conventional-Branches `<type>/<name>`
 * shape after 1.15.x because the type adds noise without information for
 * `soly new` users (the branch list itself is the registry, and the prefix
 * doesn't help readers pick the right branch).
 *
 * Examples:
 *   soly new statistic-preparation
 *   soly new login-redirect-bug
 *   soly new stats-rollup
 *
 * If the input doesn't match the strict kebab-case shape, we attempt
 * to auto-slugify it (lowercase, replace non-slug chars with `-`,
 * collapse, trim). For free-form prose like "this is a feature" or
 * even Cyrillic text, the auto-slugified result becomes the plan name
 * and the original input is preserved as the plan's description so
 * the LLM has the human-authored context.
 */
export function parsePlanName(
	raw: string,
): { name: string; prefix: string | null; autoSlugified: boolean; originalInput: string } | { error: string; tried: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { error: "missing plan name", tried: "" };

	// Strict regex: ASCII alphanumerics + hyphen, must start and end with
	// an alnum. The kebab-case shape we want to encourage.
	// Unicode regex used for the lenient path below (e.g. Cyrillic, accents).
	const SLUG_STRICT = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
	const SLUG_LENIENT = /^[\p{L}\p{N}][\p{L}\p{N}_-]*[\p{L}\p{N}]$/u;
	const MAX_LEN = 64;
	const MIN_LEN = 2;

	/** Lowercase, replace non-slug chars with `-`, collapse, trim. */
	const autoSlugify = (s: string): string =>
		s
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^\p{L}\p{N}_-]/gu, "-")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "");

	// Optional `<prefix>/<slug>` form: prefix is one kebab-case word
	// (no internal slashes), slug is the same kebab-case shape. Examples:
	//   feature/statistic-preparation
	//   fix/login-redirect-bug
	//   chore/upgrade-deps
	// Plan dirs flatten the slash: `.agents/plans/<prefix>-<slug>`.
	const slashIdx = trimmed.indexOf("/");
	if (slashIdx > 0) {
		const prefix = trimmed.slice(0, slashIdx);
		const slug = trimmed.slice(slashIdx + 1);
		const prefixOk = SLUG_STRICT.test(prefix);
		const slugOk = SLUG_STRICT.test(slug);
		if (!prefixOk || !slugOk) {
			return {
				error:
					`bad plan name "${trimmed}".\n` +
					`\nExpected: <prefix>/<slug>  (e.g. "feature/login-redirect-bug")\n` +
					`  prefix: one kebab-case word (e.g. "feature", "fix", "chore")\n` +
					`  slug:   kebab-case (lowercase letters, digits, hyphens)\n` +
					`\nTip: pass free-form prose instead and soly will auto-slugify:\n` +
					`  soly new "add a button to the settings page"  →  add-a-button-to-the-settings-page`,
				tried: trimmed,
			};
		}
		return { name: slug, prefix, autoSlugified: false, originalInput: trimmed };
	}

	// Plain slug form. If it's already kebab-case, accept as-is.
	// Exception: pure-digit strings are reserved for phase numbers
	// (`soly plan 11` → phase 11), not slugs.
	if (
		SLUG_STRICT.test(trimmed) &&
		/[a-z]/.test(trimmed) &&
		trimmed.length >= MIN_LEN &&
		trimmed.length <= MAX_LEN
	) {
		return { name: trimmed, prefix: null, autoSlugified: false, originalInput: trimmed };
	}

	// Otherwise, try to auto-slugify (handles free-form prose, Cyrillic,
	// accented chars, mixed punctuation). The result must be a valid slug
	// under the lenient Unicode regex.
	//
	// Exception: pure-digit strings (e.g. "11") are reserved for phase
	// numbers (`soly plan 11` → phase 11), not slugs. Don't auto-slugify them.
	const candidate = autoSlugify(trimmed);
	const isPureDigits = /^\d+$/.test(candidate);
	if (
		!isPureDigits &&
		candidate.length >= MIN_LEN &&
		candidate.length <= MAX_LEN &&
		SLUG_LENIENT.test(candidate)
	) {
		return { name: candidate, prefix: null, autoSlugified: true, originalInput: trimmed };
	}

	// Couldn't make anything valid out of the input. Surface a clear error
	// that explains what we tried and what works.
	return {
		error:
			`bad plan name "${trimmed}".\n` +
			`\nExpected: <slug> OR <prefix>/<slug>\n` +
			`  length: ${MIN_LEN}-${MAX_LEN} chars\n` +
			`  chars:  Unicode letters/digits/hyphens/underscores (auto-slugified to kebab-case)\n` +
			`\nTip: pass the plan description as a free-form string and soly will\n` +
			`auto-slugify it for you:\n` +
			`  soly new "add a button to the settings page"  →  add-a-button-to-the-settings-page\n` +
			`\nOr pick a short kebab-case name yourself:\n` +
			`  soly new statistic-preparation`,
		tried: candidate,
	};
}

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
		verb !== "new" &&
		verb !== "done" &&
		verb !== "migrate"
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
	const m = s.match(/^([a-z0-9][a-z0-9-]*)-([a-f0-9]{4})$/i);
	if (!m) return null;
	// Normalize to lowercase hex so downstream comparisons match.
	return `${m[1]}-${m[2].toLowerCase()}`;
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
	| { kind: "plan"; name: string; prefix: string | null; autoSlugified: boolean; originalInput: string; raw: string }
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

	// <slug> plan name — same identifier model as `soly new`. Checked AFTER
	// task ids because some task ids look exactly like plan slugs (e.g.
	// `auth-be-login-a3f9` matches the kebab-case regex). Task-id check
	// is more specific (trailing 4-hex) so it wins.
	const taskId = parseTaskIdShape(target);
	if (taskId) {
		return { kind: "task", taskId, raw };
	}

	// Check phase shape FIRST — pure digits and NN.MM patterns are phase
	// numbers, not plan slugs. Must come before parsePlanName because
	// auto-slugify would turn "11.02" into "11-02" (a valid plan slug).
	const phase = parsePhaseShape(target);
	if (phase) {
		return { kind: "phase", phase: phase.phase, plan: phase.plan, raw };
	}

	const plan = parsePlanName(target);
	if (!("error" in plan)) {
		return { kind: "plan", name: plan.name, prefix: plan.prefix, autoSlugified: plan.autoSlugified, originalInput: plan.originalInput, raw };
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
 *   plan     — plan a `<type>/<name>` plan (`.agents/plans/<name>/PLAN.md`)
 *   task     — plan (write/flesh out PLAN.md for) an existing task
 *   new-task — create a brand-new task dir + PLAN.md (with frontmatter)
 *   feature  — plan all ready tasks in a feature
 */
export type PlanTarget =
	| { kind: "phase"; phase: number; raw: string }
	| { kind: "plan"; name: string; prefix: string | null; autoSlugified: boolean; originalInput: string; raw: string }
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

	// <slug> plan name (e.g. statistic-preparation) — plans live at
	// .agents/plans/<slug>/PLAN.md, identity is the branch name. Checked
	// AFTER task ids because some task ids look exactly like plan slugs
	// (e.g. `auth-be-login-a3f9` matches the kebab-case regex). Task-id
	// check is more specific (trailing 4-hex) so it wins.
	const taskId = parseTaskIdShape(target);
	if (taskId) {
		return { kind: "task", taskId, raw };
	}

	// Check phase shape FIRST — pure digits are phase numbers, not slugs.
	// Must come before parsePlanName because auto-slugify would turn digits
	// into a valid plan slug.
	const phase = parsePhaseOnlyShape(target);
	if (phase) {
		return { kind: "phase", phase: phase.phase, raw };
	}

	const plan = parsePlanName(target);
	if (!("error" in plan)) {
		return { kind: "plan", name: plan.name, prefix: plan.prefix, autoSlugified: plan.autoSlugified, originalInput: plan.originalInput, raw };
	}

	return null;
}
