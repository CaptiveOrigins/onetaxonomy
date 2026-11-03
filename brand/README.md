# Brand family

OnePedigree and OneTaxonomy are separate tools from one maker. Like a tool family, they share a backbone and keep their own character. This file is identical in both repositories; change it in both.

## App icon

| | OnePedigree | OneTaxonomy |
| --- | --- | --- |
| Tile gradient (top → bottom) | `#c6e3cf` → `#97c9aa` (sage) | `#c9def0` → `#9cbedc` (powder blue) |
| Ink (connectors, UI accent) | `#25503d` | `#26465f` |
| Glyph | Two parents joined above one offspring | A rooted tree read left to right |

Shared by every tool:

- Tile: 896 × 896 on a 1024 canvas, corner radius 200, vertical pastel gradient in the tool's hue.
- Blocks: cream `#fbf8f2`, rounded (radius ≈ 36–40), connectors 34 px in the tool's ink with square joins.
- One amber accent dot `#e8913c` (r 26) marking "the one" (the focal individual, the selected taxon).
- Masters: `brand/icon.svg` (source) and `brand/icon-1024.png` (transparent, for app icon generators such as `tauri icon`). A future tool picks a new pastel hue (lavender, peach …) and its own glyph from the same blocks.

## Interface

Both React packages share these, under their own prefixes (`op-`, `ot-`), so neither depends on the other:

- **Icons**: the same 24 × 24 line icons (1.75 stroke, round caps and joins, `currentColor`) in `icons.tsx`, shown next to text where a label helps, alone (with `aria-label` and a tooltip) in compact floating toolbars.
- **Controls**: 32 px buttons, radius 8, 1 px border; floating toolbar at the top right of the canvas; cards and panels radius 10 with a soft shadow; focus ring 2 px amber `#f0b35a`.
- **Canvas**: drag the background to pan, Ctrl/⌘ + wheel or pinch to zoom, `+` `-` `0` keys, Fit, Download SVG, Print (chart only).
- **Selection**: amber for the selected item and its highlights; the tool's ink for structure.
- Each tool keeps its own functionality and layout; only the backbone is shared.
