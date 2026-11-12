import type { DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import type { Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { oneTaxonomy } from '../src'
import { resolveOptions } from '../src/types'
import { access, callEndpoint, makeUser, sealed, startPayload, usersCollection, WITH_CONTENT } from './helpers'

// One site, no tenants, on a database without transactions.
const SNAPSHOTS = 'taxonomy-snapshots'
const PROPOSALS = 'taxonomy-proposals'
let payload: Payload
let stop: () => Promise<void>
let manager: TypedUser
let ann: TypedUser
let ben: TypedUser
let snap: string
let meanwhile: (() => Promise<unknown>) | null = null

type Doc = Record<string, any>
const birds = { node: 'c:aves', from: null, to: 'c:reptilia' }
const proposal = { title: 'Birds are reptiles', base: { kind: 'classification', id: 'traditional', version: '1' }, moves: [birds] }
const propose = async (user: TypedUser) => (await payload.create({ collection: PROPOSALS as never, data: { snapshot: snap, proposal } as never, user, overrideAccess: false, depth: 0 })) as Doc
const update = async (id: unknown, data: Record<string, unknown>, user: TypedUser) => (await payload.update({ collection: PROPOSALS as never, id: id as string, data: data as never, user, overrideAccess: false, depth: 0 })) as Doc
const seen = async (collection: string, user: TypedUser) => (await payload.find({ collection: collection as never, user, overrideAccess: false, depth: 0 })).docs.map((d) => String((d as Doc).id))
const snapshotCount = async () => (await payload.count({ collection: SNAPSHOTS as never })).totalDocs
const accept = (id: unknown, user: TypedUser | null, body?: unknown) => callEndpoint(payload, PROPOSALS, '/:id/accept', String(id), {}, user, body)

beforeAll(async () => {
  ;({ payload, stop } = await startPayload(
    {
      collections: [usersCollection()],
      plugins: [
        oneTaxonomy({
          access,
          proposals: {
            personId: async ({ req }) => {
              const run = meanwhile
              meanwhile = null
              await run?.()
              return `keeper-${String(req.user?.id).slice(-4)}`
            },
          },
        }),
      ],
    },
    { transactions: false },
  ))
  manager = await makeUser(payload, 'manager')
  ann = await makeUser(payload, 'reader')
  ben = await makeUser(payload, 'reader')
  const doc = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.amniotes() } as never, user: manager, overrideAccess: false })) as Doc
  await payload.update({ collection: SNAPSHOTS as never, id: doc.id, data: { status: 'published' } as never, user: manager, overrideAccess: false })
  snap = String(doc.id)
})
afterAll(async () => stop?.())

describe('proposals on a site without tenants', () => {
  it('uses the user\'s document id as the person id unless the site says otherwise, looks up no names, and lets any signed-in reader propose', async () => {
    const opts = resolveOptions({ proposals: true })
    expect(await opts.proposals!.personId({ req: { user: { id: 42 } } } as never)).toBe('42')
    expect(await opts.proposals!.personId({ req: { user: null } } as never)).toBe('')
    expect(opts.proposals!.displayName).toBeNull()
    expect(opts.proposals).toMatchObject({ maxMoves: 500, maxPerUser: 200 })
    expect(await opts.access.propose({ req: { user: { id: 42 } } as never, tenant: null })).toBe(true)
    expect(await opts.access.propose({ req: { user: null } as never, tenant: null })).toBe(false)
    expect(resolveOptions({}).proposals).toBeNull()
    expect(resolveOptions({ proposals: { maxMoves: 0, maxPerUser: -3 } }).proposals).toMatchObject({ maxMoves: 500, maxPerUser: 200 })
  })

  it('goes from a private proposal to a staged version, and never shows anonymous visitors anything', async () => {
    const p = await propose(ann)
    expect(p).not.toHaveProperty('tenant')
    expect(await seen(PROPOSALS, ben)).toEqual([])
    expect(await seen(PROPOSALS, manager)).toEqual([])
    const shared = await update(p.id, { status: 'shared' }, ann)
    expect(await seen(PROPOSALS, ben)).toEqual([String(p.id)])
    await expect(payload.find({ collection: PROPOSALS as never, overrideAccess: false })).rejects.toThrow(/not allowed/i)
    await expect(payload.create({ collection: PROPOSALS as never, data: { snapshot: snap, proposal } as never, overrideAccess: false })).rejects.toThrow(/not allowed/i)
    for (const user of [null, ann, ben]) expect((await accept(p.id, user, { version: '2', checksum: shared.checksum })).status).toBe(404)

    const done = await accept(p.id, manager, { version: '2', checksum: shared.checksum })
    expect(done).toMatchObject({ status: 200, body: { snapshot: { version: '2', status: 'staged' } } })
    const made = (await payload.findByID({ collection: SNAPSHOTS as never, id: done.body.snapshot.doc, depth: 0, select: WITH_CONTENT })) as Doc
    expect((made.snapshot as DatasetSnapshot).derivedFrom!.proposal).toMatchObject({ author: `keeper-${String(ann.id).slice(-4)}`, acceptedBy: `keeper-${String(manager.id).slice(-4)}` })
    // No `displayName` on this site: a proposal shows its author's id and no name.
    expect(((await payload.findByID({ collection: PROPOSALS as never, id: p.id, depth: 0, user: ben, overrideAccess: false })) as Doc).authorName ?? null).toBeNull()
    expect(await seen(SNAPSHOTS, ann)).toEqual([snap])
    expect((await payload.findByID({ collection: PROPOSALS as never, id: p.id, depth: 0 })) as Doc).toMatchObject({ status: 'accepted' })
  })

  it('removes the new snapshot again when the proposal was taken back meanwhile (no transaction to roll back)', async () => {
    const p = await update((await propose(ben)).id, { status: 'shared' }, ben)
    const count = await snapshotCount()
    meanwhile = () => update(p.id, { status: 'private' }, ben)
    expect(await accept(p.id, manager, { version: '3', checksum: p.checksum })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/a moment ago/) } })
    expect(meanwhile).toBeNull()
    expect(await snapshotCount()).toBe(count)
    const now = (await payload.findByID({ collection: PROPOSALS as never, id: p.id, depth: 0 })) as Doc
    expect(now.status).toBe('private')
    expect(now.acceptedInto ?? null).toBeNull()
    // Version 3 is free: sharing again and accepting works.
    const again = await update(p.id, { status: 'shared' }, ben)
    expect((await accept(p.id, manager, { version: '3', checksum: again.checksum })).status).toBe(200)
    expect(await snapshotCount()).toBe(count + 1)
  })

  it('stores one version when two accepts arrive at once, without transactions', async () => {
    const p = await update((await propose(ben)).id, { status: 'shared' }, ben)
    const count = await snapshotCount()
    const results = await Promise.all([accept(p.id, manager, { version: '4', checksum: p.checksum }), accept(p.id, manager, { version: '5', checksum: p.checksum })])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await snapshotCount()).toBe(count + 1)
  })
})
