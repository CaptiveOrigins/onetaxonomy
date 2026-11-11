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
## 2026-11-11: accessibility audit

Scope: milestone M8's accessibility audit. A code-level check of the React components (`TreeView`, `TreeOutline`, `Explorer` with its inspector, view controls and menus, `LessonPlayer`) and the Mac app (`apps/studio`) against WCAG 2.2 AA. The education package has no UI of its own; its lessons are checked through `LessonPlayer`. No screen reader was run, and nothing was looked at in a real browser or the built app: the tests render into jsdom or to a string, and contrast is computed from the CSS variables. Tests went from 145 to 158: react 18 to 29 (`a11y.test.tsx`, 11 new), studio 17 to 20 (`theme.test.ts`, 3 new). Core, import, layout and education are unchanged.

### Checked and already right

- **Names (2.5.3, 4.1.2).** Every toolbar, inspector, proposal and lesson button has its visible text as its name. The icon-only canvas buttons (zoom, fit, download, print) have an `aria-label` that matches their visible tooltip. Selects and inputs are inside their labels.
- **Keyboard (2.1.1).** Every drawing action has a keyboard path: the outline (select, fold, Alt+Up/Down to reorder), the inspector (flip, focus, clade check, "Move under" in Proposed mode), the toolbar and the canvas buttons. The outline keys in the README all work; the new test walks through each of them (Home, End, Right to open and to the first child, Left to the parent, Enter, Space, Shift+Space, `*`, plus type-ahead and Alt+arrows in the existing tests).
- **Focus (2.4.7).** Buttons, selects, the canvas and outline rows have a 2 px focus ring; the studio sets one on everything with `:focus-visible`.
- **Reduced motion (2.3.3, as a courtesy).** The only animation, nodes sliding after a change, runs only under `prefers-reduced-motion: no-preference`. Now covered by a test of the stylesheet.
- **Not by color alone (1.4.1).** Classification vs phylogeny is said in words in the legend, the drawing's description and every export. Folded branches are a triangle plus "(12 not shown)". Weak support is a dashed edge with the legend "Weak support (dashed)". Extinct taxa are a hollow dot and †. Moved taxa in Proposed mode are italic and underlined. A clade check's answer is in words.
- **Status messages (4.1.3).** The studio's status line is a status region that is always present (tested on 2026-11-11, earlier).
- **Contrast that already passed.** Light: text 15.73:1 and muted 5.88:1 on white (14.76 and 5.52 on the panel), edges 3.25:1, node ink 11.78:1. Dark: text 16.12:1, muted 8.36:1, edges 4.18:1, node ink 9.45:1, selection 8.36:1. Studio light and dark text and muted text are 5.55:1 or more on every background.

### Fixed, with tests

