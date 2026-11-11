# OneTaxonomy

A source-available framework for importing, curating, browsing and publishing **scientifically faithful** taxonomic classifications and phylogenetic trees: for developers, and for teachers, museums, researchers and animal keepers who don't write code.

Part of the [OneOrigin suite](https://github.com/CaptiveOrigins/onephylogeny/blob/main/docs/oneorigin/README.md): independent tools, with no subscriptions, that work alone or together.

> **Status: early (Phase 1, milestone 4 of 8).** The pure TypeScript core, the importers (Newick, NEXUS, phyloXML, CSV/TSV checklists, Darwin Core Archives, OneTaxonomy JSON) and curated selective imports with coverage reports, views with undo/redo, layouts and the React explorer work and are tested (see `apps/playground`). A first Mac app (`apps/studio`) opens these files and saves views. Profiles and the Studio's project files are planned, and the Payload plugin has its first part (snapshots, views and a small read API, tested on an in-memory database); see [the phase plan](docs/architecture/phase-plan.md). Packages: `@captiveorigins/onetaxonomy-core` and `@captiveorigins/onetaxonomy-import` (not on npm yet).

## Principles

- **Science and display are separate.** Data lives in immutable, checksummed snapshots; views only project it.
- **A classification is not a phylogeny.** Ranks and names are never treated as evidence of common ancestry.
- **Only supported clades are called clades.** Monophyly is `monophyletic`, `not-monophyletic` or `indeterminate`, always relative to a named hypothesis, with reasons and caveats.
- **Missing stays missing.** Unmapped taxa, unresolved polytomies, unrooted trees, partial sampling and unknown status are reported, never guessed.
- **Your sources, your choice.** OneTaxonomy ships adapters, not authoritative data.

The full rules are in [scientific invariants](docs/architecture/scientific-invariants.md).

## Packages

| Package | What it does | Status |
| --- | --- | --- |
| [`@captiveorigins/onetaxonomy-core`](packages/core) | Records, validation, bounded traversal, MRCA, tri-state monophyly, curated selections, coverage reports, snapshot checksums and diffs, views (actions, undo/redo, filters, highlights, projection), JSON Schema. No dependencies; runs anywhere. | Working |
| [`@captiveorigins/onetaxonomy-import`](packages/import) | Source adapters (CSV/TSV, Darwin Core Archive, JSON, Newick, NEXUS, phyloXML), reconciliation, selective imports, community presets | Working |
| [`@captiveorigins/onetaxonomy-layout`](packages/layout) | Rectangular, phylogram/time (only when valid), radial and sunburst layouts as plain coordinates | Working |
| [`@captiveorigins/onetaxonomy-react`](packages/react) | Server-renderable SVG tree, accessible keyboard outline, explorer (undo/redo, drag, overlays, inspector, clade selector, SVG/PNG/JSON exports), lesson player | Working |
| [`@captiveorigins/onetaxonomy-education`](packages/education) | Lesson decks (scenes, cameras, annotations, reveals) and worksheets with answers computed from the data | Working |
| [`@captiveorigins/payload-plugin-onetaxonomy`](packages/payload) | Payload plugin: sealed snapshots checked by checksum, staged and published, views pinned to them, and a bounded read API (name search, ancestors, descendants, MRCA) behind the host's access rules, with optional tenant scope | Early (M7 part 1): tested on Payload with an in-memory MongoDB, not yet in a real site. Not on npm |
| [`apps/studio`](apps/studio) | OneTaxonomy for Mac (Tauri 2): open checklists, Darwin Core Archives, Newick, NEXUS and phyloXML trees and snapshots; browse them; collapse weak branches, add a tree to an open checklist and link its tips to taxa (proposed by exact name, confirmed by you), compare two trees, and reroot or midpoint-root as a new tree; save views and sealed snapshots (never over the file that was opened) | 0.1.0 on GitHub Releases. Not notarized, and it can't update itself yet |

## Try it

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @captiveorigins/onetaxonomy-examples start
```

```js
import { assessTaxon, indexDataset } from '@captiveorigins/onetaxonomy-core'

const data = indexDataset(snapshot)
const result = assessTaxon(data.classification('traditional'), 'c:reptilia', data.phylogeny('archelosauria'))
// { status: 'not-monophyletic', reason: 'missing-descendants', missing: ['t-aves'], hypothesis: { id: 'archelosauria', version: '1' }, … }
```

Curate a selective import from a checklist (see `examples/selective-import.mjs`):

```js
import { csvAdapter, selectiveImport, toSnapshot } from '@captiveorigins/onetaxonomy-import'

const read = await csvAdapter({ source: mySource }).read(csvText)        // Darwin Core column names by default
const full = toSnapshot(read, { id: 'my-checklist', version: '2026-03', createdAt })
const { snapshot, coverage } = selectiveImport(full, {
  id: 'my-selection', title: 'Kept groups', version: '1', classification: full.classifications[0].id,
  roots: [{ concept: turtlesId, policy: { kind: 'rank', ranks: ['species', 'subspecies'] } }],
}, { id: 'curated', version: '1', createdAt })
// snapshot: chosen taxa + ancestor paths only; coverage: what was left out, per root
```

## Documentation

- [Architecture](docs/architecture/architecture.md), [data schema](docs/architecture/data-schema.md), [decisions (ADRs)](docs/architecture/adr/README.md)
- [Phase plan](docs/architecture/phase-plan.md), [backlog](docs/architecture/backlog.md), [limitations](docs/architecture/limitations.md)
- [Fixtures](fixtures/README.md), [releasing](RELEASING.md)

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) for the software: free for noncommercial use, with attribution; commercial use needs a separate license from Captive Origins. Versions published before this change remain under MIT. Data you import keeps its own license; OneTaxonomy records it with every snapshot.
