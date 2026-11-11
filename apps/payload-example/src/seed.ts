import { createView, indexDataset, sealSnapshot, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import type { Payload, TypedUser } from 'payload'

import amniotes from '../../../fixtures/amniotes.json'
import structures from '../../../fixtures/structures.json'

const SNAPSHOTS = 'taxonomy-snapshots'
const VIEWS = 'taxonomy-views'
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * Fills an empty site, once: two accounts (with the password in `EXAMPLE_PASSWORD`, which `pnpm dev` makes up), one
 * published snapshot with two published views, and one staged snapshot that only a curator sees. The snapshots are
 * the repository's illustrative fixtures, not real data.
 *
 * Publishing is recorded against a person, so the seed publishes as the curator. On a database with no curator and
 * no `EXAMPLE_PASSWORD` it adds nothing.
 */
export async function seed(payload: Payload): Promise<void> {
  const password = process.env.EXAMPLE_PASSWORD
  let curator = (await payload.find({ collection: 'users', where: { role: { equals: 'curator' } }, limit: 1, depth: 0 })).docs[0] as TypedUser | undefined
  if (!curator && password && (await payload.find({ collection: 'users', limit: 1, depth: 0 })).docs.length === 0) {
    curator = (await payload.create({ collection: 'users', data: { email: 'curator@example.org', password, handle: 'Cara Curator', role: 'curator' } as never })) as unknown as TypedUser
    await payload.create({ collection: 'users', data: { email: 'member@example.org', password, handle: 'Morgan Member', role: 'member' } as never })
  }
  if (!curator) {
    payload.logger.info('OneTaxonomy example: no curator account yet, so no example data was added. Start it with `pnpm dev`, or set EXAMPLE_PASSWORD on an empty database.')
    return
  }
  if ((await payload.find({ collection: SNAPSHOTS as never, limit: 1, depth: 0, select: {} })).docs.length > 0) return
  // `collection: 'users'` is what Payload's sign-in adds to a person; the Local API needs it said.
  const user = { ...curator, collection: 'users' } as TypedUser

  const snapshot = sealSnapshot(copy(amniotes) as unknown as DatasetSnapshot)
  const stored = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot } as never, user })) as { id: string | number }
  await payload.update({ collection: SNAPSHOTS as never, id: stored.id, data: { status: 'published' } as never, user })

  const index = indexDataset(snapshot)
  const views = [
    createView(index, { id: 'amniote-tree', title: 'Amniotes: one tree hypothesis', target: { kind: 'phylogeny', id: 'archelosauria' } }),
    createView(index, { id: 'amniote-classes', title: 'Amniotes: the traditional classes', target: { kind: 'classification', id: 'traditional' } }),
  ]
  for (const view of views) {
    const doc = (await payload.create({ collection: VIEWS as never, data: { title: view.title, snapshot: stored.id, view } as never, user })) as { id: string | number }
    await payload.update({ collection: VIEWS as never, id: doc.id, data: { status: 'published' } as never, user })
  }

  // Staged: stored and checked, but not public until a curator publishes it.
  await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealSnapshot(copy(structures) as unknown as DatasetSnapshot) } as never, user })
}
