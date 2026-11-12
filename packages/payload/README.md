# @captiveorigins/payload-plugin-onetaxonomy

OneTaxonomy for Payload: sealed taxonomy snapshots, views pinned to them, import jobs that turn source files into staged snapshots, people's own proposals that a manager can accept into a new staged version, and a small read API for search, ancestors, descendants, MRCA, coverage, projected views and exports, all behind your own access rules.

> **Status: early, parts 1 to 5 of M7.** Not on npm yet. The collections, publishing, tenant scope, import jobs, proposals, the read endpoints and the admin panels work. The server side is tested on a real Payload 3.93 with an in-memory MongoDB (162 tests): bad checksums refused, sealed snapshots locked, a snapshot's content left out of every read that doesn't name it, an import of each format, re-runs that store nothing new, malformed files refused with their line, interrupted jobs resumed, runs started together claimed by one, every endpoint's results, a view's `source` through the Local API and GraphQL, proposals kept private, shared, accepted into a staged version once and declined, access refusals and cross-tenant denial. Thirteen of those tests send real requests through Payload's own REST router, signed in with a token from the login route; the rest call the endpoint handlers and the Local API directly. It also runs in a small real site, [`apps/payload-example`](../../apps/payload-example) (Next.js 16, on this machine only), where 74 more checks go over HTTP with sign-in cookies. The [admin panels](#admin-panels) have 76 tests in jsdom, and a script clicks through all four in headless Chrome on that site (40 checks, outside CI); no screen reader, Safari or Firefox has been tried on them. It hasn't run on a deployed site, or on Postgres or SQLite, and no URL import has fetched over a real network. See [ADR 0012](../../docs/architecture/adr/0012-payload-plugin.md).

## What it does

