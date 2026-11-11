# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

## 2026-11-11: canvas renderer and benchmarks

Scope: M8's canvas renderer and benchmarks. React gains `CanvasTreeView`, chosen by `TreeView` above 1,000 drawn nodes, with its level of detail in a pure module (`canvasPlan.ts`: `prepareTree`, `planCanvas`, `hitTest`, `drawPlan`, `describeLod`), and `scripts/bench-canvas.mjs` writes `docs/benchmarks.md`. `shapes.tsx` now builds its SVG paths from `shapePolygon`, which the canvas uses too. Core, import, layout, education and the Mac app are unchanged. Tests went from 281 to 297: react 85 to 101 (14 in the new `canvas.test.tsx`, 2 in the new `svg-unchanged.test.tsx`). Everything ran in Node or jsdom, where a canvas can't paint: the drawing was checked by recording the calls made on a stand-in 2D context. No browser, screen reader or built app.

### Covered

- **The switch.** `chooseRenderer` gives SVG at 999 drawn nodes and canvas at 1,001, with the threshold at 1,000; `renderer="svg"` and `"canvas"` win over the count, `canvasThreshold` moves it, and folding a branch counts (a 1,001-node tree with one branch folded is SVG) (`canvas.test.tsx`).
- **The SVG is unchanged below the threshold.** Three snapshots written from the code before this change pin the whole markup: the checklist with a branch folded ("+n not shown"), and the amniotes radial and rectangular with two highlights, trait marks, a badge, a drag offset, a drop target and a selection. They still match after `TreeView` and `shapes.tsx` were refactored, and `renderer="svg"` gives the same markup as the default (`svg-unchanged.test.tsx`, `canvas.test.tsx`).
- **Accessible name and description.** The canvas is `role="img"`, named by the title, and described by the same sentence as the SVG's `desc` (the classification or phylogeny notice and "1199 of 1199 shown.") plus the level-of-detail note, which is also visible text. Nothing in the drawing has a `tabindex` (ADR 0010), and the explorer keeps its outline (`role="tree"`).
- **Which labels show.** At 1 px per unit (12 px text) every tip in view is named; at 0.7 (8.4 px) only the selection is, at 9 px and bold, and every other name is counted as left out, with the note "… names and values are too small or crowded to show. Zoom in to see them." Three tips 8 units apart with 12-unit text: the middle name overlaps the first and is left out and counted. Radial: all 8 names show on a small tree; on 800 tips, every name shown has its neighbours at least 0.9 of the text height away, and the rest are counted.
- **Wedges and disclosure.** On 5,000 tips at the fit zoom, subtrees under a pixel become wedges; the wedges' counts add up to the merged total, and drawn + merged + out of view equals every drawn node, so nothing goes missing uncounted. The note gives both numbers and, in the explorer, points to the outline. Zoomed in (1–2k nodes in view), nothing is merged. Radial layouts merge along the outer circle with the same accounting. The selection and the drop target are never merged.
- **Highlights keep shape and colour.** Close up, a node in the first highlight has its colour and a circle, one in the second a square, as `shapeAt` gives the SVG; zoomed out, wedges holding them carry the same colour and shape. The drawing of a square uses the same corners as the SVG path (`shapePolygon`), and the highlight colour is filled.
- **High density.** With a device pixel ratio of 2 the explorer's canvas is 1600 × 1200 for an 800 × 600 drawing, and `drawPlan` starts with a 2× transform.
- **Hit-testing and selection.** `hitTest` finds a node by its dot and by its name, a wedge by its centre, and nothing on empty canvas. In the explorer, zooming in with + and clicking a drawn tip on the canvas selects it: the inspector shows its name and the outline marks it selected; a click on empty canvas changes nothing.
- **Exports don't fail silently.** SVG download on a canvas tree writes the reason in the status region ("…Download PNG instead, or fold branches until the tree is drawn as SVG.").

### Gaps left

