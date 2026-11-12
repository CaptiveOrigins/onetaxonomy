import type { Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { importsCollection, oneTaxonomy, proposalsCollection, resolveOptions, snapshotsCollection, viewsCollection } from '../src'
import { access, callEndpoint, makeUser, roleOf, sealed, startPayload, tenantsCollection, usersCollection, WITH_CONTENT } from './helpers'

const SNAPSHOTS = 'taxonomy-snapshots'
const PROPOSALS = 'taxonomy-proposals'
type Doc = Record<string, any>
let payload: Payload
let stop: () => Promise<void>
let tenantA: string | number
let managerA: TypedUser
let managerB: TypedUser
let ann: TypedUser // a reader in tenant A
let thrower: TypedUser
let published: string

// Made-up people: the host's person id for each user, and the name it shows for a person id now.
const ids = new Map<string, string>()
const names = new Map<string, string>()
let nameFails = false
// While true, the host lets visitors who aren't signed in read tenant A's published data, as a public site would.
let open = false

const tenantOfUser = (user: unknown) => {
  if (roleOf(user) === 'thrower') throw new Error('tenant lookup failed')
  const t = (user as { tenant?: unknown } | null | undefined)?.tenant
  return t && typeof t === 'object' ? ((t as { id: string | number }).id ?? null) : ((t as string | number | null | undefined) ?? null)
}
const summary = (id: string, user: TypedUser | null, query: Record<string, string | number> = {}) => callEndpoint(payload, SNAPSHOTS, '/:id/summary', id, query, user)
const preview = (id: unknown, user: TypedUser | null) => callEndpoint(payload, PROPOSALS, '/:id/preview', String(id), {}, user)
const store = async (user: TypedUser, status?: 'published', which: keyof typeof sealed = 'amniotes') => {
  const doc = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed[which]() } as never, user, overrideAccess: false })) as Doc
  if (status) await payload.update({ collection: SNAPSHOTS as never, id: doc.id, data: { status } as never, user, overrideAccess: false })
  return String(doc.id)
}

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({
    collections: [tenantsCollection, usersCollection(true)],
    plugins: [
      oneTaxonomy({
        access: { manage: access.manage, read: ({ req }) => (req.user ? access.read({ req }) : open) },
        tenant: { collection: 'tenants', resolve: ({ req }) => (req.user ? tenantOfUser(req.user) : open ? tenantA : null) },
        proposals: {
          personId: ({ req }) => ids.get(String(req.user?.id)) as string,
          displayName: ({ personId }) => {
            if (nameFails) throw new Error('directory down')
            return names.get(personId)
          },
        },
      }),
    ],
  }))
  tenantA = ((await payload.create({ collection: 'tenants' as never, data: { name: 'A' } as never })) as { id: string | number }).id
  const tenantB = ((await payload.create({ collection: 'tenants' as never, data: { name: 'B' } as never })) as { id: string | number }).id
  managerA = await makeUser(payload, 'manager', { tenant: tenantA })
  managerB = await makeUser(payload, 'manager', { tenant: tenantB })
  ann = await makeUser(payload, 'reader', { tenant: tenantA })
  thrower = await makeUser(payload, 'thrower', { tenant: tenantA })
  ;([[managerA, 'Cara Curator'], [managerB, 'Eli Curator'], [ann, 'Ann K.']] as const).forEach(([user, name], i) => {
    ids.set(String(user.id), `P-${2001 + i}`)
    names.set(`P-${2001 + i}`, name)
  })
  published = await store(managerA, 'published')
})
afterAll(async () => stop?.())