- **Snapshots** (`taxonomy-snapshots`): one document per sealed `DatasetSnapshot`, stored whole. A snapshot without a checksum, with a checksum that doesn't match, of another schema version, or with validation errors is refused. Its content never changes after that, not even from server code. The same id and version can't be stored twice. The checksum is checked again the first time the API reads it, and a snapshot changed in the database is refused (500), not answered from. A read answers without the content unless it asks for it by name: see [Reading a snapshot's content](#reading-a-snapshots-content).
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
        displayName: ({ personId }) => handleOf(personId),  // optional; the name shown beside a person's id, looked up when shown, never stored
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

## Reading a snapshot's content

A snapshot's document holds its content in the `snapshot` field, and that can be 15 MB. So a read answers without that field unless it names it. A list of snapshots, a view with its snapshot filled in, and the admin's pages all name nothing, and none of them carries the content.

- **REST:** `GET /api/taxonomy-snapshots/:id` answers with every field except `snapshot`. Add `?select[snapshot]=true` for the content, and name any other field you want with it.
- **Local API:** `payload.findByID({ collection: 'taxonomy-snapshots', id, select: { snapshot: true } })`. `find` is the same, and so is what `create`, `update` and `delete` answer with.
- **GraphQL:** `snapshot` is `null` in a plain query. Pass Payload's `select: true` argument, which reads the fields the query names: `TaxonomySnapshot(id: "…", select: true) { checksum snapshot }`.
- **Export:** `GET /api/taxonomy-snapshots/:id/export` and `exportSnapshot(req, id)` still give the whole sealed snapshot, after its checksum is checked. The search, ancestors and other endpoints read the content themselves.

Only a read with no `select` at all is changed. One that names its own is left exactly as asked, so `select: { status: true }` gives the status, and `select: { status: false }` gives everything but the status, content included.

This is about weight, not secrecy: whoever may read a snapshot may ask for its content. Hooks you add that run after a read or a change (`afterRead`, `afterChange`, `afterDelete`) get the document the same way, without `snapshot` unless the caller selected it. A `beforeChange` hook's `originalDoc` is still whole. The lock on sealed content doesn't rely on any of this. An update is still compared with the stored document, read whole.

## Proposals

Turn them on with `proposals: true` or `proposals: { personId, displayName, maxMoves, maxPerUser }`.

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

The plugin sets the proposal's id, its author (a person id, below) and its date, and drops anything else sent with it. A proposal that doesn't fit its snapshot (an unknown node, a move from a parent the node doesn't have, a cycle) is refused with the reason.

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

**People are recorded by id, never by name.** A proposal's author and the manager who accepts it are stored as a person id. When a proposal is accepted, those two ids are sealed into the new snapshot, inside its checksum, and can't be taken out later. An id that means nothing on its own leaves nothing personal there.

- `personId({ req })` gives the id. The default is the signed-in user's document id. Give your own if you have a steadier one, or more than one auth collection (two collections can hold the same id).
- An id is 1 to 64 characters: letters, digits, `.`, `_`, `:` and `-`, starting with a letter or digit. An email address, or a name with a space in it, is refused: the action stops, nothing is saved, and the value is not written to the log. A one-word handle would pass, so don't give one. The plugin can't tell it from an id.
- `displayName({ req, personId })` gives the name to show for an id. It is looked up each time a proposal is read (once per person per request) and comes back as `authorName` on the proposal and in the preview. It is never stored and never sealed, and anything sent as `authorName` is dropped. If it gives nothing or throws, the id is shown alone.

A proposal's title and notes, each move's note and the manager's note are people's own words. On acceptance the title, the moves' notes and the manager's note are sealed into the snapshot, and the proposal itself is kept as it was. Don't put anything personal in them. The plugin doesn't check.

**When someone leaves.** Your server code can take back their shared proposals (`status: 'private'`) and delete their private and declined ones. Their accepted proposals stay, and so does their id in the snapshot. Stop giving a name for that id from `displayName`, and nothing shown names them. The accepted proposal's document still holds their user document's id, as text (`author`, and `decidedBy` for a manager). Nothing written through Payload can change those two, your own server code through the Local API included, and there is no option to allow it. The lock is a hook, so it doesn't cover a write made straight to the database. If your rules move a departed person's records to another account, change `author` and `decidedBy` there, in your own code, and change nothing else: leave `proposal` (it holds the sealed person id), `checksum` and the snapshot exactly as they are, or the proposal stops matching the version made from it. A test does this on MongoDB and checks that the proposal and the snapshot still verify. Otherwise keep or delete the user document as your own rules say; the two fields are plain text, so the database doesn't mind an id whose document is gone.

Options: `slugs` (`snapshots`, `views`, `imports`, `proposals`), `access` (`read`, `manage`, `propose`), `tenant` (`collection`, `field`, `resolve`), `locale`, `limits`, `imports` (`uploads`, `fetch`, `maxBytes`, `staleAfterMinutes`, `runOnCreate`), `proposals` (`personId`, `displayName`, `maxMoves` default 500, `maxPerUser` default 200, not counting accepted ones), `admin` (`group`, `panels`).

## Admin panels

Each of the plugin's collections gets a panel at the top of its edit page. It is on unless you set `admin: { panels: false }`.

- **Snapshot.** Status in words, the dataset, version, checksum and date, how many names, concepts, classifications, phylogenies and sources it holds, a table of its classifications and phylogenies, and its sources with their licenses. A snapshot made by accepting a proposal says which proposal, who proposed it and who accepted it. A manager gets **Publish this snapshot** on a staged one and **Withdraw this snapshot** on a published one. The page doesn't load the snapshot's content, and there is no content field on it: that field is on the new-snapshot form only, where a sealed snapshot is pasted in. To look at a stored snapshot's content, use the export.
- **View.** Status, the snapshot it is drawn over and that snapshot's status, a drawing of the saved view (the first 200 nodes) with the same tree as an outline for the keyboard, and the lines readers are told about it. **Publish this view** waits until the form is saved and the snapshot is published, and says which it is waiting for.
- **Import job.** The steps of the run with the one it is on, the result, the adapter's warnings and the diagnostics with their line or position. While a job is running the panel asks again every 3 seconds. A manager gets **Run this import** on a queued job and **Run it again** on a failed one, and on a running one only after `imports.staleAfterMinutes`.
- **Proposal.** Whose it is, what it is drawn over, and what it would change: taxa with a new parent, groups that gain or lose members, groups only one side has. A manager gets **Accept this proposal**, which asks for the new version's name and an optional note, and **Decline this proposal**, which asks for a note the author will see.

The form under a panel doesn't repeat it. A snapshot's `label`, `snapshotId`, `version`, `checksum` and `counts`, and an import job's `message`, `checksum`, `inputSha256`, `diagnostics`, `warnings`, `warningCount` and `progress`, are hidden in the form (`admin.hidden`). They are still in the form's data, in the API, and available as columns in the list.

Publish, Withdraw, Accept and Decline ask first, in the page, and say what can't be undone. Nothing is sent until you confirm. Running an import doesn't ask: the most it does is store a staged snapshot, which only managers see and which can be deleted. If the site refuses, the panel says "Nothing was changed." and gives the site's reason. Before a proposal is accepted the panel lists what gets sealed into the new version for good (the title, the notes, your note, the date and the two person ids) and asks you to check none of it holds personal details.

The panels are a page over the same API as everything else. They run in the browser and call your own site as the signed-in person, so your `access` callbacks decide every answer, and a button the panel shows by mistake still gets a 403 or 404. They add one endpoint, `GET /api/taxonomy-snapshots/:id/summary` (and `summarizeSnapshot(req, id)`): the counts, tables and sources above, with each list capped by `limit` (default 20), never the names or trees themselves. It answers the same 404 as the other endpoints.

A person's name appears beside their id only if you give `proposals.displayName`, only to a signed-in requester, and it is looked up each time the page loads. It is never stored.

A panel reads from the site again after Payload's own Save, so it shows what was saved and not what was there when the page opened.

**Setting up.** The panels need `@payloadcms/ui` and `react`, which a Payload admin already has. Payload finds them through its import map, so regenerate it after adding the plugin or changing `admin.panels`:

```sh
npx payload generate:importmap
```

Without that the edit pages load with nothing where the panel should be, and Payload logs `PayloadComponent not found in importMap`.

**Colours.** The panels take their colours from Payload's theme variables, so they follow the admin's light and dark themes and a host's own theme. A status is always a word with a coloured edge, never colour alone. A test reads the installed `@payloadcms/ui` stylesheets and checks that text and muted text reach 4.5:1 and control edges 3:1 in both themes.

**What was checked.** 76 tests render the panels in jsdom with Payload's hooks and `fetch` replaced by stand-ins: which buttons each person gets, that nothing is sent before the confirm, what a refusal says, and where Escape and the focus go. The example site's smoke test checks over HTTP that the built admin pages carry the panels and that the routes they call refuse a member. The example site's `click-through` script also does a curator's work in headless Chrome, in light and dark (40 checks): publishing a snapshot with the keyboard, the wait on an unsaved view, running an import to Done, a failed one again, and one over a file imported already, renaming a finished job with Payload's own Save, accepting a proposal into a new version, storing a sealed snapshot by pasting it into the new-snapshot form, and Payload's own Save on a stored snapshot, which sent the status and no content. It needs Chrome and the network, so it is not in CI. Its first run on the import pages found the panel's paragraphs and lists sitting flush against each other in the real admin, which jsdom can't see; that is fixed, and the script now measures the gaps. Not checked: a screen reader, Safari, Firefox, a phone, or a custom Payload theme.

**What Payload's own admin asks other sites for.** The panels ask only your site. Payload's JSON field loads its code editor (Monaco) from cdn.jsdelivr.net, and its default avatar asks gravatar.com with a hash of the signed-in person's email address. Both are Payload's. The editor loads on pages with a JSON field you can see: the new-snapshot form and the view, import and proposal pages. A stored snapshot's page has none, so it doesn't ask. The avatar is asked for on every admin page; set `admin.avatar: 'default'` in your Payload config to stop it.

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
- The panels sit on Payload's default edit pages; there are no list views, no tree authoring and no page for making a proposal in the admin. A proposal is still made through the API, or in the React explorer.
- A stored snapshot's content can't be looked at in the admin. The panel shows what it holds; the export endpoint gives the content.
- Code that reads `doc.snapshot` has to select it, in a read and in an after-hook alike. See [Reading a snapshot's content](#reading-a-snapshots-content).
- The panels haven't been run with a screen reader, in Safari or Firefox, or on a phone. See [Admin panels](#admin-panels) for what was checked.

## Commands

```sh
pnpm build      # dist/
pnpm typecheck
pnpm test       # starts an in-memory MongoDB per test file; needs the MongoDB binary cached, no network in the tests
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Source-available, not open source. Commercial use needs a separate license from Captive Origins.
