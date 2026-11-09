# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

## 2026-11-08: first audit

Scope: every package and the studio app. Coverage numbers weren't collected; this maps promises to tests by reading them. OneTaxonomy has no accounts or access rules, so the "always covered" items here are data safety and the checks that must refuse rather than guess.

### Where the promises are

- The science: invariants I1 to I18 in [scientific-invariants.md](architecture/scientific-invariants.md). Each row names its tests, and that table stays the map for them.
- What isn't done: [limitations.md](architecture/limitations.md).

### Covered

- I1 to I13 and I15 to I18 name passing tests in the invariants table. These include the refusals: unrooted trees and soft polytomies give `indeterminate` (I4 to I6), unmapped taxa stay unmapped (I7), and nothing is merged or repaired silently (I10, I15, I17, I18).
- I14 (inferred traits are labelled) has no test because nothing infers traits yet. It's planned for M8, and limitations.md says so.
- Studio: opening refuses a tree whose rooting is unknown instead of assuming it, and flags a sealed snapshot that was edited afterwards (`open.test.ts`). Update checks stay off while releases are unsigned (`updates.test.ts`).

### Fixed in this pass

- **A cut-short or mis-sized ZIP entry was read silently.** CRCs aren't checked (a stated limitation), and the reader also took an entry at its word. A stored entry that ran past the end of the archive came back truncated, and a deflated entry was never compared with its stated size. Both are now refused with a `ZipError` naming the file (`dwca.test.ts`, "refuses an entry that is cut short"). The test failed before the fix.
- **Studio saving had no test.** Its atomic save (write a temporary file, then rename it) is now tested, including that a failed write leaves the old file untouched (`apps/studio/test/files.test.ts`, with the Tauri file calls mocked).

### Gaps left

- **CRC checks on ZIP entries.** Still a stated limitation. The size checks above catch truncation, but not bytes that were changed in place. Worth adding when Darwin Core Archives come from places other than the person's own disk.
- **Very large archives are read into memory,** with no cap. The person picks the file, so this affects only that person's own app, and it's a stated limitation.

### Left out as overkill

- Rendering details of the React explorer beyond what `react` tests already check, such as the exact SVG output.
- The playground app, which is a demo.
