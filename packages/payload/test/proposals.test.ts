import { verifySnapshot, type DatasetSnapshot, type Proposal } from '@captiveorigins/onetaxonomy-core'
import type { Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { oneTaxonomy, proposalChecksum } from '../src'
import { access, callEndpoint, makeUser, roleOf, sealed, startPayload, tenantsCollection, usersCollection } from './helpers'

const SNAPSHOTS = 'taxonomy-snapshots'
const PROPOSALS = 'taxonomy-proposals'
let payload: Payload
let stop: () => Promise<void>
let tenantA: string | number
let tenantB: string | number
let managerA: TypedUser
let managerA2: TypedUser
let managerB: TypedUser
let ann: TypedUser // a reader in tenant A, and the author of most proposals here
let ben: TypedUser // another reader in tenant A
let viewerA: TypedUser // may read in tenant A, may not propose
let readerB: TypedUser
let noTenant: TypedUser
let thrower: TypedUser
let snapA: string
let snapB: string

// Made-up names. The host gives them; a test can change one, or make the lookup fail.
const names = new Map<string, string>()
let nameFails = false
// Runs once, inside the next name lookup: in an accept, that is after the proposal was read and before it is claimed.
let meanwhile: (() => Promise<unknown>) | null = null

const tenantOfUser = (user: unknown) => {
  if (roleOf(user) === 'thrower') throw new Error('tenant lookup failed')
  const t = (user as { tenant?: unknown } | null | undefined)?.tenant
  return t && typeof t === 'object' ? ((t as { id: string | number }).id ?? null) : ((t as string | number | null | undefined) ?? null)
}

type Doc = Record<string, any>
const idOf = (v: unknown) => (v && typeof v === 'object' ? (v as { id: unknown }).id : v)
const birds = { node: 'c:aves', from: null, to: 'c:reptilia', note: 'Birds nest inside reptiles' }
const mammals = { node: 'c:mammalia', from: null, to: 'c:reptilia' }
const draft = (o: Record<string, unknown> = {}) => ({ title: 'Birds are reptiles', base: { kind: 'classification', id: 'traditional', version: '1' }, moves: [birds], ...o })
const propose = async (user: TypedUser, data: Record<string, unknown> = {}) => (await payload.create({ collection: PROPOSALS as never, data: { snapshot: snapA, proposal: draft(), ...data } as never, user, overrideAccess: false, depth: 0 })) as Doc
const update = async (id: unknown, data: Record<string, unknown>, user: TypedUser) => (await payload.update({ collection: PROPOSALS as never, id: id as string, data: data as never, user, overrideAccess: false, depth: 0 })) as Doc
const remove = (id: unknown, user: TypedUser) => payload.delete({ collection: PROPOSALS as never, id: id as string, user, overrideAccess: false })
const stored = async (id: unknown) => (await payload.findByID({ collection: PROPOSALS as never, id: id as string, depth: 0 })) as Doc
const readAs = async (id: unknown, user: TypedUser) => (await payload.findByID({ collection: PROPOSALS as never, id: id as string, depth: 0, user, overrideAccess: false })) as Doc
const seen = async (user: TypedUser) => (await payload.find({ collection: PROPOSALS as never, user, overrideAccess: false, depth: 0, limit: 100 })).docs.map((d) => (d as Doc).id as string)
const snapshotsSeen = async (user: TypedUser) => (await payload.find({ collection: SNAPSHOTS as never, user, overrideAccess: false, depth: 0, limit: 100 })).docs.map((d) => String((d as Doc).id))
const snapshotCount = async () => (await payload.count({ collection: SNAPSHOTS as never })).totalDocs
const snapshot = async (id: unknown) => (await payload.findByID({ collection: SNAPSHOTS as never, id: id as string, depth: 0 })) as Doc
const preview = (id: unknown, user: TypedUser | null, query: Record<string, string | number> = {}) => callEndpoint(payload, PROPOSALS, '/:id/preview', String(id), query, user)
const accept = (id: unknown, user: TypedUser | null, body?: unknown) => callEndpoint(payload, PROPOSALS, '/:id/accept', String(id), {}, user, body)
const decline = (id: unknown, user: TypedUser | null, body?: unknown) => callEndpoint(payload, PROPOSALS, '/:id/decline', String(id), {}, user, body)
const shared = async (user: TypedUser, data: Record<string, unknown> = {}) => update((await propose(user, data)).id, { status: 'shared' }, user)

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({
    collections: [tenantsCollection, usersCollection(true)],
    plugins: [
      oneTaxonomy({
        access: {
          manage: access.manage,
          read: access.read,
          propose: ({ req }) => {
            if (roleOf(req.user) === 'thrower') throw new Error('host check failed')
            return roleOf(req.user) !== 'viewer'
          },
        },
        tenant: { collection: 'tenants', resolve: ({ req }) => tenantOfUser(req.user) },
        proposals: {
          nameOf: async ({ req }) => {
            if (nameFails) throw new Error('directory down')
            const run = meanwhile
            meanwhile = null
            await run?.()
            return names.get(String(req.user?.id)) ?? ''
          },
          maxMoves: 3,
          maxPerUser: 5,
        },
      }),
    ],
  }))
  tenantA = ((await payload.create({ collection: 'tenants' as never, data: { name: 'A' } as never })) as { id: string | number }).id
  tenantB = ((await payload.create({ collection: 'tenants' as never, data: { name: 'B' } as never })) as { id: string | number }).id
  managerA = await makeUser(payload, 'manager', { tenant: tenantA })
  managerA2 = await makeUser(payload, 'manager', { tenant: tenantA })
  managerB = await makeUser(payload, 'manager', { tenant: tenantB })
  ann = await makeUser(payload, 'reader', { tenant: tenantA })
  ben = await makeUser(payload, 'reader', { tenant: tenantA })
  viewerA = await makeUser(payload, 'viewer', { tenant: tenantA })
  readerB = await makeUser(payload, 'reader', { tenant: tenantB })
  noTenant = await makeUser(payload, 'manager')
  thrower = await makeUser(payload, 'thrower', { tenant: tenantA })
  for (const [user, name] of [[managerA, 'Cara Curator'], [managerA2, 'Dev Curator'], [managerB, 'Eli Curator'], [ann, 'Ann K.'], [ben, 'Ben R.'], [readerB, 'Bo T.'], [noTenant, 'No Tenant'], [thrower, 'Thrower'], [viewerA, 'Vi Viewer']] as const)
    names.set(String(user.id), name)
  for (const [user, set] of [[managerA, (id: string) => (snapA = id)], [managerB, (id: string) => (snapB = id)]] as const) {
    const doc = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.amniotes() } as never, user, overrideAccess: false })) as Doc
    await payload.update({ collection: SNAPSHOTS as never, id: doc.id, data: { status: 'published' } as never, user, overrideAccess: false })
    set(String(doc.id))
  }
})
afterAll(async () => stop?.())

