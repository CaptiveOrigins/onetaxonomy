# 0003 — Classifications and phylogenies are different record types

**Context.** Taxonomic parentage and nomenclature do not demonstrate monophyly (spec §1.2). Treating a classification tree as a phylogeny is the most common way taxonomy software overstates evidence (e.g. calling traditional Reptilia a clade).

**Decision.** `Classification` (placements under an authority) and `Phylogeny` (a cited, versioned hypothesis with rooting, units, sampling) are separate types with separate indexes (`ClassificationIndex`, `PhylogenyIndex`). Evolutionary operations (`findMRCA`, `isMonophyletic`, `getCladeMembers`) accept only a `PhylogenyIndex`. `assessTaxon` evaluates a classification taxon against a phylogeny through explicit concept mappings, and returns `indeterminate / classification-only` without one.

**Consequences.** The type system prevents accidental clade claims from classification data. Views (M4) must label classification views and phylogeny views differently.
