# @captiveorigins/onetaxonomy-layout

Deterministic tree layouts for OneTaxonomy projections, as plain coordinates any renderer can draw (SVG, Canvas, PDF, native). Same projection in, same numbers out.

```js
import { createView, indexDataset, projectView } from '@captiveorigins/onetaxonomy-core'
import { edgePath, radial, rectangular, sunburst } from '@captiveorigins/onetaxonomy-layout'

const data = indexDataset(snapshot)
const projection = projectView(data, createView(data, { id: 'v', title: 'Turtles', target: { kind: 'phylogeny', id: 'my-tree' } }))

const tree = rectangular(projection, { leafGap: 24, levelGap: 120 })   // cladogram
tree.nodes  // [{ id, x, y, leaf }]
tree.edges.map(edgePath) // SVG path strings
tree.notice // "Phylogenetic hypothesis: branching shows proposed common ancestry, relative to this hypothesis only."

rectangular(projection, { scale: 'phylogram', width: 600 }) // needs branch lengths with a stated unit
rectangular(projection, { scale: 'time', width: 600 })      // needs a time-calibrated hypothesis; axis in Ma/ka/years before present
radial(projection, { radiusStep: 80 })
sunburst(classificationProjection)                          // classifications only
```

- **Honest by construction.** Every layout reports `diagram: 'classification' | 'phylogeny'` and a `notice` for the legend: a classification is labelled as placement under a source, never as ancestry; an unrooted tree says so. Phylogram and time scales throw `LayoutError` when lengths, units or calibration are missing instead of inventing them.
- **Collapsed nodes are leaves**, and the projection's `hiddenDescendants` tells renderers how much is folded away (show it).
- Sunburst angles are proportional to visible leaves, not to numbers of species in nature.
