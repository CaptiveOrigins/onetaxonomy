# Changelog

## Unreleased

- Core: records, validation, traversal, MRCA, tri-state monophyly, snapshot checksums.
- Import: Newick reader and writer.
- Core: curated selections (`applySelection`: explicit, all descendants, depth, rank, representative and named-predicate policies; exclusions; ancestor closure; omitted branches), `getCoverageReport` (dataset / hypothesis / caller-stated known-to-science), `extractSubset` with `derivedFrom` provenance, `diffSnapshots` and `referenceImpact`, JSON Schema for snapshots.
- Import: `SourceAdapter` interface and `toSnapshot`; CSV/TSV checklists with configurable columns; Darwin Core Archives (ZIP, `meta.xml`, Taxon core, Vernacular Names); OneTaxonomy JSON reader with checksum check; `reconcile`; `selectiveImport`; community presets (`validatePreset`, `checkPresetReferences`).
