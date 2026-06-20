// =============================================================================
// deck.ts — full-screen decision-deck TUI component
// =============================================================================
//
// Renders ONE architectural/design decision as a stack of framed "cards" — one
// option per card — that the user flips through with ←/→ (or 1-N) and picks
// with Enter. Each card shows a title, prose summary, an optional syntax-
// highlighted code snippet, and pros/cons. Esc cancels.
//
// This is the richer cousin of ask_pro's side-panel preview: instead of a thin
// column it gives a full card to each option, so the user can compare concrete
// code shapes and trade-offs before committing. Purely native (no browser, no
// server) — it composes in pi's TUI like any other custom component and reuses
// the same hard width-capping discipline as the ask_pro picker.
// =============================================================================

import {
	Container,
	Text,
	truncateToWidth,
	type Component,
	type KeybindingsManager,
} from "@earendil-works/pi-tui";

/** Minimal theme shape (matches pi's Theme.fg / .bold). */
export interface DeckTheme {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

export interface DeckOption {
	/** Card title (e.g. "Event bus"). */
	title: string;
	/** 1-3 sentence prose explanation. */
	summary?: string;
	/** Optional code snippet shown on the card. */
	code?: string;
	/** Language hint for the code snippet (e.g. "ts"). */
	lang?: string;
	/** Upsides, rendered as green "+ …" lines. */
	pros?: string[];
	/** Downsides, rendered as "− …" lines. */
	cons?: string[];
	/** Mark as the ⭐ recommended option (cursor starts here). */
	recommended?: boolean;
}

export interface DeckResult {
	/** Chosen option index, when the user pressed Enter. */
	chosen?: number;
	/** Set when the user cancelled (Esc). */
	cancelled?: boolean;
}

interface DeckComponentDeps {
	options: DeckOption[];
	theme: DeckTheme;
	keybindings: KeybindingsManager;
	done: (result: DeckResult) => void;
	/** Overall decision title. */
	title?: string;
	/** The question being decided. */
	prompt?: string;
	/** Optional syntax highlighter (pi's highlightCode). */
	highlight?: (code: string, lang?: string) => string[];
}

const KEY_ESC = "\x1b";
const KEY_ENTER = "\n";
const KEY_ENTER_CR = "\r";
const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_RIGHT = "\x1b[C";
const KEY_LEFT = "\x1b[D";

/** Max card width; cards never grow wider than this even on huge terminals. */
const MAX_BOX = 96;

export class DeckComponent extends Container {
	private options: DeckOption[];
	private theme: DeckTheme;
	private keybindings: KeybindingsManager;
	private done: (result: DeckResult) => void;
	private title: string;
	private prompt: string;
	private highlight?: (code: string, lang?: string) => string[];

	private index = 0;
	private completed = false;
	private body!: Text;

	constructor(deps: DeckComponentDeps) {
		super();
		this.options = deps.options;
		this.theme = deps.theme;
		this.keybindings = deps.keybindings;
		this.done = deps.done;
		this.title = deps.title ?? "decision";
		this.prompt = deps.prompt ?? "";
		this.highlight = deps.highlight;
		this.index = Math.max(
			0,
			this.options.findIndex((o) => o.recommended),
		);
		this.body = new Text("", 1, 0);
		this.addChild(this.body);
	}

	getIndex(): number {
		return this.index;
	}

	// --------------------------------------------------------------------------
	// Input
	// --------------------------------------------------------------------------

	handleInput(keyData: string): void {
		if (this.completed) return;
		if (keyData === KEY_ESC) {
			this.finish({ cancelled: true });
			return;
		}
		if (
			this.keybindings.matches(keyData, "tui.select.confirm") ||
			keyData === KEY_ENTER ||
			keyData === KEY_ENTER_CR
		) {
			this.finish({ chosen: this.index });
			return;
		}
		if (keyData === KEY_LEFT || keyData === KEY_UP || keyData === "h" || keyData === "k") {
			this.index = Math.max(0, this.index - 1);
			this.body.invalidate();
			return;
		}
		if (keyData === KEY_RIGHT || keyData === KEY_DOWN || keyData === "l" || keyData === "j") {
			this.index = Math.min(this.options.length - 1, this.index + 1);
			this.body.invalidate();
			return;
		}
		const num = parseInt(keyData, 10);
		if (!isNaN(num) && num >= 1 && num <= this.options.length) {
			this.index = num - 1;
			this.body.invalidate();
		}
	}

	private finish(result: DeckResult): void {
		this.completed = true;
		this.done(result);
	}

	dispose(): void {
		this.completed = true;
	}

	// --------------------------------------------------------------------------
	// Rendering — every emitted line is hard-capped to `width` visible columns.
	// --------------------------------------------------------------------------

