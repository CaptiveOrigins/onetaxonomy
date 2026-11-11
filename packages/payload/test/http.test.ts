import { createView, indexDataset, verifySnapshot, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import { handleEndpoints, type Payload, type TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { oneTaxonomy } from '../src'
import { access, makeUser, roleOf, sealed, startPayload, tenantsCollection, usersCollection } from './helpers'

/**
 * The same plugin, reached the way a browser or another server reaches it: a real `Request` through Payload's own REST
 * router (`handleEndpoints`), signed in with a token from `/api/users/login`. The other test files call the endpoint
 * handlers directly; this one shows the routes exist, take their parameters from the URL and the body, and apply the
 * same access rules when the user comes from a token. No web server and no network: the router is called in-process.
 */
const SNAPSHOTS = 'taxonomy-snapshots'
const VIEWS = 'taxonomy-views'
const IMPORTS = 'taxonomy-imports'
const PROPOSALS = 'taxonomy-proposals'
const TREES = 'https://data.example.org/trees.nwk'
let payload: Payload
let stop: () => Promise<void>
let managerA: TypedUser
let managerB: TypedUser
let ann: TypedUser // a reader in tenant A
let ben: TypedUser // another reader in tenant A
let readerB: TypedUser
let snapA: string
let staged: string
let viewPublished: string
let viewDraft: string
const tokens = new Map<TypedUser, string>()

type Doc = Record<string, any>
type Answer = { status: number; headers: Headers; text: string; body: any }
const idOf = (v: unknown) => (v && typeof v === 'object' ? (v as { id: unknown }).id : v)
const tenantOfUser = (user: unknown) => {
  const t = (user as { tenant?: unknown } | null | undefined)?.tenant
  return t && typeof t === 'object' ? ((t as { id: string | number }).id ?? null) : ((t as string | number | null | undefined) ?? null)
}

/** One HTTP request to the REST API. `as` signs it with that user's token; `body` is sent as JSON unless it is a string. */
async function http(method: string, path: string, { as, body, token }: { as?: TypedUser | null; body?: unknown; token?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {}
  const jwt = token ?? (as ? tokens.get(as) : undefined)
  if (jwt) headers.Authorization = `JWT ${jwt}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const request = new Request(`http://localhost/api${path}`, { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) })
  const res = await handleEndpoints({ config: payload.config, request })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  return { status: res.status, headers: res.headers, text, body: parsed }
}
const get = (path: string, as?: TypedUser | null) => http('GET', path, { as })
const everyoneElse = () => [readerB, managerB, null] as const

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({
    collections: [tenantsCollection, usersCollection(true)],
    plugins: [
      oneTaxonomy({
        access: { manage: access.manage, read: access.read },
        tenant: { collection: 'tenants', resolve: ({ req }) => tenantOfUser(req.user) },
        // Answered from memory: no network.
        imports: { fetch: ({ url }) => (url === TREES ? '[&R] ((Alpha:1,Beta:1):1,Gamma:2);' : Promise.reject(new Error('not allowed'))) },
        proposals: {
          personId: ({ req }) => `${roleOf(req.user) === 'manager' ? 'm' : 'r'}-${String(req.user?.id).slice(-6)}`,
          displayName: ({ personId }) => (personId.startsWith('m-') ? 'Cara Curator' : 'Robin Reader'),
        },
      }),
    ],
  }))
  const tenant = async (name: string) => ((await payload.create({ collection: 'tenants' as never, data: { name } as never })) as { id: string | number }).id
  const [tenantA, tenantB] = [await tenant('A'), await tenant('B')]
  managerA = await makeUser(payload, 'manager', { tenant: tenantA })
  managerB = await makeUser(payload, 'manager', { tenant: tenantB })
  ann = await makeUser(payload, 'reader', { tenant: tenantA })
  ben = await makeUser(payload, 'reader', { tenant: tenantA })
  readerB = await makeUser(payload, 'reader', { tenant: tenantB })
  // Sign in over HTTP too, so the token is the one a browser would hold.
  for (const user of [managerA, managerB, ann, ben, readerB]) {
    const res = await http('POST', '/users/login', { body: { email: (user as unknown as { email: string }).email, password: 'a-long-test-password' } })
    if (res.status !== 200 || typeof res.body?.token !== 'string') throw new Error(`Sign-in failed: ${res.status} ${res.text}`)
    tokens.set(user, res.body.token)
  }
  const make = async (collection: string, data: Record<string, unknown>) => String(((await payload.create({ collection: collection as never, data: data as never, user: managerA, overrideAccess: false })) as Doc).id)
  const publish = (collection: string, id: string) => payload.update({ collection: collection as never, id, data: { status: 'published' } as never, user: managerA, overrideAccess: false })
  snapA = await make(SNAPSHOTS, { snapshot: sealed.amniotes() })
  await publish(SNAPSHOTS, snapA)
  staged = await make(SNAPSHOTS, { snapshot: sealed.structures() })
  const index = indexDataset(sealed.amniotes())
  viewPublished = await make(VIEWS, { title: 'Turtles with archosaurs', snapshot: snapA, view: createView(index, { id: 'v-turtles', title: 'Turtles with archosaurs', target: { kind: 'phylogeny', id: 'archelosauria' } }) })
  await publish(VIEWS, viewPublished)
  viewDraft = await make(VIEWS, { title: 'Draft', snapshot: snapA, view: createView(index, { id: 'v-draft', title: 'Draft', target: { kind: 'classification', id: 'traditional' } }) })
})
afterAll(async () => stop?.())

