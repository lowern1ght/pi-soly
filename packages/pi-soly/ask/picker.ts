// =============================================================================
// picker.ts — multi-question picker TUI component
// =============================================================================
//
// Renders a tabbed multi-question flow inside pi's TUI. One `ask_pro` tool
// call can show N questions; the user navigates between them with Tab/arrows
// or instant-picks with 1-N. For multi-select questions, Enter toggles and
// the last question's Enter submits. For single-select (default), Enter on
// an option auto-advances to the next question (or submits on the last).
//
// Per-question `allowOther: true` appends a synthetic "Other…" option that
// opens a text-input dialog when picked. The custom string is stored as the
// answer (string for single-select, pushed into the array for multi-select).
// =============================================================================

import {
	Container,
	Text,
	Spacer,
	Input,
	truncateToWidth,
	type Component,
	type KeybindingsManager,
} from "@earendil-works/pi-tui";

/** Minimal theme shape we need. Matches pi-coding-agent's Theme.fg / .bold. */
export interface AskProTheme {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

export interface AskOption {
	label: string;
	description?: string;
	recommended?: boolean;
	/** Optional preview content shown in a side panel when this option is
	 *  focused. Use markdown or plain text to show code snippets, structure
	 *  examples, or elaboration of what the option entails.
	 *
	 *  Example:
	 *    preview: "```ts\nclass Auth {\n  token: string\n}\n```" */
	preview?: string;
}

export interface AskQuestion {
	/** Short label shown in the tab (e.g. "Auth", "Tokens"). 1-2 words. */
	header: string;
	/** The full question. */
	question: string;
	/** 2-4 options. */
	options: AskOption[];
	/** If true, user can pick multiple options (checkboxes). Default false. */
	multiSelect?: boolean;
	/** If true, append a synthetic "Other…" option that opens a text-input
	 *  dialog when picked. The custom string is stored as the answer.
	 *  Default false. */
	allowOther?: boolean;
}

/** Single-pick answer: either an option index (0..N-1) or a custom string
 *  (when "Other…" was picked and the user typed something). */
export type AskAnswer = number | string;
/** Multi-pick answer: a heterogeneous array of option indices + custom strings. */
export type AskMultiAnswer = Array<AskAnswer>;

export interface AskProResult {
	/** Set if the user cancelled (Esc). Other fields are absent. */
	cancelled?: boolean;
	/** Map of question index → answer. Single: number | string. Multi: (number | string)[] */
	answers?: Record<number, AskAnswer | AskMultiAnswer>;
	/** Optional free-text notes the user added to specific questions.
	 *  Keyed by question index. Added when the user pressed `n` after
	 *  picking an option and typed a note. */
	notes?: Record<number, string>;
}

interface AskProComponentDeps {
	questions: AskQuestion[];
	theme: AskProTheme;
	keybindings: KeybindingsManager;
	done: (result: AskProResult) => void;
	/** Optional title shown above the tabs. */
	title?: string;
}

// ---------------------------------------------------------------------------
// Keycode constants — pi uses raw escape sequences for arrows and a few other
// special keys. Tab is a single \t. Enter is \n or \r. Esc is \x1b.
// ---------------------------------------------------------------------------

const KEY_ESC = "\x1b";
const KEY_TAB = "\t";
const KEY_ENTER = "\n";
const KEY_ENTER_CR = "\r";
const KEY_SPACE = " ";
const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_RIGHT = "\x1b[C";
const KEY_LEFT = "\x1b[D";
const KEY_SHIFT_TAB = "\x1b[Z";
const KEY_BACKSPACE = "\x7f";

/** Active inline text-input mode. When non-null, the picker renders an
 *  embedded single-line `Input` field below the option list and routes
 *  keystrokes to it until Enter (commit) or Esc (cancel).
 *
 *  Why inline: the previous design called out to the host UI's modal input
 *  dialog (`ctx.ui.input()`), which clears `editorContainer` to show itself
 *  and restores the *default* editor on close — destroying the live picker.
 *  Inline input keeps the picker alive and self-contained. */
type InputMode =
	| { kind: "note" }
	| { kind: "other"; isMulti: boolean; input: Input };

/** A standalone picker component. Extends Container so it composes in the
 *  editor area like any other TUI widget. */
export class AskProComponent extends Container {
	private questions: AskQuestion[];
	private theme: AskProTheme;
	private keybindings: KeybindingsManager;
	private done: (result: AskProResult) => void;
	private title: string;

