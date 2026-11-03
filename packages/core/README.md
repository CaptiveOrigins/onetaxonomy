# @captiveorigins/onetaxonomy-core

The scientific core of OneTaxonomy: taxon concepts, names, classifications and phylogenetic hypotheses, with validation, bounded traversal, MRCA and **tri-state monophyly**. No dependencies; no DOM, Node, React, CMS or database. It runs in browsers, Node, workers and desktop webviews.

```js
import { assessTaxon, findMRCA, indexDataset, isMonophyletic, sealSnapshot, validateDataset } from '@captiveorigins/onetaxonomy-core'

const problems = validateDataset(snapshot)          // diagnostics; nothing is repaired silently
const sealed = sealSnapshot(snapshot)               // checksummed and frozen
const data = indexDataset(sealed)

const tree = data.phylogeny('archelosauria')        // a rooted hypothesis
findMRCA(tree, ['t-testudines', 't-aves'])          // { status: 'found', node: 'archelosauria', hypothesis }
isMonophyletic(tree, ['t-crocodylia', 't-aves'])    // { status: 'monophyletic', reason: 'complete-clade', … }

// A classification taxon against a hypothesis, through explicit concept mappings only:
assessTaxon(data.classification('traditional'), 'c:reptilia', tree)
// { status: 'not-monophyletic', missing: ['t-aves'], … }
assessTaxon(data.classification('traditional'), 'c:reptilia', null)
// { status: 'indeterminate', reason: 'classification-only' }
```

- **Results are relative to one hypothesis** (`{ id, version }`) and carry caveats (`partial-sampling`, `unmapped-members`, …).
- **Unrooted trees** give no MRCA or clade claims; **forests** get no invented common ancestor; **polytomies** are unresolved (`indeterminate`) unless you pass `{ polytomies: 'hard' }`.
- **Traversal** (`getChildren`, `getAncestors`, `getLineage`, `getDescendants`) is iterative and accepts `maxDepth` / `limit`, returning `truncated` when cut.

See the [data schema](../../docs/architecture/data-schema.md) and [invariants](../../docs/architecture/scientific-invariants.md).
