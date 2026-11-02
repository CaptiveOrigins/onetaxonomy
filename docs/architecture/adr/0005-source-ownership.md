# 0005 — Sources belong to the project owner; OneTaxonomy ships adapters, not data

**Context.** The owner already holds the taxonomic and phylogenetic sources and decides which are authoritative. Source licences differ and some forbid bulk redistribution.

**Decision.** OneTaxonomy implements source-agnostic formats (Newick now; JSON, CSV, Darwin Core Archive in M3; Nexus/phyloXML in M8) and a `SourceAdapter` interface. It does not select, substitute, bundle or fetch an authoritative dataset. Fixtures are small, invented or illustrative, and marked `illustrative: true` so validation flags them. Provenance (source, external id, retrieval date, licence) travels with every imported record, and licences are respected separately from the software licence.

**Consequences.** Real-source integration is an explicit dependency on the owner supplying files or schemas; core work is not blocked by it.