	private currentIndex = 0;
	private selectedIndex = 0;
	/** answers[questionIdx] = AskAnswer (single) or AskMultiAnswer (multi). */
	private answers = new Map<number, AskAnswer | AskMultiAnswer>();
	/** notes[questionIdx] = free-text note added by user (via `n` key). */
	private notes = new Map<number, string>();
	/** Set true once `done` is called — further input is ignored. */
	private completed = false;
	/** Active inline text-input mode (note or Other…). When set, all keys
	 *  except Enter/Esc are routed to the embedded Input. */
	private inputMode: InputMode | null = null;
	/** Note Input used while inputMode.kind === "note". Kept on the instance
	 *  so the `n`-flow can reuse a single field across open/close cycles. */
	private noteInput: Input | null = null;

	private tabsText!: Text;
	private bodyContainer!: Container;
	private footerText!: Text;

	constructor(deps: AskProComponentDeps) {
		super();
		this.questions = deps.questions;
		this.theme = deps.theme;
		this.keybindings = deps.keybindings;
		this.done = deps.done;
		this.title = deps.title ?? "pi-ask";

		const titleText = new Text(this.theme.fg("accent", this.theme.bold(this.title)), 1, 0);
		this.addChild(titleText);
		this.addChild(new Spacer(1));

		this.tabsText = new Text("", 1, 0);
		this.addChild(this.tabsText);
		this.addChild(new Spacer(1));

		this.bodyContainer = new Container();
		this.addChild(this.bodyContainer);

		this.addChild(new Spacer(1));
		this.footerText = new Text("", 1, 0);
		this.addChild(this.footerText);

		this.selectedIndex = this.defaultIndexFor(0);
		this.repaint();
	}

	/** Cursor lands on the recommended (⭐) option when entering a question. */
	private defaultIndexFor(qIdx: number): number {
		const opts = this.questions[qIdx]?.options ?? [];
		const rec = opts.findIndex((o) => o.recommended);
		return rec >= 0 ? rec : 0;
	}

	// -------------------------------------------------------------------------
	// Public state accessors (used by tests; safe to call from outside)
	// -------------------------------------------------------------------------

	getCurrentIndex(): number {
		return this.currentIndex;
	}

	getSelectedIndex(): number {
		return this.selectedIndex;
	}

	getAnswers(): Map<number, AskAnswer | AskMultiAnswer> {
		return new Map(this.answers);
	}

	// -------------------------------------------------------------------------
	// Rendering — updates the Text/Container children; the TUI re-renders
	// the whole tree on its next render cycle, picking up our changes.
	// -------------------------------------------------------------------------

	private repaint(): void {
		this.tabsText.setText(this.renderTabs());
		this.renderQuestionBody();
		this.footerText.setText(this.renderFooter());
	}

	private renderTabs(): string {
		return this.questions
			.map((q, i) => {
				const answered = this.isAnswered(i);
				const active = i === this.currentIndex;
				const marker = active ? "◉" : answered ? "✓" : "○";
				const label = q.header.length > 12 ? `${q.header.slice(0, 11)}…` : q.header;
				const color = active ? "accent" : answered ? "success" : "dim";
				return this.theme.fg(color, `${marker} ${label}`);
			})
			.join(this.theme.fg("dim", "   "));
	}

