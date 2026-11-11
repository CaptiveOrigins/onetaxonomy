import { createView, indexDataset } from '@captiveorigins/onetaxonomy-core'
import type { Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { oneTaxonomy } from '../src'
import { access, callEndpoint, makeUser, roleOf, sealed, startPayload, tenantsCollection, usersCollection } from './helpers'

const SNAPSHOTS = 'taxonomy-snapshots'
const VIEWS = 'taxonomy-views'
let payload: Payload
let stop: () => Promise<void>
let tenantA: string | number
let tenantB: string | number
let managerA: TypedUser
let managerB: TypedUser
let readerA: TypedUser
let readerB: TypedUser
let noTenant: TypedUser
let throwsTenant: TypedUser
let snapA: string | number
let snapB: string | number

const tenantOfUser = (user: unknown) => {
  if (roleOf(user) === 'thrower') throw new Error('tenant lookup failed')
  const t = (user as { tenant?: unknown } | null | undefined)?.tenant
  return t && typeof t === 'object' ? ((t as { id: string | number }).id ?? null) : ((t as string | number | null | undefined) ?? null)
}

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({
    collections: [tenantsCollection, usersCollection(true)],
    plugins: [oneTaxonomy({ access: { manage: access.manage, read: ({ req }) => Boolean(req.user) }, tenant: { collection: 'tenants', resolve: ({ req }) => tenantOfUser(req.user) } })],
  }))
  tenantA = ((await payload.create({ collection: 'tenants' as never, data: { name: 'A' } as never })) as { id: string | number }).id
  tenantB = ((await payload.create({ collection: 'tenants' as never, data: { name: 'B' } as never })) as { id: string | number }).id
  managerA = await makeUser(payload, 'manager', { tenant: tenantA })
  managerB = await makeUser(payload, 'manager', { tenant: tenantB })
  readerA = await makeUser(payload, 'reader', { tenant: tenantA })
  readerB = await makeUser(payload, 'reader', { tenant: tenantB })
  noTenant = await makeUser(payload, 'manager')
  throwsTenant = await makeUser(payload, 'thrower', { tenant: tenantA })
})
afterAll(async () => stop?.())

const create = (collection: string, data: Record<string, unknown>, user: TypedUser) => payload.create({ collection: collection as never, data: data as never, user, overrideAccess: false })
const idOf = (v: unknown) => (v && typeof v === 'object' ? (v as { id: unknown }).id : v)

describe('tenant scope', () => {
  it('fills a new snapshot\'s tenant from its maker, and lets each tenant store the same snapshot', async () => {
    const a = (await create(SNAPSHOTS, { snapshot: sealed.amniotes() }, managerA)) as Record<string, unknown>
    expect(idOf(a.tenant)).toBe(tenantA)
    const b = (await create(SNAPSHOTS, { snapshot: sealed.amniotes() }, managerB)) as Record<string, unknown>
    expect(idOf(b.tenant)).toBe(tenantB)
    snapA = a.id as string
    snapB = b.id as string
    for (const [id, user] of [[snapA, managerA], [snapB, managerB]] as const) await payload.update({ collection: SNAPSHOTS as never, id, data: { status: 'published' } as never, user, overrideAccess: false })
  })

  it('refuses making a record in another tenant', async () => {
    await expect(create(SNAPSHOTS, { snapshot: sealed.structures(), tenant: tenantB }, managerA)).rejects.toThrow(/not allowed/i)
  })

  it('shows each reader only their own tenant\'s snapshots', async () => {
    const seen = async (user: TypedUser) => (await payload.find({ collection: SNAPSHOTS as never, user, overrideAccess: false, depth: 0 })).docs.map((d) => (d as { id: unknown }).id)
    expect(await seen(readerA)).toEqual([snapA])
    expect(await seen(readerB)).toEqual([snapB])
    await expect(payload.findByID({ collection: SNAPSHOTS as never, id: snapA, user: readerB, overrideAccess: false })).rejects.toThrow()
  })

  it('answers 404 to every read endpoint for another tenant\'s published snapshot (cross-tenant denial)', async () => {
    const calls: [string, Record<string, string>][] = [
      ['/:id/search', { q: 'aves' }],
      ['/:id/ancestors', { phylogeny: 'archelosauria', node: 't-aves' }],
      ['/:id/descendants', { phylogeny: 'archelosauria', node: 'sauria' }],
      ['/:id/mrca', { phylogeny: 'archelosauria', nodes: 't-aves,t-crocodylia' }],
    ]
    for (const [path, q] of calls) {
      expect((await callEndpoint(payload, SNAPSHOTS, path, String(snapA), q, readerA)).status).toBe(200)
      expect((await callEndpoint(payload, SNAPSHOTS, path, String(snapA), q, readerB)).status).toBe(404)
      expect((await callEndpoint(payload, SNAPSHOTS, path, String(snapA), q, managerB)).status).toBe(404)
      // No tenant, or a tenant lookup that throws, is no access at all.
      expect((await callEndpoint(payload, SNAPSHOTS, path, String(snapA), q, noTenant)).status).toBe(404)
      expect((await callEndpoint(payload, SNAPSHOTS, path, String(snapA), q, throwsTenant)).status).toBe(404)
    }
  })

  it('refuses another tenant\'s manager changing, withdrawing or deleting a snapshot', async () => {
    await expect(payload.update({ collection: SNAPSHOTS as never, id: snapA, data: { status: 'withdrawn' } as never, user: managerB, overrideAccess: false })).rejects.toThrow()
    await expect(payload.delete({ collection: SNAPSHOTS as never, id: snapA, user: managerB, overrideAccess: false })).rejects.toThrow()
    expect(((await payload.findByID({ collection: SNAPSHOTS as never, id: snapA })) as unknown as { status: string }).status).toBe('published')
  })

  it('never moves a record to another tenant, even for trusted code', async () => {
    await expect(payload.update({ collection: SNAPSHOTS as never, id: snapA, data: { tenant: tenantB } as never, user: managerA, overrideAccess: false })).rejects.toThrow(/stays in the tenant/)
    await expect(payload.update({ collection: SNAPSHOTS as never, id: snapA, data: { tenant: tenantB } as never })).rejects.toThrow(/stays in the tenant/)
  })

  it('refuses a view over another tenant\'s snapshot, even from trusted code', async () => {
    const v = createView(indexDataset(sealed.amniotes()), { id: 'v', title: 'v', target: { kind: 'phylogeny', id: 'archelosauria' } })
    await expect(payload.create({ collection: VIEWS as never, data: { title: 'Cross', snapshot: snapB, view: v, tenant: tenantA } as never })).rejects.toThrow(/its own tenant/)
    const own = (await create(VIEWS, { title: 'Own', snapshot: snapA, view: v }, managerA)) as Record<string, unknown>
    expect(idOf(own.tenant)).toBe(tenantA)
    await payload.update({ collection: VIEWS as never, id: own.id as string, data: { status: 'published' } as never, user: managerA, overrideAccess: false })
    expect((await payload.find({ collection: VIEWS as never, user: readerB, overrideAccess: false })).totalDocs).toBe(0)
    expect((await payload.find({ collection: VIEWS as never, user: readerA, overrideAccess: false })).totalDocs).toBe(1)
  })
})
