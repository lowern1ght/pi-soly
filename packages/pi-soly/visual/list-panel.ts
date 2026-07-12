// =============================================================================
// visual/list-panel.ts — generic focused list modal (rules / docs / …)
// =============================================================================
//
// A reusable overlay panel (shown via ctx.ui.custom) on the same pattern as the
// MCP panel: a fuzzy-filterable list with a live preview pane and key actions,
// instead of dumping everything into the chat. Monochrome by default — dim
// borders, muted rows, bold for the selected row (no decorative color).
//
// The caller supplies items (+ a `refresh` to re-read them after an action) and
// optional actions (key → run). `/` enters search mode; Esc exits search, then
// closes. Pure-ish: rendering uses only pi-tui width helpers + the theme.
// =============================================================================

import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createPanelKeys, type PanelKeybindings, type PanelKeys } from "./panel-keys.ts";
import { fuzzyScore } from "./fuzzy.ts";
// (PanelKeybindings re-exported by re-export side below.)

/** One row in the panel. `body` is shown in the preview pane when selected. */
export type ListItem = { id: string; marker: string; label: string; meta?: string; body?: string };

/** A logical group within the panel (rendered as a labelled separator). */
export type ListGroup = {
	id: string;
	/** Single glyph + short title shown on the separator row (e.g. "📊 Status"). */
	title: string;
	icon: string;
	items: ListItem[];
};

/** A key-triggered action over the selected item (e.g. enable/disable/reload). */
export type ListAction = { key: string; hint: string; run: (item: ListItem) => void };

// Re-export PanelKeybindings so consumers don't need to know about the
// internal ./panel-keys.ts module.
export type { PanelKeybindings, PanelKeys };

export type ListPanelProps = {
	tui: TUI;
	theme: Theme;
	keybindings?: PanelKeybindings;
	// (Above prop is the public re-export anchor.)
	done: () => void;
	title: string;
	/** Right-aligned header text (e.g. counts / token budget). */
	headerRight?: string;
	/** Items, grouped. A single group is fine. Cursor skips group headers. */
	groups: ListGroup[];
	actions?: ListAction[];
	/** Re-read items after an action mutates state. */
	refresh?: () => ListGroup[];
	/** Fired on Enter for the selected item; the panel then closes. When set,
	 *  the footer shows an "⏎ open" hint. */
	onSelect?: (item: ListItem) => void;
};

const MAX_ROWS = 12; // list window height (render() has no viewport height)
const PREVIEW_LINES = 4;

/** Subsequence fuzzy match: substring scores highest, then in-order chars. */
// fuzzyScore moved to ./fuzzy.ts — imported above.

/** Index into `flatRows` (mixed item + group header rows). */
type RowIndex = number;

export class ListPanel implements Component {
	private readonly p: ListPanelProps;
	private readonly keys: PanelKeys;
	private groups: ListGroup[];
	private query = "";
	private searching = false;
	private selected: RowIndex = 0;

	constructor(props: ListPanelProps) {
		this.p = props;
		this.groups = props.groups;
		this.keys = createPanelKeys(props.keybindings);
	}

	invalidate(): void {
		/* stateless cache */
	}

	/** Flatten groups into rows (items + header separators). Headers carry a
	 *  `group` reference for rendering; cursor skips them. */
	private flatRows(): Array<{ kind: "item"; item: ListItem; group: ListGroup } | { kind: "header"; group: ListGroup }> {
		const out: Array<{ kind: "item"; item: ListItem; group: ListGroup } | { kind: "header"; group: ListGroup }> = [];
		for (const g of this.groups) {
			// Skip groups that have no items — no point showing an empty separator.
			if (g.items.length === 0) continue;
			out.push({ kind: "header", group: g });
			for (const item of g.items) out.push({ kind: "item", item, group: g });
		}
		return out;
	}