- **No paint was timed and nothing ran in a browser.** `docs/benchmarks.md` has Node timings for projection, layout, the plan and hit-testing on 1k, 10k and 50k made-up tips (planning one frame: at most 11 ms, the radial whole tree at 50,000 tips; under 2 ms for rectangular). Paint time, frame rate while panning, and how 2× density looks need WebKit or another browser. The machine was busy with other work during the run (load average about 21 on 12 cores), so the numbers are rough. Owner or a browser run: smoothness at 1–2k visible nodes, the threshold's placement, and a look at wedges, labels and dark mode.
- **PNG download on a canvas tree** uses `canvas.toBlob`, which jsdom doesn't have: not tested. Print shows the canvas as an image with the disclosure; not tested either.
- **The threshold is a judgment.** 1,000 drawn nodes wasn't measured against the SVG in a browser.
- **The outline isn't virtualized.** With 10,000+ rows it may be slower than the drawing; `projectView` still stops at 10,000 nodes by default and says so.
- **Text width is estimated** (0.6 em per character) so the plan is the same everywhere; long names in wide fonts can overlap slightly at the edges of the rule.
- **The note's wording** is English in `describeLod`; the explorer's `labels` don't cover it yet (a host can pass `lodNote` to `TreeView`, not to `Explorer`).
- **Dragging on the canvas** (reorder and Proposed-mode moves) goes through the same code as the SVG, offsetting the dragged subtree in the plan, but no test drags on the canvas.

### Left out as overkill

- Drawing every overlay through the recorder (support text, trait marks, badges, the axis): they use the same plan fields and drawing calls as the highlights, which are tested, and the SVG keeps its own tests for them.
- Repeating the explorer's toolbar, outline and inspector tests on a canvas tree: they don't depend on the renderer.

## 2026-11-11: possible tip matches, long trees, more shapes, drawing focus

Scope: the gaps left by the linking and accessibility sections below. React gains `nearNameMatches` and paging in `TipLinker`, six more mark shapes, and ADR 0010 for drawing focus. Core, import and the Mac app are unchanged. Tests went from 267 to 281: react 71 to 85 (12 in the new `tipnear.test.tsx`, 2 in `a11y.test.tsx`). Everything ran in Node or jsdom: no screen reader, browser or built app.

### Covered