	private renderQuestionBody(): void {
		this.bodyContainer.clear();
		const q = this.questions[this.currentIndex];
		if (!q) return;

		// Compute the current preview (from the option under the cursor).
		// Shown side-by-side with the option list via pad-right.
		const currentPreview = this.currentPreviewLines();
		const hasPreview = currentPreview.length > 0;

		// Question line: "Q1 of 3: <question>"
		this.bodyContainer.addChild(
			new Text(
				this.theme.fg("dim", `Q${this.currentIndex + 1} of ${this.questions.length}: `) +
					this.theme.bold(q.question),
				1,
				0,
			),
		);
		this.bodyContainer.addChild(new Spacer(1));

		const isMulti = q.multiSelect ?? false;
		const allowOther = q.allowOther ?? false;
		const currentAns = this.answers.get(this.currentIndex);

		// Real options
		for (let i = 0; i < q.options.length; i++) {
			const opt = q.options[i];
			if (!opt) continue;
			const isSelected = i === this.selectedIndex;

			// Cursor
			const cursor = isSelected ? this.theme.fg("accent", "❯ ") : "  ";

			// Checkbox (multi) or radio (single)
			let prefix: string;
			if (isMulti) {
				const isChecked = this.isIndexChecked(currentAns, i);
				prefix = (isChecked ? "☒" : "☐") + " ";
				prefix = this.theme.fg(isChecked ? "success" : "dim", prefix);
			} else {
				const isChosen = currentAns === i;
				prefix = (isChosen ? "●" : "○") + " ";
				prefix = this.theme.fg(isChosen ? "success" : "dim", prefix);
			}

			// ⭐ prefix for recommended
			const star = opt.recommended ? this.theme.fg("warning", "⭐ ") : "";

			// Label — accent if selected, text otherwise
			const labelText = `${star}${opt.label}`;
			const label = this.theme.fg(isSelected ? "accent" : "text", labelText);

			this.bodyContainer.addChild(new Text(cursor + prefix + label, 1, 0));

			// Description on its own line
			if (opt.description) {
				this.bodyContainer.addChild(
					new Text("    " + this.theme.fg("dim", opt.description), 1, 0),
				);
			}
		}

		// Synthetic "Other…" option (when allowOther=true). The inline text
		// field is built in, so this no longer depends on any external callback.
		if (allowOther) {
			const otherIndex = q.options.length;
			const isOtherSelected = this.selectedIndex === otherIndex;
			const customStr = this.getCustomString(currentAns);

			const cursor = isOtherSelected ? this.theme.fg("accent", "❯ ") : "  ";

			if (isMulti) {
				const isChecked = this.isCustomStringChecked(currentAns);
				const prefix = (isChecked ? "☒" : "☐") + " ";
				const prefixStyled = this.theme.fg(isChecked ? "success" : "dim", prefix);
				const labelInner = customStr
					? `Other: ${this.theme.bold(customStr)}`
					: "Other…";
				const labelStyled = this.theme.fg(
					isOtherSelected ? "accent" : "text",
					labelInner,
				);
				this.bodyContainer.addChild(
					new Text(cursor + prefixStyled + labelStyled, 1, 0),
				);
				if (isOtherSelected && !customStr) {
					this.bodyContainer.addChild(
						new Text(
							"    " +
								this.theme.fg("dim", "(press Enter to type a custom answer)"),
							1,
							0,
						),
					);
				}
			} else {
				const isChosen = typeof currentAns === "string";
				const prefix = (isChosen ? "●" : "○") + " ";
				const prefixStyled = this.theme.fg(isChosen ? "success" : "dim", prefix);
				const labelInner = customStr
					? `Other: ${this.theme.bold(customStr)}`
					: "Other…";
				const labelStyled = this.theme.fg(
					isOtherSelected ? "accent" : "text",
					labelInner,
				);
				this.bodyContainer.addChild(
					new Text(cursor + prefixStyled + labelStyled, 1, 0),
				);
				if (isOtherSelected && !customStr) {
					this.bodyContainer.addChild(
						new Text(
							"    " +
								this.theme.fg("dim", "(press Enter to type a custom answer)"),
							1,
							0,
						),
					);
				}
			}
		}

		// For multiSelect on the LAST question, also show a "Submit" row at
		// the bottom (visual hint — pressing Enter on it submits).
		if (isMulti && this.currentIndex === this.questions.length - 1) {
			this.bodyContainer.addChild(new Spacer(1));
			const allAnswered = this.allAnswered();
			const submitLabel = allAnswered ? "▶ Submit answers" : "▶ Submit (need to answer all)";
			this.bodyContainer.addChild(
				new Text(
					this.theme.fg(allAnswered ? "accent" : "dim", submitLabel),
					1,
					0,
				),
			);
		}

		// Inline text field for note / Other…. Shown below the option list when
		// inputMode is active; owns the keyboard (Enter commits, Esc cancels).
		this.renderInlineField();
	}

