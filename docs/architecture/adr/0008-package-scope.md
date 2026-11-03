# 0008 — npm names `@captiveorigins/onetaxonomy-*`

**Context.** The specification names packages `@onetaxonomy/*`, which would need a separate npm organization. The owner's other framework, OnePedigree, publishes under the existing `@captiveorigins` scope (`@captiveorigins/onepedigree-core`, `-react`, `@captiveorigins/payload-plugin-onepedigree`).

**Decision (owner, 2026-11-02).** Follow OnePedigree: `@captiveorigins/onetaxonomy-core`, `-import`, `-layout`, `-react`, `-education` (and `-live` in Phase 2), and the Payload plugin `@captiveorigins/payload-plugin-onetaxonomy`. The scope is only a publisher namespace: the code stays independent of Captive Origins (ADR 0002) and imports nothing from it.

**Consequences.** One npm account and one trusted-publisher setup for all of the owner's packages. Moving to a dedicated scope later means publishing under new names and deprecating these.
