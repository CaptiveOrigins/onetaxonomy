import { createView, indexDataset, type TaxonomicView } from '@extantape/onetaxonomy-core'
import type { Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { oneTaxonomy } from '../src'
import { access, makeUser, sealed, startPayload, usersCollection } from './helpers'

const SNAPSHOTS = 'taxonomy-snapshots'
const VIEWS = 'taxonomy-views'
let payload: Payload
let stop: () => Promise<void>
let manager: TypedUser
let reader: TypedUser
let published: string | number
let staged: string | number
const amniotes = sealed.amniotes()
const view = (over: Partial<TaxonomicView> = {}): TaxonomicView => ({
  ...createView(indexDataset(amniotes), { id: 'v-archelosauria', title: 'Turtles with archosaurs', target: { kind: 'phylogeny', id: 'archelosauria' } }),
  ...over,
})

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({ collections: [usersCollection()], plugins: [oneTaxonomy({ access })] }))
  manager = await makeUser(payload, 'manager')
  reader = await makeUser(payload, 'reader')
  published = ((await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: amniotes } as never })) as { id: string | number }).id
  await payload.update({ collection: SNAPSHOTS as never, id: published, data: { status: 'published' } as never, user: manager })
  staged = ((await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: sealed.structures() } as never })) as { id: string | number }).id
})
afterAll(async () => stop?.())

const create = (data: Record<string, unknown>, user: TypedUser | null = manager) => payload.create({ collection: VIEWS as never, data: data as never, user, overrideAccess: false })
const update = (id: string | number, data: Record<string, unknown>, user: TypedUser | null = manager) => payload.update({ collection: VIEWS as never, id, data: data as never, user, overrideAccess: false })

describe('views', () => {
  it('stores a view pinned to its snapshot as a draft', async () => {
    const doc = (await create({ title: 'Archelosauria', snapshot: published, view: view() })) as Record<string, unknown>
    expect(doc).toMatchObject({ status: 'draft', viewId: 'v-archelosauria' })
  })

  it('refuses a view that pins another snapshot, or none by checksum', async () => {
    const v = view()
    await expect(create({ title: 'x', snapshot: published, view: { ...v, snapshot: { ...v.snapshot, checksum: 'sha256:' + '1'.repeat(64) } } })).rejects.toThrow(/pins/)
    await expect(create({ title: 'x', snapshot: published, view: { ...v, snapshot: { id: v.snapshot.id, version: v.snapshot.version } } })).rejects.toThrow(/pins/)
    await expect(create({ title: 'x', snapshot: staged, view: v })).rejects.toThrow(/pins/)
  })

  it('refuses a view core finds errors in (unknown nodes, unknown hierarchy)', async () => {
    await expect(create({ title: 'x', snapshot: published, view: view({ collapsed: ['nowhere'] }) })).rejects.toThrow(/not in this phylogeny/)
    await expect(create({ title: 'x', snapshot: published, view: view({ target: { kind: 'phylogeny', id: 'missing' } }) })).rejects.toThrow(/Unknown phylogeny/)
    await expect(create({ title: 'x', snapshot: published, view: { nonsense: true } })).rejects.toThrow(/can't be stored|pins/)
  })

  it('refuses readers, and starting as published', async () => {
    await expect(create({ title: 'x', snapshot: published, view: view() }, reader)).rejects.toThrow(/not allowed/i)
    await expect(create({ title: 'x', snapshot: published, view: view(), status: 'published' })).rejects.toThrow(/starts as a draft/)
  })

  it('publishes only over a published snapshot, then locks the view', async () => {
    const structures = sealed.structures()
    const draftOnStaged = (await create({
      title: 'Polytomy',
      snapshot: staged,
      view: createView(indexDataset(structures), { id: 'v-poly', title: 'Polytomy', target: { kind: 'phylogeny', id: 'polytomy' } }),
    })) as { id: string | number }
    await expect(update(draftOnStaged.id, { status: 'published' })).rejects.toThrow(/Publish the snapshot before/)

    const doc = (await create({ title: 'To publish', snapshot: published, view: view({ id: 'v-pub' }) })) as { id: string | number }
    // A draft can still change.
    await update(doc.id, { title: 'To publish, renamed', view: view({ id: 'v-pub', collapsed: ['archosauria'] }) })
    const pub = (await update(doc.id, { status: 'published' })) as Record<string, unknown>
    expect(pub).toMatchObject({ status: 'published', publishedBy: String(manager.id) })
    await expect(update(doc.id, { view: view({ id: 'v-pub' }) })).rejects.toThrow(/published view can't be edited/)
    await expect(update(doc.id, { title: 'Renamed' })).rejects.toThrow(/published view can't be edited/)
    await expect(payload.update({ collection: VIEWS as never, id: doc.id, data: { snapshot: staged } as never })).rejects.toThrow(/published view can't be edited/)
    await expect(payload.delete({ collection: VIEWS as never, id: doc.id })).rejects.toThrow(/can't be deleted/)

    const readable = await payload.find({ collection: VIEWS as never, user: reader, overrideAccess: false, depth: 0 })
    expect(readable.docs.map((d) => (d as { id: unknown }).id)).toEqual([doc.id])
    await expect(payload.find({ collection: VIEWS as never, user: null, overrideAccess: false })).rejects.toThrow(/not allowed/i)

    await update(doc.id, { status: 'withdrawn' })
    expect((await payload.find({ collection: VIEWS as never, user: reader, overrideAccess: false, depth: 0 })).totalDocs).toBe(0)
  })

  it('refuses new views over a withdrawn snapshot; drafts can be deleted', async () => {
    const draft = (await create({ title: 'Draft', snapshot: published, view: view({ id: 'v-draft' }) })) as { id: string | number }
    await payload.delete({ collection: VIEWS as never, id: draft.id, user: manager, overrideAccess: false })
    await payload.update({ collection: SNAPSHOTS as never, id: published, data: { status: 'withdrawn' } as never })
    await expect(create({ title: 'Late', snapshot: published, view: view({ id: 'v-late' }) })).rejects.toThrow(/withdrawn/)
  })
})