describe('over HTTP: who you are comes from the token', () => {
  it('lists a reader only the published snapshots of their own tenant, and an anonymous request nothing', async () => {
    const mine = await get(`/${SNAPSHOTS}?depth=0`, ann)
    expect(mine.status).toBe(200)
    expect(mine.body.docs.map((d: Doc) => String(d.id))).toEqual([snapA])
    const managed = await get(`/${SNAPSHOTS}?depth=0&limit=50`, managerA)
    expect(managed.body.docs.map((d: Doc) => String(d.id)).sort()).toEqual([snapA, staged].sort())
    for (const user of [readerB, managerB]) expect((await get(`/${SNAPSHOTS}?depth=0`, user)).body.docs).toEqual([])
    const anonymous = await get(`/${SNAPSHOTS}?depth=0`)
    expect(anonymous.status).toBe(403)
    expect(anonymous.text).not.toContain('fixture-amniotes')
    // A staged snapshot by its id: the same answer as one that doesn't exist.
    expect((await get(`/${SNAPSHOTS}/${staged}`, ann)).status).toBe(404)
    expect((await get(`/${SNAPSHOTS}/${staged}`, managerA)).status).toBe(200)
  })

  it('treats a token that isn\'t one, or is for nobody, as anonymous', async () => {
    for (const token of ['not-a-token', `${tokens.get(ann)!.slice(0, -4)}AAAA`]) {
      const res = await http('GET', `/${SNAPSHOTS}/${snapA}/search?q=aves`, { token })
      expect(res.status).toBe(404)
      expect(res.text).not.toContain('Aves')
    }
  })

  it('refuses a reader writing through the standard routes', async () => {
    expect((await http('POST', `/${SNAPSHOTS}`, { as: ann, body: { snapshot: sealed.checklist() } })).status).toBe(403)
    expect((await http('PATCH', `/${SNAPSHOTS}/${snapA}`, { as: ann, body: { status: 'withdrawn' } })).status).toBe(403)
    expect((await http('DELETE', `/${SNAPSHOTS}/${staged}`, { as: ann })).status).toBe(403)
    for (const user of [managerB, null]) expect((await http('PATCH', `/${SNAPSHOTS}/${snapA}`, { as: user, body: { status: 'withdrawn' } })).status).toBeGreaterThanOrEqual(400)
    expect(((await payload.findByID({ collection: SNAPSHOTS as never, id: snapA, depth: 0 })) as Doc).status).toBe('published')
    expect(((await payload.findByID({ collection: SNAPSHOTS as never, id: staged, depth: 0 })) as Doc).status).toBe('staged')
  })
})

