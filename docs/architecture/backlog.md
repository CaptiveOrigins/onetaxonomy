# Backlog

Since 2026-11-10 the open items below are tracked as tasks in the maintainers' task log (K235 to K241). This page stays as the record of what each milestone covers; the task log is where open work is ranked.

Task-level plan per milestone ([`phase-plan.md`](phase-plan.md)). `[x]` done with tests, `[ ]` to do. Integration dependencies on the project owner are marked **(owner)**.

## M1 — Monorepo, contracts, ADRs ✅

- [x] pnpm workspace, strict TypeScript, Vitest, tsup builds, CI (build, typecheck, test)
- [x] Architecture, scientific invariants, data schema, phase plan, backlog, limitations
- [x] ADRs 0001–0008
- [x] Illustrative fixtures: classification forest + conflicting hypotheses (amniotes); polytomy, forest, unrooted, fossil/time-calibrated, split names (structures)
- [x] Release workflow (tag → staged npm publish → owner approval), lockstep versions
- [x] GitHub repository `CaptiveOrigins/onetaxonomy` (public); npm names `@captiveorigins/onetaxonomy-*` (ADR 0008)

## M2 — Core model, parser, validation, traversal ✅

- [x] Record types (`model.ts`), schema version 1
- [x] Tree/phylogeny indexes; bounded, iterative traversal (children, parent, ancestors, lineage, descendants, tips)
- [x] `findMRCA`, `isMonophyletic` (tri-state, soft/hard polytomies, sampling caveats), `getCladeMembers`, `assessTaxon` (classification taxon vs hypothesis, unmapped members)
- [x] `validateDataset` diagnostics: duplicates, dangling refs, missing sources, cycles, multiple parents, self-edges, units, time calibration
- [x] Snapshot sealing: canonical JSON, pure SHA-256 checksum, deep freeze, verification
- [x] Name lookup with ambiguity (`findByName`)
- [x] Newick reader/writer (`@captiveorigins/onetaxonomy-import`): quoting, comments, support, rooting stated explicitly, explicit concept mapping
- [x] Runnable example (`examples/`)
- [x] JSON Schema export of the record types (M3: `packages/core/schema/snapshot.schema.json`)

## M3 — Import, curation, snapshots ✅

- [x] `SourceAdapter` interface: `describe()`, `read()` → normalized records + raw ids + license + warnings
- [x] Structured JSON (the schema itself) and CSV (configurable column mapping) adapters
- [x] Darwin Core Archive (Taxon core: `taxonID`, `parentNameUsageID`, `acceptedNameUsageID`, `taxonomicStatus`, `taxonRank`, `scientificName`, `scientificNameAuthorship`, vernacular extension)
- [x] Name/concept linking and identifier reconciliation across sources (report, never merge silently; synonyms, homonyms, splits/lumps)
- [x] `CuratedSelection`: roots with policies (`explicit`, `allAvailableDescendants`, `depth`, `rank`, `representative`, predicate), exclusions, ancestor closure, rationale
- [x] Selective import: chosen roots + ancestor paths, nothing from unselected branches; preview of added/omitted; batch of several clades
- [x] `getCoverageReport` (in dataset / in hypothesis / known-to-science distinction)
- [x] Snapshot diff and migration report (renamed, split, merged, relocated); existing views untouched
- [x] Community preset file format (references + policies + style, no shadow data)
- [x] Acceptance demo: three nonadjacent taxa → only those + ancestors, omitted coverage shown
- [ ] **(owner)** Supply the actual source files/schemas to integrate (taxonomy releases, phylogenies); adapters stay configurable until then

## M4 — Views, layout, React viewer ✅

- [x] `TaxonomicView` + `ViewAction` reducer (`applyViewAction`), undo/redo, `serializeView`, `validateView`, `projectView`
- [x] Filters (status incl. unknown, rank, geography, traits, period, source, custom) that disclose hidden counts
- [x] Highlights: `group` vs validated `clade` (I3)
- [x] `@captiveorigins/onetaxonomy-layout`: rectangular cladogram, radial, phylogram/time-scaled only when valid, classification sunburst (labelled as classification)
- [x] `@captiveorigins/onetaxonomy-react`: SVG tree viewer, explorer state hook, inspector, view controls; keyboard and screen-reader navigation; reduced motion
- [x] Clade selector UI (pick members, see the assessment) (M5, 2026-11-02); Canvas rendering with level of detail for very large trees → M8
- [x] `apps/playground`
- [x] Acceptance (core): drag/collapse/filter/rotate with undo/redo; snapshot checksum unchanged (`view.test.ts`) and through the explorer (`react.test.tsx`)

## M5 — Profiles, overlays, exports, education (done 2026-11-03)