	/** Append the active inline text field to bodyContainer. No-op when no
	 *  inline mode is active. */
	private renderInlineField(): void {
		const mode = this.inputMode;
		if (!mode) return;
		const q = this.questions[this.currentIndex];
		const label =
			mode.kind === "note"
				? this.theme.fg("dim", "Note:")
				: this.theme.fg("dim", "Custom answer:");
		this.bodyContainer.addChild(new Spacer(1));
		this.bodyContainer.addChild(new Text(label + " " + this.theme.fg("dim", "(enter ⏎ confirm · esc cancel)"), 1, 0));
		this.bodyContainer.addChild(new Spacer(1));
		if (mode.kind === "other") {
			this.bodyContainer.addChild(mode.input);
		} else if (this.noteInput) {
			this.bodyContainer.addChild(this.noteInput);
		}
	}

	// -------------------------------------------------------------------------
	// State helpers
	// -------------------------------------------------------------------------

	/** Is option `idx` currently in the answer (multi only)? */
	private isIndexChecked(ans: AskAnswer | AskMultiAnswer | undefined, idx: number): boolean {
		if (ans === undefined) return false;
		if (typeof ans === "number" || typeof ans === "string") return false;
		return (ans as AskMultiAnswer).includes(idx);
	}

	/** Is a custom string currently in the multi answer? */
	private isCustomStringChecked(ans: AskAnswer | AskMultiAnswer | undefined): boolean {
		if (ans === undefined) return false;
		if (typeof ans === "number" || typeof ans === "string") return false;
		return (ans as AskMultiAnswer).some((a) => typeof a === "string");
	}

	/** Extract the current custom string (for single-pick or the first
	 *  string in a multi answer). Returns "" if no custom string. */
	private getCustomString(ans: AskAnswer | AskMultiAnswer | undefined): string {
		if (ans === undefined) return "";
		if (typeof ans === "string") return ans;
		const found = (ans as AskMultiAnswer).find((a) => typeof a === "string");
		return typeof found === "string" ? found : "";
	}

	/** Total number of selectable rows for the current question (options + Other). */
	private totalOptionsForCurrent(): number {
		const q = this.questions[this.currentIndex];
		if (!q) return 0;
		const allowOther = q.allowOther ?? false;
		return q.options.length + (allowOther ? 1 : 0);
	}

	// -------------------------------------------------------------------------
	// Rendering — tabs and footer
	// -------------------------------------------------------------------------

	private renderFooter(): string {
		const q = this.questions[this.currentIndex];
		if (!q) return "";
		const isMulti = q.multiSelect ?? false;
		const isLast = this.currentIndex === this.questions.length - 1;
		const allowOther = q.allowOther ?? false;
		const otherIndex = allowOther ? q.options.length : -1;
		const totalOptions = this.totalOptionsForCurrent();

		const parts: string[] = [];

		// When the inline text field is open, it owns the keyboard — show
		// only its affordances, not the navigation hints.
		if (this.inputMode !== null) {
			parts.push(this.theme.fg("accent", "⏎ confirm"));
			parts.push(this.theme.fg("dim", "esc cancel"));
			return parts.join("   ");
		}

		parts.push(this.theme.fg("dim", "↑↓ navigate"));
		parts.push(this.theme.fg("dim", `1-${totalOptions} pick`));
		if (this.currentIndex > 0) parts.push(this.theme.fg("dim", "tab/← prev"));
		if (this.currentIndex < this.questions.length - 1) {
			parts.push(this.theme.fg("dim", "tab/→ next"));
		}
		// "Other…" hint: single-select uses Enter to open inline input,
		// multi-select uses Space. (The inline field is always available now;
		// no external dependency required.)
		if (allowOther && this.selectedIndex === otherIndex) {
			parts.push(this.theme.fg("accent", isMulti ? "␣ type" : "⏎ type"));
		} else if (isMulti) {
			// Multi-select: Space toggles, Enter advances/submits
			parts.push(this.theme.fg("dim", "␣ toggle"));
			if (isLast) {
				parts.push(
					this.theme.fg(
						this.allAnswered() ? "accent" : "dim",
						this.allAnswered() ? "⏎ submit" : "⏎ (answer all)",
					),
				);
			} else {
				parts.push(this.theme.fg("dim", "⏎ next"));
			}
		} else {
			// Single-select: Enter is the action key
			parts.push(this.theme.fg("accent", isLast ? "⏎ submit" : "⏎ next"));
		}
		// `n` hint: add/edit an inline note. Always available now (inline
		// field, no external dependency).
		const hasNote = this.notes.has(this.currentIndex);
		const noteHint = hasNote ? "n ✓note" : "n note";
		parts.push(this.theme.fg(hasNote ? "success" : "dim", noteHint));
		parts.push(this.theme.fg("dim", "esc cancel"));
		return parts.join("   ");
	}

