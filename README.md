# OneTaxonomy

An open-source framework for importing, curating, browsing and publishing **scientifically faithful** taxonomic classifications and phylogenetic trees: for developers, and for teachers, museums, researchers and animal keepers who don't write code.

> **Status: early (Phase 1, milestone 2 of 8).** The pure TypeScript core and the Newick reader/writer work and are tested. Curation, views, the React viewer, the Payload plugin and the macOS Studio are planned; see [the phase plan](docs/architecture/phase-plan.md). Packages: `@captiveorigins/onetaxonomy-core` and `@captiveorigins/onetaxonomy-import` (not on npm yet).

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
| [`@captiveorigins/onetaxonomy-core`](packages/core) | Records, validation, bounded traversal, MRCA, tri-state monophyly, snapshot checksums. No dependencies; runs anywhere. | Working |
| [`@captiveorigins/onetaxonomy-import`](packages/import) | Format readers and writers (Newick so far), source adapters, curation | Newick working |
| `@captiveorigins/onetaxonomy-layout`, `react`, `education`, `payload` | Layouts, React viewer, lessons, Payload plugin | Planned |
| `apps/studio` | Offline macOS studio (Tauri 2) | Planned |

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

## Documentation

- [Architecture](docs/architecture/architecture.md), [data schema](docs/architecture/data-schema.md), [decisions (ADRs)](docs/architecture/adr/README.md)
- [Phase plan](docs/architecture/phase-plan.md), [backlog](docs/architecture/backlog.md), [limitations](docs/architecture/limitations.md)
- [Fixtures](fixtures/README.md), [releasing](RELEASING.md)

## License

MIT for the software. Data you import keeps its own license; OneTaxonomy records it with every snapshot.
