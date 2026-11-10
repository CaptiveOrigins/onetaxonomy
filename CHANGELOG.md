# Changelog

## Unreleased

## 0.1.0-alpha.3

- Import: a Darwin Core Archive entry that is cut short, or doesn't unpack to its stated size, is now refused with an error naming the file, instead of being read in part.
- First test audit (`docs/test-audit.md`), with tests for the studio's atomic save.

## Mac app 0.1.0

- First release of OneTaxonomy for Mac.
- The Mac app can't update itself yet. Releases have no signing key, so download the new DMG instead. Signed updates can come in a later release.
- Documentation: names the OneOrigin suite.
- The repository moved to github.com/CaptiveOrigins, including the address the Mac app checks for updates.

## 0.1.0-alpha.2

- Proposed mode: drag a taxon onto a new parent (or choose one from a list) to model your own arrangement. Moves are reversible, carry the author's name, travel with the view file, and can be compared side by side with the accepted tree. The accepted data never changes.
- Core: `Proposal`, `applyToClassification`, `applyToPhylogeny`, `compareHierarchies`, and the view actions `startProposal`, `proposeMove`, `revertMove`, `endProposal`.

## 0.1.0-alpha.1

- License: PolyForm Noncommercial 1.0.0. Earlier versions remain under MIT.
- Core and Import: optional paired support values (`additionalSupport`, `supportMethods`).

- Core: records, validation, traversal, MRCA, tri-state monophyly, snapshot checksums.
- Import: Newick reader and writer.
- Core: curated selections (`applySelection`: explicit, all descendants, depth, rank, representative and named-predicate policies; exclusions; ancestor closure; omitted branches), `getCoverageReport` (dataset / hypothesis / caller-stated known-to-science), `extractSubset` with `derivedFrom` provenance, `diffSnapshots` and `referenceImpact`, JSON Schema for snapshots.
- Core: views (`TaxonomicView`, `ViewAction`, `applyViewAction`, `dispatch`/`undo`/`redo`, `serializeView`/`parseView`, `validateView`), `projectView` with focus, collapse, hide, display order, filters (status incl. unknown, rank, source) and disclosed hidden counts, `makeHighlight` (clade only with support).
- React (new package): `TreeView` (server-renderable SVG), `TreeOutline` (WAI-ARIA tree, Alt+arrows to reorder), `Explorer` (undo/redo, layouts, status filter, inspector), `useTaxonomyView`, `Legend`; playground app.
- Layout (new package): rectangular cladogram, phylogram and time scale only when valid, radial, classification sunburst.
- Core (M5): `TraitSet` in snapshots (observed states from one cited source; validated, kept by `extractSubset`, in the JSON Schema); view `overlays` (support with a weak threshold, extinct taxa and fossil ages, color by trait) via the `setOverlays` action; `inspectNode` (names, authorship, synonyms, common names, profile, ages, support, traits, references, citations), `nodeOverlays`, `viewCitations`, `describeView` (the disclosure every export carries).
- Education (new package, M5): lesson decks (scenes with views, cameras, annotations and reveal steps; worksheets), `sceneAt`, `validateLesson`, `answerQuestion`/`checkResponse` computed by the core (is-clade, MRCA, missing taxa), `worksheetMarkdown` with an answer key, serialize/parse. React: `LessonPlayer` (present, explore, studio), `cameraBox`, numbered annotation badges on `TreeView`; chevron icons.
- Core: `describeAssessment` (a monophyly result in words, with names). React: clade selector (Shift/Ctrl/⌘-click several taxa, see whether they form a clade and why, keep them as a clade or a group; one classification taxon checks against a chosen phylogeny), removable highlights.
- React (M5): inspector shows profiles, traits and sources; overlay controls and legend; Download menu: SVG and PNG (with the disclosure written under the drawing) and the view file (JSON); printing adds the disclosure; "About this diagram" panel. New icons: check, dagger, image, file, book.
- Import: `SourceAdapter` interface and `toSnapshot`; CSV/TSV checklists with configurable columns; Darwin Core Archives (ZIP, `meta.xml`, Taxon core, Vernacular Names); OneTaxonomy JSON reader with checksum check; `reconcile`; `selectiveImport`; community presets (`validatePreset`, `checkPresetReferences`).
