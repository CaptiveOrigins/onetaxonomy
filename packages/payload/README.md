# @captiveorigins/payload-plugin-onetaxonomy

OneTaxonomy for Payload: sealed taxonomy snapshots, views pinned to them, import jobs that turn source files into staged snapshots, and a small read API for search, ancestors, descendants, MRCA, coverage, projected views and exports, all behind your own access rules.

> **Status: early, parts 1 and 2 of M7.** Not on npm yet. The collections, publishing, tenant scope, import jobs and the read endpoints work, and are tested on a real Payload 3.93 with an in-memory MongoDB (80 tests): bad checksums refused, sealed snapshots locked, an import of each format, re-runs that store nothing new, malformed files refused with their line, interrupted jobs resumed, every endpoint's results, access refusals and cross-tenant denial. It hasn't run in a real Payload site, through Payload's HTTP routing (the tests call the endpoint handlers directly), or on Postgres, and no URL import has fetched over a real network. No admin views or proposals yet. See [ADR 0012](../../docs/architecture/adr/0012-payload-plugin.md).

## What it does

- **Snapshots** (`taxonomy-snapshots`): one document per sealed `DatasetSnapshot`, stored whole. A snapshot without a checksum, with a checksum that doesn't match, of another schema version, or with validation errors is refused. Its content never changes after that, not even from server code. The same id and version can't be stored twice. The checksum is checked again the first time the API reads it, and a snapshot changed in the database is refused (500), not answered from.
- **Staged, published, withdrawn.** New snapshots are staged, seen only by managers. Publishing needs a signed-in person and records who and when. Withdrawn hides it from readers. Nothing moves back, and only staged snapshots can be deleted.
- **Views** (`taxonomy-views`): a OneTaxonomy view over one snapshot. It must pin that snapshot's id, version and checksum, and core's `validateView` must find no errors. Drafts can change; published views can't. A view is published only over a published snapshot.
- **Import jobs** (`taxonomy-imports`, with the `imports` option): one job reads one file, a CSV/TSV checklist, a Darwin Core Archive, a OneTaxonomy JSON snapshot, or Newick, NEXUS or phyloXML trees, with the matching OneTaxonomy adapter. It seals the result with core's `sealSnapshot`, checks the checksum, validates it, and stores it as a staged snapshot for a manager to check and publish. The job records its progress, the adapter's warnings, and any diagnostics, with the line or position in the file. A file that can't be read, or a dataset with validation errors, fails the job and stores nothing. The same file with the same settings stores nothing new: the job says "already imported" and links the snapshot. A job that was interrupted can be run again and starts from the file; if it had already stored its snapshot, it finds it rather than storing a second. Only managers see or run jobs.
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

  A published view whose snapshot was later withdrawn stays readable, and says so: its projection and export carry `source.withdrawn: true` and start the disclosure's warnings with "Source withdrawn: …". The snapshot itself is hidden from readers. This is a proposal waiting for the lead's decision (ADR 0012, point 14).

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
      },
      tenant: { collection: 'sites', resolve: ({ req }) => req.user?.site ?? null }, // optional
      locale: { default: 'en' },
      limits: { maxResults: 100, maxDepth: 100, maxMrcaNodes: 100, maxNodes: 5000, maxCoverageIds: 1000 },
      imports: {                                            // optional; without it there is no imports collection
        uploads: { collection: 'media' },                   // read as the person running the job
        fetch: ({ url }) => fetchFromAllowedHosts(url),     // optional; your function decides which URLs are allowed
      },
    }),
  ],
})
```

Only `true` from a callback allows. `false`, any other value, or a throw is a no. With `tenant`, both collections get a required relationship to your tenants collection, and every read and write is limited to the requester's tenant. If `resolve` gives nothing or throws, there's no access at all.

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

`createdAt` is required because it is part of the checksum: with it fixed, the same file gives the same snapshot. Settings that can't make a snapshot are refused when the job is made. A job's input and results can't be edited afterwards; make a new job. `POST /api/taxonomy-imports/:id/run` or `runImport(req, id)` runs a job again: a finished one is left as it is, a failed one is tried again, and one still marked running is refused (409) until `imports.staleAfterMinutes` (default 15) have passed. Server code without a user runs jobs with `runImport(req, id, { overrideAccess: true })`. Set `imports.runOnCreate: false` to run jobs from your own queue instead.

Host pages can call `searchNames`, `ancestorsOf`, `descendantsOf`, `mrcaOf`, `coverageOf`, `exportSnapshot`, `projectedView` and `exportView` with a request (from `createLocalReq`). They apply the same access and return `{ ok, body }` or `{ ok: false, status, error }`.

Options: `slugs` (`snapshots`, `views`, `imports`), `access`, `tenant` (`collection`, `field`, `resolve`), `locale`, `limits`, `imports` (`uploads`, `fetch`, `maxBytes`, `staleAfterMinutes`, `runOnCreate`), `admin.group`.

## Limits

- A MongoDB document holds at most 16 MB, so very large snapshots can't be stored yet. Imports refuse files over `imports.maxBytes` (default 15 MB).
- An import runs in one request. A big file holds that request until it's done; run such jobs from a queue with `runOnCreate: false`.
- The default upload reader reads Payload's local storage (`staticDir`). For cloud storage, give `imports.uploads.read`.
- Two runs of the same job started at the same moment aren't prevented; the unique index stops a duplicate snapshot, but one of the two jobs may fail.
- The first question about a snapshot loads and checks the whole thing. Indexes for eight snapshots are kept in memory after that.
- A published view stays readable after its snapshot is withdrawn, flagged in the API (a proposal, see above). Payload's own reads of the view don't carry the flag yet.
- Payload's default edit views only: an import's progress, warnings and diagnostics show as JSON. Admin views, proposals and an example app are later parts.

## Commands

```sh
pnpm build      # dist/
pnpm typecheck
pnpm test       # starts an in-memory MongoDB per test file; needs the MongoDB binary cached, no network in the tests
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Source-available, not open source. Commercial use needs a separate license from Captive Origins.
