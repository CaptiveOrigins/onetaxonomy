# @captiveorigins/payload-plugin-onetaxonomy

OneTaxonomy for Payload: sealed taxonomy snapshots, views pinned to them, import jobs that turn source files into staged snapshots, people's own proposals that a manager can accept into a new staged version, and a small read API for search, ancestors, descendants, MRCA, coverage, projected views and exports, all behind your own access rules.

> **Status: early, parts 1 to 4 of M7.** Not on npm yet. The collections, publishing, tenant scope, import jobs, proposals and the read endpoints work, and are tested on a real Payload 3.93 with an in-memory MongoDB (139 tests): bad checksums refused, sealed snapshots locked, an import of each format, re-runs that store nothing new, malformed files refused with their line, interrupted jobs resumed, runs started together claimed by one, every endpoint's results, a view's `source` through the Local API and GraphQL, proposals kept private, shared, accepted into a staged version once and declined, access refusals and cross-tenant denial. Twelve of those tests send real requests through Payload's own REST router, signed in with a token from the login route; the rest call the endpoint handlers and the Local API directly. It hasn't run in a real Payload site behind a web server, or on Postgres or SQLite, and no URL import has fetched over a real network. No admin views yet: a proposal is a JSON field in the admin. See [ADR 0012](../../docs/architecture/adr/0012-payload-plugin.md).

## What it does

- **Snapshots** (`taxonomy-snapshots`): one document per sealed `DatasetSnapshot`, stored whole. A snapshot without a checksum, with a checksum that doesn't match, of another schema version, or with validation errors is refused. Its content never changes after that, not even from server code. The same id and version can't be stored twice. The checksum is checked again the first time the API reads it, and a snapshot changed in the database is refused (500), not answered from.
- **Staged, published, withdrawn.** New snapshots are staged, seen only by managers. Publishing needs a signed-in person and records who and when. Withdrawn hides it from readers. Nothing moves back, and only staged snapshots can be deleted.
- **Views** (`taxonomy-views`): a OneTaxonomy view over one snapshot. It must pin that snapshot's id, version and checksum, and core's `validateView` must find no errors. Drafts can change; published views can't. A view is published only over a published snapshot.
- **Import jobs** (`taxonomy-imports`, with the `imports` option): one job reads one file, a CSV/TSV checklist, a Darwin Core Archive, a OneTaxonomy JSON snapshot, or Newick, NEXUS or phyloXML trees, with the matching OneTaxonomy adapter. It seals the result with core's `sealSnapshot`, checks the checksum, validates it, and stores it as a staged snapshot for a manager to check and publish. The job records its progress, the adapter's warnings, and any diagnostics, with the line or position in the file. A file that can't be read, or a dataset with validation errors, fails the job and stores nothing. The same file with the same settings stores nothing new: the job says "already imported" and links the snapshot. A job that was interrupted can be run again and starts from the file; if it had already stored its snapshot, it finds it rather than storing a second. When two runs of one job start at the same moment, one runs it and the other is refused (409). Only managers see or run jobs.
- **Proposals** (`taxonomy-proposals`, with the `proposals` option): a signed-in person's own rearrangement of a classification or a tree, drawn over one snapshot. It is private until its author shares it with the people who can read that snapshot. A manager can accept a shared proposal on a classification, which makes a **new staged snapshot version** that names the proposal, its author and the manager; the published snapshot isn't touched, and readers see nothing new until a manager publishes the new version. Or the manager declines it, with a note. Proposals on a phylogeny can be shared and compared but never accepted. See [Proposals](#proposals).
- **Read API**, as the requester, with results capped:

  | Endpoint | Query | Answers |
  | --- | --- | --- |
  | `GET /api/taxonomy-snapshots/:id/search` | `q`, `limit`, `locale` | Concepts whose names equal or start with `q`, exact first. Every concept using a name is listed, synonyms are marked, and common names are searched only in the locale asked for. |
  | `GET …/:id/ancestors` | `classification` or `phylogeny`, `node`, `limit`, `maxDepth` | Ancestors, nearest first, with labels. |
  | `GET …/:id/descendants` | the same | Descendants, breadth first. |
  | `GET …/:id/mrca` | `phylogeny`, `nodes` (comma-separated) | Core's `findMRCA`: found, indeterminate (unrooted) or none (different trees), naming the hypothesis. |
  | `GET …/:id/coverage` | `classification`, `phylogeny`, `groups`, `included` (comma-separated), `omittedLimit` | Core's `getCoverageReport`: per group, how many concepts are included and omitted, the omitted branches, and how many a hypothesis maps. Without `included`, every concept in the classification counts. Taxa known to science are never estimated: always `not-stated`. |
  | `GET …/:id/export` | | The sealed snapshot exactly as stored, as a JSON download, after its checksum is checked. |
  | `GET /api/taxonomy-views/:id/projection` | `limit` | Core's `projectView` (the nodes to draw, in order, with counts of what isn't drawn) and `describeView`'s disclosure. |
  | `GET /api/taxonomy-views/:id/export` | | A JSON download: `view` (the plain view file), `source` (the snapshot it pins, with its status) and the disclosure lines. |

  A snapshot or view that doesn't exist, that the requester can't read, or that belongs to another tenant is a 404, the same 404 every time. Readers see published records; managers see every status in their tenant. Unknown hierarchies and nodes are 404 too. Bad queries are 400, and so is MRCA on a classification, which makes no claim of common ancestry. In an unrooted phylogeny, ancestors and descendants answer `indeterminate` rather than following storage order.

  A published view whose snapshot was later withdrawn stays readable, and says so: its projection and export carry `source.withdrawn: true` and start the disclosure's warnings with "Source withdrawn: …". The snapshot itself is hidden from readers (ADR 0012, point 14).

  Payload's own reads say the same. Every view read over REST, GraphQL or the Local API has a `source` field: `{ doc, id, version, checksum, status, withdrawn }`, the same object the endpoints give. It isn't stored; it is worked out from the snapshot when the view is read, so it is always the status now. It is `null` if the snapshot is gone, and a `source` you send is ignored.

