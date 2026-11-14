# 0011 — The Mac app keeps its work in files: a `.onetaxonomy` bundle, no SQLite for now

**Status.** Accepted by the maintainers, 2026-11-11. It follows the owner's rule that files stay plain and readable without the tool; revisit only on the measured triggers below.

**Context.** M6 listed SQLite persistence, backups and migrations beside a `.onetaxonomy` bundle. The Mac app already works on plain files: it opens checklists, archives, trees and sealed snapshots, never writes over the file it opened, and saves views and sealed snapshots with a temporary file and a rename. The owner's rules for these tools say a person's files stay theirs, as plain documented files readable without the tool, and that a feature which adds something to look after has to take away more than it adds.

What M6 needs from storage:

1. Keep a piece of work (a dataset, its views, lessons and media) together, and move it to another Mac or person.
2. Know when something has changed or been damaged, and say what.
3. Pin the dataset a view or lesson was made with, and notice when the one at hand is different.
4. Survive a crash while saving.
5. Read files from older versions of the app (migrations).
6. Backups.

**Decision.** No SQLite now. The `.onetaxonomy` bundle and the existing JSON files cover all six:

1. The bundle is one ZIP file holding `manifest.json`, the sealed snapshot (optional), views, lessons and media, all as plain JSON or the media's own format ([bundle-format.md](../bundle-format.md)). Any unzip tool opens it.
2. The manifest lists every file with its size and SHA-256, and each snapshot is sealed. The reader checks all of it before using any of it, and names each problem: no manifest, bad JSON, an unknown format version, a missing file, a size or checksum mismatch, a snapshot that isn't the one pinned, a path outside its folder. A damaged bundle is refused whole; it is never half-opened.
3. The manifest pins each snapshot by id, version and checksum, and every view and lesson must point at a pin. When the open dataset is another version, the app asks: keep the pinned one (when it's embedded) or relink to the open one, which is checked first and refused whole if anything doesn't fit.
4. Saves already go through a temporary file and a rename (`writeFileSafely`); bundles use the same path.
5. Each format has a version (`formatVersion` in the manifest, `schemaVersion` in snapshots, `formatVersion` in views and lessons). A reader refuses a version it doesn't know, with a message that says so. A migration, when one is needed, is a function from one JSON shape to the next in `@extantape/onetaxonomy-import`, as data-schema.md already says.
6. A bundle is a single file, so Time Machine, iCloud Drive, a USB stick or email back it up, and a copy is a backup. The app holds no state of its own beyond Settings.

SQLite would add a database the person can't read without a tool, a second copy of the data to keep in step with their files, a native dependency in the Tauri build, and its own migrations and backup story. It would take nothing away that the files don't already handle.

**What would change this.** Any of these, measured rather than guessed:

- A dataset too large to hold in memory or to read in an acceptable time as JSON (a snapshot in the hundreds of MB, or opening a bundle taking more than a few seconds on a typical Mac). The plain-TypeScript SHA-256 is the first thing to time.
- Search or queries across many datasets or bundles at once (a library of projects), where an index would have to be rebuilt every time.
- Edits that must be saved continuously and in small pieces (autosave of many small changes), where rewriting the whole bundle each time is too slow.

If one comes, SQLite would be a cache or index beside the files, rebuilt from them, never the only copy. That needs its own ADR and a follow-up PR.

**Consequences.**

- No database, no migrations framework and no backup feature to build or explain. The bundle format is the thing to document and keep stable.
- Bundles are written uncompressed ("stored"), so they are as large as their contents. Readers must also accept deflated entries, so compression can be added later without a new format version.
- Saving rewrites the whole bundle. That's fine at the sizes tested (the fixtures, a few KB) but is the first limit large datasets would reach.
- An embedded dataset carries its sources' licences and provenance with it, as a snapshot does. Whether to embed is the person's choice in the save form (ADR 0005: OneTaxonomy never bundles a dataset itself).
- The backlog's SQLite line is closed as not needed, pointing here.
