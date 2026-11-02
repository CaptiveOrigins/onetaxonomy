# 0001 — pnpm monorepo, strict TypeScript, tsup, Vitest

**Context.** The specification asks for a pnpm TypeScript monorepo with strict types, Vitest, Playwright, lint/format, changesets, CI and runnable examples. The sibling project OnePedigree already uses pnpm 11 workspaces, tsup builds and Vitest.

**Decision.** Same toolchain as OnePedigree: pnpm workspaces (`packages/*`, `apps/*`, `examples`), `tsconfig.base.json` with `strict` and `noUncheckedIndexedAccess`, ESM-only packages built with tsup, Vitest per package, GitHub Actions CI (install → build → typecheck → test). Playwright arrives with the first UI (M4); a linter/formatter arrives with the second contributor-facing package rather than as an empty config.

**Consequences.** One mental model across Captive Origins' frameworks. Workspace packages are tested against each other's built output, so CI builds before typechecking.
