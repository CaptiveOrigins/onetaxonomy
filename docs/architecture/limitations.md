# Limitations and risks

Kept current with each milestone. Nothing listed here is claimed as done.

## Current (after M3)

- Input formats: Newick, OneTaxonomy JSON, delimited checklists (CSV/TSV) and Darwin Core Archives (Taxon core + Vernacular Names; other extensions are reported and skipped). Nexus and phyloXML are M8.
- Darwin Core Archives: no ZIP64, no encryption, CRCs not checked; `meta.xml` is read with a small purpose-built parser (core/extension, files, id/coreid, fields with index or default), not a general XML parser. Very large archives are read into memory.
- Reconciliation links concepts only by shared identifiers and lists same-name candidates; there is no fuzzy matching, authorship parsing or concept-relationship (RCC-5) model yet. Curators link concepts by hand.
- Split/lump detection in `diffSnapshots` is a heuristic over name usage (candidates only) and relies on adapters producing stable ids from the source's own identifiers.
- Coverage counts what a dataset and a hypothesis hold; numbers known to science come only from the caller with a cited source.
- Views, layouts and the React explorer exist (M4); the viewer draws SVG only, so very large visible trees (thousands of nodes) will be slow until the Canvas renderer (M8). Pan/zoom, drag-and-drop with a pointer and a clade selector UI are not built yet (reordering works with Alt+arrows and flip). `comparePhylogenies` is M8.
- The JSON Schema (`schema/snapshot.schema.json`) checks structure only; referential integrity and scientific checks stay in `validateDataset`.
- `assessTaxon` maps members to terminals only through explicit `concepts` on phylogeny nodes. Importers must create those mappings; until then, real trees report members as unmapped (by design, I7).
- Support values are stored but not yet used: there is no "collapse branches under X% support" option (M8).
- Index building is in memory. Large-tree benchmarks (10k+ taxa) are planned for M8; traversal is iterative and tested on a 20,000-deep chain.
- Fixtures are illustrative. They mirror widely discussed relationships (turtles with archosaurs) but are not sources and must not be cited.
- Packages are not published yet; names are `@captiveorigins/onetaxonomy-*` (ADR 0008).