describe('making a proposal', () => {
  it('stores it as its author\'s, private, with the plugin\'s own id, name, date and checksum', async () => {
    const before = Date.now()
    const doc = await propose(ann, {
      author: String(managerA.id),
      proposalId: 'forged',
      checksum: 'sha256:forged',
      title: 'Forged title',
      proposal: { ...draft(), id: 'forged', author: 'Someone Else', created: '2000-01-01T00:00:00.000Z', surprise: true, notes: '  Two lines of evidence.  ' },
    })
    const p = doc.proposal as Proposal
    expect(doc).toMatchObject({ author: String(ann.id), status: 'private', title: 'Birds are reptiles', proposalId: p.id, checksum: proposalChecksum(p) })
    expect(idOf(doc.tenant)).toBe(tenantA)
    expect(String(idOf(doc.snapshot))).toBe(snapA)
    expect(p.id).toMatch(/^p-[0-9a-f]{12}$/)
    expect(p).toEqual({ id: p.id, title: 'Birds are reptiles', author: 'Ann K.', created: p.created, notes: 'Two lines of evidence.', base: { kind: 'classification', id: 'traditional', version: '1' }, moves: [birds] })
    expect(Date.parse(p.created)).toBeGreaterThanOrEqual(before)
    for (const f of ['decidedBy', 'decidedAt', 'decisionNote', 'acceptedInto']) expect((await stored(doc.id))[f] ?? null).toBeNull()
    await remove(doc.id, ann)
  })

  it('refuses anonymous visitors, people who may not propose, and checks that fail', async () => {
    const data = { snapshot: snapA, proposal: draft() }
    const before = (await payload.count({ collection: PROPOSALS as never })).totalDocs
    await expect(payload.create({ collection: PROPOSALS as never, data: data as never, overrideAccess: false })).rejects.toThrow(/not allowed/i)
    for (const user of [viewerA, thrower, noTenant]) await expect(propose(user)).rejects.toThrow(/not allowed/i)
    // Trusted code has no author to record either.
    await expect(payload.create({ collection: PROPOSALS as never, data: { ...data, tenant: tenantA } as never })).rejects.toThrow(/signed-in person/)
    await expect(payload.find({ collection: PROPOSALS as never, overrideAccess: false })).rejects.toThrow(/not allowed/i)
    await expect(seen(thrower)).rejects.toThrow(/not allowed/i)
    await expect(seen(noTenant)).rejects.toThrow(/not allowed/i)
    expect((await payload.count({ collection: PROPOSALS as never })).totalDocs).toBe(before)
  })

  it('refuses a proposal that doesn\'t fit its snapshot, with the reason', async () => {
    const bad = (proposal: Record<string, unknown>, data: Record<string, unknown> = {}) => propose(ann, { proposal, ...data })
    await expect(bad(draft({ moves: [{ node: 'nope', from: null, to: 'c:reptilia' }] }))).rejects.toThrow(/Unknown node/)
    await expect(bad(draft({ moves: [{ node: 'c:aves', from: 'c:mammalia', to: 'c:reptilia' }] }))).rejects.toThrow(/no longer under/)
    await expect(bad(draft({ moves: [{ node: 'c:reptilia', from: null, to: 'c:squamata' }] }))).rejects.toThrow(/own descendant/)
    await expect(bad(draft({ base: { kind: 'classification', id: 'nope', version: '1' } }))).rejects.toThrow(/no classification nope/)
    await expect(bad(draft({ base: { kind: 'classification', id: 'traditional', version: '9' } }))).rejects.toThrow(/can't be saved/)
    await expect(bad(draft({ base: { kind: 'tree', id: 'traditional', version: '1' } }))).rejects.toThrow(/base\.kind/)
    await expect(bad(draft({ title: '  ' }))).rejects.toThrow(/needs a title/)
    await expect(bad(draft({ title: 'x'.repeat(201) }))).rejects.toThrow(/needs a title/)
    await expect(bad(draft({ notes: 7 }))).rejects.toThrow(/notes are text/)
    await expect(bad(draft({ moves: 'all of them' }))).rejects.toThrow(/must be a list/)
    await expect(bad(draft({ moves: [{ node: 'c:aves', to: 'c:reptilia' }] }))).rejects.toThrow(/Move 1 needs/)
    await expect(bad(draft({ moves: [birds, mammals, { node: 'c:testudines', from: 'c:reptilia', to: null }, { node: 'c:squamata', from: 'c:reptilia', to: null }] }))).rejects.toThrow(/up to 3 moves; this one has 4/)
    await expect(bad(draft(), { status: 'shared' })).rejects.toThrow(/starts private/)
    await expect(bad(draft(), { status: 'accepted' })).rejects.toThrow(/starts private/)
    await expect(bad(draft(), { decidedBy: String(managerA.id) })).rejects.toThrow(/done by a manager/)
    await expect(bad(draft(), { acceptedInto: snapA })).rejects.toThrow(/done by a manager/)
    await expect(propose(ann, { snapshot: undefined })).rejects.toThrow()
  })

  it('gives the same answer for a snapshot that is missing, hidden or in another tenant', async () => {
    const staged = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.structures() } as never, user: managerA, overrideAccess: false })) as Doc
    const hidden = /doesn't exist, or you can't read it/
    await expect(propose(ann, { snapshot: snapB })).rejects.toThrow(hidden)
    await expect(propose(ann, { snapshot: staged.id })).rejects.toThrow(hidden)
    await expect(propose(ann, { snapshot: '0123456789abcdef01234567' })).rejects.toThrow(hidden)
    await expect(propose(ann, { tenant: tenantB })).rejects.toThrow(/not allowed/i)
    // Trusted code can't put a proposal in one tenant over another tenant's snapshot either, whichever way round.
    for (const [snapshot, tenant] of [[snapB, tenantA], [snapA, tenantB]] as const)
      await expect(payload.create({ collection: PROPOSALS as never, data: { snapshot, proposal: draft(), tenant } as never, user: ann })).rejects.toThrow(hidden)
    await payload.delete({ collection: SNAPSHOTS as never, id: staged.id })
  })

  it('stops when the site can\'t give the person\'s name', async () => {
    const before = (await payload.count({ collection: PROPOSALS as never })).totalDocs
    nameFails = true
    try {
      await expect(propose(ann)).rejects.toMatchObject({ status: 500, message: expect.stringMatching(/couldn't give your name/) })
    } finally {
      nameFails = false
    }
    names.set(String(ann.id), '   ')
    await expect(propose(ann)).rejects.toThrow(/couldn't give your name/)
    names.set(String(ann.id), 'Ann K.')
    expect((await payload.count({ collection: PROPOSALS as never })).totalDocs).toBe(before)
  })

  it('keeps at most maxPerUser proposals per person', async () => {
    const made: Doc[] = []
    for (let i = 0; i < 5; i++) made.push(await propose(ben, { proposal: draft({ title: `Idea ${i}` }) }))
    await expect(propose(ben)).rejects.toThrow(/You have 5 proposals/)
    // Someone else's count is their own.
    await remove((await propose(ann)).id, ann)
    await remove(made[0]!.id, ben)
    made[0] = await propose(ben)
    for (const d of made) await remove(d.id, ben)
    expect(await seen(ben)).toEqual([])
  })
})

describe('private and shared', () => {
  let p: Doc

  it('keeps a private proposal invisible to everyone but its author, in and out of its tenant', async () => {
    p = await propose(ann)
    expect(await seen(ann)).toEqual([p.id])
    for (const user of [ben, viewerA, managerA, managerB, readerB]) {
      expect(await seen(user), String(user.id)).toEqual([])
      await expect(readAs(p.id, user)).rejects.toThrow()
      expect((await preview(p.id, user)).status).toBe(404)
      await expect(update(p.id, { status: 'shared' }, user)).rejects.toThrow()
      await expect(remove(p.id, user)).rejects.toThrow()
    }
    for (const user of [null, thrower, noTenant]) expect((await preview(p.id, user)).status).toBe(404)
    // A manager can't decide on what they can't see.
    for (const user of [managerA, managerB]) {
      expect((await accept(p.id, user, { version: '2', checksum: p.checksum })).status).toBe(404)
      expect((await decline(p.id, user, {})).status).toBe(404)
    }
    expect(await stored(p.id)).toMatchObject({ status: 'private', checksum: p.checksum })
  })

  it('shares only with a move and a published snapshot', async () => {
    const empty = await propose(ann, { proposal: draft({ title: 'Nothing yet', moves: [] }) })
    await expect(update(empty.id, { status: 'shared' }, ann)).rejects.toThrow(/moves nothing/)
    await remove(empty.id, ann)
    // A manager can draft over a staged snapshot, but not share it until the snapshot is published.
    const staged = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.checklist() } as never, user: managerA, overrideAccess: false })) as Doc
    const c = (staged.snapshot as DatasetSnapshot).classifications[0]!
    const first = c.placements.find((x) => x.parent !== null)!
    const early = await propose(managerA, { snapshot: staged.id, proposal: { title: 'Early', base: { kind: 'classification', id: c.id, version: c.version }, moves: [{ node: first.concept, from: first.parent, to: null }] } })
    await expect(update(early.id, { status: 'shared' }, managerA)).rejects.toThrow(/while its snapshot is published/)
    await remove(early.id, managerA)
    await payload.delete({ collection: SNAPSHOTS as never, id: staged.id })
  })

  it('shows a shared proposal to its tenant\'s readers and to nobody else', async () => {
    p = await update(p.id, { status: 'shared' }, ann)
    expect(p.status).toBe('shared')
    for (const user of [ann, ben, viewerA, managerA]) {
      expect(await seen(user)).toEqual([p.id])
      expect((await preview(p.id, user)).status).toBe(200)
    }
    for (const user of [managerB, readerB]) {
      expect(await seen(user)).toEqual([])
      await expect(readAs(p.id, user)).rejects.toThrow()
      expect((await preview(p.id, user)).status).toBe(404)
    }
    for (const user of [null, thrower, noTenant]) expect((await preview(p.id, user)).status).toBe(404)
    for (const user of [managerB, readerB, ben, ann, viewerA, noTenant, thrower, null]) {
      expect((await accept(p.id, user, { version: '2', checksum: p.checksum })).status, 'accept').toBe(404)
      expect((await decline(p.id, user, {})).status, 'decline').toBe(404)
    }
    expect((await stored(p.id)).status).toBe('shared')
  })

  it('locks a shared proposal: nobody edits or deletes it, and only its author unshares it', async () => {
    await expect(update(p.id, { proposal: draft({ title: 'Changed' }) }, ann)).rejects.toThrow(/Stop sharing it first/)
    for (const user of [ben, viewerA, managerA, managerB]) await expect(update(p.id, { status: 'private' }, user)).rejects.toThrow()
    for (const user of [ann, ben, managerA, managerB]) await expect(remove(p.id, user)).rejects.toThrow()
    await expect(payload.delete({ collection: PROPOSALS as never, id: p.id })).rejects.toThrow(/Stop sharing/)
    expect(await stored(p.id)).toMatchObject({ status: 'shared', checksum: p.checksum })
  })

  it('lets its author take it back, revise it under their current name, and share it again', async () => {
    await update(p.id, { status: 'private' }, ann)
    expect(await seen(ben)).toEqual([])
    names.set(String(ann.id), 'Ann Keeper')
    const revised = await update(p.id, { proposal: draft({ title: 'Birds and mammals are reptiles', moves: [birds, mammals] }) }, ann)
    const before = p.proposal as Proposal
    expect(revised.proposal).toMatchObject({ id: before.id, created: before.created, author: 'Ann Keeper', title: 'Birds and mammals are reptiles' })
    expect(revised).toMatchObject({ title: 'Birds and mammals are reptiles', proposalId: before.id, checksum: proposalChecksum(revised.proposal as Proposal) })
    expect(revised.checksum).not.toBe(p.checksum)
    // An edit that doesn't fit is refused, and the stored proposal stays as it was.
    await expect(update(p.id, { proposal: draft({ moves: [{ node: 'nope', from: null, to: null }] }) }, ann)).rejects.toThrow(/Unknown node/)
    expect((await stored(p.id)).checksum).toBe(revised.checksum)
    p = await update(p.id, { proposal: draft(), status: 'shared' }, ann)
    expect(p).toMatchObject({ status: 'shared', title: 'Birds are reptiles' })
  })

  it('never lets a decision, the author, the snapshot or the tenant be set through an update', async () => {
    const other = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.structures() } as never, user: managerA, overrideAccess: false })) as Doc
    const tries: [Record<string, unknown>, RegExp][] = [
      [{ status: 'accepted' }, /done by a manager/],
      [{ status: 'declined' }, /done by a manager/],
      [{ decidedBy: String(ann.id) }, /done by a manager/],
      [{ decidedAt: '2026-11-11T00:00:00.000Z' }, /done by a manager/],
      [{ decisionNote: 'Fine by me' }, /done by a manager/],
      [{ acceptedInto: snapA }, /done by a manager/],
      [{ author: String(ben.id) }, /author can't change/],
      [{ snapshot: other.id }, /stays on the snapshot/],
      [{ tenant: tenantB }, /stays in the tenant/],
    ]
    for (const [data, why] of tries) {
      await expect(update(p.id, data, ann), JSON.stringify(data)).rejects.toThrow(why)
      // Trusted code is held to the same rule: the hook refuses it, not only the access check.
      await expect(payload.update({ collection: PROPOSALS as never, id: p.id, data: data as never }), JSON.stringify(data)).rejects.toThrow(why)
    }
    await payload.delete({ collection: SNAPSHOTS as never, id: other.id })
    expect(await stored(p.id)).toMatchObject({ status: 'shared', checksum: p.checksum, author: String(ann.id) })
    expect(String(idOf((await stored(p.id)).snapshot))).toBe(snapA)
  })
})

