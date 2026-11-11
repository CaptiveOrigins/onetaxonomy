# Data schema (version 1)

The TypeScript types in [`packages/core/src/model.ts`](../../packages/core/src/model.ts) are the definitive schema; this page explains them. All records are plain JSON: ISO date strings, no `Map`s or classes. `schemaVersion` changes only with a migration in `@captiveorigins/onetaxonomy-import`.

## Identity

- Every record has an opaque `id` (`Id = string`). IDs are **never** scientific names: names change, collide (homonyms) and are shared by different concepts (splits, lumps).
- Records from a source keep that source's own identifiers as `ExternalId { source, id }` and `Provenance { source, externalId, retrievedAt, note }`.
- A **name** (`ScientificName`) is a string plus authorship. A **concept** (`TaxonConcept`) is a circumscription according to a source and points to its accepted name, with other `usages` (synonym, misapplied, provisional, unknown). Two sources that circumscribe a taxon differently produce two concepts, even with the same name: OneTaxonomy never merges them silently. `DatasetIndex.findByName` returns every concept using a name, so callers resolve ambiguity explicitly.

## Records

| Record | Purpose | Key fields |
| --- | --- | --- |
| `Source` | Supplied by the project owner | `title`, `citation`, `url`, `license` (of the data), `externalVersion`, `retrievedAt`, `illustrative` (fixtures) |
| `DatasetSnapshot` | Immutable, versioned container | `schemaVersion`, `id`, `version`, `createdAt`, `checksum` (`sha256:` of canonical JSON, set by `sealSnapshot`), `sources`, `names`, `concepts`, `classifications`, `phylogenies`, `profiles`, `traits` |
| `ScientificName` | A name string | `name`, `authorship`, `externalIds` |
| `TaxonConcept` | A taxon according to a source | `acceptedName`, `usages[]`, `rank` (free text), `externalIds`, `commonNames[{ name, locale }]`, `provenance` |
| `Classification` | A taxonomic hierarchy (tree or forest) | `title`, `version`, `sources`, `placements[{ concept, parent \| null }]` |
| `Phylogeny` | A phylogenetic **hypothesis** | `title`, `version`, `sources`, `citation`, `rooted`, `rooting`, `lengthUnit`, `timeCalibrated`, `sampling` (`complete`/`partial`/`unknown`), `nodes`, `edges` |
| `PhyloNode` | Node of a hypothesis | `label` (display only), `concepts[]` (explicit mapping; absent = unmapped), `support`, `additionalSupport` (values from other methods), `status` (`extant`/`extinct`/`unknown`), `age { value, min, max }` |
| `PhyloEdge` | Directed parent → child | `length` (in the phylogeny's `lengthUnit`), `support` |
| `TaxonProfile` | Optional facts about a concept | `summary`, `status`, `geography`, `morphology`, `ecology`, `media[]` (with license/credit), `citations`, `extensions` (consumer-namespaced) |
| `TraitSet` | Observed character states from one cited source | `title`, `source`, `states[] { id, label, color? }`, `values[] { concept, state, note? }` (one value per concept; never inferred: unstated concepts stay uncolored) |

`DatasetSnapshot.derivedFrom` records the snapshot (id, version, checksum) and selection a subset was extracted from. A JSON Schema for snapshots ships in `@captiveorigins/onetaxonomy-core/schema/snapshot.schema.json` for non-TypeScript consumers.

## Curation (M3)

| Record | Purpose | Key fields |
| --- | --- | --- |
| `CuratedSelection` | What to take from one classification, and why | `classification`, `roots[{ concept, policy, label, rationale }]`, `exclude[{ concept, rationale }]` |
| `SelectionPolicy` | How much of a root's subtree | `explicit` (the root), `allAvailableDescendants`, `depth`, `rank` (stated ranks, case-insensitive), `representative` (chosen descendants), `predicate` (named; the function is supplied when applying) |
| `SelectionResult` | The applied selection | `curated` (chosen), `ancestors` (paths added as context), `included`, `excluded`, `roots[{ status, curated, omitted, omittedBranches }]`, `diagnostics`, `truncated` |
| `GroupCoverage` | Coverage for one group | `dataset { total, included, omitted, includedByRank, omittedBranches }`, `hypothesis { mapped, unmapped, sampling }`, `knownToScience` (caller-stated count + source, or `not-stated`) |
| `SnapshotDiff` | Release-to-release changes by concept id | `added`, `removed`, `renamed`, `rankChanged`, `relocated`, `splitCandidates`, `mergeCandidates` |
| `CommunityPreset` (import) | Shareable curation | pinned `references[{ snapshot, version, checksum }]`, `selections`, `style` hints by id; no taxonomic records (refused by `validatePreset`) |

Results list ids in the classification's own order (the source's order), not traversal order. Exclusion wins over every policy.

Planned for later milestones (types are added with the code that uses them): `TaxonomicView`, `ViewAction`, `Highlight` (M4), `Lesson`, `Scene` and `Workspace` (M5–M6). The `.onetaxonomy` bundle and its manifest (M6) are documented in [bundle-format.md](bundle-format.md).

## Semantics that matter

- **Classification vs phylogeny.** A `Classification` states placements under an authority; it carries no claim of common ancestry. Only a rooted `Phylogeny` supports MRCA and clade claims.
- **Edge direction.** In an unrooted phylogeny, edge direction is just the storage orientation (e.g. from the Newick text). Algorithms refuse ancestry claims until it is rooted, and the rooting choice is recorded in `rooting`.
- **Units.** `lengthUnit` applies to every edge length in the hypothesis. No unit means lengths are not interpretable; only `Ma`, `ka` and `years` are time. `timeCalibrated: true` requires a time unit.
- **Sampling.** `sampling: 'partial'` (or unknown) means a taxon's absence from the tree is not evidence that it doesn't belong to a clade. Monophyly results carry `partial-sampling` / `sampling-unknown` caveats.
- **Forests and polytomies** are valid. Nodes with more than two children are polytomies, treated as unresolved (soft) unless a caller asks for hard polytomies.

## Monophyly results

`isMonophyletic` and `assessTaxon` return `MonophylyResult`:

```ts
{
  status: 'monophyletic' | 'not-monophyletic' | 'indeterminate',
  reason: 'complete-clade' | 'missing-descendants' | 'unresolved-polytomy' | 'unrooted'
        | 'classification-only' | 'different-trees' | 'unknown-node' | 'no-mapped-members' | 'empty',
  hypothesis: { id, version } | null,   // what the answer is relative to
  mrca?: Id, selected: Id[], missing: Id[], unresolvedAt?: Id,
  caveats: ('single-terminal' | 'partial-sampling' | 'sampling-unknown' | 'unmapped-members')[],
  unmapped?: Id[],
}
```

## Diagnostics

`validateDataset` returns `Diagnostic { severity: 'error' | 'warning' | 'info', code, message, path, ids?, suggestion? }`. Errors make a snapshot unusable (indexes refuse it); warnings are scientific caveats; info notes (e.g. illustrative sources) are informational. Validation never mutates or repairs.