describe('a snapshot\'s summary', () => {
  it('tells a manager what the snapshot holds, without its content', async () => {
    const res = await summary(published, managerA)
    expect(res.status).toBe(200)
    const s = sealed.amniotes()
    expect(res.body).toMatchObject({
      snapshot: { doc: published, id: s.id, version: s.version, checksum: s.checksum, status: 'published', createdAt: s.createdAt },
      counts: { names: 8, concepts: 8, classifications: 1, phylogenies: 2, sources: 1 },
      sources: [{ id: 'fixture', title: 'OneTaxonomy illustrative fixture: amniote orders', license: 'CC0-1.0', illustrative: true }],
      classifications: [{ id: 'traditional', version: '1', placements: 7 }],
      phylogenies: [
        { id: 'archelosauria', rooted: true, nodes: 11 },
        { id: 'anapsid-turtles', rooted: true, nodes: 11 },
      ],
      truncated: false,
    })
    expect(res.body.classifications[0].roots).toBeGreaterThan(0)
    expect(res.body.phylogenies[0].tips).toBeGreaterThan(0)
    // A summary, not an export: no names, concepts, placements or tree nodes.
    expect(Object.keys(res.body).sort()).toEqual(['classifications', 'counts', 'phylogenies', 'snapshot', 'sources', 'truncated'])
    expect(JSON.stringify(res.body)).not.toMatch(/n:aves|c:aves|Aves/)
  })

  it('cuts its lists to the limit and says so, with the full numbers in counts', async () => {
    const res = await summary(published, managerA, { limit: 1 })
    expect(res.body.phylogenies).toHaveLength(1)
    expect(res.body.counts.phylogenies).toBe(2)
    expect(res.body.truncated).toBe(true)
    // Like the rest of the read API: less than one means one, a limit that isn't a number means the default, and a huge one is clamped.
    for (const limit of ['0', '-3']) expect((await summary(published, managerA, { limit })).body.phylogenies, limit).toHaveLength(1)
    for (const limit of ['x', '1e9']) expect((await summary(published, managerA, { limit })).body, limit).toMatchObject({ truncated: false, phylogenies: [{}, {}] })
  })

  it('answers 404 to anyone who may not read the snapshot, and for an id that isn\'t there', async () => {
    const own = await store(managerB) // tenant B's, staged
    const cases: [string, string, TypedUser | null][] = [
      ['a visitor', published, null],
      ['another tenant\'s manager', published, managerB],
      ['a reader, of a staged snapshot', own, ann],
      ['a user whose access check throws', published, thrower],
      ['an unknown id', '000000000000000000000000', managerA],
      ['an id that isn\'t one', 'not-an-id', managerA],
    ]
    for (const [who, id, user] of cases) expect(await summary(id, user), who).toEqual({ status: 404, body: { error: expect.any(String) } })
    expect((await summary(own, managerB)).body.snapshot.status).toBe('staged')
    expect((await summary(published, ann)).status).toBe(200)
  })

  it('refuses a stored snapshot that no longer matches its checksum', async () => {
    const doc = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.checklist() } as never, user: managerA, overrideAccess: false })) as Doc
    const model = (payload.db as unknown as { collections: Record<string, { updateOne: (q: unknown, u: unknown) => Promise<unknown> }> }).collections[SNAPSHOTS]!
    await model.updateOne({ _id: doc.id }, { $set: { 'snapshot.title': 'Changed behind the plugin\'s back' } })
    const res = await summary(String(doc.id), managerA)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.stringMatching(/checksum/i) })
  })
})