- **Selected text was 3.07:1.** The brand orange `#cf8137` was used for text (selected node labels, the selected outline row, drop targets, the "Proposed by" badge): 3.07:1 on white, 2.88:1 on the panel. Text now uses a new `--ot-selected-text`, `#a65f20` in light (4.91:1 on white, 4.61:1 on the panel) and the existing `#e7a066` in dark (8.36:1). Fills and the focus ring keep the brand orange.
- **The "Proposed by" badge was orange on white in dark mode, 2.18:1.** It used an undefined `--ot-bg` with a white fallback. It now uses `--ot-surface` and `--ot-selected-text` (8.36:1 in dark, 4.91:1 in light).
- **Warnings and errors failed in dark mode.** Weak-support values and cautions (`#b45309`) were 3.63:1 and 3.41:1, and errors (`#b91c1c`) 2.82:1, on the dark background. New `--ot-warning` and `--ot-error` keep the light values (5.02:1 and 6.47:1 on white; cautions 4.71:1 on the panel) and use `#fbbf24` (10.93:1) and `#f87171` (6.60:1) in dark.
- **Lesson marker digits were 3.07:1** (white on orange, 2.18:1 in dark). They're now `#1d2330`: 5.13:1 on `#cf8137`, 7.20:1 on `#e7a066`.
- **Text fields had 1.33:1 borders** (1.31:1 in the studio), too faint to find the field (1.4.11). Explorer and lesson fields now use `--ot-field-border` (`#a08a83`, 3.25:1 on white, 3.05:1 on the panel; dark `#8a7470`, 4.18:1). Studio inputs use `--field-border` (`#968485`, 3.54:1 on white; dark `#6b7383`, 3.26:1 on the field, 3.83:1 on the page).
- **Light or Dark in the studio's Settings didn't reach the explorer.** The explorer's colors follow the system through a media query, so Light on a dark Mac drew `#eef1f6` text on a white page (1.13:1), and Dark on a light Mac drew `#1d2330` on `#12151b` (1.16:1). `app.css` now sets the explorer's variables for a chosen appearance; a test keeps them equal to the library's.
- **Exported SVGs weren't valid XML in tests.** `standaloneSvg` set `xmlns` as a plain attribute, and the serializer added its own, so the file had it twice and an XML parser refused it. It's now set as a namespace declaration, once. The white background was also put before `<title>`; the title and description now come first. Whether browsers wrote the attribute twice wasn't checked; jsdom did. The new test parses the export and finds the title and description through `aria-labelledby` and `aria-describedby`.
- **A failed PNG export said nothing.** `download` had no `catch`, so an error was an unhandled rejection. It now reports "Could not export the drawing: …" in the explorer's status region.
- **The explorer's status region appeared with its message.** A live region added together with its text often isn't announced. The region (`.ot-error`, `role="status"`) is now always there and empty until needed. The clade check's answer sits in a status region that stays mounted as the selection changes.
- **The download menu was a menu in name only.** It had `role="menu"` but focus stayed on the button and arrow keys did nothing. Opening it now moves focus to the first item; Up, Down, Home and End move; Escape and Tab close it and return focus to the button.
- **Drawing keys weren't written down.** The canvas handled arrows, + and −, 0 and Escape, but its label only described the mouse. The label now lists the keys, and the inspector's hint lists the outline keys.
- **† was read as "dagger".** The outline hides the mark from screen readers and adds "(extinct)" in its place (`extinctLabel`, replaceable). The tree also sets `aria-multiselectable`, since Shift+Space and Shift-click add to the selection.
- **Lesson modes were three Tab stops with no arrow keys.** The mode switcher is a radio group, so it's now one Tab stop and the arrow keys move and choose.
- **A lesson caution was shown only in amber.** It now starts with "Caution:" (replaceable `caution` label).
- **Remove buttons on highlights were 20 px**, under the 24 px minimum (2.5.8). Now 24 px.
- **The studio window had no level-one heading.** The file name in the toolbar is now the `h1`, styled as before.

### Gaps left

- **The brand-orange focus ring is 2.88:1 on the explorer panel** (`#cf8137` on `#fbf7f4`) and 2.89:1 on the studio toolbar (`#fdf7f7`), under 3:1. It's 3.07:1 on white and 7.8:1 or more in dark. `brand/README.md` names this exact color for focus and is kept identical across the One tools, so changing it is the owner's call: a deeper orange such as `#a65f20` for the ring, or panels close to white (`#fefcfb` gives 3.00:1).
- **Highlights and trait states are told apart by color in the drawing.** Each node's highlights and trait state are in words in the inspector, and the legend names each color, but the halos (35% opacity) and trait dots have no shape or pattern of their own, and trait colors come from the data unchecked. Fixing it means a shape or letter per highlight or state: a design change.
- **Dragging has no single-pointer alternative for two actions (2.5.7).** Reordering siblings (Alt+Up/Down in the outline is keyboard only; "Flip children" only reverses) and panning (zoom and fit are buttons, panning isn't). Moving under a new parent has the "Move under" list. Small "move up/down" buttons in the inspector and pan buttons would close it.
- **The drawing's nodes are `role="button"` inside an SVG with `role="img"`,** whose children screen readers ignore, and they can't be reached with Tab. The outline is the accessible way to the same nodes, by design. Making the drawing itself navigable is larger and overlaps the planned canvas renderer.
- **The explorer toolbar is `role="toolbar"` without arrow-key movement.** Every control is reachable with Tab, so nothing is lost, but the role promises arrows. Either add a roving tab stop or drop the role.
- **Why a layout is unavailable is only in the option's `title`,** which a keyboard or screen-reader user may not get.
- **Outline fold arrows are 16 px wide** (2.5.8). Enter, Right and Left, and double-click in the drawing, also fold, but no pointer alternative of 24 px exists. Making them wider shifts the outline's indent.
- **The studio doesn't move focus to the forms it opens** (Newick questions, column choices, Settings), and errors go to the polite status line rather than an alert.
- **Live regions that mount with their first message** (the clade check when a second taxon is added) may not be announced. Only a screen reader can confirm.
- **Never run with a screen reader or in a browser.** VoiceOver, keyboard use in the built Mac app, and real rendering (focus rings on SVG, `:has()` borders, the PNG export) need a check by hand.

### Left out as overkill

- Contrast of disabled controls (exempt in 1.4.3) and of decorative panel borders (`--ot-border`, 1.33:1): buttons are identified by their text.
- Re-testing the outline keys that the existing tests already cover (type-ahead, Alt+arrows).

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