describe('over HTTP: the read endpoints', () => {
  it('routes each one, reads its parameters from the URL, and answers 404 to other tenants and anonymous requests', async () => {
    const calls: [string, (body: Doc) => void][] = [
      [`/${SNAPSHOTS}/${snapA}/search?q=aves`, (b) => expect(b.results).toEqual([expect.objectContaining({ concept: 'c:aves', name: 'Aves' })])],
      [`/${SNAPSHOTS}/${snapA}/ancestors?phylogeny=archelosauria&node=t-aves`, (b) => expect(b.items.map((i: Doc) => i.id)).toEqual(['archosauria', 'archelosauria', 'sauria', 'amniota'])],
      [`/${SNAPSHOTS}/${snapA}/descendants?phylogeny=archelosauria&node=sauria`, (b) => expect(b.items.map((i: Doc) => i.id)).toContain('t-testudines')],
      [`/${SNAPSHOTS}/${snapA}/mrca?phylogeny=archelosauria&nodes=t-aves,t-crocodylia`, (b) => expect(b.result).toMatchObject({ status: 'found' })],
      [`/${SNAPSHOTS}/${snapA}/coverage?classification=traditional`, (b) => expect(b.snapshot).toMatchObject({ id: 'fixture-amniotes' })],
      [`/${VIEWS}/${viewPublished}/projection`, (b) => expect(b.source).toMatchObject({ id: 'fixture-amniotes', withdrawn: false })],
      [`/${VIEWS}/${viewPublished}/export`, (b) => expect(b.view).toMatchObject({ id: 'v-turtles' })],
    ]
    for (const [path, check] of calls) {
      const res = await get(path, ann)
      expect(res.status, path).toBe(200)
      check(res.body)
      for (const user of everyoneElse()) {
        const other = await get(path, user)
        expect(other.status, path).toBe(404)
        expect(other.text, path).not.toMatch(/aves|amniotes|turtles/i)
      }
    }
  })

  it('answers 400 for a missing parameter, bounds a limit from the URL, and answers 404 for a staged snapshot or a draft view', async () => {
    expect((await get(`/${SNAPSHOTS}/${snapA}/search`, ann)).status).toBe(400)
    // A limit in the URL is honoured, and one that isn't a number falls back to the default; neither can ask for everything.
    const one = await get(`/${SNAPSHOTS}/${snapA}/descendants?phylogeny=archelosauria&node=sauria&limit=1`, ann)
    expect(one.body).toMatchObject({ truncated: true, items: [{ id: 'lepidosauria' }] })
    expect((await get(`/${SNAPSHOTS}/${snapA}/search?q=aves&limit=abc`, ann)).body.results).toHaveLength(1)
    expect((await get(`/${SNAPSHOTS}/${snapA}/coverage`, ann)).status).toBe(400)
    expect((await get(`/${SNAPSHOTS}/${staged}/search?q=exemplum`, ann)).status).toBe(404)
    expect((await get(`/${SNAPSHOTS}/${staged}/search?q=exemplum`, managerA)).status).toBe(200)
    expect((await get(`/${VIEWS}/${viewDraft}/projection`, ann)).status).toBe(404)
    expect((await get(`/${VIEWS}/${viewDraft}/projection`, managerA)).status).toBe(200)
    expect((await get(`/${SNAPSHOTS}/not-an-id/search?q=aves`, ann)).status).toBe(404)
  })

  it('downloads a published snapshot exactly as sealed, as an attachment', async () => {
    const res = await get(`/${SNAPSHOTS}/${snapA}/export`, ann)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[\w.-]+\.json"$/)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(res.body).toEqual(sealed.amniotes())
    expect(verifySnapshot(res.body as DatasetSnapshot)).toBe(true)
    for (const user of everyoneElse()) expect((await get(`/${SNAPSHOTS}/${snapA}/export`, user)).status).toBe(404)
    expect((await get(`/${SNAPSHOTS}/${staged}/export`, ann)).status).toBe(404)
  })

  it('has no write hiding behind a read route', async () => {
    for (const path of [`/${SNAPSHOTS}/${snapA}/search?q=aves`, `/${SNAPSHOTS}/${snapA}/export`, `/${VIEWS}/${viewPublished}/projection`]) {
      for (const method of ['POST', 'PUT', 'DELETE']) expect((await http(method, path, { as: managerA })).status, `${method} ${path}`).toBeGreaterThanOrEqual(400)
    }
    expect(((await payload.findByID({ collection: SNAPSHOTS as never, id: snapA, depth: 0 })) as Doc).status).toBe('published')
    expect((await get(`/${VIEWS}/${viewPublished}/projection`, ann)).status).toBe(200)
  })
})

