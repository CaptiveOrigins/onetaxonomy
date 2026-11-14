import { createRequire } from 'node:module'

import { configToSchema } from '@payloadcms/graphql'
import { createView, indexDataset, sealSnapshot, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import { configToJSONSchema, createLocalReq, type Payload, type TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { oneTaxonomy } from '../src'
import { access, callEndpoint, makeUser, sealed, startPayload, unfrozen, usersCollection } from './helpers'

// Payload's own reads of a view (Local API here; REST runs the same find operations, and GraphQL is run for real
// below) must say what the plugin's endpoints say about the view's snapshot: its status, and whether it was withdrawn.

// The same copy of graphql that @payloadcms/graphql loads. Vite would pick graphql's other build, and graphql refuses
// a schema made by a different copy of itself.
const { graphql } = createRequire(import.meta.url)('graphql') as typeof import('graphql')

const SNAPSHOTS = 'taxonomy-snapshots'
const VIEWS = 'taxonomy-views'
type Doc = Record<string, any>

let payload: Payload
let stop: () => Promise<void>
let manager: TypedUser
let reader: TypedUser
const snapshots: Record<string, string> = {}
const views: Record<string, string> = {}

const versioned = (version: string) => {
  const s = unfrozen(sealed.amniotes())
  s.version = version
  delete (s as { checksum?: string }).checksum
  return sealSnapshot(s) as DatasetSnapshot
}
const storeSnapshot = async (s: DatasetSnapshot, publish = true) => {
  const doc = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: s } as never })) as Doc
  if (publish) await payload.update({ collection: SNAPSHOTS as never, id: doc.id, data: { status: 'published' } as never, user: manager, overrideAccess: false })
  return String(doc.id)
}
const viewOf = (s: DatasetSnapshot, id: string) => createView(indexDataset(s), { id, title: id, target: { kind: 'phylogeny', id: 'archelosauria' } })
const storeView = async (snapshot: string, s: DatasetSnapshot, id: string, publish = true, extra: Record<string, unknown> = {}) => {
  const doc = (await payload.create({ collection: VIEWS as never, data: { title: id, snapshot, view: viewOf(s, id), ...extra } as never, user: manager, overrideAccess: false })) as Doc
  if (publish) await payload.update({ collection: VIEWS as never, id: doc.id, data: { status: 'published' } as never, user: manager, overrideAccess: false })
  return String(doc.id)
}
const withdraw = (snapshot: string, req?: Awaited<ReturnType<typeof createLocalReq>>) =>
  payload.update({ collection: SNAPSHOTS as never, id: snapshot, data: { status: 'withdrawn' } as never, ...(req ? { req } : { user: manager, overrideAccess: false }) })
const readView = (id: string, user: TypedUser | null = reader, more: Record<string, unknown> = {}) =>
  payload.findByID({ collection: VIEWS as never, id, depth: 0, user, overrideAccess: false, ...more }) as Promise<Doc>
const rawViews = () => (payload.db as unknown as { collections: Record<string, { findOne: (q: unknown) => { lean: () => Promise<Doc | null> } }> }).collections[VIEWS]!

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({ collections: [usersCollection()], plugins: [oneTaxonomy({ access })] }))
  manager = await makeUser(payload, 'manager')
  reader = await makeUser(payload, 'reader')
  const current = sealed.amniotes()
  snapshots.current = await storeSnapshot(current)
  views.current = await storeView(snapshots.current, current, 'v-current')
  views.second = await storeView(snapshots.current, current, 'v-second')
  views.third = await storeView(snapshots.current, current, 'v-third')
  // A snapshot published, viewed, then withdrawn by its publisher.
  const old = versioned('0.9')
  snapshots.old = await storeSnapshot(old)
  views.old = await storeView(snapshots.old, old, 'v-old')
  await withdraw(snapshots.old)
})
afterAll(async () => stop?.())

