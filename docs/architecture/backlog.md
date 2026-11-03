# Backlog

Task-level plan per milestone ([`phase-plan.md`](phase-plan.md)). `[x]` done with tests, `[ ]` to do. Integration dependencies on the project owner are marked **(owner)**.

## M1 — Monorepo, contracts, ADRs ✅

- [x] pnpm workspace, strict TypeScript, Vitest, tsup builds, CI (build, typecheck, test)
- [x] Architecture, scientific invariants, data schema, phase plan, backlog, limitations
- [x] ADRs 0001–0008
- [x] Illustrative fixtures: classification forest + conflicting hypotheses (amniotes); polytomy, forest, unrooted, fossil/time-calibrated, split names (structures)
- [x] Release workflow (tag → staged npm publish → owner approval), lockstep versions
- [x] GitHub repository `mgilardi/onetaxonomy` (public); npm names `@captiveorigins/onetaxonomy-*` (ADR 0008)

## M2 — Core model, parser, validation, traversal ✅

- [x] Record types (`model.ts`), schema version 1
- [x] Tree/phylogeny indexes; bounded, iterative traversal (children, parent, ancestors, lineage, descendants, tips)
- [x] `findMRCA`, `isMonophyletic` (tri-state, soft/hard polytomies, sampling caveats), `getCladeMembers`, `assessTaxon` (classification taxon vs hypothesis, unmapped members)
- [x] `validateDataset` diagnostics: duplicates, dangling refs, missing sources, cycles, multiple parents, self-edges, units, time calibration
- [x] Snapshot sealing: canonical JSON, pure SHA-256 checksum, deep freeze, verification
- [x] Name lookup with ambiguity (`findByName`)
- [x] Newick reader/writer (`@captiveorigins/onetaxonomy-import`): quoting, comments, support, rooting stated explicitly, explicit concept mapping
- [x] Runnable example (`examples/`)
- [ ] JSON Schema export of the record types (for non-TypeScript consumers) → M3

## M3 — Import, curation, snapshots (next)

- [ ] `SourceAdapter` interface: `describe()`, `read()` → normalized records + raw ids + license + warnings
- [ ] Structured JSON (the schema itself) and CSV (configurable column mapping) adapters
- [ ] Darwin Core Archive (Taxon core: `taxonID`, `parentNameUsageID`, `acceptedNameUsageID`, `taxonomicStatus`, `taxonRank`, `scientificName`, `scientificNameAuthorship`, vernacular extension)
- [ ] Name/concept linking and identifier reconciliation across sources (report, never merge silently; synonyms, homonyms, splits/lumps)
- [ ] `CuratedSelection`: roots with policies (`explicit`, `allAvailableDescendants`, `depth`, `rank`, `representative`, predicate), exclusions, ancestor closure, rationale
- [ ] Selective import: chosen roots + ancestor paths, nothing from unselected branches; preview of added/omitted; batch of several clades
- [ ] `getCoverageReport` (in dataset / in hypothesis / known-to-science distinction)
- [ ] Snapshot diff and migration report (renamed, split, merged, relocated); existing views untouched
- [ ] Community preset file format (references + policies + style, no shadow data)
- [ ] Acceptance demo: three nonadjacent taxa → only those + ancestors, omitted coverage shown
- [ ] **(owner)** Supply the actual source files/schemas to integrate (taxonomy releases, phylogenies); adapters stay configurable until then

## M4 — Views, layout, React viewer

- [ ] `TaxonomicView` + `ViewAction` reducer (`applyViewAction`), undo/redo, `serializeView`, `validateView`, `projectView`
- [ ] Filters (status incl. unknown, rank, geography, traits, period, source, custom) that disclose hidden counts
- [ ] Highlights: `group` vs validated `clade` (I3)
- [ ] `@captiveorigins/onetaxonomy-layout`: rectangular cladogram, radial, phylogram/time-scaled only when valid, classification sunburst (labelled as classification)
- [ ] `@captiveorigins/onetaxonomy-react`: provider, tree viewer (Canvas/SVG with level of detail), inspector, clade selector, view controls; keyboard and screen-reader navigation; reduced motion
- [ ] `apps/playground`
- [ ] Acceptance: drag/collapse/filter/rotate with undo/redo; snapshot checksum unchanged

## M5 — Profiles, overlays, exports, education

- [ ] Profiles and evidence in the inspector; support, fossil, extinction and trait overlays; citations
- [ ] Export SVG/PNG/PDF (labelled classification vs phylogeny, hidden branches disclosed), JSON view, embeds
- [ ] `@captiveorigins/onetaxonomy-education`: scenes, annotations, camera states, reveal animations, lesson decks, worksheets; Explore vs Studio modes

## M6 — Studio (macOS)

- [ ] Tauri 2 app, SQLite persistence, native dialogs, backups, migrations
- [ ] `.onetaxonomy` bundle (ZIP container, manifest, checksums, pinned snapshot refs, media, optional embedded dataset); damaged-file diagnostics
- [ ] Offline end-to-end journey; upgrade/relink flow when sources change

## M7 — Payload plugin

- [ ] `@captiveorigins/payload-plugin-onetaxonomy` with configurable slugs, locale, permissions, optional tenant scope, source adapters
- [ ] Admin views: import progress, conflicts, curation preview, tree authoring, profiles, publishing, lessons
- [ ] Bounded API: search, ancestors/descendants, MRCA, coverage, projected views, exports; access checks; cross-tenant denial tests
- [ ] Resumable, idempotent import jobs
- [ ] `apps/payload-example`

## M8 — Science and performance polish

- [ ] Phylogeny comparison (`comparePhylogenies`), explicit rooting tools, support-threshold collapsing
- [ ] Deep-time rendering where calibrated; trait overlays; documented discrete-character parsimony (labelled *inferred*)
- [ ] Nexus and phyloXML adapters
- [ ] Benchmarks: 10k+ taxa datasets, 1–2k visible nodes; documented devices/browsers
- [ ] Accessibility audit

## Phase 2 (not started by design)

- [ ] `@captiveorigins/onetaxonomy-live` protocol and client; `services/live-server`; session codes; challenges evaluated by core