	private isAnswered(qIdx: number): boolean {
		const a = this.answers.get(qIdx);
		if (a === undefined) return false;
		if (Array.isArray(a)) return a.length > 0;
		return true;
	}

	private allAnswered(): boolean {
		for (let i = 0; i < this.questions.length; i++) {
			if (!this.isAnswered(i)) return false;
		}
		return true;
	}

	// -------------------------------------------------------------------------
	// Key handling
	// -------------------------------------------------------------------------

	handleInput(keyData: string): void {
		if (this.completed) return;

		// --- Inline text-input mode (note / Other…) --------------------------
		// When active, all keys route to the embedded Input except the
		// confirm/cancel gestures, which we intercept to commit or abort.
		if (this.inputMode !== null) {
			this.handleInputModeKey(keyData);
			return;
		}

		// Esc — cancel the whole picker
		if (keyData === KEY_ESC) {
			this.completed = true;
			this.done({ cancelled: true });
			return;
		}

		const q = this.questions[this.currentIndex];
		if (!q) return;
		const isMulti = q.multiSelect ?? false;
		const allowOther = q.allowOther ?? false;
		const otherIndex = allowOther ? q.options.length : -1;
		const totalOptions = this.totalOptionsForCurrent();

		// Arrow up / k — move selection up
		if (
			this.keybindings.matches(keyData, "tui.select.up") ||
			keyData === "k" ||
			keyData === KEY_UP
		) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.repaint();
			return;
		}

		// Arrow down / j — move selection down
		if (
			this.keybindings.matches(keyData, "tui.select.down") ||
			keyData === "j" ||
			keyData === KEY_DOWN
		) {
			this.selectedIndex = Math.min(totalOptions - 1, this.selectedIndex + 1);
			this.repaint();
			return;
		}

		// Tab / Right arrow — next question
		if (keyData === KEY_TAB || keyData === KEY_RIGHT) {
			if (this.currentIndex < this.questions.length - 1) {
				this.currentIndex++;
				this.selectedIndex = this.defaultIndexFor(this.currentIndex);
				this.repaint();
			}
			return;
		}

		// Shift+Tab / Left arrow — prev question
		if (keyData === KEY_SHIFT_TAB || keyData === KEY_LEFT) {
			if (this.currentIndex > 0) {
				this.currentIndex--;
				this.selectedIndex = this.defaultIndexFor(this.currentIndex);
				this.repaint();
			}
			return;
		}

		// Backspace — also prev question (common convention)
		if (keyData === KEY_BACKSPACE && this.currentIndex > 0) {
			this.currentIndex--;
			this.selectedIndex = 0;
			this.repaint();
			return;
		}

		// Number keys 1-N — instant pick (including "Other…" at position N+1)
		const num = parseInt(keyData, 10);
		if (!isNaN(num) && num >= 1 && num <= totalOptions) {
			this.handlePick(num - 1);
			return;
		}

		// Space — toggle in multi-select.
		// On "Other…", opens the inline text field (or toggles existing custom string).
		// In single-select, Space is a no-op (Enter is the action key there).
		if (keyData === KEY_SPACE) {
			if (!isMulti) return;
			// On Other… → open inline field (or re-toggle existing custom string)
			if (allowOther && this.selectedIndex === otherIndex) {
				this.openOtherInput();
				return;
			}
			const cur = (this.answers.get(this.currentIndex) as AskMultiAnswer | undefined) ?? [];
			const idx = cur.indexOf(this.selectedIndex);
			if (idx === -1) cur.push(this.selectedIndex);
			else cur.splice(idx, 1);
			this.answers.set(this.currentIndex, cur);
			this.repaint();
			return;
		}

