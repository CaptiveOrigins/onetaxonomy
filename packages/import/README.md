# @captiveorigins/onetaxonomy-import

Readers, writers and (soon) source adapters and curated imports for OneTaxonomy. It ships no data: you bring your sources.

## Newick

```js
import { parseNewick, toNewick } from '@captiveorigins/onetaxonomy-import'

const tree = parseNewick("((A_b:0.1,'C d':0.2)95:0.05,F:1e-3);", {
  id: 'my-tree', title: 'My tree', version: '1', sources: ['my-source'],
  rooted: true,                       // required unless the file says [&R] or [&U]
  lengthUnit: 'substitutions-per-site',
  mapLabel: (label) => myConcepts[label], // explicit mapping; unmapped labels stay unmapped
})
toNewick(tree) // "[&R] ((A b:0.1,'C d':0.2)95:0.05,F:0.001);"
```

Polytomies are kept, quoted labels and comments preserved (comments become `annotations.newickComments`), numeric internal labels read as support values (`internalLabels` option), and errors report the character position.

Planned (M3): structured JSON, CSV, Darwin Core Archive, source adapters, reconciliation, curated selections and coverage reports.