describe('a snapshot made from an accepted proposal', () => {
  let made: string
  let proposal: Doc

  beforeAll(async () => {
    proposal = (await payload.create({
      collection: PROPOSALS as never,
      data: { snapshot: published, proposal: { title: 'Birds are reptiles', base: { kind: 'classification', id: 'traditional', version: '1' }, moves: [{ node: 'c:aves', from: null, to: 'c:reptilia', note: 'Birds nest inside reptiles' }] } } as never,
      user: ann,
      overrideAccess: false,
      depth: 0,
    })) as Doc
    proposal = (await payload.update({ collection: PROPOSALS as never, id: proposal.id, data: { status: 'shared' } as never, user: ann, overrideAccess: false, depth: 0 })) as Doc
  })

  it('previews with names for the ids it lists, and says who may decide', async () => {
    const asAuthor = await preview(proposal.id, ann)
    expect(asAuthor.status).toBe(200)
    expect(asAuthor.body.labels).toMatchObject({ 'c:aves': 'Aves', 'c:reptilia': 'Reptilia' })
    // Every id the lists name has a label here, or the fixture has no name for it.
    for (const m of asAuthor.body.moved) expect(asAuthor.body.labels[m.node], m.node).toEqual(expect.any(String))
    expect(asAuthor.body.mayDecide).toBe(false)
    expect((await preview(proposal.id, managerA)).body.mayDecide).toBe(true)
    // A manager elsewhere doesn't learn that it exists, let alone decide it.
    expect((await preview(proposal.id, managerB)).status).toBe(404)
  })

  it('shows the sealed person ids, with names looked up for signed-in people only and never stored', async () => {
    const accepted = await callEndpoint(payload, PROPOSALS, '/:id/accept', String(proposal.id), {}, managerA, { version: '2', checksum: proposal.checksum })
    expect(accepted.status).toBe(200)
    made = accepted.body.snapshot.doc

    const asManager = await summary(made, managerA)
    expect(asManager.body.snapshot).toMatchObject({ version: '2', status: 'staged' })
    expect(asManager.body.derivedFrom).toMatchObject({
      version: '1',
      proposal: { title: 'Birds are reptiles', author: 'P-2003', authorName: 'Ann K.', acceptedBy: 'P-2001', acceptedByName: 'Cara Curator', classification: { id: 'traditional', version: '1' }, moved: 1 },
    })

    // The name shown is the one the host gives now: nothing was kept from the day it was accepted.
    names.set('P-2003', 'Ann Kowalczyk')
    expect((await summary(made, managerA)).body.derivedFrom.proposal.authorName).toBe('Ann Kowalczyk')
    names.delete('P-2003')
    const gone = (await summary(made, managerA)).body.derivedFrom.proposal
    expect(gone).toMatchObject({ author: 'P-2003', acceptedByName: 'Cara Curator' })
    expect(gone).not.toHaveProperty('authorName')
    nameFails = true
    const down = (await summary(made, managerA)).body.derivedFrom.proposal
    nameFails = false
    expect(down).toMatchObject({ author: 'P-2003', acceptedBy: 'P-2001' })
    expect(down).not.toHaveProperty('authorName')
    expect(down).not.toHaveProperty('acceptedByName')
    names.set('P-2003', 'Ann K.')

    // No name, and no email address, in what is stored.
    const kept = JSON.stringify(await payload.findByID({ collection: SNAPSHOTS as never, id: made, depth: 0, select: WITH_CONTENT }))
    expect(kept).not.toMatch(/Ann K|Cara Curator|Kowalczyk|@/)
    expect(kept).toContain('P-2003')
  })

  it('gives a visitor who may read it the ids and no names', async () => {
    await payload.update({ collection: SNAPSHOTS as never, id: made, data: { status: 'published' } as never, user: managerA, overrideAccess: false })
    expect((await summary(made, null)).status).toBe(404)
    open = true
    try {
      const res = await summary(made, null)
      expect(res.status).toBe(200)
      expect(res.body.derivedFrom.proposal).toMatchObject({ author: 'P-2003', acceptedBy: 'P-2001' })
      expect(JSON.stringify(res.body)).not.toMatch(/Ann K|Cara Curator|@/)
      // The same visitor still can't see a staged snapshot.
      expect((await summary(await store(managerA, undefined, 'structures'), null)).status).toBe(404)
    } finally {
      open = false
    }
    expect((await summary(made, ann)).body.derivedFrom.proposal.authorName).toBe('Ann K.')
  })
})

describe('the panel field', () => {
  const panelOf = (c: { fields: unknown[] }) => c.fields.find((f) => (f as { type?: string }).type === 'ui') as { name: string; admin: { disableListColumn?: boolean; components: { Field: { path: string; clientProps: Record<string, unknown> } } } } | undefined
  const withAll = resolveOptions({ slugs: { snapshots: 'snaps' }, imports: { fetch: () => '', staleAfterMinutes: 7 }, proposals: true })

  it('is the first field of each collection and names its client component', () => {
    const cases = [
      [snapshotsCollection(withAll), 'SnapshotPanel', {}],
      [viewsCollection(withAll), 'ViewPanel', {}],
      [importsCollection(withAll), 'ImportPanel', { staleAfterMinutes: 7 }],
      [proposalsCollection(withAll), 'ProposalPanel', { limits: { version: 100, note: 2000 } }],
    ] as const
    for (const [collection, component, props] of cases) {
      const panel = panelOf(collection)
      expect(collection.fields[0], component).toBe(panel)
      expect(panel?.admin.disableListColumn).toBe(true)
      expect(panel?.admin.components.Field.path).toBe(`@captiveorigins/payload-plugin-onetaxonomy/client#${component}`)
      const sent = panel!.admin.components.Field.clientProps
      expect(sent).toEqual({ slugs: { snapshots: 'snaps', views: 'taxonomy-views', imports: 'taxonomy-imports', proposals: 'taxonomy-proposals' }, ...props })
      // Only plain values go to the browser: nothing of the host's options, callbacks or limits beyond these.
      expect(JSON.parse(JSON.stringify(sent))).toEqual(sent)
    }
  })

  it('is left out when the host turns panels off', () => {
    const off = resolveOptions({ admin: { panels: false }, imports: { fetch: () => '' }, proposals: true })
    for (const c of [snapshotsCollection(off), viewsCollection(off), importsCollection(off), proposalsCollection(off)]) expect(panelOf(c)).toBeUndefined()
    expect(resolveOptions({}).admin.panels).toBe(true)
    expect(resolveOptions({ admin: { group: 'Science' } }).admin).toEqual({ group: 'Science', panels: true })
  })
})
