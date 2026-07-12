// =============================================================================
// visual/border.ts — shared rounded-border renderer for modal panels
// =============================================================================
//
// All soly modal panels (ListPanel, McpPanel, McpSetupPanel) draw bordered
// boxes. Before this module, each had its own helpers:
//   - list-panel:  frame(), headerLine(), footerLine(), ruleLine()  (┌┐└┘)
//   - mcp-panel:   row(), emptyRow(), divider()                     (╭╮╰╯ + raw ANSI)
//   - mcp-setup:   padLine()                                         (┌┐└┘)
//
// This module unifies them under one API with rounded corners (╭╮╰╯├┤│─).
// Each function takes a `styler` ((s: string) => string) so it works with
// any color system — pi's Theme.fg(), mcp-panel's fg(), or identity in tests.
//
// All width math uses pi-tui's visibleWidth/truncateToWidth so ANSI color
// codes inside `content` never break alignment (same approach as list-panel).
// =============================================================================

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Colors the border characters. Identity (s => s) in tests. */
export type BorderStyler = (s: string) => string;

/** Top border with a centered title: `╭── title ──╮`. */
export function borderTop(title: string, innerW: number, styler: BorderStyler, titleStyler?: BorderStyler): string {
	const ts = titleStyler ?? styler;
	const titleW = visibleWidth(title);
	const dashTotal = Math.max(0, innerW - titleW);
	const leftDash = Math.floor(dashTotal / 2);
	const rightDash = dashTotal - leftDash;
	return styler("╭" + "─".repeat(leftDash)) + ts(title) + styler("─".repeat(rightDash) + "╮");
}

/** Bottom border: `╰──...──╯`. */
export function borderBottom(innerW: number, styler: BorderStyler): string {
	return styler("╰" + "─".repeat(innerW) + "╯");
}

/** Mid-panel divider: `├──...──┤`. */
export function borderDivider(innerW: number, styler: BorderStyler): string {
	return styler("├" + "─".repeat(innerW) + "┤");
}

/** Labelled divider inside the panel: `├── label ──┤`. */
export function borderLabelledDivider(label: string, innerW: number, styler: BorderStyler, labelStyler?: BorderStyler): string {
	const ls = labelStyler ?? styler;
	const head = `─ ${label} `;
	const dashN = Math.max(0, innerW - visibleWidth(head) - 1);
	return styler("├ ") + ls(head) + styler("─".repeat(dashN) + "┤");
}

/** Content row: `│ content │` (truncated with `…` if too wide, padded if short). */
export function borderRow(content: string, innerW: number, styler: BorderStyler): string {
	const truncated = visibleWidth(content) > innerW
		? truncateToWidth(content, innerW, "…", true)
		: content;
	const pad = Math.max(0, innerW - visibleWidth(truncated));
	return styler("│ ") + truncated + " ".repeat(pad) + styler(" │");
}

/** Empty row: `│          │`. */
export function borderEmpty(innerW: number, styler: BorderStyler): string {
	return styler("│") + " ".repeat(innerW) + styler("│");
}
