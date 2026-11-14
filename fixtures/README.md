# Fixtures

Small, **illustrative** datasets for tests, examples and documentation. Every fixture source is marked `illustrative: true` and must not be cited as science. OneTaxonomy never ships an authoritative dataset; real data comes from the sources a project owner supplies (see `docs/architecture/adr/0005-source-ownership.md`).

| File | Shows |
| --- | --- |
| `amniotes.json` | A traditional classification (Reptilia and Aves as separate classes, a forest) beside two **conflicting** rooted hypotheses: turtles with archosaurs (Archelosauria), and turtles outside Sauria. Traditional Reptilia is not a clade in either: the MRCA of its orders includes birds. |
| `structures.json` | A root **polytomy**, a **forest**, an **unrooted** quartet with substitution lengths, a **time-calibrated** tree with an **extinct** lineage and an *unknown* status, and a **split** (one name string, two concepts). |
| `checklist.csv` → `checklist.json` | A parent-pointer checklist in Darwin Core columns with **invented names** (Exemplaria, Alphus …): synonyms, a heterotypic synonym, a provisional species, common names in two languages. Used for adapters, curation, coverage and the selective-import demo. |
| `checklist-v2.csv` → `checklist-v2.json` | "Release 2" of the same checklist: a rename, two relocations, a rank change, a split candidate (misapplied name) and a lump (removed species now a synonym). Used by `diffSnapshots`. |

Regenerate the JSON from the CSV files with `pnpm build && pnpm --filter @extantape/onetaxonomy-examples fixtures`; the CSV adapter test checks that the committed JSON still matches.