		// Enter — confirm / advance / submit (universal confirm gesture).
		// In single-select: picks the option, then advances or submits.
		// In multi-select: skips toggle (use Space for that); just advances
		// or submits. On the LAST question, if all answered, Enter submits.
		if (
			this.keybindings.matches(keyData, "tui.select.confirm") ||
			keyData === KEY_ENTER ||
			keyData === KEY_ENTER_CR
		) {
			// If "Other…" is the selected option in single-select, open the
			// inline field. In multi-select, Enter on Other… just advances
			// (use Space to toggle/type a custom answer).
			if (allowOther && this.selectedIndex === otherIndex && !isMulti) {
				this.openOtherInput();
				return;
			}

			if (isMulti) {
				// On the LAST question, if all questions are answered, Enter
				// submits. Otherwise it advances (if not last) or stays put
				// (on last + not all answered — user must finish first).
				if (
					this.currentIndex === this.questions.length - 1 &&
					this.allAnswered()
				) {
					this.submit();
					return;
				}
				if (this.currentIndex < this.questions.length - 1) {
					this.currentIndex++;
					this.selectedIndex = this.defaultIndexFor(this.currentIndex);
				}
				this.repaint();
			} else {
				// Single-select: set current as answer, then advance or submit
				this.answers.set(this.currentIndex, this.selectedIndex);
				if (this.currentIndex < this.questions.length - 1) {
					this.currentIndex++;
					this.selectedIndex = this.defaultIndexFor(this.currentIndex);
					this.repaint();
				} else if (this.allAnswered()) {
					this.submit();
				} else {
					this.repaint();
				}
			}
			return;
		}

	// `n` — add/edit a free-text note for the current question via the
		// inline field. Always available (no external dependency).
		if (keyData === "n") {
			this.openNoteInput();
			return;
		}
	}

	private handlePick(optionIdx: number): void {
		const q = this.questions[this.currentIndex];
		if (!q) return;
		const isMulti = q.multiSelect ?? false;
		const allowOther = q.allowOther ?? false;
		const otherIndex = allowOther ? q.options.length : -1;

		// "Other…" picked via number key → open inline field
		if (allowOther && optionIdx === otherIndex) {
			this.openOtherInput();
			return;
		}

		if (isMulti) {
			const cur = (this.answers.get(this.currentIndex) as AskMultiAnswer | undefined) ?? [];
			const idx = cur.indexOf(optionIdx);
			if (idx === -1) cur.push(optionIdx);
			else cur.splice(idx, 1);
			this.answers.set(this.currentIndex, cur);
			this.repaint();
		} else {
			this.answers.set(this.currentIndex, optionIdx);
			this.selectedIndex = optionIdx;
			if (this.currentIndex < this.questions.length - 1) {
				// Advance to next question; don't submit yet
				this.currentIndex++;
				this.selectedIndex = this.defaultIndexFor(this.currentIndex);
				this.repaint();
			} else if (this.allAnswered()) {
				// Last question + all answered → submit
				this.submit();
			} else {
				this.repaint();
			}
		}
	}

	/** Create a fresh inline Input pre-filled with `value`, cursor at the
	 *  end so the user can immediately extend or backspace-edit it.
	 *  (Input.setValue leaves the cursor at min(prevCursor, len) which is 0
	 *  for a fresh field — typing the prefill char-by-char puts the cursor
	 *  at the end naturally.) */
	private makeInput(value: string): Input {
		const input = new Input();
		for (const ch of value) input.handleInput(ch);
		return input;
	}

	/** Open the inline field for the "Other…" option on the current
	 *  question. Pre-fills with any existing custom string so it can be
	 *  edited. While open, all keys route to the field except Enter/Esc. */
	private openOtherInput(): void {
		const q = this.questions[this.currentIndex];
		if (!q) return;
		const isMulti = q.multiSelect ?? false;
		const currentAns = this.answers.get(this.currentIndex);
		const existing = this.getCustomString(currentAns);
		this.inputMode = { kind: "other", isMulti, input: this.makeInput(existing) };
		this.repaint();
	}

	/** Open the inline field for a note on the current question. Pre-fills
	 *  with any existing note so it can be edited. */
	private openNoteInput(): void {
		if (!this.questions[this.currentIndex]) return;
		const existing = this.notes.get(this.currentIndex) ?? "";
		this.noteInput = this.makeInput(existing);
		this.inputMode = { kind: "note" };
		this.repaint();
	}

	/** Route a keystroke to the active inline field, intercepting Enter
	 *  (commit) and Esc (cancel). Mirrors the Enter-on-last / advance /
	 *  submit flow that the old async path had. */
	private handleInputModeKey(keyData: string): void {
		const mode = this.inputMode;
		if (!mode) return;

		// Esc — cancel inline input, return to option navigation
		if (keyData === KEY_ESC) {
			this.closeInput(false);
			return;
		}
		// Enter — commit
		if (
			this.keybindings.matches(keyData, "tui.select.confirm") ||
			keyData === KEY_ENTER ||
			keyData === KEY_ENTER_CR
		) {
			this.closeInput(true);
			return;
		}
		// Everything else (typing, arrows, backspace, etc.) → the field
		const input = mode.kind === "other" ? mode.input : this.noteInput!;
		input.handleInput(keyData);
		this.repaint();
	}

