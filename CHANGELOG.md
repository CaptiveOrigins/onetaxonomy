# Changelog

## Unreleased

- Core: records, validation, traversal, MRCA, tri-state monophyly, snapshot checksums.
- Import: Newick reader and writer.
- Core: curated selections (`applySelection`: explicit, all descendants, depth, rank, representative and named-predicate policies; exclusions; ancestor closure; omitted branches), `getCoverageReport` (dataset / hypothesis / caller-stated known-to-science), `extractSubset` with `derivedFrom` provenance, `diffSnapshots` and `referenceImpact`, JSON Schema for snapshots.
- Core: views (`TaxonomicView`, `ViewAction`, `applyViewAction`, `dispatch`/`undo`/`redo`, `serializeView`/`parseView`, `validateView`), `projectView` with focus, collapse, hide, display order, filters (status incl. unknown, rank, source) and disclosed hidden counts, `makeHighlight` (clade only with support).
- React (new package): `TreeView` (server-renderable SVG), `TreeOutline` (WAI-ARIA tree, Alt+arrows to reorder), `Explorer` (undo/redo, layouts, status filter, inspector), `useTaxonomyView`, `Legend`; playground app.
- Layout (new package): rectangular cladogram, phylogram and time scale only when valid, radial, classification sunburst.
- Core (M5): `TraitSet` in snapshots (observed states from one cited source; validated, kept by `extractSubset`, in the JSON Schema); view `overlays` (support with a weak threshold, extinct taxa and fossil ages, color by trait) via the `setOverlays` action; `inspectNode` (names, authorship, synonyms, common names, profile, ages, support, traits, references, citations), `nodeOverlays`, `viewCitations`, `describeView` (the disclosure every export carries).
- React (M5): inspector shows profiles, traits and sources; overlay controls and legend; Download menu: SVG and PNG (with the disclosure written under the drawing) and the view file (JSON); printing adds the disclosure; "About this diagram" panel. New icons: check, dagger, image, file, book.
- Import: `SourceAdapter` interface and `toSnapshot`; CSV/TSV checklists with configurable columns; Darwin Core Archives (ZIP, `meta.xml`, Taxon core, Vernacular Names); OneTaxonomy JSON reader with checksum check; `reconcile`; `selectiveImport`; community presets (`validatePreset`, `checkPresetReferences`).
