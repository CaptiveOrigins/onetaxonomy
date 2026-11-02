# Scientific invariants

Every package keeps these rules. Each has an automated test; the test file is named next to it. A rule without a passing test is not considered implemented ([`limitations.md`](limitations.md) lists any that are pending).

| # | Invariant | Enforced by | Test |
| --- | --- | --- | --- |
| I1 | **Scientific data ≠ displayed view.** Views are projections over a pinned, immutable snapshot; no view operation changes the snapshot. | `applyViewAction` is pure; snapshots are frozen after creation; the snapshot checksum is recomputed in tests. | M4 `view-actions.test.ts` |
| I2 | **Classification ≠ phylogeny.** A classification hierarchy never certifies monophyly; only a rooted phylogeny can. | Separate record types; `assessGroup` on a classification returns `indeterminate` with reason `classification-only`. | `monophyly.test.ts` |
| I3 | **Only supported clades are called clades.** Arbitrary groups can be highlighted but are labelled *groups*. | `Highlight.kind` is `group` unless a monophyly assessment returned `monophyletic` against a named hypothesis. | `monophyly.test.ts`, M4 |
| I4 | **Monophyly is tri-state and scoped.** Results are `monophyletic`, `not-monophyletic` or `indeterminate`, always relative to one hypothesis (id + version), with the MRCA, missing members and caveats. Incomplete data never yields an unjustified yes/no. | `isMonophyletic` | `monophyly.test.ts` |
| I5 | **Rooting matters.** MRCA and clade claims need a rooted hypothesis; unrooted trees yield `indeterminate` (`unrooted`) until an explicit, recorded rooting. | `findMRCA`, `isMonophyletic` | `monophyly.test.ts` |
| I6 | **Polytomies are kept.** Unresolved branching is never silently dichotomized. By default a polytomy is *soft* (unresolved): a group formed by some, not all, branches of a polytomy is `indeterminate`. | `isMonophyletic({ polytomies })` | `monophyly.test.ts` |
| I7 | **Missing stays missing.** A taxon concept without an explicit mapping to a phylogeny node is reported as unmapped, never guessed by name. Terminals may be samples or unnamed lineages. | `PhyloNode.conceptIds` explicit; `assessTaxon` reports unmapped members | `monophyly.test.ts` |
| I8 | **Forests stay forests.** Disconnected roots get no invented common ancestor; MRCA across trees is `null` with reason `different-trees`. | indexes, `findMRCA` | `traversal.test.ts` |
| I9 | **Units are explicit.** Branch lengths carry a unit; no unit means no time. Time-scaled layouts require `unit: 'Ma'`-type time units. | `validateDataset` (`length-without-unit`, `mixed-units`) | `validation.test.ts` |
| I10 | **Identity is not a name.** Records use opaque IDs plus source-qualified external IDs; homonyms, synonyms and splits are separate concepts/names and never merged silently. | model; reconciliation in `import` | `validation.test.ts`, M3 |
| I11 | **Unknown is a value.** Extant/extinct status may be `unknown`; filters treat it as its own category. | model, M4 filters | M4 |
| I12 | **Curation ≠ exhaustive import.** A curated selection imports chosen roots by policy plus ancestor paths, never descendants of unselected branches, and discloses what was omitted. | `import` curation | M3 `curation.test.ts` |
| I13 | **Coverage is disclosed.** “All descendants in dataset”, “in selected hypothesis” and “known to science” are distinct; OneTaxonomy only asserts the first two. Hidden descendants are counted, not dropped. | `getCoverageReport`, projections | M3, M4 |
| I14 | **Inference is labelled.** Ancestral trait reconstructions carry method and assumptions and are marked *inferred*. | M8 | M8 |
| I15 | **Validation explains.** Problems come back as diagnostics (severity, code, path, suggestion); nothing is silently repaired. | `validateDataset` | `validation.test.ts` |
| I16 | **Deterministic.** The same snapshot and view always project to the same output; traversal orders are stable. | indexes sort children by input order | `traversal.test.ts` |