describe('over HTTP: imports', () => {
  const settings = { snapshot: { id: 'http-trees', version: '1', createdAt: '2026-11-11T00:00:00.000Z' }, source: { id: 'http-trees', title: 'Illustrative trees', illustrative: true }, options: { id: 'http-tree', version: '1' } }

  it('lets a manager make and re-run a job, and nobody else see or run it', async () => {
    for (const user of [ann, null]) expect((await http('POST', `/${IMPORTS}`, { as: user, body: { format: 'newick', url: TREES, settings } })).status).toBe(403)
    const made = await http('POST', `/${IMPORTS}`, { as: managerA, body: { format: 'newick', url: TREES, settings } })
    expect(made.status).toBe(201)
    expect(made.body.doc).toMatchObject({ status: 'done' })
    const job = String(made.body.doc.id)
    const snap = (await payload.findByID({ collection: SNAPSHOTS as never, id: idOf(made.body.doc.snapshot) as string, depth: 0 })) as Doc
    expect(snap).toMatchObject({ status: 'staged', snapshotId: 'http-trees' })
    for (const user of [ann, managerB, readerB, null]) expect((await http('POST', `/${IMPORTS}/${job}/run`, { as: user })).status).toBe(404)
    const again = await http('POST', `/${IMPORTS}/${job}/run`, { as: managerA })
    expect(again.status).toBe(200)
    expect(((await payload.findByID({ collection: IMPORTS as never, id: job, depth: 0 })) as Doc).attempts).toBe(made.body.doc.attempts)
    // Running is a POST: a GET of the same path runs nothing.
    expect((await get(`/${IMPORTS}/${job}/run`, managerA)).status).toBeGreaterThanOrEqual(400)
    expect((await get(`/${IMPORTS}?depth=0`, ann)).status).toBe(403)
  })
})