describe('preview', () => {
  it('lists what would change, with the checksum and whether it can be accepted', async () => {
    const [p] = (await payload.find({ collection: PROPOSALS as never, user: ben, overrideAccess: false, depth: 0 })).docs as Doc[]
    const { status, body } = await preview(p!.id, ben)
    expect(status).toBe(200)
    expect(body.proposal).toMatchObject({ doc: String(p!.id), id: p!.proposalId, title: 'Birds are reptiles', author: 'Ann Keeper', status: 'shared', checksum: p!.checksum, base: { kind: 'classification', id: 'traditional', version: '1' } })
    expect(body.snapshot).toMatchObject({ doc: snapA, id: 'fixture-amniotes', version: '1' })
    expect(body).toMatchObject({ acceptable: true, truncated: false, counts: { moves: 1 } })
    expect(body).not.toHaveProperty('notAcceptable')
    expect(body.moved).toEqual([birds])
    expect(body.changedGroups.find((g: Doc) => g.node === 'c:reptilia')).toMatchObject({ gained: ['c:aves'], lost: [] })
  })

  it('bounds its lists and says so', async () => {
    const two = await propose(managerA, { proposal: draft({ title: 'Two moves', moves: [birds, mammals] }) })
    const { status, body } = await preview(two.id, managerA, { limit: 1 })
    expect(status).toBe(200)
    expect(body.counts.moves).toBe(2)
    expect(body.moved).toHaveLength(1)
    expect(body.truncated).toBe(true)
    expect(body).toMatchObject({ acceptable: false, notAcceptable: 'It isn\'t shared yet.' })
    // A manager's own private proposal isn't accepted in one step either: it is shared first.
    expect(await accept(two.id, managerA, { version: '2', checksum: two.checksum })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/Share it first/) } })
    expect((await decline(two.id, managerA, {})).status).toBe(409)
    await remove(two.id, managerA)
  })
})