	/** Commit (commit=true) or discard the active inline field, then return
	 *  to normal option navigation. */
	private closeInput(commit: boolean): void {
		const mode = this.inputMode;
		if (!mode) return;
		this.inputMode = null;

		if (mode.kind === "note") {
			const text = this.noteInput?.getValue() ?? "";
			this.noteInput = null;
			if (commit) {
				const trimmed = text.trim();
				if (trimmed === "") {
					this.notes.delete(this.currentIndex);
				} else {
					this.notes.set(this.currentIndex, trimmed);
				}
			}
			this.repaint();
			return;
		}

		// kind === "other"
		const isMulti = mode.isMulti;
		const text = mode.input.getValue();
		const trimmed = commit ? text.trim() : "";
		if (commit && trimmed !== "") {
			if (isMulti) {
				const cur =
					(this.answers.get(this.currentIndex) as AskMultiAnswer | undefined) ?? [];
				// Replace existing custom string (if any) so user can edit
				const existingIdx = cur.findIndex((a) => typeof a === "string");
				if (existingIdx >= 0) cur[existingIdx] = trimmed;
				else cur.push(trimmed);
				this.answers.set(this.currentIndex, cur);
			} else {
				this.answers.set(this.currentIndex, trimmed);
			}
		}
		this.repaint();

		// Single-select: a committed custom answer advances or submits,
		// matching the old async behavior. Multi-select stays put (user
		// may toggle more options). Cancellation never advances.
		if (commit && !isMulti && trimmed !== "") {
			if (this.currentIndex < this.questions.length - 1) {
				this.currentIndex++;
				this.selectedIndex = this.defaultIndexFor(this.currentIndex);
				this.repaint();
			} else if (this.allAnswered()) {
				this.submit();
			}
		}
	}

	private submit(): void {
		if (!this.allAnswered()) return;
		const answers: Record<number, AskAnswer | AskMultiAnswer> = {};
		for (let i = 0; i < this.questions.length; i++) {
			answers[i] = this.answers.get(i) as AskAnswer | AskMultiAnswer;
		}
		// Include notes only if at least one was added
		const notes: Record<number, string> = {};
		let hasNotes = false;
		for (let i = 0; i < this.questions.length; i++) {
			const n = this.notes.get(i);
			if (n) {
				notes[i] = n;
				hasNotes = true;
			}
		}
		this.completed = true;
		this.done(hasNotes ? { answers, notes } : { answers });
	}

	// -------------------------------------------------------------------------
	// Public no-op dispose (Container doesn't define one; we just stop taking
	// input). TUI will tear down children when the parent is disposed.
	// -------------------------------------------------------------------------

	dispose(): void {
		this.completed = true;
		this.inputMode = null;
		this.noteInput = null;
	}

	// -----------------------------------------------------------------------
	// Side-by-side render: picker column (left) + preview column (right).
	//
	// HARD GUARANTEE: every emitted line is capped to `width` visible columns
	// via truncateToWidth(). The previous implementation measured width with a
	// hand-rolled regex that ignored OSC 8 hyperlinks / FTCS marks (which pi-tui
	// wraps around rendered text) and never truncated the left column or the
	// combined row — so a long option label or preview word pushed a line past
	// the terminal width and crashed pi ("Rendered line N exceeds terminal
	// width"). See C:/Users/bradw/.pi/agent/pi-crash.log.
	// -----------------------------------------------------------------------
	private static readonly SPLIT_COL = 60; // max picker column width when a preview is present
	private static readonly SEP = " │ "; // 3-col gutter between the two columns
	private static readonly MIN_COL = 16; // minimum useful width for either column