## Install

```js
import { oneTaxonomy } from '@captiveorigins/payload-plugin-onetaxonomy'

export default buildConfig({
  // …
  plugins: [
    oneTaxonomy({
      access: {
        read: ({ req }) => Boolean(req.user),             // default; use () => true for a public site
        manage: ({ req }) => req.user?.role === 'curator', // default: nobody but server code
        propose: ({ req }) => Boolean(req.user),           // default; who may make proposals, among those who may read
      },
      tenant: { collection: 'sites', resolve: ({ req }) => req.user?.site ?? null }, // optional
      locale: { default: 'en' },
      limits: { maxResults: 100, maxDepth: 100, maxMrcaNodes: 100, maxNodes: 5000, maxCoverageIds: 1000 },
      imports: {                                            // optional; without it there is no imports collection
        uploads: { collection: 'media' },                   // read as the person running the job
        fetch: ({ url }) => fetchFromAllowedHosts(url),     // optional; your function decides which URLs are allowed
      },
      proposals: {                                          // optional; `true` takes the defaults; without it there is no proposals collection
        nameOf: ({ req }) => req.user.handle,               // the name sealed into an accepted version: a public handle, not an email
      },
    }),
  ],
})
```

Only `true` from a callback allows. `false`, any other value, or a throw is a no. With `tenant`, every collection gets a required relationship to your tenants collection, and every read and write is limited to the requester's tenant. If `resolve` gives nothing or throws, there's no access at all.

Store a snapshot from server code or as a manager:

```js
import { sealSnapshot } from '@captiveorigins/onetaxonomy-core'

const doc = await payload.create({ collection: 'taxonomy-snapshots', data: { snapshot: sealSnapshot(snapshot) }, user, overrideAccess: false })
await payload.update({ collection: 'taxonomy-snapshots', id: doc.id, data: { status: 'published' }, user, overrideAccess: false })
```

