# Architecture decision records

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-monorepo-and-tooling.md) | pnpm monorepo, strict TypeScript, tsup, Vitest | Accepted |
| [0002](0002-pure-core.md) | A pure, dependency-free core | Accepted |
| [0003](0003-classification-vs-phylogeny.md) | Classifications and phylogenies are different record types | Accepted |
| [0004](0004-tri-state-monophyly.md) | Monophyly is tri-state, scoped to a hypothesis; soft polytomies by default | Accepted |
| [0005](0005-source-ownership.md) | Sources belong to the project owner; OneTaxonomy ships adapters, not data | Accepted |
| [0006](0006-view-actions.md) | Views change only through serializable actions | Accepted (implemented in M4) |
| [0007](0007-releases.md) | Lockstep versions; tag releases staged on npm, approved by a maintainer (instead of Changesets) | Accepted |
| [0008](0008-package-scope.md) | npm names `@captiveorigins/onetaxonomy-*` | Accepted (owner) |
| [0009](0009-license.md) | PolyForm Noncommercial 1.0.0 | Accepted (owner 2026-11-04) |
| [0010](0010-outline-is-the-keyboard-path.md) | The outline is the keyboard path into the tree; drawing nodes stay out of the Tab order | Accepted (Science, 2026-11-11) |
| [0012](0012-payload-plugin.md) | The Payload plugin stores sealed snapshots whole and answers bounded questions about them | Proposed (Science, 2026-11-11) |
