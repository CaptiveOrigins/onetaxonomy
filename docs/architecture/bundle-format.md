# The `.onetaxonomy` bundle (format version 1)

A bundle keeps a piece of work together: the dataset, the views and lessons made with it, and media. It's a plain ZIP file, so you can open it with Finder, `unzip` or any ZIP library and read every file in it without OneTaxonomy. Why it's a file and not a database: [ADR 0011](adr/0011-bundle-not-sqlite.md).

The code is `writeBundle` and `readBundle` in `@captiveorigins/onetaxonomy-import` ([`bundle.ts`](../../packages/import/src/bundle.ts)). The Mac app's Save as bundle… and Open… use them.

## Layout

```
manifest.json                         always, and first
snapshots/<id>-<version>.json         the dataset, if it's embedded: a sealed snapshot, the same text Save snapshot… writes
views/<view id>.view.json             one per view
lessons/<lesson id>.lesson.json       one per lesson
media/<name>                          images and other media, in their own formats
```

Entries are written uncompressed ("stored") with UTF-8 names and real CRC-32s. Readers must also accept deflated entries. No encryption and no ZIP64, so a bundle stays under 4 GiB. JSON files are pretty-printed with sorted keys.

## manifest.json

```json
{
  "format": "onetaxonomy-bundle",
  "formatVersion": 1,
  "createdAt": "2026-11-11T09:30:00.000Z",
  "createdBy": { "app": "OneTaxonomy for Mac", "version": "0.1.1" },
  "title": "Archelosauria",
  "snapshots": [
    {
      "id": "fixture-amniotes",
      "version": "1",
      "checksum": "sha256:…64 hex digits…",
      "file": "snapshots/fixture-amniotes-1.json"
    }
  ],
  "files": [
    { "path": "snapshots/fixture-amniotes-1.json", "role": "snapshot", "sha256": "…", "bytes": 48213 },
    { "path": "views/main.view.json", "role": "view", "sha256": "…", "bytes": 912 },
    { "path": "media/shell.png", "role": "media", "sha256": "…", "bytes": 20480, "mediaType": "image/png" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `onetaxonomy-bundle`. |
| `formatVersion` | `1`. A reader refuses a version it doesn't know and says so; it never guesses. |
| `createdAt` | When the bundle was written (ISO 8601). |
| `createdBy` | The app and its version. |
| `title` | Optional. The Mac app uses the title of the view on screen. |
| `snapshots` | The **pins**: each dataset the views and lessons were made with, by `id`, `version` and `checksum` (the snapshot's own sealed checksum: `sha256:` of its canonical JSON, see [data-schema.md](data-schema.md)). `file` is set when the snapshot is embedded; without it the bundle names the dataset but doesn't carry it. |
| `files` | Every file in the bundle except `manifest.json`: its `path`, its `role` (`snapshot`, `view`, `lesson` or `media`), the SHA-256 of its bytes (lowercase hex), its size in `bytes`, and for media an optional `mediaType`. |

Two different checksums are in play. A file's `sha256` is of its bytes on disk, so any change to the file is caught. A pin's `checksum` is of the snapshot's content, so the same dataset is recognised wherever it is, embedded or opened from a separate `.json` file.

## Rules a reader checks

`readBundle` checks all of these before it returns anything. Any failure means the bundle isn't opened; every problem found is listed, each with the file it concerns.

| Problem code | When |
| --- | --- |
| `not-a-zip` | The file isn't a readable ZIP (or is cut short). |
| `missing-manifest` | No `manifest.json` at the top. |
| `bad-json` | `manifest.json`, a view or a lesson, or an embedded snapshot isn't valid JSON. |
| `not-a-bundle` | The manifest's `format` isn't `onetaxonomy-bundle`. |
| `unknown-format-version` | The manifest's `formatVersion` isn't one this reader knows. |
| `bad-manifest` | A required field is missing or the wrong type, a path is listed twice, or a pin names a file that isn't listed as a snapshot (or a snapshot file no pin names). |
| `unsafe-path` | A path is absolute, uses `\`, `.` or `..`, or isn't inside its role's folder. |
| `missing-file` | A listed file isn't in the ZIP. |
| `size-mismatch` | A file's size differs from the manifest's. |
| `checksum-mismatch` | A file's SHA-256 differs from the manifest's, or an embedded snapshot is unsealed or no longer matches its own seal. |
| `pin-mismatch` | An embedded snapshot isn't the one its pin names, or a view or lesson pins the right id and version with a different checksum. |
| `unpinned` | A view or lesson was made with a snapshot (id and version) the manifest doesn't pin. |
| `bad-content` | A file isn't the kind its role says (not a view, lesson or snapshot), or the snapshot has validation errors. |

Files in the ZIP that the manifest doesn't list are left out, and a note says which.

## In the Mac app

- **Save as bundle…** asks one question, whether to include the dataset (on by default; without it the bundle opens only where that snapshot is opened first), shows what will go in, and lists anything made with another version of the dataset that will point to the one on screen. Cancel writes nothing. The file is written to a temporary name and renamed into place, and the file that was opened is never written over.
- **Open…** reads `.onetaxonomy` files. A damaged bundle is refused with every problem listed, and what was open stays open. If the open dataset is the pinned one, the bundle opens without a question. If it's another version of the same dataset (same id; different version, or same version with different contents), the app asks: keep the pinned version (only possible when it's embedded), or relink to the open one. Relinking checks every view and lesson against the open version first and is refused whole if any doesn't fit. Neither choice changes the bundle file; Save as bundle… writes a new one.
- Lessons and media in a bundle are kept and written back out on the next Save as bundle…; the Mac app doesn't show or edit them yet.
- The Mac app opens bundles with one pinned dataset. The format allows several.

## Reading one by hand

```sh
unzip -l made-up.onetaxonomy                       # what's inside
unzip -p made-up.onetaxonomy manifest.json         # the manifest
unzip -p made-up.onetaxonomy views/main.view.json  # a view
unzip made-up.onetaxonomy -d made-up && cd made-up && shasum -a 256 views/*.json   # compare with the manifest
```
