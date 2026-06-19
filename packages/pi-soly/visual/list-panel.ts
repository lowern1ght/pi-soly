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
import { createPanelKeys, type PanelKeybindings, type PanelKeys } from "../mcp/panel-keys.ts";

/** One row in the panel. `body` is shown in the preview pane when selected. */
export type ListItem = { id: string; marker: string; label: string; meta?: string; body?: string };

/** A key-triggered action over the selected item (e.g. enable/disable/reload). */
export type ListAction = { key: string; hint: string; run: (item: ListItem) => void };

export type ListPanelProps = {
	tui: TUI;
	theme: Theme;
	keybindings?: PanelKeybindings;
	done: () => void;
	title: string;
	/** Right-aligned header text (e.g. counts / token budget). */
	headerRight?: string;
	items: ListItem[];
	actions?: ListAction[];
	/** Re-read items after an action mutates state. */
	refresh?: () => ListItem[];
};

const MAX_ROWS = 12; // list window height (render() has no viewport height)
const PREVIEW_LINES = 4;

/** Subsequence fuzzy match: substring scores highest, then in-order chars. */
function fuzzyScore(query: string, text: string): number {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (!q) return 1;
	if (t.includes(q)) return 100 + q.length / t.length;
	let qi = 0;
	for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
	return qi === q.length ? 1 : 0;
}

export class ListPanel implements Component {
	private readonly p: ListPanelProps;
	private readonly keys: PanelKeys;
	private items: ListItem[];
	private query = "";
	private searching = false;
	private selected = 0;

	constructor(props: ListPanelProps) {
		this.p = props;
		this.items = props.items;
		this.keys = createPanelKeys(props.keybindings);
	}

	invalidate(): void {
		/* stateless cache */
	}

	private filtered(): ListItem[] {
		if (!this.query) return this.items;
		return this.items
			.map((it) => ({ it, s: fuzzyScore(this.query, `${it.label} ${it.meta ?? ""}`) }))
			.filter((x) => x.s > 0)
			.sort((a, b) => b.s - a.s)
			.map((x) => x.it);
	}

	private clamp(list: ListItem[]): void {
		if (this.selected >= list.length) this.selected = Math.max(0, list.length - 1);
		if (this.selected < 0) this.selected = 0;
	}

	handleInput(data: string): void {
		const list = this.filtered();
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
		} else if (this.keys.selectDown(data)) {
			this.selected = Math.min(list.length - 1, this.selected + 1);
		} else if (data === "/") {
			this.searching = true;
		} else {
			const action = this.p.actions?.find((a) => a.key === data);
			const current = list[this.selected];
			if (action && current) {
				action.run(current);
				if (this.p.refresh) this.items = this.p.refresh();
			}
		}
		this.p.tui.requestRender();
	}

	render(width: number): string[] {
		const theme = this.p.theme;
		const dim = (s: string) => theme.fg("dim", s);
		const muted = (s: string) => theme.fg("muted", s);
		const inner = Math.max(20, width - 4);
		const list = this.filtered();
		this.clamp(list);

		const out: string[] = [];
		out.push(this.headerLine(inner, dim, muted));
		out.push(this.searchLine(inner, dim, muted));
		out.push(this.frame("", inner, dim));

		// Windowed list around the selection.
		const start = Math.max(0, Math.min(this.selected - Math.floor(MAX_ROWS / 2), Math.max(0, list.length - MAX_ROWS)));
		const window = list.slice(start, start + MAX_ROWS);
		if (window.length === 0) out.push(this.frame(dim("  (no matches)"), inner, dim));
		for (let i = 0; i < window.length; i++) out.push(this.rowLine(window[i] as ListItem, start + i === this.selected, inner, dim, muted));

		out.push(this.ruleLine("preview", inner, dim));
		for (const line of this.previewLines(list[this.selected], inner)) out.push(this.frame("  " + muted(line), inner, dim));

		out.push(this.footerLine(inner, dim));
		return out;
	}

	private frame(content: string, inner: number, dim: (s: string) => string): string {
		const pad = Math.max(0, inner - visibleWidth(content));
		return dim("│ ") + content + " ".repeat(pad) + dim(" │");
	}

	private headerLine(inner: number, dim: (s: string) => string, muted: (s: string) => string): string {
		const left = ` ${this.p.title} `;
		const right = this.p.headerRight ? ` ${this.p.headerRight} ` : "";
		const fillN = Math.max(1, inner + 2 - visibleWidth(left) - visibleWidth(right));
		return dim("┌") + muted(left) + dim("─".repeat(fillN)) + muted(right) + dim("┐");
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
		const hint = ` ↑↓ move · / search${acts ? " · " + acts : ""} · esc `;
		const fillN = Math.max(1, inner + 2 - visibleWidth(hint));
		return dim("└") + dim(hint) + dim("─".repeat(fillN)) + dim("┘");
	}
}
