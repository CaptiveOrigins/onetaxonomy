# @captiveorigins/onetaxonomy-import

Source adapters, readers and writers, reconciliation and curated selective imports for OneTaxonomy. It ships no data and picks no sources: you bring yours. Adapters take file contents (text or bytes), not paths, so they run in browsers, Node, workers and desktop webviews.

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

## Source adapters

Every adapter implements `SourceAdapter<Input>` (`describe()`, `read(input) → ImportResult`) and returns names, concepts, one classification, the source's raw ids and **warnings** for anything it handled conservatively (missing parent → kept as a root; parent that is a synonym → its accepted taxon; synonym without its accepted taxon → skipped; unmapped status → `unknown`). `toSnapshot(results, { id, version, createdAt })` combines results into a snapshot; seal it with `sealSnapshot`.

```js
import { csvAdapter, dwcaAdapter, readSnapshotJson, toSnapshot, DARWIN_CORE_COLUMNS } from '@captiveorigins/onetaxonomy-import'

const source = { id: 'my-source', title: 'My checklist', citation: '…', license: 'CC BY 4.0', externalVersion: '2026-03' }

// CSV/TSV with any column names (Darwin Core names by default):
const csv = csvAdapter({ source, delimiter: '\t', columns: { ...DARWIN_CORE_COLUMNS, vernacular: [{ column: 'common_en', locale: 'en' }] } })
// Darwin Core Archive (the ZIP bytes, or { files: { 'meta.xml': …, 'taxon.txt': … } }):
const dwca = dwcaAdapter({ source, statusMap: { 'accepted name': 'accepted' } })
const result = await dwca.read(zipBytes)
const snapshot = toSnapshot(result, { id: 'my-source', version: '2026-03', createdAt: new Date().toISOString() })

// A OneTaxonomy snapshot file: schema version, checksum ('verified' | 'mismatch' | 'unsealed') and diagnostics.
const { snapshot: loaded, checksum, diagnostics } = readSnapshotJson(text)
```

Concept ids are `<idPrefix>:<the source's id>` (prefix defaults to the source id), so they stay stable across releases of the same source and `diffSnapshots` can compare releases.

## Reconciliation

`reconcile(a, b)` lists concepts that share an external identifier, concepts that only share a name (candidates for a curator), names used by several concepts on either side (never linked automatically) and what is only on one side. It never merges anything.

## Curated selective import

```js
import { selectiveImport } from '@captiveorigins/onetaxonomy-import'

const { snapshot, selection, coverage, diagnostics } = selectiveImport(full, {
  id: 'keepers', title: 'Groups we keep', version: '1', classification: 'col:classification',
  roots: [
    { concept: 'col:TURTLES', policy: { kind: 'rank', ranks: ['species', 'subspecies'] }, rationale: '…' },
    { concept: 'col:GECKO-GENUS', policy: { kind: 'allAvailableDescendants' } },
  ],
  exclude: [{ concept: 'col:FOSSIL-FAMILY', rationale: 'extinct' }],
}, { id: 'curated', version: '1', createdAt })
```

Policies: `explicit`, `allAvailableDescendants`, `depth`, `rank`, `representative`, `predicate` (named; pass `predicates: { name: fn }`). The result holds only the chosen concepts and their ancestor paths, with `derivedFrom` provenance; `coverage` tells, per root, how much was included and which branches were left out. A selection with errors (unknown root or predicate) is refused rather than imported in part.

## Community presets

A preset (`format: 'onetaxonomy-preset'`) shares curation, not data: pinned snapshot references (id, version, checksum), selections and style hints by concept id. `validatePreset(json)` refuses embedded taxonomic records; `checkPresetReferences(preset, snapshots)` reports checksum mismatches and ids that no longer exist.