describe('accepting', () => {
  let p: Doc
  let made: string

  it('refuses a request that doesn\'t say exactly what is being accepted, and stores nothing', async () => {
    p = ((await payload.find({ collection: PROPOSALS as never, user: managerA, overrideAccess: false, depth: 0 })).docs as Doc[])[0]!
    const count = await snapshotCount()
    const tries: [unknown, number, RegExp][] = [
      [{ checksum: p.checksum }, 400, /Name the new snapshot version/],
      [{ version: 'x'.repeat(101), checksum: p.checksum }, 400, /Name the new snapshot version/],
      [{ version: '2' }, 400, /checksum as you last saw it/],
      [{ version: '2', checksum: 'sha256:0000' }, 409, /changed since you looked/],
      [{ version: '1', checksum: p.checksum }, 400, /snapshot's own/],
      [{ version: '2', checksum: p.checksum, createdAt: 'yesterday' }, 400, /createdAt must be a date/],
      [{ version: '2', checksum: p.checksum, note: 5 }, 400, /note is text/],
      ['{ not json', 400, /isn't valid JSON/],
      [undefined, 400, /Name the new snapshot version/],
    ]
    for (const [body, status, error] of tries) expect(await accept(p.id, managerA, body), JSON.stringify(body)).toMatchObject({ status, body: { error: expect.stringMatching(error) } })
    nameFails = true
    try {
      expect(await accept(p.id, managerA, { version: '2', checksum: p.checksum })).toMatchObject({ status: 500, body: { error: expect.stringMatching(/couldn't give your name/) } })
    } finally {
      nameFails = false
    }
    expect(await snapshotCount()).toBe(count)
    expect(await stored(p.id)).toMatchObject({ status: 'shared', checksum: p.checksum })
  })

  it('makes a new staged version, with both names in its record, and leaves the published one alone', async () => {
    const base = await snapshot(snapA)
    const { status, body } = await accept(p.id, managerA, { version: '2', checksum: p.checksum, createdAt: '2026-11-11T12:00:00.000Z', note: 'Agreed at the review' })
    expect(status).toBe(200)
    expect(body.proposal).toEqual({ doc: String(p.id), id: p.proposalId, status: 'accepted', checksum: p.checksum })
    expect(body.snapshot).toMatchObject({ id: 'fixture-amniotes', version: '2', status: 'staged' })
    expect(body.derivedFrom).toEqual({ doc: snapA, id: 'fixture-amniotes', version: '1', checksum: base.checksum })
    made = body.snapshot.doc

    const next = await snapshot(made)
    expect(next).toMatchObject({ status: 'staged', snapshotId: 'fixture-amniotes', version: '2', checksum: body.snapshot.checksum })
    expect(idOf(next.tenant)).toBe(tenantA)
    const content = next.snapshot as DatasetSnapshot
    expect(verifySnapshot(content)).toBe(true)
    expect(content.derivedFrom).toEqual({
      snapshot: 'fixture-amniotes', version: '1', checksum: base.checksum,
      proposal: { id: p.proposalId, title: 'Birds are reptiles', author: 'Ann Keeper', acceptedBy: 'Cara Curator', classification: { id: 'traditional', version: '1' }, moved: ['c:aves'] },
    })
    expect(content.classifications[0]!.placements.find((x) => x.concept === 'c:aves')!.parent).toBe('c:reptilia')
    expect(content.sources.find((s) => s.id === `proposal:${p.proposalId}`)).toBeTruthy()

    // The published snapshot is what it was, and readers see nothing new until the new version is published.
    const after = await snapshot(snapA)
    expect(after).toMatchObject({ status: 'published', version: '1', checksum: base.checksum })
    expect((after.snapshot as DatasetSnapshot).classifications[0]!.placements.find((x) => x.concept === 'c:aves')!.parent).toBeNull()
    expect(after.updatedAt).toBe(base.updatedAt)
    expect(await snapshotsSeen(ann)).toEqual([snapA])
    expect((await snapshotsSeen(managerA)).sort()).toEqual([snapA, made].sort())
    expect(await snapshotsSeen(managerB)).toEqual([snapB])
  })

  it('shows the decision to readers without the staged version or who decided', async () => {
    for (const user of [ann, ben, viewerA]) {
      const doc = await readAs(p.id, user)
      expect(doc).toMatchObject({ status: 'accepted', decisionNote: 'Agreed at the review', decidedAt: '2026-11-11T12:00:00.000Z' })
      expect(doc).not.toHaveProperty('acceptedInto')
      expect(doc).not.toHaveProperty('decidedBy')
      await expect(payload.find({ collection: PROPOSALS as never, where: { acceptedInto: { equals: made } }, user, overrideAccess: false })).rejects.toThrow()
    }
    const doc = await readAs(p.id, managerA)
    expect(doc.decidedBy).toBe(String(managerA.id))
    expect(String(idOf(doc.acceptedInto))).toBe(made)
    for (const user of [managerB, readerB]) await expect(readAs(p.id, user)).rejects.toThrow()
    expect(await preview(p.id, ann)).toMatchObject({ status: 200, body: { acceptable: false, notAcceptable: 'It was already accepted.' } })
  })

  it('accepts once: a second accept, a decline and every later change are refused', async () => {
    const count = await snapshotCount()
    expect(await accept(p.id, managerA, { version: '3', checksum: p.checksum })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/already accepted/) } })
    expect(await accept(p.id, managerA2, { version: '3', checksum: p.checksum })).toMatchObject({ status: 409 })
    expect(await decline(p.id, managerA, {})).toMatchObject({ status: 409, body: { error: expect.stringMatching(/already accepted/) } })
    expect(await snapshotCount()).toBe(count)
    for (const data of [{ status: 'private' }, { status: 'shared' }, { proposal: draft({ title: 'Later thought' }) }]) {
      await expect(update(p.id, data, ann)).rejects.toThrow()
      await expect(payload.update({ collection: PROPOSALS as never, id: p.id, data: data as never })).rejects.toThrow(/can't change|can't go from/)
    }
    for (const user of [ann, managerA]) await expect(remove(p.id, user)).rejects.toThrow()
    await expect(payload.delete({ collection: PROPOSALS as never, id: p.id })).rejects.toThrow(/it is kept/)
    expect(await stored(p.id)).toMatchObject({ status: 'accepted', checksum: p.checksum })
  })

  it('refuses a version that is already stored, and keeps the proposal open', async () => {
    const q = await shared(ben, { proposal: draft({ title: 'Mammals are reptiles', moves: [mammals] }) })
    const count = await snapshotCount()
    expect(await accept(q.id, managerA, { version: '2', checksum: q.checksum })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/already stored/) } })
    expect(await snapshotCount()).toBe(count)
    expect((await stored(q.id)).status).toBe('shared')
    await update(q.id, { status: 'private' }, ben)
    await remove(q.id, ben)
  })

  it('opens the proposal again when its staged version is deleted', async () => {
    await payload.delete({ collection: SNAPSHOTS as never, id: made, user: managerA, overrideAccess: false })
    const doc = await stored(p.id)
    expect(doc).toMatchObject({ status: 'shared', checksum: p.checksum, decidedBy: String(managerA.id), decisionNote: expect.stringMatching(/was deleted, so the proposal is open again/) })
    expect(doc.acceptedInto ?? null).toBeNull()
    expect(await preview(p.id, ben)).toMatchObject({ status: 200, body: { acceptable: true } })
    // It can be accepted again, by another manager, into the version name that is free again.
    const again = await accept(p.id, managerA2, { version: '2', checksum: p.checksum })
    expect(again.status).toBe(200)
    const content = (await snapshot(again.body.snapshot.doc)).snapshot as DatasetSnapshot
    expect(content.derivedFrom!.proposal).toMatchObject({ author: 'Ann Keeper', acceptedBy: 'Dev Curator' })
    expect((await stored(p.id)).status).toBe('accepted')
  })

  it('refuses every proposal on a phylogeny, with the reason', async () => {
    const turtles = { node: 't-testudines', from: 'archelosauria', to: 'amniota' }
    const t = await shared(ben, { proposal: { title: 'Turtles outside the reptiles', base: { kind: 'phylogeny', id: 'archelosauria', version: '1' }, moves: [turtles] } })
    const shown = await preview(t.id, managerA)
    expect(shown).toMatchObject({ status: 200, body: { acceptable: false, notAcceptable: expect.stringMatching(/published hypothesis/), counts: { moves: 1 } } })
    expect(shown.body.broken.map((g: Doc) => g.node)).toContain('archelosauria')
    const count = await snapshotCount()
    expect(await accept(t.id, managerA, { version: '5', checksum: t.checksum })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/published hypothesis/) } })
    expect(await snapshotCount()).toBe(count)
    expect((await stored(t.id)).status).toBe('shared')
  })

  it('accepts nothing when the proposal changed between the manager\'s look and the claim', async () => {
    const q = await shared(ben, { proposal: draft({ title: 'Mammals are reptiles', moves: [mammals] }) })
    const count = await snapshotCount()
    // The author takes it back, rewrites it and shares it again while the accept is under way: same status, new content.
    meanwhile = async () => {
      await update(q.id, { status: 'private' }, ben)
      await update(q.id, { proposal: draft({ title: 'Birds and mammals are reptiles', moves: [birds, mammals] }), status: 'private' }, ben)
      await update(q.id, { status: 'shared' }, ben)
    }
    expect(await accept(q.id, managerA, { version: '3', checksum: q.checksum })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/a moment ago/) } })
    expect(meanwhile).toBeNull()
    expect(await snapshotCount()).toBe(count)
    const now = await stored(q.id)
    expect(now).toMatchObject({ status: 'shared', title: 'Birds and mammals are reptiles' })
    expect(now.checksum).not.toBe(q.checksum)
    expect(now.acceptedInto ?? null).toBeNull()
    await update(q.id, { status: 'private' }, ben)
    await remove(q.id, ben)
  })

  it('stores one version when two managers accept at once', async () => {
    const q = await shared(ben, { proposal: draft({ title: 'Mammals are reptiles', moves: [mammals] }) })
    const count = await snapshotCount()
    const results = await Promise.all([accept(q.id, managerA, { version: '3', checksum: q.checksum }), accept(q.id, managerA2, { version: '4', checksum: q.checksum })])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await snapshotCount()).toBe(count + 1)
    const won = results.find((r) => r.status === 200)!
    const doc = await stored(q.id)
    expect(doc.status).toBe('accepted')
    expect(String(idOf(doc.acceptedInto))).toBe(won.body.snapshot.doc)
    const all = (await payload.find({ collection: SNAPSHOTS as never, depth: 0, limit: 100 })).docs as Doc[]
    expect(all.filter((s) => (s.snapshot as DatasetSnapshot).derivedFrom?.proposal?.id === q.proposalId)).toHaveLength(1)
  })
})

