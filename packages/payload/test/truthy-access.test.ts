import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { oneTaxonomy } from '../src'
import { callEndpoint, makeUser, sealed, startPayload, usersCollection } from './helpers'

// Its own file: Payload keeps one instance per process, so a different config needs a separate test file.
const SNAPSHOTS = 'taxonomy-snapshots'
let payload: Payload
let stop: () => Promise<void>

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({
    collections: [usersCollection()],
    // Host callbacks that return truthy values other than true.
    plugins: [oneTaxonomy({ access: { read: (() => 'yes') as never, manage: (() => 1) as never } })],
  }))
})
afterAll(async () => stop?.())

it('treats a host callback returning a truthy value other than true as no', async () => {
  const user = await makeUser(payload, 'manager')
  const doc = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.amniotes() } as never })) as { id: string | number }
  // Published by trusted code (access skipped, a signed-in person recorded), so only the read callback decides.
  await payload.update({ collection: SNAPSHOTS as never, id: doc.id, data: { status: 'published' } as never, user })
  await expect(payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.structures() } as never, user, overrideAccess: false })).rejects.toThrow(/not allowed/i)
  await expect(payload.find({ collection: SNAPSHOTS as never, user, overrideAccess: false })).rejects.toThrow(/not allowed/i)
  expect((await callEndpoint(payload, SNAPSHOTS, '/:id/search', String(doc.id), { q: 'aves' }, user)).status).toBe(404)
})