describe('over HTTP: proposals', () => {
  const birds = { node: 'c:aves', from: null, to: 'c:reptilia' }
  const draft = { title: 'Birds are reptiles', base: { kind: 'classification', id: 'traditional', version: '1' }, moves: [birds] }
  let p: Doc

  it('stores a proposal as the signed-in person\'s, whatever the body claims', async () => {
    expect((await http('POST', `/${PROPOSALS}`, { body: { snapshot: snapA, proposal: draft } })).status).toBe(403)
    // A decision can't be written in at the start.
    expect((await http('POST', `/${PROPOSALS}?depth=0`, { as: ann, body: { snapshot: snapA, proposal: draft, decidedBy: String(ann.id), acceptedInto: snapA } })).status).toBe(400)
    const own = await http('POST', `/${PROPOSALS}?depth=0`, { as: ann, body: { snapshot: snapA, proposal: { ...draft, author: 'Someone Else', id: 'chosen-id' }, author: String(ben.id) } })
    expect(own.status).toBe(201)
    p = own.body.doc
    expect(p).toMatchObject({ status: 'private', author: String(ann.id) })
    expect(p.decidedBy ?? null).toBeNull()
    expect(p.acceptedInto ?? null).toBeNull()
    expect(p.proposal.author).toMatch(/^r-[0-9a-f]{6}$/)
    expect(p.proposal.id).not.toBe('chosen-id')
    // Private: nobody else gets it, by list, by id or by preview.
    for (const user of [ben, managerA, managerB, null]) {
      const list = await get(`/${PROPOSALS}?depth=0`, user)
      expect(list.body?.docs ?? []).toEqual([])
      expect((await get(`/${PROPOSALS}/${p.id}`, user)).status).toBeGreaterThanOrEqual(403)
      expect((await get(`/${PROPOSALS}/${p.id}/preview`, user)).status).toBe(404)
    }
  })

  it('shares it, previews it, and lets only a manager of its tenant decide', async () => {
    for (const forged of [{ status: 'accepted' }, { decidedBy: String(ann.id) }, { author: String(ben.id) }]) expect((await http('PATCH', `/${PROPOSALS}/${p.id}`, { as: ann, body: forged })).status, JSON.stringify(forged)).toBeGreaterThanOrEqual(400)
    const sharedNow = await http('PATCH', `/${PROPOSALS}/${p.id}?depth=0`, { as: ann, body: { status: 'shared' } })
    expect(sharedNow.status).toBe(200)
    p = sharedNow.body.doc
    expect(p.status).toBe('shared')
    const seenByBen = await get(`/${PROPOSALS}/${p.id}/preview?limit=5`, ben)
    expect(seenByBen).toMatchObject({ status: 200, body: { acceptable: true, proposal: { status: 'shared', checksum: p.checksum }, moved: [birds] } })
    for (const user of everyoneElse()) expect((await get(`/${PROPOSALS}/${p.id}/preview`, user)).status).toBe(404)

    const body = { version: '2', checksum: p.checksum, createdAt: '2026-11-11T12:00:00.000Z' }
    for (const user of [ann, ben, managerB, readerB, null]) {
      expect((await http('POST', `/${PROPOSALS}/${p.id}/accept`, { as: user, body })).status).toBe(404)
      expect((await http('POST', `/${PROPOSALS}/${p.id}/decline`, { as: user, body: {} })).status).toBe(404)
    }
    // A manager who doesn't say what they are accepting is refused, and nothing is stored.
    const count = (await payload.count({ collection: SNAPSHOTS as never })).totalDocs
    expect((await http('POST', `/${PROPOSALS}/${p.id}/accept`, { as: managerA, body: '{ not json' })).status).toBe(400)
    expect((await http('POST', `/${PROPOSALS}/${p.id}/accept`, { as: managerA })).status).toBe(400)
    expect((await http('POST', `/${PROPOSALS}/${p.id}/accept`, { as: managerA, body: { ...body, checksum: 'sha256:0' } })).status).toBeGreaterThanOrEqual(400)
    expect((await get(`/${PROPOSALS}/${p.id}/accept`, managerA)).status).toBeGreaterThanOrEqual(400)
    expect((await payload.count({ collection: SNAPSHOTS as never })).totalDocs).toBe(count)
    expect(((await payload.findByID({ collection: PROPOSALS as never, id: p.id, depth: 0 })) as Doc).status).toBe('shared')
  })

  it('accepts into a staged version that readers don\'t see, and keeps the accepted proposal', async () => {
    const res = await http('POST', `/${PROPOSALS}/${p.id}/accept`, { as: managerA, body: { version: '2', checksum: p.checksum, createdAt: '2026-11-11T12:00:00.000Z' } })
    expect(res).toMatchObject({ status: 200, body: { proposal: { status: 'accepted' }, snapshot: { id: 'fixture-amniotes', version: '2', status: 'staged' } } })
    const made = String(res.body.snapshot.doc)
    expect((await get(`/${SNAPSHOTS}?depth=0`, ann)).body.docs.map((d: Doc) => String(d.id))).toEqual([snapA])
    expect((await get(`/${SNAPSHOTS}/${made}`, ann)).status).toBe(404)
    expect((await get(`/${SNAPSHOTS}/${made}/export`, ann)).status).toBe(404)
    const content = (await get(`/${SNAPSHOTS}/${made}/export`, managerA)).body as DatasetSnapshot
    expect(verifySnapshot(content)).toBe(true)
    expect(content.derivedFrom?.proposal).toMatchObject({ author: `r-${String(ann.id).slice(-6)}`, acceptedBy: `m-${String(managerA.id).slice(-6)}` })
    expect(JSON.stringify(content)).not.toMatch(/Cara Curator|Robin Reader/)
    // Readers see that it was accepted, without who decided or where it went.
    const seen = (await get(`/${PROPOSALS}/${p.id}?depth=0`, ben)).body as Doc
    expect(seen.status).toBe('accepted')
    // The author's name is looked up for the response; the proposal itself holds their id.
    expect(seen).toMatchObject({ authorName: 'Robin Reader', proposal: { author: `r-${String(ann.id).slice(-6)}` } })
    expect(seen).not.toHaveProperty('decidedBy')
    expect(seen).not.toHaveProperty('acceptedInto')
    // Kept: no change and no delete, for its author or a manager.
    for (const user of [ann, managerA]) {
      expect((await http('PATCH', `/${PROPOSALS}/${p.id}`, { as: user, body: { status: 'private' } })).status).toBeGreaterThanOrEqual(400)
      expect((await http('DELETE', `/${PROPOSALS}/${p.id}`, { as: user })).status).toBeGreaterThanOrEqual(400)
    }
    expect((await http('POST', `/${PROPOSALS}/${p.id}/accept`, { as: managerA, body: { version: '3', checksum: p.checksum } })).status).toBe(409)
    expect(((await payload.findByID({ collection: PROPOSALS as never, id: p.id, depth: 0 })) as Doc).status).toBe('accepted')
  })

  it('declines with a note the author can read', async () => {
    const mammals = { snapshot: snapA, proposal: { ...draft, title: 'Mammals are reptiles', moves: [{ node: 'c:mammalia', from: null, to: 'c:reptilia' }] } }
    // A new proposal starts private: one that asks to be shared, or decided, at once is refused.
    for (const status of ['shared', 'accepted']) expect((await http('POST', `/${PROPOSALS}?depth=0`, { as: ben, body: { ...mammals, status } })).status).toBe(400)
    const made = await http('POST', `/${PROPOSALS}?depth=0`, { as: ben, body: mammals })
    expect(made.status).toBe(201)
    const d = made.body.doc as Doc
    expect(d.status).toBe('private')
    expect((await http('PATCH', `/${PROPOSALS}/${d.id}`, { as: ben, body: { status: 'shared' } })).status).toBe(200)
    expect((await http('POST', `/${PROPOSALS}/${d.id}/decline`, { as: managerA, body: { note: 7 } })).status).toBe(400)
    const res = await http('POST', `/${PROPOSALS}/${d.id}/decline`, { as: managerA, body: { note: 'Needs a reference' } })
    expect(res).toMatchObject({ status: 200, body: { proposal: { status: 'declined' } } })
    expect((await get(`/${PROPOSALS}/${d.id}?depth=0`, ben)).body).toMatchObject({ status: 'declined', decisionNote: 'Needs a reference' })
    expect((await get(`/${PROPOSALS}/${d.id}`, ann)).status).toBeGreaterThanOrEqual(403)
    expect((await http('DELETE', `/${PROPOSALS}/${d.id}`, { as: ben })).status).toBe(200)
  })
})
