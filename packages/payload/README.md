# @captiveorigins/payload-plugin-onetaxonomy

OneTaxonomy for Payload: sealed taxonomy snapshots, views pinned to them, and a small read API for name search, ancestors, descendants and MRCA, all behind your own access rules.

> **Status: early, part 1 of M7.** Not on npm yet. The two collections, publishing, tenant scope and the four read endpoints work, and are tested on a real Payload 3.93 with an in-memory MongoDB (46 tests): bad checksums refused, sealed snapshots locked, search, ancestors, descendants and MRCA results, access refusals, and cross-tenant denial. It hasn't run in a real Payload site, through Payload's HTTP routing (the tests call the endpoint handlers directly), or on Postgres. No admin views, import jobs or proposals yet. See [ADR 0012](../../docs/architecture/adr/0012-payload-plugin.md).

## What it does

- **Snapshots** (`taxonomy-snapshots`): one document per sealed `DatasetSnapshot`, stored whole. A snapshot without a checksum, with a checksum that doesn't match, of another schema version, or with validation errors is refused. Its content never changes after that, not even from server code. The same id and version can't be stored twice. The checksum is checked again the first time the API reads it, and a snapshot changed in the database is refused (500), not answered from.
- **Staged, published, withdrawn.** New snapshots are staged, seen only by managers. Publishing needs a signed-in person and records who and when. Withdrawn hides it from readers. Nothing moves back, and only staged snapshots can be deleted.
- **Views** (`taxonomy-views`): a OneTaxonomy view over one snapshot. It must pin that snapshot's id, version and checksum, and core's `validateView` must find no errors. Drafts can change; published views can't. A view is published only over a published snapshot.
- **Read API**, as the requester, with results capped:

  | Endpoint | Query | Answers |
  | --- | --- | --- |
  | `GET /api/taxonomy-snapshots/:id/search` | `q`, `limit`, `locale` | Concepts whose names equal or start with `q`, exact first. Every concept using a name is listed, synonyms are marked, and common names are searched only in the locale asked for. |
  | `GET …/:id/ancestors` | `classification` or `phylogeny`, `node`, `limit`, `maxDepth` | Ancestors, nearest first, with labels. |
  | `GET …/:id/descendants` | the same | Descendants, breadth first. |
  | `GET …/:id/mrca` | `phylogeny`, `nodes` (comma-separated) | Core's `findMRCA`: found, indeterminate (unrooted) or none (different trees), naming the hypothesis. |

  A snapshot that doesn't exist, that the requester can't read, or that belongs to another tenant is a 404, the same 404 every time. Unknown hierarchies and nodes are 404 too. Bad queries are 400, and so is MRCA on a classification, which makes no claim of common ancestry. In an unrooted phylogeny, ancestors and descendants answer `indeterminate` rather than following storage order.

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
      limits: { maxResults: 100, maxDepth: 100, maxMrcaNodes: 100 },
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

Host pages can call `searchNames`, `ancestorsOf`, `descendantsOf` and `mrcaOf` with a request (from `createLocalReq`). They apply the same access and return `{ ok, body }` or `{ ok: false, status, error }`.

Options: `slugs` (`snapshots`, `views`), `access`, `tenant` (`collection`, `field`, `resolve`), `locale`, `limits`, `admin.group`.

## Limits

- A MongoDB document holds at most 16 MB, so very large snapshots can't be stored yet.
- The first question about a snapshot loads and checks the whole thing. Indexes for eight snapshots are kept in memory after that.
- A published view stays readable after its snapshot is withdrawn.
- Payload's default edit views only. Admin views, import jobs, proposals, coverage, projected views, exports and an example app are later parts.

## Commands

```sh
pnpm build      # dist/
pnpm typecheck
pnpm test       # starts an in-memory MongoDB per test file; needs the MongoDB binary cached, no network in the tests
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Source-available, not open source. Commercial use needs a separate license from Captive Origins.
