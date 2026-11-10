# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

## 2026-11-10: full audit

Scope: every package and the studio app, against the README, the invariants table (I1 to I18), limitations.md and the ADRs. No coverage output exists in the repo, so this maps promises to tests by reading them. The source hasn't changed since the first audit apart from the release, so this pass looked hardest at the data-safety checks. Tests went from 133 to 142: core 66 to 70, import 28 to 30, studio 11 to 14. Layout (6), education (4) and react (18) are unchanged.

### Covered

- I1 to I13 and I15 to I18 still name passing tests in the invariants table. I14 (inferred traits) is still M8 and untested, as limitations.md says.
- Snapshot sealing: SHA-256 against the standard vectors, freezing, key order not mattering, and an edited snapshot failing `verifySnapshot` (`validation.test.ts`). `readSnapshotJson` reports `verified` and `mismatch` and refuses an unsupported schema version (import `curation.test.ts`). The studio flags a sealed file edited afterwards (`open.test.ts`).
- Community presets refuse shadow data and report pins whose checksum no longer matches (import `curation.test.ts`).
- ZIP reading refuses entries that are cut short or the wrong size (`dwca.test.ts`).
- Studio saving is atomic, and a failed write leaves the old file alone (`files.test.ts`, Tauri mocked). Update checks stay off while releases are unsigned (`updates.test.ts`).
- The refusals: unrooted trees, soft polytomies, unmapped taxa and Newick files with unknown rooting give `indeterminate` or an error, never a guess (`monophyly.test.ts`, `open.test.ts`).

### Gaps added (with the tests)

- **A snapshot with no checksum never verifies.** `verifySnapshot` with the checksum missing or empty is false (`validation.test.ts`).
- **Sealing doesn't touch the caller's object,** and re-sealing replaces a stale checksum with the right one (`validation.test.ts`).
- **A view pinned to the same snapshot id and version but another checksum is flagged** `snapshot-mismatch`. Before, only a different id was tested (`view.test.ts`).
- **`parseView` refuses text that isn't a view** (`view.test.ts`).
- **`readSnapshotJson` says `unsealed` for a file with no checksum and `mismatch` for an empty one,** never `verified`. It refuses a file with no concepts array or no `phylogenies` array rather than reading it in part (import `curation.test.ts`, 2 tests).
- **Studio:** cancelling the save dialog writes nothing, and a failed rename is reported as an error, not as a save (`files.test.ts`, 2 tests). Saving a sealed copy leaves the open snapshot unfrozen and unchanged (`open.test.ts`).

All new tests passed on the current code. No bug was found.

### Gaps left

- **The studio says nothing when it opens an unsealed snapshot.** `readSnapshotJson` reports `unsealed`, but `openSnapshot` only warns on `mismatch`. A sealed file whose `checksum` line was deleted therefore opens with no notice. A notice such as "This file isn't sealed, so later changes to it can't be detected" is a small change to `apps/studio/src/open.ts` plus one test. It changes what the app shows, so it's left for the lead rather than done in an audit.
- **A failed rename leaves `<file>.tmp` beside the chosen file.** The old file is safe and the error is shown, but the temporary file isn't removed. Minor; fix with the next studio change.
- CRC checks on ZIP entries, and large archives read into memory, as in the first audit. Both are stated limitations.
- The studio's dialogs and file calls are mocked. Saving on a real disk is only checked by hand.

### Left out as overkill

- More SHA-256 vectors. Three standard vectors plus a multi-byte string already cover padding and UTF-8.
- Rendering details of the React explorer, and the playground and examples apps, as before.

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