	render(width: number): string[] {
		const boxWidth = Math.max(12, Math.min(width, MAX_BOX));
		const inner = Math.max(4, boxWidth - 4);
		const opt = this.options[this.index];
		const out: string[] = [];

		out.push(this.center(this.theme.bold(this.theme.fg("accent", this.title)), boxWidth));
		for (const l of this.wrap(this.prompt, boxWidth)) {
			if (l) out.push(this.center(this.theme.fg("dim", l), boxWidth));
		}
		out.push("");
		out.push(this.center(this.renderPager(), boxWidth));
		out.push("");
		if (opt) for (const l of this.renderCard(opt, boxWidth, inner)) out.push(l);
		out.push("");
		out.push(this.center(this.theme.fg("dim", this.footerHints()), boxWidth));

		return out.map((l) => truncateToWidth(l, width, "", false));
	}

	/** A framed card for one option. */
	private renderCard(opt: DeckOption, boxWidth: number, inner: number): string[] {
		const bar = "━".repeat(boxWidth - 2);
		const lines: string[] = [this.theme.fg("accent", `┏${bar}┓`)];
		const star = opt.recommended ? "⭐ " : "";
		lines.push(this.box(this.theme.bold(star + opt.title), inner));

		if (opt.summary) {
			lines.push(this.box("", inner));
			for (const l of this.wrap(opt.summary, inner)) {
				lines.push(this.box(this.theme.fg("text", l), inner));
			}
		}
		if (opt.code) {
			lines.push(this.box("", inner));
			for (const l of this.highlightLines(opt.code, opt.lang)) {
				lines.push(this.box(l, inner));
			}
		}
		const pros = opt.pros ?? [];
		const cons = opt.cons ?? [];
		if (pros.length || cons.length) {
			lines.push(this.box("", inner));
			for (const p of pros) lines.push(this.box(this.theme.fg("success", `+ ${p}`), inner));
			for (const c of cons) lines.push(this.box(this.theme.fg("warning", `− ${c}`), inner));
		}
		lines.push(this.theme.fg("accent", `┗${bar}┛`));
		return lines;
	}

	/** Frame one content line inside the card borders, padded to `inner`. */
	private box(content: string, inner: number): string {
		const edge = this.theme.fg("accent", "┃");
		return `${edge} ${truncateToWidth(content, inner, "", true)} ${edge}`;
	}

	/** `◀  ●○○  2/3  ▶` — the option pager. */
	private renderPager(): string {
		const dots = this.options
			.map((_, i) => this.theme.fg(i === this.index ? "accent" : "dim", i === this.index ? "●" : "○"))
			.join("");
		const left = this.theme.fg(this.index > 0 ? "accent" : "dim", "◀");
		const right = this.theme.fg(this.index < this.options.length - 1 ? "accent" : "dim", "▶");
		const counter = this.theme.fg("dim", `${this.index + 1}/${this.options.length}`);
		return `${left}  ${dots}  ${counter}  ${right}`;
	}

	private footerHints(): string {
		return "←/→ flip · 1-N jump · ⏎ choose · esc cancel";
	}

	/** Highlight (or dim-fallback) a code snippet into per-line styled strings. */
	private highlightLines(code: string, lang?: string): string[] {
		const src = code.replace(/\r\n/g, "\n").replace(/\s+$/, "");
		return this.highlight
			? this.highlight(src, lang)
			: src.split("\n").map((l) => this.theme.fg("dim", l));
	}

	/** Center a (possibly styled) string within `width` visible columns. */
	private center(s: string, width: number): string {
		const pad = Math.max(0, Math.floor((width - this.visible(s)) / 2));
		return " ".repeat(pad) + s;
	}

	/** Visible width of a styled string (strips ANSI/OSC for the count). */
	private visible(s: string): number {
		// eslint-disable-next-line no-control-regex
		return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;[^\x07]*\x07/g, "").length;
	}

	/** Greedy word-wrap (split on existing newlines first). `.length` is a safe
	 *  upper bound — callers hard-cap the final row, so a miscount can't overflow. */
	private wrap(text: string, maxWidth: number): string[] {
		if (!text) return [];
		const out: string[] = [];
		for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
			if (raw.trim() === "") {
				out.push("");
				continue;
			}
			let cur = "";
			for (const w of raw.split(" ")) {
				const word = w.length > maxWidth ? truncateToWidth(w, maxWidth, "") : w;
				if (cur.length === 0) cur = word;
				else if (cur.length + 1 + word.length <= maxWidth) cur += ` ${word}`;
				else {
					out.push(cur);
					cur = word;
				}
			}
			out.push(cur);
		}
		return out;
	}
}

/** Type guard for the public component. */
export function isDeckComponent(c: Component): c is DeckComponent {
	return c instanceof DeckComponent;
}
