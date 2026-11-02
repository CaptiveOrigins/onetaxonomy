# Limitations and risks

Kept current with each milestone. Nothing listed here is claimed as done.

## Current (after M2)

- Only Newick is implemented as an input format. JSON (the schema itself) works by constructing records directly; CSV, Darwin Core Archive, Nexus and phyloXML are in M3/M8.
- No curation, coverage report, views, layout or UI yet (M3–M5). `getCoverageReport`, `projectView`, `applyViewAction`, `validateView`, `serializeView` and `comparePhylogenies` from the specification's API are not implemented.
- `assessTaxon` maps members to terminals only through explicit `concepts` on phylogeny nodes. Importers must create those mappings; until then, real trees report members as unmapped (by design, I7).
- Support values are stored but not yet used: there is no "collapse branches under X% support" option (M8).
- Index building is in memory. Large-tree benchmarks (10k+ taxa) are planned for M8; traversal is iterative and tested on a 20,000-deep chain.
- Fixtures are illustrative. They mirror widely discussed relationships (turtles with archosaurs) but are not sources and must not be cited.
- Packages are not published; the npm scope is pending (ADR 0008).
