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
}

/** Options for the text-input dialog opened when "Other…" is picked. */
export interface AskProInputRequest {
	title: string;
	prompt: string;
	placeholder?: string;
}

interface AskProComponentDeps {
	questions: AskQuestion[];
	theme: AskProTheme;
	keybindings: KeybindingsManager;
	done: (result: AskProResult) => void;
	/** Optional title shown above the tabs. */
	title?: string;
	/** Open a text-input dialog for the "Other…" option. Returns the typed
	 *  text, or undefined if the user cancelled. If omitted, the "Other…"
	 *  option is hidden even when `allowOther: true` (caller should ensure
	 *  the dependency is present if it advertises allowOther). */
	onRequestInput?: (req: AskProInputRequest) => Promise<string | undefined>;
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

/** A standalone picker component. Extends Container so it composes in the
 *  editor area like any other TUI widget. */
export class AskProComponent extends Container {
	private questions: AskQuestion[];
	private theme: AskProTheme;
	private keybindings: KeybindingsManager;
	private done: (result: AskProResult) => void;
	private onRequestInput?: (req: AskProInputRequest) => Promise<string | undefined>;
	private title: string;

	private currentIndex = 0;
	private selectedIndex = 0;
	/** answers[questionIdx] = AskAnswer (single) or AskMultiAnswer (multi). */
	private answers = new Map<number, AskAnswer | AskMultiAnswer>();
	/** Set true once `done` is called — further input is ignored. */
	private completed = false;
	/** Set while a text-input dialog is awaiting the user's reply. */
	private awaitingInput = false;

	private tabsText!: Text;
	private bodyContainer!: Container;
	private footerText!: Text;

	constructor(deps: AskProComponentDeps) {
		super();
		this.questions = deps.questions;
		this.theme = deps.theme;
		this.keybindings = deps.keybindings;
		this.done = deps.done;
		this.onRequestInput = deps.onRequestInput;
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

		this.repaint();
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

		// Synthetic "Other…" option (when allowOther=true)
		if (allowOther && this.onRequestInput) {
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
		return q.options.length + (allowOther && this.onRequestInput ? 1 : 0);
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
		parts.push(this.theme.fg("dim", "↑↓ navigate"));
		parts.push(this.theme.fg("dim", `1-${totalOptions} pick`));
		if (this.currentIndex > 0) parts.push(this.theme.fg("dim", "tab/← prev"));
		if (this.currentIndex < this.questions.length - 1) {
			parts.push(this.theme.fg("dim", "tab/→ next"));
		}
		// "Other…" hint: single-select uses Enter, multi-select uses Space
		if (allowOther && this.onRequestInput && this.selectedIndex === otherIndex) {
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
		if (this.completed || this.awaitingInput) return;

		// Esc — cancel
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
				this.selectedIndex = 0;
				this.repaint();
			}
			return;
		}

		// Shift+Tab / Left arrow — prev question
		if (keyData === KEY_SHIFT_TAB || keyData === KEY_LEFT) {
			if (this.currentIndex > 0) {
				this.currentIndex--;
				this.selectedIndex = 0;
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
		// On "Other…", opens the input dialog (or toggles existing custom string).
		// In single-select, Space is a no-op (Enter is the action key there).
		if (keyData === KEY_SPACE) {
			if (!isMulti) return;
			// On Other… → open input dialog (or re-toggle existing custom string)
			if (allowOther && this.onRequestInput && this.selectedIndex === otherIndex) {
				void this.requestOtherInput();
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
			// If "Other…" is the selected option in single-select, open
			// the input dialog. In multi-select, Enter on Other… just
			// advances (use Space to toggle/type a custom answer).
			if (
				allowOther &&
				this.onRequestInput &&
				this.selectedIndex === otherIndex &&
				!isMulti
			) {
				void this.requestOtherInput();
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
					this.selectedIndex = 0;
				}
				this.repaint();
			} else {
				// Single-select: set current as answer, then advance or submit
				this.answers.set(this.currentIndex, this.selectedIndex);
				if (this.currentIndex < this.questions.length - 1) {
					this.currentIndex++;
					this.selectedIndex = 0;
					this.repaint();
				} else if (this.allAnswered()) {
					this.submit();
				} else {
					this.repaint();
				}
			}
			return;
		}
	}

	private handlePick(optionIdx: number): void {
		const q = this.questions[this.currentIndex];
		if (!q) return;
		const isMulti = q.multiSelect ?? false;
		const allowOther = q.allowOther ?? false;
		const otherIndex = allowOther ? q.options.length : -1;

		// "Other…" picked via number key
		if (allowOther && this.onRequestInput && optionIdx === otherIndex) {
			void this.requestOtherInput();
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
				this.selectedIndex = 0;
				this.repaint();
			} else if (this.allAnswered()) {
				// Last question + all answered → submit
				this.submit();
			} else {
				this.repaint();
			}
		}
	}

	/**
	 * Open the text-input dialog for the "Other…" option. Awaits the user's
	 * reply asynchronously. While awaiting, the picker ignores further input.
	 * If the user types text, the answer is stored (string for single, pushed
	 * to the multi-select array for multi). If the user cancels, the answer
	 * is unchanged.
	 */
	private async requestOtherInput(): Promise<void> {
		if (!this.onRequestInput) return;
		const q = this.questions[this.currentIndex];
		if (!q) return;
		this.awaitingInput = true;
		const isMulti = q.multiSelect ?? false;

		const text = await this.onRequestInput({
			title: q.header,
			prompt: `Custom answer for: ${q.question}`,
			placeholder: "Type your answer…",
		});
		this.awaitingInput = false;

		if (text === undefined) {
			// User cancelled — leave answer as-is, just redraw
			this.repaint();
			return;
		}
		const trimmed = text.trim();
		if (trimmed === "") {
			this.repaint();
			return;
		}

		if (isMulti) {
			const cur = (this.answers.get(this.currentIndex) as AskMultiAnswer | undefined) ?? [];
			// Replace existing custom string (if any) so user can edit
			const existingIdx = cur.findIndex((a) => typeof a === "string");
			if (existingIdx >= 0) cur[existingIdx] = trimmed;
			else cur.push(trimmed);
			this.answers.set(this.currentIndex, cur);
			this.repaint();
		} else {
			// Single-select: set custom string, advance or submit
			this.answers.set(this.currentIndex, trimmed);
			if (this.currentIndex < this.questions.length - 1) {
				this.currentIndex++;
				this.selectedIndex = 0;
				this.repaint();
			} else if (this.allAnswered()) {
				this.submit();
			} else {
				this.repaint();
			}
		}
	}

	private submit(): void {
		if (!this.allAnswered()) return;
		const answers: Record<number, AskAnswer | AskMultiAnswer> = {};
		for (let i = 0; i < this.questions.length; i++) {
			answers[i] = this.answers.get(i) as AskAnswer | AskMultiAnswer;
		}
		this.completed = true;
		this.done({ answers });
	}

	// -------------------------------------------------------------------------
	// Public no-op dispose (Container doesn't define one; we just stop taking
	// input). TUI will tear down children when the parent is disposed.
	// -------------------------------------------------------------------------

	dispose(): void {
		this.completed = true;
		this.awaitingInput = false;
	}
}

/** Type guard for the public component. */
export function isAskProComponent(c: Component): c is AskProComponent {
	return c instanceof AskProComponent;
}
