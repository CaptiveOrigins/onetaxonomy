# Releasing

One description everywhere: each `package.json` (`description`, `keywords`) is the source; GitHub's description and topics are synced from the root `package.json` before each release, npm takes each package's at release, and the Release workflow refuses to stage if GitHub differs.

1. Bump the same `version` in every `packages/*/package.json` (lockstep, ADR 0007), update `CHANGELOG.md`, commit as `Release x.y.z`, tag `vx.y.z`, and push the commit and the tag.
2. The Release workflow builds, tests and **stages** every package on npm (trusted publishing, no stored token). Prereleases go to the `alpha` dist-tag once a package has a stable version; before that they are also `latest`.
3. The maintainer account approves each with 2FA: npmjs.com → avatar → **Staged Packages** → **Approve**, or `npm stage list` then `npm stage approve <id>`. Only then are they public.

`@captiveorigins/payload-plugin-onetaxonomy` (`packages/payload`) moves in lockstep but isn't staged yet: the Release workflow skips it until the owner has published its first version by hand and set up its trust. Then remove `grep -v -x payload` from the workflow's stage step.

The first version of each package is published by hand (`pnpm publish --access public` in each `packages/*` folder, `core` first; pnpm turns `workspace:^` into the real version), because npm can only trust a workflow for a package that exists; then, once per package:

```bash
npm trust github <package-name> --repo CaptiveOrigins/onetaxonomy --file release.yml --allow-stage-publish --yes
```