	/** Lines of preview content for the option currently under the cursor.
	 *  Returns [] when no option is focused or the option has no preview. */
	private currentPreviewLines(): string[] {
		const q = this.questions[this.currentIndex];
		if (!q) return [];
		// Only real options carry previews (not "Other…")
		if (this.selectedIndex < 0 || this.selectedIndex >= q.options.length) return [];
		const opt = q.options[this.selectedIndex];
		if (!opt?.preview) return [];
		// Trim and split on newlines; drop leading/trailing blank lines.
		const lines = opt.preview
			.replace(/\r\n/g, "\n")
			.split("\n")
			.map((l) => l.trimEnd());
		while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
		while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
		return lines;
	}

	/** Greedy word-wrap one source line to `maxWidth`, hard-truncating any
	 *  single word longer than `maxWidth`. Returns 1+ lines, each ≤ maxWidth
	 *  visible columns. Uses .length here only as a fast upper bound — the
	 *  caller still hard-caps the final row, so a miscount can never overflow. */
	private wrapPreviewLine(line: string, maxWidth: number): string[] {
		if (maxWidth <= 0) return [""];
		if (line.length === 0) return [""];
		const words = line.split(" ");
		const out: string[] = [];
		let cur = "";
		for (const w of words) {
			const word = w.length > maxWidth ? truncateToWidth(w, maxWidth, "") : w;
			if (cur.length === 0) {
				cur = word;
			} else if (cur.length + 1 + word.length <= maxWidth) {
				cur += " " + word;
			} else {
				out.push(cur);
				cur = word;
			}
		}
		out.push(cur);
		return out;
	}

	/** Override render to produce a side-by-side layout when a preview is
	 *  present. Falls back to default Container render otherwise. Every
	 *  returned line is guaranteed ≤ `width` visible columns. */
	render(width: number): string[] {
		const superLines = super.render(width);
		const previewLines = this.currentPreviewLines();
		if (previewLines.length === 0) return superLines;

		const border = this.theme.fg("dim", "│");
		const sepLen = AskProComponent.SEP.length; // 3

		// Column allocation. Picker gets ~55% (capped at SPLIT_COL); the rest
		// goes to preview. If there isn't room for two usable columns, fall
		// back to a stacked layout (picker full-width, preview underneath).
		const splitCol = Math.min(
			AskProComponent.SPLIT_COL,
			Math.max(AskProComponent.MIN_COL, Math.floor(width * 0.55)),
		);
		const previewWidth = width - splitCol - sepLen;
		if (previewWidth < AskProComponent.MIN_COL) {
			return this.renderPreviewStacked(width, superLines, previewLines, border);
		}

		// Wrap each preview source line to previewWidth (a long line may
		// produce several wrapped rows).
		const wrapped: string[] = [];
		for (const line of previewLines) {
			for (const w of this.wrapPreviewLine(line, previewWidth)) wrapped.push(w);
		}

		const result: string[] = [];
		// Header row for the preview column (aligned under it), hard-capped.
		result.push(
			truncateToWidth(
				"".padEnd(splitCol) + " " + border + " " + this.theme.fg("dim", "— preview —"),
				width,
				"",
				false,
			),
		);
		const rows = Math.max(superLines.length, wrapped.length);
		for (let i = 0; i < rows; i++) {
			const superLine = superLines[i] ?? "";
			const pLine = wrapped[i];
			// Left: exactly splitCol wide — truncate long option lines and pad
			// short ones. truncateToWidth preserves ANSI/OSC styling.
			const left = truncateToWidth(superLine, splitCol, "", true);
			let row = left + " " + border + " ";
			if (pLine !== undefined) row += this.theme.fg("text", pLine);
			// Hard cap — the guarantee that prevents the terminal-width crash.
			result.push(truncateToWidth(row, width, "", false));
		}
		return result;
	}

	/** Stacked fallback for narrow terminals: picker lines at full width,
	 *  then a framed preview block below. Every line ≤ width. */
	private renderPreviewStacked(
		width: number,
		superLines: string[],
		previewLines: string[],
		border: string,
	): string[] {
		const result: string[] = [];
		for (const l of superLines) result.push(truncateToWidth(l, width, "", false));
		result.push(
			truncateToWidth(this.theme.fg("dim", `${border} — preview —`), width, "", false),
		);
		for (const line of previewLines) {
			for (const w of this.wrapPreviewLine(line, width)) {
				result.push(truncateToWidth(this.theme.fg("text", w), width, "", false));
			}
		}
		return result;
	}
}

/** Type guard for the public component. */
export function isAskProComponent(c: Component): c is AskProComponent {
	return c instanceof AskProComponent;
}