describe('a view read through Payload says what its snapshot\'s status is', () => {
  it('gives readers the same source as the view endpoints, for a current snapshot and a withdrawn one', async () => {
    const current = await readView(views.current!)
    expect(current.source).toEqual({ doc: snapshots.current, id: 'fixture-amniotes', version: '1', checksum: sealed.amniotes().checksum, status: 'published', withdrawn: false })
    const old = await readView(views.old!)
    expect(old.source).toMatchObject({ doc: snapshots.old, version: '0.9', status: 'withdrawn', withdrawn: true })
    for (const key of ['current', 'old']) {
      const endpoint = await callEndpoint(payload, VIEWS, '/:id/projection', views[key]!, {}, reader)
      expect((await readView(views[key]!)).source).toEqual(endpoint.body.source)
    }
  })

  it('flags every view in a list, and reads each snapshot\'s status once for the page', async () => {
    const findOne = vi.spyOn(payload.db, 'findOne')
    try {
      const page = await payload.find({ collection: VIEWS as never, depth: 0, user: reader, overrideAccess: false, sort: 'viewId' })
      expect(page.docs.map((d) => [(d as Doc).viewId, (d as Doc).source.withdrawn])).toEqual([['v-current', false], ['v-old', true], ['v-second', false], ['v-third', false]])
      const snapshotReads = findOne.mock.calls.filter(([args]) => (args as { collection: string }).collection === SNAPSHOTS)
      expect(snapshotReads).toHaveLength(2)
    } finally {
      findOne.mockRestore()
    }
  })

  it('fills a view\'s snapshot in without its content when the relationship is populated', async () => {
    for (const user of [reader, manager]) {
      const deep = await readView(views.current!, user, { depth: 1 })
      expect(deep.snapshot).toMatchObject({ id: snapshots.current, snapshotId: 'fixture-amniotes', status: 'published' })
      expect(deep.snapshot).not.toHaveProperty('snapshot')
      expect(JSON.stringify(deep.snapshot)).not.toContain('"schemaVersion"')
    }
  })

  it('keeps the withdrawn snapshot itself hidden from readers, at any depth', async () => {
    const deep = await readView(views.old!, reader, { depth: 2 })
    expect(deep.source.withdrawn).toBe(true)
    // The relationship stays a bare id: the reader can't read the snapshot, so it isn't filled in.
    expect(deep.snapshot).toBe(snapshots.old)
    await expect(payload.findByID({ collection: SNAPSHOTS as never, id: snapshots.old!, user: reader, overrideAccess: false })).rejects.toThrow(/not found/i)
  })

  it('answers when only source is selected, and leaves it out when it isn\'t', async () => {
    const only = await readView(views.old!, reader, { select: { source: true } })
    expect(only.source).toMatchObject({ status: 'withdrawn', withdrawn: true })
    expect(only).not.toHaveProperty('snapshot')
    const without = await readView(views.old!, reader, { select: { title: true } })
    expect(without).toEqual({ id: views.old, title: 'v-old' })
  })

  it('gives no source to anyone who can\'t read the view', async () => {
    const draftSnapshot = versioned('2-draft')
    const draft = await storeView(await storeSnapshot(draftSnapshot, false), draftSnapshot, 'v-draft', false)
    expect((await readView(draft, manager)).source).toMatchObject({ status: 'staged', withdrawn: false })
    await expect(readView(draft, reader)).rejects.toThrow(/not found/i)
    await expect(readView(views.current!, null)).rejects.toThrow(/not allowed/i)
  })

  it('is worked out, never stored: a source sent with a view is ignored', async () => {
    const current = sealed.amniotes()
    const forged = { doc: 'x', id: 'made-up', version: '9', checksum: 'sha256:made-up', status: 'published', withdrawn: false }
    const asManager = await storeView(snapshots.current!, current, 'v-forged', false, { source: forged })
    expect((await readView(asManager, manager)).source).toMatchObject({ doc: snapshots.current, id: 'fixture-amniotes', version: '1' })
    const asServer = (await payload.create({ collection: VIEWS as never, data: { title: 'v-forged-server', snapshot: snapshots.current, view: viewOf(current, 'v-forged-server'), source: forged } as never })) as Doc
    expect(asServer.source).toMatchObject({ id: 'fixture-amniotes', version: '1' })
    await payload.update({ collection: VIEWS as never, id: asManager, data: { title: 'v-forged, renamed', source: forged } as never, user: manager, overrideAccess: false })
    for (const id of [asManager, String(asServer.id)]) expect(await rawViews().findOne({ _id: id }).lean()).not.toHaveProperty('source')
  })

  it('sees a withdrawal made earlier in the same request', async () => {
    const s = versioned('0.8')
    const snapshot = await storeSnapshot(s)
    const view = await storeView(snapshot, s, 'v-same-request')
    const req = await createLocalReq({ user: manager as never }, payload)
    expect(((await payload.findByID({ collection: VIEWS as never, id: view, depth: 0, req })) as Doc).source.withdrawn).toBe(false)
    await withdraw(snapshot, req)
    expect(((await payload.findByID({ collection: VIEWS as never, id: view, depth: 0, req })) as Doc).source).toMatchObject({ status: 'withdrawn', withdrawn: true })
  })

  it('says null, not a guess, when the snapshot is gone', async () => {
    const s = versioned('0.7')
    const snapshot = await storeSnapshot(s, false)
    const view = await storeView(snapshot, s, 'v-orphan', false)
    await payload.delete({ collection: SNAPSHOTS as never, id: snapshot, user: manager, overrideAccess: false })
    expect((await readView(view, manager)).source).toBeNull()
  })
})