	/** Apply fuzzy filter; when searching, group headers are still shown but
	 *  only groups that contain at least one matching item survive, and
	 *  within those groups only matching items are returned. */
	private filteredRows(): Array<{ kind: "item"; item: ListItem; group: ListGroup } | { kind: "header"; group: ListGroup }> {
		if (!this.query) return this.flatRows();
		const q = this.query.toLowerCase();
		const matchedByGroup = new Map<ListGroup, Set<ListItem>>();
		for (const g of this.groups) {
			const matched = new Set<ListItem>();
			for (const it of g.items) {
				if (fuzzyScore(q, `${it.label} ${it.meta ?? ""}`) > 0) matched.add(it);
			}
			if (matched.size > 0) matchedByGroup.set(g, matched);
		}
		const out: Array<{ kind: "item"; item: ListItem; group: ListGroup } | { kind: "header"; group: ListGroup }> = [];
		for (const g of this.groups) {
			const matched = matchedByGroup.get(g);
			if (!matched) continue;
			out.push({ kind: "header", group: g });
			for (const it of g.items) if (matched.has(it)) out.push({ kind: "item", item: it, group: g });
		}
		return out;
	}

	private clamp(list: { kind: "item" | "header" }[]): void {
		if (list.length === 0) {
			this.selected = 0;
			return;
		}
		// First clamp into valid range.
		if (this.selected >= list.length) this.selected = list.length - 1;
		if (this.selected < 0) this.selected = 0;
		// Then walk to the nearest non-header row — prefer forward (visual
		// scan direction), fall back to backward.
		if (list[this.selected]?.kind === "header") {
			for (let i = this.selected; i < list.length; i++) {
				if (list[i]?.kind === "item") { this.selected = i; return; }
			}
			for (let i = this.selected; i >= 0; i--) {
				if (list[i]?.kind === "item") { this.selected = i; return; }
			}
		}
	}

	handleInput(data: string): void {
		const list = this.filteredRows();
		this.clamp(list);

		if (this.searching) {
			if (matchesKey(data, "escape") || matchesKey(data, "return")) {
				this.searching = false;
			} else if (matchesKey(data, "backspace")) {
				this.query = this.query.slice(0, -1);
			} else if (data.length === 1 && data >= " ") {
				this.query += data;
				this.selected = 0;
			}
			this.p.tui.requestRender();
			return;
		}

		if (matchesKey(data, "escape")) {
			this.p.done();
			return;
		}
		if (this.keys.selectUp(data)) {
			this.selected = Math.max(0, this.selected - 1);
			// Skip group headers when moving up.
			while (this.selected > 0 && list[this.selected]?.kind === "header") this.selected--;
		} else if (this.keys.selectDown(data)) {
			this.selected = Math.min(list.length - 1, this.selected + 1);
			// Skip group headers when moving down.
			while (this.selected < list.length - 1 && list[this.selected]?.kind === "header") this.selected++;
		} else if (data === "/") {
			this.searching = true;
		} else if (matchesKey(data, "return")) {
			const current = list[this.selected];
			// Headers are not selectable — ignore Enter on them.
			if (current && current.kind === "item" && this.p.onSelect) {
				this.p.onSelect(current.item);
				this.p.done();
				return;
			}
		} else {
			const action = this.p.actions?.find((a) => a.key === data);
			const current = list[this.selected];
			if (action && current && current.kind === "item") {
				action.run(current.item);
				if (this.p.refresh) this.groups = this.p.refresh();
			}
		}
		this.p.tui.requestRender();
	}