- **Near names are found by three rules, the closest first** (`tipnear.test.tsx`): underscores, spacing and case ("Alphus_primus", "deltus  SEXTUS"); a trailing specimen code left off ("Deltus_septimus_MZUSP1234", and "MZUSP 1234" and "KU-12345" in the unit test); one edit, including two letters swapped ("Epsilus octavsu") and one edit after a code is left off ("Gamus quartus_AB12"). A synonym found this way keeps its status. Capitals alone aren't a code, a label that is all code is left alone, and names under five letters aren't matched by one edit ("Bus" doesn't find "Bos").
- **Near names never act alone.** They're proposed only for tips with no exact match, aren't `bulk`, and "Accept all exact unique matches (1)" takes only the exact one; every row stays unlinked until a person chooses. They're listed in their own "Possible matches, not exact" region and in their own group in the row's list, each with "(not exact: <rule>)". The Link button is a toggle (`aria-pressed`) whose name starts with its visible text; linking says "(not exact)" in the status region, and pressing it again unlinks.
- **What was chosen is recorded.** `linkedPhylogeny` notes `near-name-confirmed` with the label, the name, the rule and what was left off; a taxon chosen another way stays `chosen-by-person`. The open snapshot's JSON is unchanged.
- **Long trees.** Over `pageSize` rows (default 200; 200 tips isn't paged, 201 is) the table shows one page, with "Tips 1–200 of 201" in a status region. Previous and Next move pages, and when one becomes disabled focus moves to the other. "List tips" narrows to one kind of match with counts; it filters on the kind of match, which linking doesn't change, so a row doesn't vanish when linked. Accept all still counts every tip, on any page.
- **Twelve shapes.** All closed paths, all different. Eight highlights on eight nodes draw the first eight shapes, and the legend shows the same eight; trait states get the twelve, then repeat (`a11y.test.tsx`).
- **Drawing focus (ADR 0010).** Drawing nodes keep `tabindex="-1"` inside a `role="img"` SVG, and the outline tree is one Tab stop. The ADR says why roving focus in the drawing wasn't added: the image role hides focusable children from screen readers, arrows already pan the canvas, and the order on screen depends on the layout.

### Gaps left

- **Authorship in a label** ("Alphus primus Fixture, 2026") and trinomials written differently still aren't matched: "2026" is left off as a code, but "Fixture," stays.
- **Near-name matching was timed only once,** on made-up data: 5,000 labels against 20,000 names took about 340 ms in Node. Not timed in WebKit.
- **The Not linked list under the table isn't paged.** It's plain text, one line per tip.
- **ADR 0010 is proposed, not accepted.** The owner may want roving focus in the drawing anyway.
- **Shapes at print size** and the new shapes in dark mode haven't been looked at. Past twelve, shapes repeat.
- **Not run for real:** VoiceOver on the possible-matches region, the toggle buttons and the page status.

### Left out as overkill

- Every label override, and more one-edit cases: `isOneEdit` is tested for each kind of edit and two near misses.

## 2026-11-11: rooting in describeView, two controls named "Show"

Scope: two gaps from the sections below. The rooting note moves from the explorer into core's `describeView`, and the two "Show" dropdowns get distinct names. Tests went from 263 to 267: core 101 to 105 (4 in `rooting.test.ts`); react (71) and the studio (39) have the same counts, with assertions changed and one added. Everything ran in Node or jsdom with Tauri mocked.

### Covered

- **Every `describeView` caller discloses rerooting.** For an outgroup rooting, the line after "Phylogenetic hypothesis:" is "Rooting (outgroup): " and the record's whole note, which names the outgroup and the record it came from. A midpoint rooting says "Rooting (midpoint): … it is not an outgroup rooting." A record without a note still gets the method, the outgroup by label and the source record ("Rooting (outgroup): on the outgroup A, from t version 1."), and one with only a method gets that. A tree with no rooting record, or marked unrooted, gets no line (`rooting.test.ts`).
- **The explorer shows core's line once.** The note under the toolbar and the About list both read "Rooting (outgroup): Rerooted on the outgroup Mammalia…", and About has it once (`getByText` fails on two) (`phylo.test.tsx`). The Mac app shows the same line for a tree rooted in the window (`app.test.tsx`).
- **Two "Show" dropdowns, two names.** The Mac app's header picker is "Show tree or classification" and the explorer's filter "Show living or extinct". Both start with the visible "Show" (2.5.3), and with a tree open both are in the window with those names (`app.test.tsx`, `a11y.test.tsx`).

### Gaps left

- **The explorer's filter name is a separate label** (`statusFilter`). A host that changes `status` should change it too; nothing checks that one contains the other.
- **Not run for real:** VoiceOver reading the two names, and the rooting line in a real export or print.

### Left out as overkill

- Testing the rooting line in each export format: SVG, PNG and print all take `describeView`'s lines, which the existing export tests already cover.

## 2026-11-11: accessibility gaps closed

Scope: the small and medium gaps from the accessibility audit below. The brand-orange focus ring is left as it is: that's the owner's decision (N154). Core and import are unchanged. Tests went from 248 to 263: react 58 to 71 (13 new in `a11y.test.tsx`), studio 37 to 39 (2 in `app.test.tsx`; `theme.test.ts` now checks the error color and the alert region). Everything ran in jsdom with Tauri mocked.

### Fixed, with tests

- **Reordering without dragging (2.5.7).** Move up and Move down in the inspector reorder a taxon among its siblings, one undo step each, like Alt+Up and Alt+Down. They're disabled at the ends and absent for a root or an only child.
- **Panning without dragging (2.5.7).** Pan left, right, up and down in the drawing controls move the view a tenth of its size, like the arrow keys. Each has a visible tooltip with its name, and Fit brings the view back.
- **The toolbar pattern.** Both `role="toolbar"` elements (the explorer's and the drawing controls) are one Tab stop. Left and Right move and wrap, Home and End jump, and disabled controls are skipped. The control last used keeps the stop, and if it becomes disabled (Undo, once undone) the first enabled one takes it. In the number field the arrows stay with the field. In a text field they move focus only from its start or end (no such field is in a toolbar yet, so that branch isn't tested).
- **Why a layout is unavailable** is visible text under the toolbar, one sentence per reason ("phylogram and time: A classification has no branch lengths or ages…"), and the layout select's `aria-describedby` points at it.
- **Fold arrows are 24 px** wide and at least 24 px tall (2.5.8). Leaves keep the same width so names line up. That widens each level of the outline by 8 px.
- **Highlights and trait states by shape (1.4.1).** Each highlight's halo, and each trait state's mark, has a shape by its place in the list: circle, square, diamond, triangle, upside-down triangle, hexagon. The legend shows the same shape beside each name. Halos now have a full-color outline, and trait marks a thin ink outline, so pale colors from the data still show an edge. Mixed states stay a dashed outline. The test uses two states one hex digit apart, which only the shape tells apart.
- **The Mac app moves focus to the forms it opens.** That covers tree questions, column choices, Settings, and linking tips (since the previous section). Cancel and Done return focus to the button that opened the form.
- **The Mac app's errors go to an alert region** (`role="alert"`). It is mounted empty before the first error, is separate from the status line, and is cleared by the next success. The error color is 4.5:1 or more on the page and the panel in light and dark.

### Gaps left

- **The focus ring** is 2.88:1 on the panels: owner decision N154.
- **Shapes repeat after six** highlights or trait states. Past that, color and the words in the inspector and legend tell them apart. (Addressed in "possible tip matches" above.)
- **Only the first highlight on a node is drawn.** That hasn't changed: a node in two highlights shows one halo.
- **The drawing's nodes still aren't reachable with Tab** (the outline is the way in; why is now ADR 0010), and live regions that mount with their first message (the clade check with a second taxon) still need a screen reader to confirm.
- **Not run for real:** VoiceOver, keyboard use in WebKit and the built app, and how the shapes look at print size.

### Left out as overkill

- Testing every toolbar control in turn: the pattern is one function over whatever controls are present, and the tests cover moving, wrapping, skipping disabled controls, selects and the number field.

## 2026-11-11: linking tree tips to taxa

Scope: the gap left in the section below ("Comparison in the Mac app always refuses files it imports itself"). React gains `TipLinker`, `proposeTipLinks` and `linkedPhylogeny`; the Mac app gains "Link tips to taxa…" and "Add tree…". Core and import are unchanged. Tests went from 228 to 248: react 44 to 58 (`tiplinks.test.tsx`, 14 new), studio 31 to 37 (2 in `open.test.ts`, 2 in `files.test.ts`, 2 in `app.test.tsx`; the theme test now finds the library's colors under the new `.ot-tip-links` scope). Everything ran in jsdom with Tauri mocked: no screen reader, browser or built app.

### Covered

- **Nothing is linked silently.** On opening, every tip is unlinked and listed, and the "make" button is disabled. Proposals are exact names, letter case aside, through core's `findByName`: an accepted name and a synonym are each one unique match, two taxa with one name are ambiguous, a misapplied name is proposed with "check before accepting", and internal nodes are never matched (`tiplinks.test.tsx`).
- **Accept all is one explicit action that says how many.** Its button reads "Accept all exact unique matches (2)", it takes only accepted-name and synonym matches (not the misapplied or ambiguous ones), says "Accepted 2 exact unique matches." in the status region, never re-links a tip the person left unlinked or one that was already linked, and is disabled with "No exact unique matches to accept" when there are none.
- **Accept, change, leave.** One proposal accepted with its row's button (named "Accept Zetus nonus for Zetus decimus", which starts with its visible text); a homonym chosen in the select, which lists every candidate with authorship, rank, source and id; a link removed ("Alphus primus left unlinked."). Each decision is announced in a status region that is mounted and empty before the first one.
- **Keyboard.** Focus moves to the step's title when it opens. "Another taxon…" puts focus in a name field: Enter links the one taxon with that exact name, says when none has it, offers every taxon when several do (without choosing), and does nothing when the field is empty; Escape closes it. The table has a caption and column and row headers. In the Mac app, Cancel and confirming return focus to "Link tips to taxa…".
- **The open snapshot is never changed.** `linkedPhylogeny` and `TipLinker` leave a sealed snapshot's JSON unchanged; the new record has a free id, only the changed tips' `concepts` (the model's explicit mapping), a `conceptLink` annotation saying whether the person confirmed a name match or chose the taxon, and the same edges. It validates, and an unknown concept or node is refused.
- **Linking makes comparison possible, and its limit is shown.** The imported tree is refused by `comparePhylogenies`; the linked one compares. One taxon on two tips is flagged with the reason comparison would refuse it.
- **Mac app, end to end.** A tree opened alone gets the plain reason no tip can match and how to fix it. With the fixture checklist open: Add tree… shows only tree files, adds the tree as a new snapshot and shows it; linking it makes "alpha (tips linked)" and shows it; a second tree likewise; "Compare with…" then gives Robinson-Foulds 4 on 4 shared tips. Saving over the added tree file is refused before anything is written; saving elsewhere writes a sealed file with all four trees, the imported ones still unlinked (`app.test.tsx`).
- **Adding trees.** `withTrees` renames a source or tree id already in use (a checklist and a tree both named "alpha" is likely), keeps the trees' source references right, never links a tip, leaves the open snapshot unchanged, and refuses a file that brings taxa or a classification (taxonomies are never merged) or no tree (`open.test.ts`). `saveJson` refuses every file the dataset came from (`files.test.ts`).

### Gaps left

- **Only exact names are proposed.** Spelling variants, authorship in the label ("Alphus primus Fixture, 2026"), trinomials written differently, and labels with specimen codes ("Alphus_primus_AB123") match nothing and must be found by hand. Fuzzy or rule-based matching would be a separate, labelled method, and is a decision for the lead. (Addressed in "possible tip matches" above.)
- **Long trees.** Every tip is a table row with a select. Not timed beyond the fixtures; a tree with thousands of tips may want paging or a filter for unmatched rows. (Addressed in "possible tip matches" above.)
- **Not run for real:** VoiceOver reading the table, the selects' optgroups and the status region; the datalist suggestions in WebKit; the Tauri dialogs and writes in the built app.
- **Add tree… needs the taxa first.** A tree opened alone can't be linked: the step says so. Opening a snapshot that holds both is the other way in.

### Left out as overkill

- Every label override: plain strings in one `labels` object, like the explorer's.
- More `findByName` cases: core's own tests cover its case-folding and ambiguity.

## 2026-11-11: controls for comparison, rooting and support collapse

Scope: the explorer and Mac app controls for the features in the previous section: the support threshold, "Compare with…", rerooting and midpoint rooting, and opening NEXUS and phyloXML in the Mac app. Core and import are unchanged. Tests went from 202 to 228: react 29 to 44 (`phylo.test.tsx`, 15 new), studio 20 to 31 (6 in `open.test.ts`, 1 in `files.test.ts`, 4 in the new `app.test.tsx`, which renders the whole window in jsdom with Tauri mocked). Core (101), import (42), layout (6) and education (4) are unchanged. Everything ran in jsdom: no screen reader, browser or built app.

### Covered

- **Support threshold.** Typing "7" then "70" applies nothing until Enter, so it's one undo step; Enter and leaving the field both apply it, and an empty field clears it. The summary ("2 branches below 70 collapsed; 1 has no support value.") is in a status region that is mounted, empty, before the first message; About gives the core's longer disclosure. Undo brings back every branch and empties the field. Clear is named "Clear support threshold", which contains its visible text, and is disabled when nothing is set. For a classification the field is disabled and its `aria-describedby` points at the visible reason. Singular and plural wording (`phylo.test.tsx`).
- **Compare with…** Only offered when there's another phylogeny. On the two amniote fixtures: distance 2, normalized 0.25, rooted, 6 shared tips, the clade each tree has that the other lacks, and "None" for tips in one tree only. Changing the mode and the tree (selects, so keyboard-operable) updates the status sentence; a given tree missing one tip is reported as "only in" with the core's note. Tips without concept mappings give the core's refusal, and no distance is shown. "Select" on a differing clade selects it in the drawing (`phylo.test.tsx`).
- **Rooting never changes the record shown.** Rooting on a tip and on a clade (every tip under it) hands a new record to `onRooted` with a new id, the method, the outgroup and the source record, and the sealed snapshot's JSON is unchanged afterwards. Midpoint rooting skips an id that's already taken. A refusal (no branch lengths, the whole tree as outgroup) is shown in the status region and nothing is handed on. No outgroup button on the root, and no rooting controls without `onRooted`. A rooted record's note is shown under the toolbar and in About (`phylo.test.tsx`).
- **Mac app: the rooted tree is a new snapshot and a new file.** `withPhylogeny` leaves the open (sealed, frozen) snapshot unchanged and still verifying, drops the checksum, records `derivedFrom`, refuses a duplicate id, and seals on save (`open.test.ts`). In the window: rooting a tip from a NEXUS file shows the new tree with its note and says the file is unchanged; choosing the opened file in the save dialog is refused before anything is written; saving elsewhere writes the temporary file and renames it, and the saved file holds all three trees and verifies (`app.test.tsx`). `saveJson` refuses the opened path in any letter case (`files.test.ts`).
- **Mac app: NEXUS and phyloXML.** Every extension in the open dialog maps to a kind; `.tre` with `#NEXUS` at the top (after comments) is NEXUS, otherwise Newick. Rooting is asked only when a NEXUS `TREE` has no [&R] or [&U] (a BEAST-style comment with "=" before the tree's "=" doesn't confuse it) or a phyloXML `<phylogeny>` has no `rooted`; paired support is noticed in NEXUS. TRANSLATE names reach the tips, nothing is mapped to taxa, and skipped parts become notes with their line ("Line 2: TAXA block is not read"). In the window, a NEXUS file opens through the mocked dialog with that note in the list, and a file that leaves rooting unsaid gets the question (`open.test.ts`, `app.test.tsx`).

### Gaps left

- **Comparison in the Mac app always refuses files it imports itself.** Newick, NEXUS and phyloXML tips are never mapped to taxa (by design: no matching by label), and comparison needs mappings. It works on snapshots that carry mappings. A way to map tips explicitly in the app (a mapping table the person confirms) is a feature, for the lead's list.
- **Two controls are named "Show"** in the Mac app: the header's tree or classification picker and the explorer's living/extinct filter. They existed before; a clearer name for the header one ("Tree or classification") is a small wording change left to the owner. (Closed in "rooting in describeView" above.)
- **Differing clades aren't highlighted in the drawing.** "Select" puts one in the selection; drawing all of them at once would need a highlight that isn't saved in the view. Clades only in the other tree have no node here, so they're listed only.
- **The rooting note is added by the explorer, not by `describeView`.** Exports from the explorer include it; another app calling `describeView` directly won't see it. Adding it in core would change core's output, which this branch was asked not to do. (Closed in "rooting in describeView" above.)
- **Not run for real:** VoiceOver reading the status regions, the number field's spinner and Enter in WebKit, and the Tauri dialogs and file writes in the built app. NEXUS and phyloXML were tried only on made-up files.
- **Saving over the opened file is refused by path, letter case aside.** A symlink or another path to the same file isn't caught.

### Left out as overkill

- Comparison and rooting results in more cases: core's tests already cover them; the UI tests check that results and refusals are shown.
- Every label override: they're plain strings in the same `labels` object as the rest.

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