describe('declining', () => {
  it('declines with a note, hides it from other readers, and lets the author revise and share again', async () => {
    const d = await shared(ben, { proposal: draft({ title: 'Crocodiles are not reptiles', moves: [{ node: 'c:crocodylia', from: 'c:reptilia', to: null }] }) })
    expect(await decline(d.id, managerA, { note: 7 })).toMatchObject({ status: 400 })
    expect(await decline(d.id, managerA, '{ not json')).toMatchObject({ status: 400 })
    const count = await snapshotCount()
    const done = await decline(d.id, managerA, { note: 'Needs a reference' })
    expect(done).toMatchObject({ status: 200, body: { proposal: { doc: String(d.id), status: 'declined', checksum: d.checksum } } })
    expect(await snapshotCount()).toBe(count)
    expect(await readAs(d.id, ben)).toMatchObject({ status: 'declined', decisionNote: 'Needs a reference' })
    expect(await readAs(d.id, ben)).not.toHaveProperty('decidedBy')
    expect((await readAs(d.id, managerA)).decidedBy).toBe(String(managerA.id))
    for (const user of [ann, viewerA, managerB, readerB]) await expect(readAs(d.id, user)).rejects.toThrow()
    expect(await decline(d.id, managerA, {})).toMatchObject({ status: 409, body: { error: expect.stringMatching(/already declined/) } })
    expect(await accept(d.id, managerA, { version: '6', checksum: d.checksum })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/was declined/) } })
    expect(await preview(d.id, managerA)).toMatchObject({ status: 200, body: { acceptable: false } })

    await expect(update(d.id, { proposal: draft({ title: 'Again' }) }, ben)).rejects.toThrow(/Set it back to private/)
    await expect(update(d.id, { status: 'shared' }, ben)).rejects.toThrow(/can't go from declined to shared/)
    const revised = await update(d.id, { status: 'private', proposal: draft({ title: 'Crocodiles are not reptiles (Smith 2020)', moves: [{ node: 'c:crocodylia', from: 'c:reptilia', to: null }] }) }, ben)
    expect(revised).toMatchObject({ status: 'private', title: 'Crocodiles are not reptiles (Smith 2020)' })
    expect((await update(d.id, { status: 'shared' }, ben)).status).toBe('shared')
    expect(await seen(ann)).toContain(d.id)

    // A declined proposal can also be deleted by its author, and by nobody else.
    await decline(d.id, managerA, {})
    await expect(remove(d.id, managerA)).rejects.toThrow()
    await remove(d.id, ben)
    await expect(stored(d.id)).rejects.toThrow()
  })

  it('declines nothing when the author took the proposal back a moment before', async () => {
    const d = await shared(ben, { proposal: draft({ title: 'Mammals are reptiles', moves: [mammals] }) })
    // The author unshares between the manager's read and the write: the write is conditional, so it changes nothing.
    const db = payload.db
    const real = db.updateOne
    db.updateOne = async (args) => {
      db.updateOne = real
      await update(d.id, { status: 'private' }, ben)
      return real.call(db, args)
    }
    try {
      expect(await decline(d.id, managerA, { note: 'No' })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/a moment ago/) } })
    } finally {
      db.updateOne = real
    }
    const now = await stored(d.id)
    expect(now.status).toBe('private')
    expect(now.decisionNote ?? null).toBeNull()
    await remove(d.id, ben)
  })
})