	render(width: number): string[] {
		const theme = this.p.theme;
		const dim = (s: string) => theme.fg("dim", s);
		const muted = (s: string) => theme.fg("muted", s);
		const inner = Math.max(20, width - 4);
		const list = this.filteredRows();
		this.clamp(list);

		const out: string[] = [];
		out.push(this.headerLine(inner, dim, muted));
		out.push(this.searchLine(inner, dim, muted));
		out.push(this.frame("", inner, dim));

		// Windowed view around the selection.
		const selectedRow = list[this.selected];
		const start = Math.max(0, Math.min(this.selected - Math.floor(MAX_ROWS / 2), Math.max(0, list.length - MAX_ROWS)));
		const window = list.slice(start, start + MAX_ROWS);
		if (window.length === 0) out.push(this.frame(dim("  (no matches)"), inner, dim));
		for (let i = 0; i < window.length; i++) {
			const r = window[i];
			if (!r) continue;
			const absoluteIdx = start + i;
			if (r.kind === "header") {
				out.push(this.groupHeaderLine(r.group, inner, dim, muted));
			} else {
				const sel = absoluteIdx === this.selected && selectedRow?.kind === "item";
				out.push(this.rowLine(r.item, sel, inner, dim, muted));
			}
		}

		// Preview shows the selected item only — headers have no preview.
		out.push(this.ruleLine("preview", inner, dim));
		const previewItem = selectedRow?.kind === "item" ? selectedRow.item : undefined;
		for (const line of this.previewLines(previewItem, inner)) out.push(this.frame("  " + muted(line), inner, dim));

		out.push(this.footerLine(inner, dim));
		return out;
	}

	/** Full-width separator row: `📊 Status ─────────`. */
	private groupHeaderLine(g: ListGroup, inner: number, dim: (s: string) => string, muted: (s: string) => string): string {
		const head = ` ${dim(g.icon)} ${muted(g.title)} `;
		const dashes = Math.max(0, inner - visibleWidth(head));
		return dim(`│${head}${"─".repeat(dashes)} │`);
	}

	private frame(content: string, inner: number, dim: (s: string) => string): string {
		const pad = Math.max(0, inner - visibleWidth(content));
		return dim("│ ") + content + " ".repeat(pad) + dim(" │");
	}

	private headerLine(inner: number, dim: (s: string) => string, muted: (s: string) => string): string {
		const left = ` ${this.p.title} `;
		const right = this.p.headerRight ? ` ${this.p.headerRight} ` : "";
		const fillN = Math.max(1, inner + 2 - visibleWidth(left) - visibleWidth(right));
		return dim("╭") + muted(left) + dim("─".repeat(fillN)) + muted(right) + dim("╮");
	}

	private searchLine(inner: number, dim: (s: string) => string, muted: (s: string) => string): string {
		const text = this.searching || this.query ? `/ ${this.query}${this.searching ? "▏" : ""}` : muted("/ to search");
		return this.frame(text, inner, dim);
	}

	private rowLine(it: ListItem, selected: boolean, inner: number, dim: (s: string) => string, muted: (s: string) => string): string {
		const cursor = selected ? muted("❯ ") : "  ";
		const label = selected ? this.p.theme.bold(it.label) : muted(it.label);
		const head = `${cursor}${dim(it.marker)} ${label}`;
		const meta = it.meta ? dim(it.meta) : "";
		const gap = Math.max(1, inner - visibleWidth(head) - visibleWidth(meta));
		const line = head + " ".repeat(gap) + meta;
		return this.frame(visibleWidth(line) > inner ? truncateToWidth(line, inner) : line, inner, dim);
	}

	/** A full-width "── label ───" rule inside the panel border. */
	private ruleLine(label: string, inner: number, dim: (s: string) => string): string {
		const head = `── ${label} `;
		const dashes = Math.max(0, inner - visibleWidth(head));
		return dim(`│ ${head}${"─".repeat(dashes)} │`);
	}

	private previewLines(it: ListItem | undefined, inner: number): string[] {
		const body = (it?.body ?? "").replace(/\s+/g, " ").trim();
		if (!body) return ["(no preview)"];
		return wrapTextWithAnsi(body, inner - 2).slice(0, PREVIEW_LINES);
	}

	private footerLine(inner: number, dim: (s: string) => string): string {
		const acts = (this.p.actions ?? []).map((a) => `${a.key} ${a.hint}`).join(" · ");
		const open = this.p.onSelect ? "⏎ open · " : "";
		const hint = ` ↑↓ move · ${open}/ search${acts ? " · " + acts : ""} · esc `;
		const fillN = Math.max(1, inner + 2 - visibleWidth(hint));
		return dim("╰") + dim(hint) + dim("─".repeat(fillN)) + dim("╯");
	}
}
