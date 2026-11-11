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

## NEXUS and phyloXML

```js
import { nexusAdapter, phyloXmlAdapter } from '@captiveorigins/onetaxonomy-import'

const source = { id: 'my-study', title: 'My study', citation: '…', license: 'CC BY 4.0' }
const nexus = await nexusAdapter({ source, id: 'my-study', version: '1', lengthUnit: 'substitutions-per-site', mapLabel }).read(text)
const xml = await phyloXmlAdapter({ source, id: 'my-study', version: '1', mapTaxonomy: (t) => byNcbi[t.ids.find((x) => x.provider === 'ncbi')?.id] }).read(text)
// result.phylogenies: one per tree, ids `my-study:1`, `my-study:2`…
```

The NEXUS reader takes the trees from every TREES block. A TRANSLATE table turns tip tokens back into names before `mapLabel` sees them. A tree is rooted only if it says `[&R]`, unrooted if it says `[&U]` or is a `UTREE`; otherwise pass `rooted`, or the file is refused. Other blocks (TAXA, CHARACTERS…) are skipped with a warning, and so are tip labels that aren't in the table.

The phyloXML reader takes each `<phylogeny>`: nested clades, names, branch lengths (attribute or element; refused if they disagree), every `<confidence>` (the first is `support`, the rest `additionalSupport`, each with its `type` as the method) and the taxonomy, which is kept as an annotation and offered to `mapTaxonomy`. Rooting comes from the `rooted` attribute. Elements it doesn't read (sequences, events, dates, colors…) are counted in the warnings. It reads no DTDs or external entities.

Both refuse malformed input with the line (and the element, for phyloXML). Neither file format states a branch length unit, so give `lengthUnit` when you know it.

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

## Bundles

A `.onetaxonomy` bundle is a ZIP holding `manifest.json`, an optional sealed snapshot, views, lessons and media, each listed with its size and SHA-256. The format is documented in [docs/architecture/bundle-format.md](../../docs/architecture/bundle-format.md).

```js
import { readBundle, writeBundle } from '@captiveorigins/onetaxonomy-import'

const bytes = writeBundle({ createdAt, createdBy: { app: 'my-app', version: '1.0.0' }, snapshots: [{ snapshot, embed: true }], views: [view] })
const result = await readBundle(bytes)
if (!result.ok) console.log(result.problems) // [{ code: 'checksum-mismatch', path: 'views/main.view.json', message: '…' }]
```

`writeBundle` refuses a view or lesson made with a snapshot it doesn't pin. `readBundle` checks everything before returning anything (the manifest and its format version, each file's presence, size and checksum, the JSON, that embedded snapshots are sealed and match their pins) and returns either the whole bundle or every problem, never part of one. `writeZip` and `crc32` are exported too.
