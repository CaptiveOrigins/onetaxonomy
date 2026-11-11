# @captiveorigins/onetaxonomy-react

React components for OneTaxonomy: a server-renderable SVG tree, an accessible keyboard outline of the same tree, and an explorer with undo/redo. Every interaction is a view action from `@captiveorigins/onetaxonomy-core`, so the scientific data never changes and views can be saved, shared and replayed.

```tsx
import { createView, indexDataset } from '@captiveorigins/onetaxonomy-core'
import { Explorer } from '@captiveorigins/onetaxonomy-react'
import '@captiveorigins/onetaxonomy-react/styles.css'

const data = indexDataset(snapshot)
const view = createView(data, { id: 'turtles', title: 'Turtles', target: { kind: 'classification', id: 'my-classification' } })

<Explorer dataset={data} initialView={view} title="Turtles" onViewChange={save} />
```

- **`TreeView`**: SVG only, no effects: renders on the server. `role="img"` with a title and a description that says whether it is a classification or a phylogeny and how much is shown. Stable `ot-*` classes and `data-*` states (status, rank, collapsed, selected); extinct taxa are marked †.
- **`TreeOutline`**: the WAI-ARIA tree pattern: one tab stop, arrows, Right/Left to open/close, Home/End, type-ahead, Space to select (Shift+Space adds to the selection), Enter to open a branch, `*` to open its siblings, **Alt+Up/Down to reorder** (the keyboard alternative to dragging). Folded descendants are announced ("12 not shown"), and † is read as "extinct".
- **`Explorer`**: toolbar (undo, redo, expand/collapse all, layout, living/extinct/unknown filter), drawing, outline and inspector (rank, status, highlights with *clade* or *group* and the hypothesis they were assessed against, flip children, show only this branch). Layouts the data can't support stay disabled with the reason. With the drawing focused, arrow keys pan, + and − zoom, 0 fits and Escape clears the selection; the inspector's hint lists the outline keys. All text is replaceable through `labels`.
- **`useTaxonomyView`**: the headless state (view, projection, dispatch, undo/redo) for your own UI.
- Styles are optional (`styles.css`, CSS custom properties, dark mode, reduced motion). The default light and dark themes meet WCAG 2.2 AA contrast for text (4.5:1) and lines and field borders (3:1); a test computes the ratios from the stylesheet. One known exception: the brand-orange focus ring is 2.88:1 on the panel color (3.07:1 on the drawing).

Try it: `pnpm build && pnpm --filter @captiveorigins/onetaxonomy-playground build`, then open `apps/playground/dist/index.html`.