- [x] Profiles and evidence in the inspector; support, fossil, extinction and trait overlays (observed traits: `TraitSet`); citations
- [x] Export SVG/PNG/PDF (labelled classification vs phylogeny, hidden branches disclosed), JSON view, embeds (PDF via print; embeds = server-rendered `TreeView`)
- [x] `@captiveorigins/onetaxonomy-education`: scenes, annotations, camera states, reveals (step-by-step view actions; animated transitions are the renderer's), lesson decks, worksheets with computed answers; Present, Explore and Studio modes (`LessonPlayer`)

## Proposed mode (owner 2026-11-03; done 2026-11-05)

- [x] Core: proposals, derived hierarchies, checks, `compareHierarchies`, view actions, disclosure in every export
- [x] Explorer: start a proposal, drag onto a new parent or pick from a list, revert and undo, accepted vs proposed for a taxon, side-by-side compare
- [ ] Plugin (M7): proposals per user, shareable; a curator can accept one into a new staged version, never silently (not started; staged snapshot versions, which acceptance will create, exist since part 1, 2026-11-11)

## M6 — Studio (macOS)

- [x] Tauri 2 app, native dialogs, atomic saves, Settings, updater, and opening every importer's format (`apps/studio`)
- [x] ~~SQLite persistence, backups, migrations~~ Not needed now (2026-11-11, [ADR 0011](adr/0011-bundle-not-sqlite.md), proposed): plain files and the bundle cover persistence, safe saves, format versions and backups; the ADR says what would bring SQLite back (as a cache beside the files)
- [x] `.onetaxonomy` bundle (ZIP container, manifest, checksums, pinned snapshot refs, media, optional embedded dataset); damaged-file diagnostics (2026-11-11, [bundle-format.md](bundle-format.md)). The Mac app carries lessons and media through but doesn't show or add them yet
- [ ] Offline end-to-end journey; upgrade/relink flow when sources change. Relink is done (2026-11-11): a bundle pinned to another version of the open dataset asks to keep the pinned one or relink, never silently. The app needs no network to open, browse or save; a full offline journey in the built app hasn't been walked through

## M7 — Payload plugin

- [ ] `@captiveorigins/payload-plugin-onetaxonomy` with configurable slugs, locale, permissions, optional tenant scope, source adapters (part 1, 2026-11-11, [ADR 0012](adr/0012-payload-plugin.md): slugs, locale for common-name search, read and manage callbacks that fail closed, tenant scope, sealed snapshots and pinned views with staged/published/withdrawn states; source adapters wait for import jobs)
- [ ] Admin views: import progress, conflicts, curation preview, tree authoring, profiles, publishing, lessons (not started; part 1 uses Payload's default edit views)
- [ ] Bounded API: search, ancestors/descendants, MRCA, coverage, projected views, exports; access checks; cross-tenant denial tests (part 1, 2026-11-11: search, ancestors, descendants and MRCA with access checks, limits, 404 for anything unreadable and cross-tenant denial tests; coverage, projected views and exports to come)
- [ ] Resumable, idempotent import jobs (not started; the snapshot collection already refuses the same id and version twice)
- [ ] `apps/payload-example` (not started)

## M8 — Science and performance polish

- [x] Phylogeny comparison (`comparePhylogenies`), explicit rooting tools (`rerootPhylogeny`, `midpointRoot`), support-threshold collapsing (`collapseBelowSupport` view action) (2026-11-11; core only, no explorer or Mac app controls yet)
- [ ] Deep-time rendering where calibrated; trait overlays; documented discrete-character parsimony (labelled *inferred*)
- [x] Nexus and phyloXML adapters (2026-11-11; the Mac app doesn't open them yet)
- [ ] Canvas renderer with level of detail (1–2k visible nodes smoothly). Built 2026-11-11: `TreeView` switches to a canvas above 1,000 drawn nodes, with level of detail, disclosure and hit-testing; planning one frame takes under 11 ms in Node at 50,000 tips (`docs/benchmarks.md`). Not ticked: paint time and smoothness haven't been measured in a browser.
- [ ] Benchmarks: 10k+ taxa datasets, 1–2k visible nodes; documented devices/browsers. Started 2026-11-11: `scripts/bench-canvas.mjs` times projection, layout and the canvas plan on 1k, 10k and 50k made-up tips in Node and writes `docs/benchmarks.md` with the machine. Not ticked: no browser has been measured.
- [x] Accessibility audit (code-level, WCAG 2.2 AA, 2026-11-11: `docs/test-audit.md`; small fixes made, gaps listed there; no screen reader or real browser run yet)

## Phase 2 (not started by design)

- [ ] `@captiveorigins/onetaxonomy-live` protocol and client; `services/live-server`; session codes; challenges evaluated by core
