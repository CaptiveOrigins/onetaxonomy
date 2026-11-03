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
- **`TreeOutline`**: the WAI-ARIA tree pattern: one tab stop, arrows, Right/Left to open/close, Home/End, type-ahead, Space to select, **Alt+Up/Down to reorder** (the keyboard alternative to dragging). Folded descendants are announced ("12 not shown").
- **`Explorer`**: toolbar (undo, redo, expand/collapse all, layout, living/extinct/unknown filter), drawing, outline and inspector (rank, status, highlights with *clade* or *group* and the hypothesis they were assessed against, flip children, show only this branch). Layouts the data can't support stay disabled with the reason. All text is replaceable through `labels`.
- **`useTaxonomyView`**: the headless state (view, projection, dispatch, undo/redo) for your own UI.
- Styles are optional (`styles.css`, CSS custom properties, dark mode, reduced motion).

Try it: `pnpm build && pnpm --filter @captiveorigins/onetaxonomy-playground build`, then open `apps/playground/dist/index.html`.