Import a file as a manager. The job runs when it is made, and the document that comes back says how it went:

```js
const job = await payload.create({
  collection: 'taxonomy-imports',
  data: {
    format: 'csv',                       // csv, dwca, onetaxonomy-json, newick, nexus, phyloxml
    file: upload.id,                     // or url: 'https://…', with imports.fetch
    settings: {
      snapshot: { id: 'my-checklist', version: '2026-11', createdAt: '2026-11-11T00:00:00Z' },
      source: { id: 'my-checklist', title: 'My checklist', citation: '…', license: 'CC-BY-4.0' },
      options: { idPrefix: 'mc' },       // passed to the adapter: columns, delimiter, classification, or for trees id, version, rooted, lengthUnit …
      // labels: { 'Alpha one': ['mc:12'] }   tree files only: labels mapped to concepts, nothing guessed
    },
  },
  user, overrideAccess: false,
})
// job.status: 'done' | 'already-imported' | 'failed'; job.snapshot, job.message, job.warnings, job.diagnostics
```

`createdAt` is required because it is part of the checksum: with it fixed, the same file gives the same snapshot. Settings that can't make a snapshot are refused when the job is made. A job's input and results can't be edited afterwards; make a new job. `POST /api/taxonomy-imports/:id/run` or `runImport(req, id)` runs a job again: a finished one is left as it is, a failed one is tried again, and one still marked running is refused (409) until `imports.staleAfterMinutes` (default 15) have passed. If another run starts the job first, this one is refused (409) and changes nothing. Server code without a user runs jobs with `runImport(req, id, { overrideAccess: true })`. Set `imports.runOnCreate: false` to run jobs from your own queue instead.

Host pages can call `searchNames`, `ancestorsOf`, `descendantsOf`, `mrcaOf`, `coverageOf`, `exportSnapshot`, `projectedView` and `exportView` with a request (from `createLocalReq`). They apply the same access and return `{ ok, body }` or `{ ok: false, status, error }`.

## Proposals

Turn them on with `proposals: true` or `proposals: { nameOf, maxMoves, maxPerUser }`.

```js
// Anyone signed in who may read and propose. It starts private.
const p = await payload.create({
  collection: 'taxonomy-proposals',
  data: {
    snapshot: snapshotDoc.id,
    proposal: {
      title: 'Birds are reptiles',
      notes: 'Optional, up to 5,000 characters.',
      base: { kind: 'classification', id: 'traditional', version: '1' },
      moves: [{ node: 'c:aves', from: null, to: 'c:reptilia', note: 'Birds nest inside reptiles' }],  // null is the root
    },
  },
  user, overrideAccess: false,
})
await payload.update({ collection: 'taxonomy-proposals', id: p.id, data: { status: 'shared' }, user, overrideAccess: false })
```

