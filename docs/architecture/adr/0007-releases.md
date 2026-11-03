# 0007 — Lockstep versions; tag releases staged on npm (instead of Changesets)

**Context.** The specification suggests Changesets. The owner's projects (OnePedigree and the Payload plugins) share one release process: a version tag triggers a GitHub workflow that tests, builds and **stages** the packages on npm through trusted publishing (no stored token); a maintainer approves them with 2FA on npmjs.com.

**Decision.** All OneTaxonomy packages (`@captiveorigins/onetaxonomy-*`, `@captiveorigins/payload-plugin-onetaxonomy`) share one version (lockstep), bumped together, released by tag through the same staged workflow (`.github/workflows/release.yml`, `RELEASING.md`). Changesets is not used: with lockstep versions it adds a step without adding information, and per-package changelogs live in `CHANGELOG.md`.

**Consequences.** Every release publishes every package, even unchanged ones. Revisit if packages need independent versions after 1.0.
