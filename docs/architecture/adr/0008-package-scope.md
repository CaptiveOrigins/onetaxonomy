# 0008 — npm names `@extantape/onetaxonomy-*`

**Context.** The specification names packages `@onetaxonomy/*`, which would need a separate npm organization. The owner's other framework, OnePedigree, already published under the owner's existing npm scope.

**Decision (owner, 2026-11-02).** Follow OnePedigree: `onetaxonomy-core`, `-import`, `-layout`, `-react`, `-education` (and `-live` in Phase 2), and the Payload plugin `payload-plugin-onetaxonomy`, all under the same scope as OnePedigree. The scope is only a publisher namespace: the code stays independent of any site that uses it (ADR 0002) and imports nothing from one.

**Moved (owner, 2026-11-14).** EXTANT APE owns OneTaxonomy. The repo moves to `ExtantApe/OneTaxonomy` and the packages publish under `@extantape` from 0.1.0-alpha.4: `@extantape/onetaxonomy-core` and the rest, and `@extantape/payload-plugin-onetaxonomy`. OnePedigree made the same move. The old names of the published packages get deprecated with a pointer to the new ones.

**Consequences.** One npm account and one trusted-publisher setup for all of the owner's packages. The move to `@extantape` meant publishing under new names and deprecating the old ones; anyone installing them changes the scope in their `package.json` and imports.