describe('when someone leaves', () => {
  it('lets the site take back and delete their open proposals, under the name they last used', async () => {
    const open = await shared(ben, { proposal: draft({ title: 'Mammals are reptiles', moves: [mammals] }) })
    const drafted = await propose(ben, { proposal: draft({ title: 'A thought' }) })
    // Server code, with no user. The name isn't asked for again: nobody is signed in to ask about.
    nameFails = true
    try {
      const back = (await payload.update({ collection: PROPOSALS as never, id: open.id as string, data: { status: 'private' } as never, depth: 0 })) as Doc
      expect(back).toMatchObject({ status: 'private', checksum: open.checksum, author: String(ben.id) })
      expect((back.proposal as Proposal).author).toBe('Ben R.')
    } finally {
      nameFails = false
    }
    expect(await seen(ann)).not.toContain(open.id)
    for (const doc of [open, drafted]) await payload.delete({ collection: PROPOSALS as never, id: doc.id as string })
    for (const doc of [open, drafted]) await expect(stored(doc.id)).rejects.toThrow()
    // Accepted ones stay ("accepts once" above): a snapshot version names them.
  })
})

describe('a withdrawn snapshot', () => {
  it('can\'t be proposed on, shared on or accepted from', async () => {
    const w = await shared(readerB, { snapshot: snapB })
    const own = await propose(managerB, { snapshot: snapB })
    await payload.update({ collection: SNAPSHOTS as never, id: snapB, data: { status: 'withdrawn' } as never, user: managerB, overrideAccess: false })
    const count = await snapshotCount()
    expect(await accept(w.id, managerB, { version: '2', checksum: w.checksum })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/was withdrawn/) } })
    expect(await snapshotCount()).toBe(count)
    expect((await stored(w.id)).status).toBe('shared')
    expect(await preview(w.id, managerB)).toMatchObject({ status: 200, body: { acceptable: false, notAcceptable: 'Its snapshot isn\'t published.' } })
    // A reader can't read a withdrawn snapshot, so there is nothing to compare with.
    expect(await preview(w.id, readerB)).toMatchObject({ status: 409 })
    await expect(propose(managerB, { snapshot: snapB })).rejects.toThrow(/was withdrawn/)
    await expect(propose(readerB, { snapshot: snapB })).rejects.toThrow(/doesn't exist, or you can't read it/)
    await expect(update(own.id, { proposal: draft({ title: 'Later' }) }, managerB)).rejects.toThrow(/was withdrawn/)
    await expect(update(own.id, { status: 'shared' }, managerB)).rejects.toThrow(/while its snapshot is published/)
    // Declining still works, and the author can take theirs back and delete it.
    expect((await decline(w.id, managerB, {})).status).toBe(200)
    await remove(w.id, readerB)
    await remove(own.id, managerB)
  })
})
