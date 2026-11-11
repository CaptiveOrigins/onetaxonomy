# Phase plan

Work proceeds in **vertical slices**: each milestone ships runnable code, tests, documentation and fixtures, and is only marked done when its acceptance checks pass. Status here is kept current; the task-level list is in [`backlog.md`](backlog.md).

| # | Phase | Deliverable | Acceptance (from the specification) | Status |
| --- | --- | --- | --- | --- |
| 1 | 1 | Monorepo, contracts, fixture sources, ADRs | Tests run; architecture and source-ownership constraints documented | **Done** (2026-11-02) |
| 2 | 1 | Pure core model, hierarchy/phylogeny parser, validation, traversals | Conflicting trees, forest, polytomy, unrooted tree and fossil examples behave correctly | **Done** (2026-11-02): core + Newick; JSON schema export and Nexus/phyloXML move to M3/M8 |
| 3 | 1 | Import adapters, curation, snapshot management | Select three nonadjacent taxa, import only those plus ancestor paths; show omitted-branch coverage | **Done** (2026-11-02): `examples/selective-import.mjs` |
| 4 | 1 | Serializable views, React viewer, layouts, interactions | Drag/collapse/filter/rotate with undo/redo; underlying graph checksum unchanged | **Done** (2026-11-02): core views, layouts, React explorer, `apps/playground`. Canvas level-of-detail rendering for very large trees moves to M8 |
| 5 | 1 | Profiles, overlays, exports, lessons/presets | Accurate diagrams and a portable view; reopening reproduces the same scientific references | **Done** (2026-11-03): inspector, overlays, exports with disclosures, clade selector, education package and lesson player |
| 6 | 1 | Studio for macOS, end to end | Import → curate → explore → save → close → reopen → export, all offline | Next |
| 7 | 1 | Payload plugin and example app | Install via plugin, curate in admin, React viewer on a public page, tenant isolation verified | Started (2026-11-11): part 1, snapshots, views and the first read API ([ADR 0012](adr/0012-payload-plugin.md)) |
| 8 | 1 | Science and performance polish | Alternative hypotheses, dating where valid, trait method, accessibility, large-tree benchmarks | Planned |
| 9 | 2 | OneTaxonomy Live and instructor challenges | One instructor and several students join by code; private view actions; server-evaluated tasks; expiry | Phase 2 — not started by design |

## Phase 2 boundary

Nothing in Phase 1 depends on networking, accounts or a hosted service. Phase 1 still prepares for Phase 2:

- **View state and actions are serializable and pure** (M4): a classroom only needs to sync `ViewAction`s and scene ids over a pinned snapshot, never whole trees.
- **Evaluation lives in `core`** and returns explanations (`MonophylyResult`, `MrcaResult`), so challenge checks (identify the MRCA, choose the smallest clade, find omitted descendants) reuse it instead of judging pixel positions.
- **Lessons and scenes** (M5) are portable files that a live session can reference by id.

## Downstream: Captive Origins

Captive Origins' curated phylogenetic taxonomy (its own brief, 2026-11-02) depends on M3 (curated selections, coverage, staged import manifests), M4 (views, discovery categories rendered as non-clade groups) and M7 (Payload plugin). That integration lives in the Captive Origins repository and only consumes OneTaxonomy packages.
