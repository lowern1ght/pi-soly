# `.assets/`

Visual assets used by the top-level `README.md` (and any other doc that
references `./packages/pi-soly/.assets/<file>`).

## Files (PNGs only — no GIFs, no asciinema)

| File | Used in | Status |
|---|---|---|
| `banner.png` | Top of README (hero) | TODO — see spec below |
| `soly-picker.png` | "Quick start" section caption | TODO |
| `ask-pro.png` | "Rules & Docs" section | TODO |
| `decision-deck.png` | "Rules & Docs" section | TODO |
| `soly-settings.png` | "Settings" section | TODO |

## Brand invariants (apply to all assets)

- **Palette**: dark theme. Background `#1a1a1a` · text `#e0e0e0` ·
  accent (yellow-400) `#fbbf24` · dim `#666666`.
- **Typeface**: monospace. JetBrains Mono, Fira Code, or system mono.
- **Iconography**: ⚡ bolt, BMP glyphs only. No emoji / VS16
  sequences (they mis-measure and ghost the panel).
- **No OS-specific paths** in screenshots — strip `/Users/...`,
  `C:\...`, etc.

## Specs (one per asset)

### `banner.png`
- 1280×400 PNG, transparent or `#1a1a1a` background
- Center: ⚡ + "soly" wordmark + tagline "Plans · State · MANDATORY rules"
- Right side: schematic of `soly new → execute → done` arrows, or
  stylized TUI fragment showing `/sly` modal
- Alt text for the README link: "pi-soly — workflow engine for pi"

### `soly-picker.png`
- 1000×600 PNG
- Terminal screenshot showing the `/sly` modal with the three groups
  (Status / Inspect / Manage) populated
- Cursor on an item, preview pane shows the live preview
- Header right: "X phases · Y% · /sly /s"

### `ask-pro.png`
- 1000×400 PNG
- Terminal screenshot showing the `ask_pro` multi-question picker
- Tabs at the top (1/2/3), one question's options visible with the
  ⭐ recommended row highlighted
- Preview pane empty or showing the current question's context

### `decision-deck.png`
- 1000×600 PNG
- Terminal screenshot showing the `decision_deck` full-screen cards
- One card fully expanded with code preview; recommended ⭐ visible

### `soly-settings.png`
- 1000×600 PNG
- Terminal screenshot showing the `/sly settings` interactive editor
- Cursor on a toggle, footer showing the +/- action keys
- One group expanded (e.g. "Agent") with the recommended option
  marked ⭐

## Workflow

1. You (designer) make the assets in this directory
2. `git add .assets/`
3. The README references are already wired — no further changes
4. Re-run `bun test` (the e2e install test checks the tarball
   integrity — it should pass since `.assets/` is in
   `package.json#files`)
