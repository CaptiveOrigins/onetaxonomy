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

## Comparing and rooting hypotheses

```js
import { comparePhylogenies, midpointRoot, rerootPhylogeny } from '@captiveorigins/onetaxonomy-core'

comparePhylogenies(treeA, treeB)
// { status: 'compared', mode: 'unrooted', rf: 2, normalized: 0.5, shared, onlyInA, onlyInB, inAOnly, inBOnly, notes }
const rooted = rerootPhylogeny(unrootedTree, ['t-lamprey'], { id: 'my-tree-rooted', version: '1' })
// rooted.rooting: { method: 'outgroup', outgroup: ['t-lamprey'], from: { id, version }, note }
const midpoint = midpointRoot(unrootedTree, { id: 'my-tree-midpoint', version: '1' }) // only when you ask; labelled as such
```

- `comparePhylogenies` gives the Robinson-Foulds distance on the tips the two hypotheses share, matched by explicit concept mappings only. Tips in only one are listed, not dropped silently. It compares rooted clades when both are explicitly rooted, unrooted splits otherwise, and it refuses unmapped or ambiguous tips and forests. Support values and branch lengths aren't used.
- `rerootPhylogeny` and `midpointRoot` return a **new** record that says how it was rooted and from what. They never change the input. Support stays with the split it measures. Time-calibrated hypotheses, forests and outgroups that aren't a clade are refused. `describeView` puts a rooted record's rooting, method first ("Rooting (outgroup): Rerooted on…"), right after the hypothesis line, so every export says the tree was rerooted.
- Views can draw branches below a support threshold as polytomies (`{ type: 'collapseBelowSupport', threshold }`). The projection lists the collapsed branches and `describeView` discloses them. Branches with no support value are never collapsed.

## Curation, coverage and releases

```js
import { applySelection, diffSnapshots, extractSubset, getCoverageReport, referenceImpact } from '@captiveorigins/onetaxonomy-core'

const result = applySelection(data, selection)            // curated + ancestor paths, omitted branches, diagnostics
const coverage = getCoverageReport(data, {
  classification: selection.classification, included: result, phylogeny: 'my-tree',
  knownToScience: { [turtles]: { count: describedSpecies, rank: 'species', source: 'the checklist you cite' } },
})                                                        // dataset · hypothesis · known to science (only as you state it)
const subset = extractSubset(snapshot, { id, version, createdAt, classification: selection.classification, include: result })
const changes = referenceImpact(diffSnapshots(oldRelease, newRelease), mySavedIds) // renamed, relocated, split/merge candidates…
```

`schema/snapshot.schema.json` (exported as `@captiveorigins/onetaxonomy-core/schema/snapshot.schema.json`) describes the snapshot format for non-TypeScript tools.

See the [data schema](../../docs/architecture/data-schema.md) and [invariants](../../docs/architecture/scientific-invariants.md).
