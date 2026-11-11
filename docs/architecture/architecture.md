# OneTaxonomy architecture

OneTaxonomy imports, curates, browses, rearranges the *presentation* of, and publishes scientifically faithful taxonomic classifications and phylogenetic trees. It is independent of any application: Captive Origins is its first consumer, but nothing here knows about Captive Origins, reptiles, Payload, Next.js or MongoDB.

The authoritative specification is the *OneTaxonomy — Architecture & Implementation Specification* (v1.0, November 2026). This document records how the repository implements it. Decisions with alternatives are in [`adr/`](adr/), the rules every component must keep are in [`scientific-invariants.md`](scientific-invariants.md), and the record formats are in [`data-schema.md`](data-schema.md).

## Layers

```text
            ┌──────────────┐   ┌──────────────┐   ┌───────────────┐
 apps       │ studio (Mac) │   │  playground  │   │ payload-example│
            └──────┬───────┘   └──────┬───────┘   └───────┬───────┘
                   │                  │                   │
 adapters   ┌──────┴──────┐    ┌──────┴──────┐     ┌──────┴──────┐
            │  education  │    │    react    │     │   payload   │  (optional)
            └──────┬──────┘    └──────┬──────┘     └──────┬──────┘
                   │           ┌──────┴──────┐            │
                   │           │   layout    │            │
                   │           └──────┬──────┘            │
            ┌──────┴──────────────────┴───────────────────┴──────┐
 domain     │   import (formats, adapters, reconcile, snapshots)  │
            ├─────────────────────────────────────────────────────┤
            │   core (model, validation, traversal, monophyly,     │
            │         coverage, projection, view actions)          │
            └─────────────────────────────────────────────────────┘
 Phase 2    live (protocol, client)  ·  services/live-server
```

Dependencies only point downward. `core` has no runtime dependencies and compiles without DOM or Node types (`lib: ES2023`, `types: []`), so it runs in browsers, Node, workers and Tauri webviews alike.

| Package | Status | Depends on | Must never depend on |
| --- | --- | --- | --- |
| `core` | Milestone 2 | — | React, Payload, databases, Node-only APIs, Tauri, network |
| `import` | Milestone 2–3 | core | Payload, databases |
| `layout` | Milestone 4 | core | rendering, storage |
| `react` | Milestone 4 | core, layout | Payload, Next.js, network |
| `education` | Milestone 5 | core | live networking |
| `payload` | Milestone 7 | core, import, react | — (optional plugin) |
| `apps/studio` | Milestone 6 | core, import, layout, react, education | Payload, a hosted account |
| `live`, `services/live-server` | Phase 2 | core | — (never required for offline use) |

Packages that don't exist yet are listed in [`backlog.md`](backlog.md); there is no empty scaffolding.

## Data flow

Import pipeline (`import`): **read → parse → normalize → link names/concepts → reconcile identifiers → validate → immutable snapshot → indexes → curation/view projections.**

- A `DatasetSnapshot` is immutable once created and identified by `id` + `version` + `checksum`. Refreshing a source creates a new snapshot plus an explicit diff; existing views keep pointing at the snapshot they were saved with.
- Classifications and phylogenies live side by side in a snapshot as different record types. Algorithms that make evolutionary claims (MRCA, monophyly, clade membership) accept only *rooted phylogenies*; classification hierarchies can be traversed but never certify a clade ([ADR 0003](adr/0003-classification-vs-phylogeny.md)).
- A `TaxonomicView` is a serializable, versioned *projection* over a pinned snapshot: focus, filters, collapsed nodes, highlights, layout, manual positions, annotations. Views change only through `ViewAction`s applied by a pure reducer, which also gives undo/redo and is the event format Phase 2 broadcasts ([ADR 0006](adr/0006-view-actions.md)).

## Persistence and transport are adapters

`core` defines records and pure functions over in-memory indexes. Where records are stored — plain JSON files and a `.onetaxonomy` bundle in Studio (no SQLite for now: [ADR 0011](adr/0011-bundle-not-sqlite.md); format in [bundle-format.md](bundle-format.md)), Payload collections or storage records in a CMS, static JSON in a website — is decided by the adapter packages. Large topologies are stored as whole snapshot records, not as millions of CMS documents.

## Source ownership

The project owner supplies the taxonomic and phylogenetic sources. OneTaxonomy provides source-agnostic formats (JSON, CSV, Darwin Core Archive, Newick; Nexus/phyloXML where feasible) and a `SourceAdapter` interface; it never selects, substitutes or bundles an authoritative dataset ([ADR 0005](adr/0005-source-ownership.md)). Fixtures in `fixtures/` are small and illustrative, marked as such, and not for scientific use.

## Phase boundary

Phase 1 is everything non-live (spec §1–10). Phase 2 (OneTaxonomy Live, session codes, instructor challenges) is a separate optional package and service. Phase 1 prepares for it with serializable view state and actions, and with challenge-ready evaluation functions in `core` (e.g. `findMRCA`, `isMonophyletic`, `getCladeMembers`) that return explanations rather than booleans.