The plugin sets the proposal's id, author name and date, and drops anything else sent with it. A proposal that doesn't fit its snapshot (an unknown node, a move from a parent the node doesn't have, a cycle) is refused with the reason.

| Status | Who sees it | What can happen |
| --- | --- | --- |
| `private` | Its author | The author edits, shares or deletes it. |
| `shared` | Everyone in the tenant who may read | It can't be edited or deleted. The author can take it back to `private`. A manager accepts or declines it. |
| `accepted` | Everyone in the tenant who may read | Nothing. It is part of a snapshot version's record and is kept, even from server code. |
| `declined` | Its author and managers | The author takes it back to `private` to revise it, or deletes it. |

Sharing needs at least one move and a published snapshot. Anonymous visitors never see proposals, even where your snapshots are public.

| Endpoint | Who | Does |
| --- | --- | --- |
| `GET /api/taxonomy-proposals/:id/preview` (`limit`) | Anyone who can read the proposal and its snapshot | What it would change: taxa moved, groups that gain or lose members, groups broken and formed, each list capped, with the proposal's `checksum`, `acceptable`, and `notAcceptable` saying why not. |
| `POST …/:id/accept` with `{ "version": "2", "checksum": "sha256:…", "note": "…", "createdAt": "…" }` | Managers in its tenant | Makes the new staged version and marks the proposal accepted. `version` names the new version. `checksum` is the proposal's, from the preview: if the proposal changed since, nothing is accepted. `note` and `createdAt` (default now) are optional. Answers the new snapshot and the one it was made from. |
| `POST …/:id/decline` with `{ "note": "…" }` | Managers in its tenant | Marks it declined. The author sees the note. |

Anyone else gets the 404 of a missing proposal. A refusal that depends on the proposal's state is a 409 with the reason: not shared, changed since the checksum, a snapshot that isn't published, a version already stored, a proposal on a phylogeny, or another manager having decided a moment before. Two managers accepting at once store one version. Host code can call `previewProposal`, `acceptProposal` and `declineProposal` with a request.

The new version is core's `acceptIntoSnapshot`: the classification gets a new version, each moved placement names the proposal as its source, a source record `proposal:<id>` says who proposed and who accepted, and `derivedFrom` pins the snapshot it was made from. It is stored staged, so publishing it is a second, separate step. Deleting that staged version before it is published opens the proposal again.

**Names are permanent.** `nameOf` gives the name a person's proposals and decisions carry (default `User <id>`). When a proposal is accepted, its author's name and the manager's are sealed into the new snapshot, inside its checksum. They can't be taken out later. Give a name people are happy to have published. If `nameOf` throws or gives nothing, the action stops and nothing is saved.

**When someone leaves.** Your server code can take back their shared proposals (`status: 'private'`) and delete their private and declined ones. Their accepted proposals stay, with the name they carried when accepted, and so does that name in the snapshot.

Options: `slugs` (`snapshots`, `views`, `imports`, `proposals`), `access` (`read`, `manage`, `propose`), `tenant` (`collection`, `field`, `resolve`), `locale`, `limits`, `imports` (`uploads`, `fetch`, `maxBytes`, `staleAfterMinutes`, `runOnCreate`), `proposals` (`nameOf`, `maxMoves` default 500, `maxPerUser` default 200, not counting accepted ones), `admin.group`.

## Limits

- A MongoDB document holds at most 16 MB, so very large snapshots can't be stored yet. Imports refuse files over `imports.maxBytes` (default 15 MB).
- An import runs in one request. A big file holds that request until it's done; run such jobs from a queue with `runOnCreate: false`.
- The default upload reader reads Payload's local storage (`staticDir`). For cloud storage, give `imports.uploads.read`.
- Only one run can start a job at a time on MongoDB. That hasn't been checked on Postgres or SQLite, where the unique index still stops a duplicate snapshot. A run that takes longer than `imports.staleAfterMinutes` can be taken over by a new run; the slow one still writes its progress to the job when it wakes, but only one snapshot is stored.
- The first question about a snapshot loads and checks the whole thing. Indexes for eight snapshots are kept in memory after that.
- A published view stays readable after its snapshot is withdrawn, flagged as `source.withdrawn` in the endpoints and in Payload's own reads. In the admin, `source` shows as read-only JSON.
- Each acceptance is made from the published snapshot alone. Two proposals accepted on one snapshot give two versions, not one with both; to combine them, publish the first and propose again on it.
- A new snapshot and its proposal's status are written in one transaction where the database has them (a MongoDB replica set). Without transactions the snapshot is removed again if the proposal couldn't be marked, but a crash between the two writes can leave a staged version that no proposal points to. A manager can delete it.
- The claim that lets one manager's decision win is one statement on MongoDB. It hasn't been checked on Postgres or SQLite.
- A proposal that is shared again after a decision keeps that decision's note until the next one.
- Payload's default edit views only: an import's progress, warnings and diagnostics show as JSON, and a proposal is a JSON field. Admin views and an example app are later parts.

## Commands

```sh
pnpm build      # dist/
pnpm typecheck
pnpm test       # starts an in-memory MongoDB per test file; needs the MongoDB binary cached, no network in the tests
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Source-available, not open source. Commercial use needs a separate license from Captive Origins.
