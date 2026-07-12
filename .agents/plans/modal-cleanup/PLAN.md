# Modal Cleanup — extract shared panel helpers, migrate MCP panels

## Context

Five modal/panel components exist in pi-soly. Three already use the shared
`ListPanel` base (`commands/{artifacts,docs,rules,soly}.ts`, `settings-ui.ts`).
Four roll their own rendering and duplicate logic:

- `ask/picker.ts` (1406 lines) — own KEY_* constants, own render (OUT OF SCOPE)
- `mcp/mcp-panel.ts` (829 lines) — own `fg()`, `row()/emptyRow()/divider()`, raw ANSI
- `mcp/mcp-setup-panel.ts` (580 lines) — own `fg()`, `padLine()`, `wrapText()`
- `deck/deck.ts` (386 lines) — own render (OUT OF SCOPE)

## Problems found

1. `fuzzyScore()` duplicated identically in `mcp/mcp-panel.ts:58` and `visual/list-panel.ts:63`
2. Border/frame helpers: 3 separate implementations (list-panel `frame()`, mcp-panel `row()/emptyRow()/divider()`, mcp-setup-panel `padLine()`)
3. Key handling: picker uses raw bytes (`KEY_ESC = "\x1b"`), mcp panels use `matchesKey()`, list-panel uses `panel-keys`
4. Raw ANSI (`\x1b[1m` etc.) in mcp-panel (6) and picker (5) — bypasses theme; list-panel uses 0
5. mcp-panel has 13 `emptyRow()` calls — too much vertical padding
6. Inconsistent borders: mcp-panel `╭╮╰╯` (rounded), mcp-setup-panel `┌┐└┘` (square), list-panel `┌┐└┘` (square)

## Scope (user-confirmed)

- ✅ Extract shared helpers (fuzzyScore, border/frame, key constants)
- ✅ Migrate mcp-panel + mcp-setup-panel to use shared helpers
- ✅ Rounded borders `╭╮╰╯` everywhere
- ✅ Clean up excess emptyRow() in mcp-panel
- ❌ ask/picker.ts migration (too complex — multi-question tabs, previews)
- ❌ deck/deck.ts migration

## Plan

### Task 1: Create `visual/border.ts` — shared border renderer

Rounded-corner border helpers (`╭╮╰╯├┤│─`). All take a `styler` function
(`(s: string) => string`) for color, so they work with any theme system.

```ts
export type BorderStyler = (s: string) => string;

export function borderTop(title: string, innerW: number, styler: BorderStyler, titleStyler?: BorderStyler): string;
export function borderBottom(innerW: number, styler: BorderStyler): string;
export function borderDivider(innerW: number, styler: BorderStyler): string;
export function borderRow(content: string, innerW: number, styler: BorderStyler): string;
export function borderEmpty(innerW: number, styler: BorderStyler): string;
export function borderLabelledDivider(label: string, innerW: number, styler: BorderStyler, labelStyler?: BorderStyler): string;
```

- `borderRow` truncates content to `innerW` with `…` and pads to fill
- `borderTop` centers the title: `╭── title ──╮`
- All use `╭╮╰╯├┤│─` (rounded)

### Task 2: Create `visual/fuzzy.ts` — shared fuzzyScore

Extract the identical `fuzzyScore(query, text)` from list-panel.ts.
Single source of truth. Both list-panel and mcp-panel import from here.

### Task 3: Migrate `visual/list-panel.ts`

- Replace local `fuzzyScore` with import from `visual/fuzzy.ts`
- Replace `┌┐└┘` border chars with `╭╮╰╯` (via shared border.ts)
- Keep `frame()` as a thin wrapper over `borderRow()` for internal use

### Task 4: Migrate `mcp/mcp-panel.ts`

- Replace local `fuzzyScore` with import from `visual/fuzzy.ts`
- Replace `row()/emptyRow()/divider()` with `borderRow/borderEmpty/borderDivider` from border.ts
- Replace `╭╮` top border construction (lines 610-612) with `borderTop()`
- Replace raw ANSI bold/italic/inverse (`\x1b[1m` etc.) with theme.fg() where possible
  - Keep `fg()` helper for MCP-specific colors (rainbow progress, server status colors)
  - But border rendering goes through border.ts (themed)
- Clean up excess `emptyRow()` calls: 13 → ~6 (remove redundant spacing between sections)
- Keep `rainbowProgress()` — it's MCP-specific, not shared

### Task 5: Migrate `mcp/mcp-setup-panel.ts`

- Replace `padLine()` with `borderRow()` from border.ts
- Replace `┌┐└┘` with `╭╮╰╯`
- Replace `├┤` divider with `borderDivider()`
- Keep local `wrapText()` (pi-tui has `wrapTextWithAnsi` but setup-panel's is simpler and works)
- Keep local `fg()` for MCP-specific colors

### Task 6: Update tests

- `tests/list-panel-groups.test.ts` — update border char expectations (`┌` → `╭`, etc.)
- Any mcp-panel tests that assert on rendered output — update border chars + spacing
- Add `tests/border.test.ts` — unit tests for border helpers (width math, truncation, title centering)
- Add `tests/fuzzy.test.ts` — unit tests for fuzzyScore (already tested indirectly, but direct tests are cheap)

## must_haves

- truths:
  - "fuzzyScore exists in exactly one file (visual/fuzzy.ts)"
  - "border helpers exist in visual/border.ts, used by list-panel + mcp-panel + mcp-setup-panel"
  - "all panels use ╭╮╰╯ rounded borders"
  - "mcp-panel has ≤7 emptyRow/borderEmpty calls (down from 13)"
  - "no raw \x1b[ in border rendering (only in mcp-panel fg() for content colors)"
  - "ask/picker.ts and deck/deck.ts are NOT touched"
  - "bun test passes (all existing tests updated for new border chars)"
  - "bun run typecheck clean"