describe('GraphQL', () => {
  const run = async (source: string, user: TypedUser | null) => {
    const { schema } = configToSchema(payload.config)
    const req = await createLocalReq({ user: (user ?? undefined) as never }, payload)
    if (user === null) req.user = null
    return graphql({ schema, source, contextValue: { req, headers: {} } }) as Promise<{ data?: any; errors?: readonly { message: string }[] }>
  }

  it('answers source on a list and on one view, with and without the select argument', async () => {
    const list = await run('{ TaxonomyViews(sort: "viewId") { docs { viewId source } } }', reader)
    expect(list.errors).toBeUndefined()
    // Only the views made in beforeAll; earlier tests published others.
    const firstFour = list.data.TaxonomyViews.docs.filter((d: Doc) => ['v-current', 'v-old', 'v-second', 'v-third'].includes(d.viewId))
    expect(firstFour.map((d: Doc) => [d.viewId, d.source.status, d.source.withdrawn])).toEqual([
      ['v-current', 'published', false],
      ['v-old', 'withdrawn', true],
      ['v-second', 'published', false],
      ['v-third', 'published', false],
    ])
    // select: true reads only the fields the query names, so the view's snapshot reference isn't loaded with it.
    const one = await run(`{ TaxonomyView(id: "${views.old}", select: true) { source } }`, reader)
    expect(one.errors).toBeUndefined()
    expect(one.data.TaxonomyView.source).toEqual((await readView(views.old!)).source)
  })

  it('gives a snapshot\'s content only with the select argument, which reads the fields the query names', async () => {
    const plain = await run(`{ TaxonomySnapshot(id: "${snapshots.current}") { checksum snapshot } }`, reader)
    expect(plain.errors).toBeUndefined()
    expect(plain.data.TaxonomySnapshot).toMatchObject({ checksum: sealed.amniotes().checksum, snapshot: null })
    const named = await run(`{ TaxonomySnapshot(id: "${snapshots.current}", select: true) { checksum snapshot } }`, reader)
    expect(named.errors).toBeUndefined()
    expect(named.data.TaxonomySnapshot.snapshot).toEqual(sealed.amniotes())
  })

  it('refuses anonymous readers as before', async () => {
    const anonymous = await run('{ TaxonomyViews { docs { viewId source } } }', null)
    expect(anonymous.errors?.[0]?.message).toMatch(/not allowed/i)
  })
})

describe('generated types', () => {
  it('describe source as the endpoints\' object, or null', () => {
    const schema = configToJSONSchema(payload.config, 'text') as { definitions: Record<string, { properties: Record<string, any> }> }
    const source = schema.definitions[VIEWS]!.properties.source
    expect(source.type).toEqual(['object', 'null'])
    expect(source.required).toEqual(['doc', 'id', 'version', 'checksum', 'status', 'withdrawn'])
    expect(source.properties.status.enum).toEqual(['staged', 'published', 'withdrawn'])
  })
})
