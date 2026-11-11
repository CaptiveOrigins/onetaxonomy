# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

## 2026-11-11: phylogeny comparison, rooting and new importers

Scope: the M8 science items that need no owner data: `comparePhylogenies`, `rerootPhylogeny` and `midpointRoot`, the `collapseBelowSupport` view action, and the NEXUS and phyloXML readers. Tests went from 145 to 188: core 70 to 101, import 30 to 42. Layout (6), education (4), react (18) and the studio (17) are unchanged.

### Covered

- **Robinson-Foulds values worked out by hand** on 3- to 7-tip trees: two 5-tip trees with no split in common (4 of 4), rooted versus unrooted on the same pair (2 of 6 and 2 of 4), the same unrooted tree stored from different nodes (0), a different root on one topology (2 rooted, 0 unrooted), a polytomy against its resolution (1), and too few shared tips to normalize (`null`) (`compare.test.ts`).
- **Tips in only one tree are reported and left out of the distance,** never pruned silently (`compare.test.ts`).
- **Refusals that must fail closed:** unmapped tips (never matched by label), one concept on two tips, a tip with two concepts, forests, and rooted comparison of an unrooted tree (`compare.test.ts`). Rooting refuses outgroups that aren't a clade under any rooting, internal nodes, unknown ids, the whole tree, an empty outgroup, forests, time-calibrated trees and, for midpoint rooting, missing branch lengths (`rooting.test.ts`).
- **Support stays with its split when rerooting.** `(((A,B)95,C)70,D)` rooted on A puts 95 on the clade (C,D), which is what 95 measured (`rooting.test.ts`). This is a known mistake in tree software, so it gets its own test.
- **The rooted record states what was done** (method, outgroup, source record, where on the branch the root went), validates with `validateDataset` and the JSON Schema, and has Robinson-Foulds 0 against its input when compared unrooted (`rooting.test.ts`).
- **Sealed snapshots are never changed:** comparison, rerooting, midpoint rooting and support collapsing all run on a sealed snapshot whose JSON and checksum are unchanged afterwards, and the rooted records share no objects with it (`compare.test.ts`, `rooting.test.ts`, `support-collapse.test.ts`).
- **Support collapsing is disclosed** in the projection and in `describeView`. A branch with no support value is never collapsed and is counted, a missing length stays missing, distances from the root are kept, a branch the user folded is left alone, and classifications and non-numeric thresholds are refused (`support-collapse.test.ts`).
- **NEXUS:** TRANSLATE tables, `[&R]`, `[&U]`, `UTREE` and the `rooted` option, mapping on translated names (not table numbers), skipped blocks and untranslated tips as warnings, and ten malformed files refused with the right line (`nexus.test.ts`).
- **phyloXML:** clades, names, both forms of branch length, several confidence values with their types, taxonomy ids for mapping, skipped elements as warnings, 5,000-deep nesting, and thirteen malformed files refused with the line and element, including a DOCTYPE that could declare entities (`phyloxml.test.ts`).
- Both readers produce snapshots that validate and seal, and carry the source's license.

### Gaps left

- The NEXUS and phyloXML readers are tested on hand-written files only. Real exports from MrBayes, BEAST, PAUP, Mesquite and Archaeopteryx should be tried once the owner has files to share; none were downloaded, as the tests use no network.
- Comparison and rooting haven't been timed on large trees (10k+ tips). That belongs with the M8 benchmarks.
- Trees with one-child internal nodes aren't tested for rerooting. The code keeps such nodes as they are.
- The explorer, layouts and Mac app have no controls or tests for these features yet. The explorer and the Mac app were being changed in another branch, so they were left alone.

### Left out as overkill

- More Robinson-Foulds cases. The ones above cover each branch of the code (shared and unshared tips, rooted and unrooted, polytomies, nothing to normalize).
- Every phyloXML element the reader skips. They share one code path, and two are tested.

## 2026-11-11: unsealed notice and temporary-file cleanup in the studio

Scope: the two studio gaps left on 2026-11-10. Tests went from 142 to 145, all in the studio (14 to 17). The packages are unchanged.

### Fixed, with tests

- **An unsealed snapshot opened with no notice.** `openSnapshot` now returns a `seal` notice for `unsealed` ("This snapshot isn't sealed, so changes to it since it was made can't be detected.") and for `mismatch`, and the studio shows it in its status region, outside the collapsed list of notes, so a screen reader announces it on opening. A sealed file gets none. `mismatch` is still the first note as before (`open.test.ts`, 2 tests: the notice for sealed, stripped and edited files, and where `StatusBar` renders it).
- **A failed rename left `<file>.tmp` beside the chosen file.** A failed write or rename now removes the temporary file and reports the original error unchanged. If removing fails too, the error says so and names the file, with the original error as its `cause`. This mirrors the OnePhylogeny CLI store's fix of 2026-11-09, which drops the cleanup error instead (`files.test.ts`, 2 tests).
- **Saving was never allowed to rename.** Found while fixing the above: the studio's capabilities didn't grant `fs:allow-rename`, so in the real app every save would fail at the rename and leave the temporary file. They now grant `fs:allow-rename` and `fs:allow-remove`. The tests mock Tauri, so they couldn't catch this.

### Gaps left

- The Tauri file calls and the capability check are mocked. Saving on a real disk, including the rename now being allowed, needs a check by hand in a built app.
- The notice is checked by rendering `StatusBar` to a string. How VoiceOver reads it in the app hasn't been tried.

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
