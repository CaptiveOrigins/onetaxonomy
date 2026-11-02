# 0006 — Views change only through serializable actions

**Context.** Visual editing must never change science (I1), views must be reproducible, undo/redo is required, and Phase 2 must broadcast view changes without sending trees.

**Decision.** A `TaxonomicView` pins `{ snapshot id, version, checksum }` and a hypothesis/classification, and holds only presentation state. It changes only through `ViewAction`s (collapse, expand, rotate siblings, move node/subtree, resize, focus, filter, highlight, annotate…) applied by a pure reducer `applyViewAction(state, action)`. History is a list of actions. Topology edits are a different, explicit command family that creates a new snapshot version with provenance, and is disabled in presentation and classroom contexts.

**Consequences.** Live sessions (Phase 2) sync actions and scene ids over a shared pinned snapshot. Tests assert the snapshot checksum is unchanged after any sequence of view actions.
