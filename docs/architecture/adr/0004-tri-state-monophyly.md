# 0004 — Monophyly is tri-state, scoped to a hypothesis; soft polytomies by default

**Context.** Real data is incomplete: trees are unrooted, partially sampled, unresolved, or lack mappings. A boolean `isMonophyletic` forces false certainty.

**Decision.** Results are `monophyletic | not-monophyletic | indeterminate` with a `reason`, the hypothesis `{ id, version }`, the MRCA, the missing terminals and caveats (`partial-sampling`, `sampling-unknown`, `single-terminal`, `unmapped-members`). Rules:

- Unrooted hypothesis → `indeterminate / unrooted`. Selections spanning separate trees of a forest → `not-monophyletic / different-trees`, with no invented ancestor.
- The selection's terminals are compared with all terminals under their MRCA **in the full hypothesis**, never in a filtered view.
- Polytomies are *soft* by default: if the MRCA is a polytomy and the selection takes whole branches of it, the answer depends on an unknown resolution → `indeterminate / unresolved-polytomy`. Callers may choose *hard* polytomies. A selection that cuts through a resolved branch is `not-monophyletic` regardless, because every resolution keeps that branch.
- Partial sampling does not downgrade a `monophyletic` result (the claim is relative to the sampled hypothesis), but is always reported as a caveat. Unmapped members are reported, never matched by name.

**Consequences.** Every consumer must handle three states, and UIs must show caveats. Phase 2 challenges get explanations for free.
