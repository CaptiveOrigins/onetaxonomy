# Brand family

OnePedigree and OneTaxonomy are separate tools from one maker. Like a tool family, they share a backbone and keep their own character. This file is identical in both repositories; change it in both.

## App icon

| | OnePedigree | OneTaxonomy |
| --- | --- | --- |
| Tile gradient (top → bottom) | `#f8dcc0` → `#eeb684` (pastel Captive Origins orange) | `#f8d6d7` → `#eda9ac` (pastel Captive Origins pink) |
| Glyph | Two parents joined above one offspring | A rooted tree read left to right |

Both use Captive Origins brown `#4c312c` as ink (connectors, UI structure). Owner's choice 2026-11-02 (option A of the palette study; the swap, option C, stays possible: exchange the two hues).

Shared by every tool:

- Tile: 896 × 896 on a 1024 canvas, corner radius 200, vertical pastel gradient of a Captive Origins color.
- Blocks: cream `#fbf8f2`, rounded (radius ≈ 36–40), connectors 34 px in Captive Origins brown with square joins.
- The Captive Origins heart (pink `#e48185`, about 80 px wide) as the maker's mark, placed on "the one" (the focal individual, the selected taxon).
- Masters: `brand/icon.svg` (source) and `brand/icon-1024.png` (transparent, for app icon generators such as `tauri icon`). A future tool takes a pastel of another Captive Origins color (mauve `#91645d`, a lighter or deeper orange/pink) and its own glyph from the same blocks.

## Interface

Both React packages share these (colors from the Captive Origins palette: orange `#cf8137`, pink `#e48185`, brown `#4c312c`), under their own prefixes (`op-`, `ot-`), so neither depends on the other:

- **Icons**: the same 24 × 24 line icons (1.75 stroke, round caps and joins, `currentColor`) in `icons.tsx`, shown next to text where a label helps, alone (with `aria-label` and a tooltip) in compact floating toolbars.
- **Controls**: 32 px buttons, radius 8, 1 px border; floating toolbar at the top right of the canvas; cards and panels radius 10 with a soft shadow; focus ring 2 px Captive Origins orange `#cf8137` (`#e7a066` in dark mode).
- **Canvas**: drag the background to pan, Ctrl/⌘ + wheel or pinch to zoom, `+` `-` `0` keys, Fit, Download SVG, Print (chart only).
- **Selection**: Captive Origins orange for the selected item and focus; brown for structure; pink for the brand mark and highlights.
- Each tool keeps its own functionality and layout; only the backbone is shared.
