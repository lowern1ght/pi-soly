// =============================================================================
// mode/branch-prompt.ts — branch-naming ask_pro options
// =============================================================================
//
// Replaces the old `defaultBranchPrefix` config field. When the LLM scaffolds
// a new plan/phase, it asks the user for the prefix via ask_pro instead of
// auto-applying a project default.
//
// Always offers a free-text "Other…" option (handled by ask_pro by default)
// so the user can pick any prefix or none.
// =============================================================================

/** Branch-naming choice returned by the user. */
export type BranchPrefix = "feat/" | "fix/" | "chore/" | "" | { custom: string };

/** Options presented to the LLM via ask_pro. The LLM passes these through
 *  to the ask_pro call verbatim — first option is the recommended default. */
export function branchPrefixOptions(): Array<{
	label: string;
	description: string;
	recommended?: boolean;
	preview: string;
}> {
	return [
		{
			label: "feat/&lt;slug&gt;",
			description: "feature work — new functionality, refactors, migrations",
			recommended: true,
			preview: "feat/auth-jwt\nfeat/quota-indicator\nfeat/docs-knowledge-base",
		},
		{
			label: "fix/&lt;slug&gt;",
			description: "bug fixes — crashes, regressions, broken behaviour",
			preview: "fix/login-redirect-bug\nfix/race-in-quota-poll",
		},
		{
			label: "chore/&lt;slug&gt;",
			description: "chores — renames, dep bumps, format-only changes, tooling",
			preview: "chore/bump-typescript-6\nchore/rename-to-dot-stbl",
		},
		{
			label: "&lt;slug&gt; (no prefix)",
			description: "branch = slug verbatim, no prefix",
			preview: "auth-jwt\nquota-indicator",
		},
	];
}

/** Validate a free-text branch prefix (the user picked "Other…"). Rules:
 *  - empty string is allowed (means no prefix)
 *  - must be a valid git branch prefix (forward slash optional, no spaces,
 *    no leading dash, no consecutive slashes)
 *  - max 40 chars
 *  Returns the cleaned prefix or null if invalid. */
export function validateCustomPrefix(raw: string): string | null {
	const cleaned = raw.trim();
	if (cleaned === "") return "";
	if (cleaned.length > 40) return null;
	// Must not contain spaces, special shell chars, or start with a dash/dot
	if (/^[-.]/.test(cleaned)) return null;
	if (/[\s\\:*?"<>|]/.test(cleaned)) return null;
	if (/\/\//.test(cleaned)) return null;
	// Normalize: must end with / if non-empty (so prefix + slug works)
	if (!cleaned.endsWith("/") && cleaned !== "") return cleaned + "/";
	return cleaned;
}
