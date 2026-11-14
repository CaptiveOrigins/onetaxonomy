# 0010 — The outline is the keyboard path into the tree; drawing nodes stay out of the Tab order

**Status.** Accepted by the maintainers, 2026-11-11: a technical accessibility choice, not a product decision. Follow-up logged: pan the drawing to whatever is selected in the outline (done 2026-11-11, see Consequences).

**Context.** The explorer's drawing is an SVG with `role="img"`, a title and a description. Its nodes have `tabindex="-1"`, so they take focus when clicked but not with Tab. Every action on a node has a keyboard path through the outline beside it, a `role="tree"` with one Tab stop and the tree view keys (Up and Down, Right and Left to open, close and move, Home and End, type-ahead, Space and Enter, Alt+Up and Alt+Down to reorder), and through the inspector. The audit of 2026-11-11 asked whether the drawing's nodes could be reached with Tab too, in a roving-tabindex pattern.

**Decision.** Keep the outline as the keyboard and screen-reader path. Don't make drawing nodes Tab stops. Reasons:

- A focusable control inside `role="img"` is hidden from screen readers, since an image's children are presentational. Making nodes reachable would mean changing the drawing to a group of buttons, so screen-reader users would meet every taxon twice (in the drawing and in the outline), the second time without the tree's levels, positions and open or closed states.
- The canvas already uses the arrow keys to pan. Arrow keys on a focused node would have to move between nodes instead, so the same keys would mean two things a Tab apart.
- The drawing's node order changes with the layout (rectangular, radial, sunburst), so Up and Down in the drawing either follow the outline's order, which doesn't match what's on screen in a radial layout, or follow positions on screen, which is a second navigation model to build, test and explain.
- What a sighted keyboard user needs from the drawing is to see where they are. The outline already selects in the drawing, and the selection is drawn there.

**Consequences.** `TreeView` keeps `tabindex="-1"` on nodes and `role="img"` on the SVG; a test in `a11y.test.tsx` holds both, and that the outline is one Tab stop. If the drawing ever needs its own focus, the cheaper step is to pan it to the outline's selection when that is out of view, which adds no second keyboard model.

Done 2026-11-11: choosing a taxon in the outline (Space, Enter on a tip, or a click on its row) pans the drawing, SVG or canvas, when the taxon is off screen or within 40 px of the edge, the shortest way that brings it 40 px inside. With several selected, it keeps them all in view and zooms out only when they can't fit at the current zoom, by the smallest factor that fits them; it never zooms in. The pan glides over 200 ms, or jumps when the person asks for reduced motion or the browser can't say. Focus stays in the outline. A plain pan announces nothing; a zoom out says "Zoomed out to show the selection." once in a polite status region. A click in the drawing never moves it, and any pan or zoom by the person stops a glide. Tests in `packages/react/test/reveal.test.tsx`.
