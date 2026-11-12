import { sealSnapshot, snapshotChecksum } from '@captiveorigins/onetaxonomy-core'
import { readdirSync, readFileSync } from 'node:fs'
import type { Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { oneTaxonomy } from '../src'
import { access, callEndpoint, makeUser, sealed, startPayload, unfrozen, usersCollection, WITH_CONTENT } from './helpers'

const SNAPSHOTS = 'taxonomy-snapshots'
let payload: Payload
let stop: () => Promise<void>
let manager: TypedUser
let reader: TypedUser

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({ collections: [usersCollection()], plugins: [oneTaxonomy({ access })] }))
  manager = await makeUser(payload, 'manager')
  reader = await makeUser(payload, 'reader')
})
afterAll(async () => stop?.())

const create = (snapshot: unknown, user: TypedUser | null = manager, extra: Record<string, unknown> = {}) =>
  payload.create({ collection: SNAPSHOTS as never, data: { snapshot, ...extra } as never, user, overrideAccess: false })
const update = (id: string | number, data: Record<string, unknown>, user: TypedUser | null = manager) =>
  payload.update({ collection: SNAPSHOTS as never, id, data: data as never, user, overrideAccess: false })
const findAs = (user: TypedUser | null) => payload.find({ collection: SNAPSHOTS as never, user, overrideAccess: false, depth: 0 })

describe('the plugin', () => {
  it('adds only the snapshots and views collections (no imports or proposals unless asked), and the read endpoints', () => {
    const slugs = payload.config.collections.map((c) => c.slug).filter((s) => !s.startsWith('payload-'))
    expect(slugs.sort()).toEqual(['taxonomy-snapshots', 'taxonomy-views', 'users'])
    const paths = (slug: string) => (payload.collections[slug as never]!.config.endpoints as { path: string }[]).map((e) => e.path)
    expect(paths(SNAPSHOTS).slice(0, 6)).toEqual(['/:id/search', '/:id/ancestors', '/:id/descendants', '/:id/mrca', '/:id/coverage', '/:id/export'])
    expect(paths('taxonomy-views').slice(0, 2)).toEqual(['/:id/projection', '/:id/export'])
  })

  it('refuses a slug that is already taken, and a tenants collection that isn\'t there', () => {
    expect(() => oneTaxonomy({ slugs: { snapshots: 'users' } })({ collections: [usersCollection()] } as never)).toThrow(/already exists/)
    expect(() => oneTaxonomy({ tenant: { collection: 'tenants', resolve: () => 'a' } })({ collections: [usersCollection()] } as never)).toThrow(/isn't in this config/)
    expect(() => oneTaxonomy({ imports: { uploads: { collection: 'users' } } })({ collections: [usersCollection()] } as never)).toThrow(/isn't an upload collection/)
    expect(() => oneTaxonomy({ imports: { fetch: () => '' } })({ collections: [usersCollection(), { slug: 'taxonomy-imports', fields: [] }] } as never)).toThrow(/already exists/)
    expect(() => oneTaxonomy({ proposals: true })({ collections: [usersCollection(), { slug: 'taxonomy-proposals', fields: [] }] } as never)).toThrow(/already exists/)
    // A proposals slug that isn't used doesn't clash.
    expect(() => oneTaxonomy()({ collections: [usersCollection(), { slug: 'taxonomy-proposals', fields: [] }] } as never)).not.toThrow()
  })
})

describe('core stays free of Payload', () => {
  it('no other package depends on or imports payload (only this plugin does)', () => {
    for (const pkg of ['core', 'import', 'layout', 'react', 'education']) {
      const root = new URL(`../../${pkg}/`, import.meta.url)
      const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as Record<string, Record<string, string> | undefined>
      for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) expect(Object.keys(manifest[field] ?? {}).filter((d) => /payload/.test(d)), `${pkg} ${field}`).toEqual([])
      const sources = (readdirSync(new URL('src/', root), { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f))
      for (const f of sources) expect(readFileSync(new URL(`src/${f}`, root), 'utf8'), `${pkg}/src/${f}`).not.toMatch(/from ['"](payload|@payloadcms\/)/)
    }
  })
})

describe('storing a snapshot', () => {
  it('stores a sealed snapshot as staged, with its id, version, checksum and counts taken from it', async () => {
    const s = sealed.amniotes()
    const doc = (await create(s)) as Record<string, any>
    expect(doc).toMatchObject({ status: 'staged', snapshotId: 'fixture-amniotes', version: '1', checksum: s.checksum, label: 'fixture-amniotes 1' })
    expect(doc.counts).toMatchObject({ names: s.names.length, concepts: s.concepts.length, classifications: 1, phylogenies: 2 })
    const kept = (await payload.findByID({ collection: SNAPSHOTS as never, id: doc.id, depth: 0, select: { snapshot: true } as never })) as Record<string, any>
    expect(kept.snapshot).toEqual(s)
    expect(kept.snapshot.checksum).toBe(snapshotChecksum(kept.snapshot))
  })

  it('refuses a snapshot changed after sealing (bad checksum)', async () => {
    const s = unfrozen(sealed.structures())
    s.concepts[0]!.rank = 'changed after sealing'
    await expect(create(s)).rejects.toThrow(/doesn't match its checksum/)
    await expect(create({ ...sealed.structures(), checksum: 'sha256:' + '0'.repeat(64) })).rejects.toThrow(/doesn't match its checksum/)
    // Refused for trusted server code too: the check is in a hook, not in access.
    await expect(payload.create({ collection: SNAPSHOTS as never, data: { snapshot: s } as never })).rejects.toThrow(/doesn't match its checksum/)
  })

  it('refuses an unsealed snapshot, another schema version and a snapshot with validation errors', async () => {
    const { checksum: _c, ...unsealed } = sealed.structures()
    await expect(create(unsealed)).rejects.toThrow(/isn't sealed/)
    await expect(create(sealSnapshot({ ...unfrozen(sealed.structures()), schemaVersion: 2 as never }))).rejects.toThrow(/schema version 1/)
    const broken = unfrozen(sealed.structures())
    broken.id = 'broken'
    broken.phylogenies[0]!.edges.push({ id: 'dangling', parent: 'root', child: 'nowhere' })
    await expect(create(sealSnapshot(broken))).rejects.toThrow(/error\(s\)/)
    await expect(create('{not json')).rejects.toThrow(/valid JSON/)
  })

  it('refuses the same id and version twice, saying whether the content differs', async () => {
    await expect(create(sealed.amniotes())).rejects.toThrow(/already stored\./)
    const changed = unfrozen(sealed.amniotes())
    changed.createdAt = '2030-01-01T00:00:00.000Z'
    await expect(create(sealSnapshot(changed))).rejects.toThrow(/different content/)
  })

  it('backs that with a unique index on id and version, for writes that race the check', async () => {
    const model = (payload.db as unknown as { collections: Record<string, { collection: { indexes: () => Promise<{ key: Record<string, number>; unique?: boolean }[]> } }> }).collections[SNAPSHOTS]!
    const indexes = await model.collection.indexes()
    expect(indexes.find((i) => Object.keys(i.key).join() === 'snapshotId,version')).toMatchObject({ unique: true })
  })

  it('refuses a given id, version or checksum that differs from the snapshot\'s own, and starting as published', async () => {
    const s = unfrozen(sealed.checklist())
    s.version = 'given'
    await expect(create(sealSnapshot(s), manager, { version: 'other' })).rejects.toThrow(/isn't the snapshot's own/)
    await expect(create(sealSnapshot(s), manager, { status: 'published' })).rejects.toThrow(/starts as staged/)
    await expect(create(sealSnapshot(s), manager, { publishedBy: 'someone' })).rejects.toThrow(/set by publishing/)
  })

  it('refuses people who may not manage: readers, anonymous, and a host check that throws', async () => {
    const thrower = await makeUser(payload, 'thrower')
    for (const user of [reader, null, thrower]) await expect(create(sealed.checklist(), user)).rejects.toThrow(/not allowed/i)
  })
})

describe('a stored snapshot\'s content is read only when it is asked for by name', () => {
  let id: string | number
  const s = (() => {
    const draft = unfrozen(sealed.checklist())
    draft.version = 'content-test'
    return sealSnapshot(draft)
  })()
  // Something only the content holds, never the fields beside it.
  const INSIDE = '"schemaVersion"'

  it('leaves it out of what storing answers', async () => {
    const made = (await create(s)) as Record<string, unknown>
    id = made.id as string
    expect(made).toMatchObject({ snapshotId: s.id, version: 'content-test', checksum: s.checksum, status: 'staged' })
    expect(made).not.toHaveProperty('snapshot')
    expect(JSON.stringify(made)).not.toContain(INSIDE)
  })

  it('leaves it out of a read, a list, an update\'s answer and a delete\'s answer when no select is named, for a manager and for trusted code', async () => {
    for (const as of [{ user: manager, overrideAccess: false }, {}]) {
      const one = (await payload.findByID({ collection: SNAPSHOTS as never, id, depth: 0, ...as })) as Record<string, unknown>
      expect(one).toMatchObject({ id, checksum: s.checksum, counts: { concepts: s.concepts.length } })
      expect(JSON.stringify(one)).not.toContain(INSIDE)
      const list = await payload.find({ collection: SNAPSHOTS as never, depth: 0, limit: 100, ...as })
      expect(list.docs.map((d) => (d as { id: unknown }).id)).toContain(id)
      expect(JSON.stringify(list.docs)).not.toContain(INSIDE)
    }
    const published = (await update(id, { status: 'published' })) as Record<string, unknown>
    expect(published).toMatchObject({ status: 'published', checksum: s.checksum })
    expect(JSON.stringify(published)).not.toContain(INSIDE)
    const many = await payload.update({ collection: SNAPSHOTS as never, where: { id: { equals: id } }, data: { status: 'withdrawn' } as never, user: manager, overrideAccess: false })
    expect(many.docs).toHaveLength(1)
    expect(JSON.stringify(many.docs)).not.toContain(INSIDE)
    const other = unfrozen(sealed.checklist())
    other.version = 'content-test-deleted'
    const staged = (await create(sealSnapshot(other))) as { id: string | number }
    const gone = await payload.delete({ collection: SNAPSHOTS as never, id: staged.id, user: manager, overrideAccess: false })
    expect(gone).toMatchObject({ id: staged.id, version: 'content-test-deleted' })
    expect(JSON.stringify(gone)).not.toContain(INSIDE)
  })

  it('gives it, exactly as sealed, to a select that names it', async () => {
    const only = (await payload.findByID({ collection: SNAPSHOTS as never, id, depth: 0, select: { snapshot: true } as never, user: manager, overrideAccess: false })) as Record<string, unknown>
    expect(only.snapshot).toEqual(s)
    expect(only).not.toHaveProperty('checksum')
    const whole = (await payload.findByID({ collection: SNAPSHOTS as never, id, depth: 0, select: WITH_CONTENT })) as Record<string, unknown>
    expect(whole).toMatchObject({ snapshot: s, checksum: s.checksum, status: 'withdrawn' })
    const listed = await payload.find({ collection: SNAPSHOTS as never, where: { id: { equals: id } }, depth: 0, select: { snapshot: true } as never })
    expect((listed.docs[0] as unknown as Record<string, unknown>).snapshot).toEqual(s)
    // A select that names other fields is left alone: it already says what is wanted.
    const some = (await payload.findByID({ collection: SNAPSHOTS as never, id, depth: 0, select: { version: true } as never })) as Record<string, unknown>
    expect(some).toEqual({ id, version: 'content-test' })
    // So is one that only leaves fields out: everything else comes, the content included.
    const allBut = (await payload.findByID({ collection: SNAPSHOTS as never, id, depth: 0, select: { label: false } as never })) as Record<string, unknown>
    expect(allBut).not.toHaveProperty('label')
    expect(allBut).toMatchObject({ snapshot: s, checksum: s.checksum })
  })

  it('still locks the content: an update is compared with what is stored, not with what was read', async () => {
    const fresh = unfrozen(sealed.checklist())
    fresh.version = 'content-test-locked'
    const doc = (await create(sealSnapshot(fresh))) as { id: string | number }
    await expect(update(doc.id, { snapshot: sealed.structures() })).rejects.toThrow(/can't be edited/)
    await expect(update(doc.id, { snapshot: null })).rejects.toThrow(/can't be edited/)
    // The same content sent back is no change.
    await expect(update(doc.id, { snapshot: sealSnapshot(fresh) })).resolves.toMatchObject({ status: 'staged' })
    await payload.delete({ collection: SNAPSHOTS as never, id: doc.id })
  })

  it('shows the content field in the admin only on the new-snapshot form', () => {
    const field = payload.collections[SNAPSHOTS as never]!.config.fields.find((f) => 'name' in f && f.name === 'snapshot') as unknown as { admin: { condition: (data: unknown, sibling: unknown, more: { operation: string }) => boolean } }
    expect(field.admin.condition({}, {}, { operation: 'create' })).toBe(true)
    expect(field.admin.condition({ id }, {}, { operation: 'update' })).toBe(false)
  })
})

describe('publishing and editing', () => {
  let id: string | number
  beforeAll(async () => {
    const s = unfrozen(sealed.checklist())
    s.version = 'publish-test'
    id = ((await create(sealSnapshot(s))) as { id: string | number }).id
  })

  it('hides staged snapshots from readers and anonymous requests', async () => {
    expect((await findAs(reader)).docs.map((d) => (d as { id: unknown }).id)).not.toContain(id)
    await expect(findAs(null)).rejects.toThrow(/not allowed/i)
    expect((await findAs(manager)).docs.map((d) => (d as { id: unknown }).id)).toContain(id)
  })

  it('never lets a sealed snapshot\'s content change, staged or published, even for trusted code', async () => {
    const other = sealed.structures()
    await expect(update(id, { snapshot: other })).rejects.toThrow(/can't be edited/)
    await expect(update(id, { checksum: other.checksum })).rejects.toThrow(/can't be edited/)
    await expect(payload.update({ collection: SNAPSHOTS as never, id, data: { version: 'x' } as never })).rejects.toThrow(/can't be edited/)
  })

  it('publishes as a signed-in manager, recording who and when; readers then see it', async () => {
    await expect(update(id, { status: 'published' }, reader)).rejects.toThrow(/not allowed/i)
    await expect(payload.update({ collection: SNAPSHOTS as never, id, data: { status: 'published' } as never })).rejects.toThrow(/signed-in person/)
    const doc = (await update(id, { status: 'published' })) as Record<string, unknown>
    expect(doc).toMatchObject({ status: 'published', publishedBy: String(manager.id) })
    expect(Date.parse(String(doc.publishedAt))).toBeGreaterThan(Date.now() - 60_000)
    expect((await findAs(reader)).docs.map((d) => (d as { id: unknown }).id)).toContain(id)
  })

  it('can\'t edit a published snapshot, move it back to staged, or rewrite who published it', async () => {
    const changed = unfrozen(sealed.checklist())
    changed.version = 'publish-test'
    changed.concepts[0]!.rank = 'edited'
    await expect(update(id, { snapshot: sealSnapshot(changed) })).rejects.toThrow(/can't be edited/)
    await expect(update(id, { status: 'staged' })).rejects.toThrow(/can't go from published to staged/)
    await expect(update(id, { publishedBy: 'someone else' })).rejects.toThrow(/set by publishing/)
  })

  it('refuses deleting a published snapshot, even for trusted code; a staged one can be deleted', async () => {
    await expect(payload.delete({ collection: SNAPSHOTS as never, id, user: manager, overrideAccess: false })).rejects.toThrow()
    await expect(payload.delete({ collection: SNAPSHOTS as never, id })).rejects.toThrow(/can't be deleted/)
    const s = unfrozen(sealed.checklist())
    s.version = 'to-delete'
    const staged = (await create(sealSnapshot(s))) as { id: string | number }
    await expect(payload.delete({ collection: SNAPSHOTS as never, id: staged.id, user: reader, overrideAccess: false })).rejects.toThrow()
    await payload.delete({ collection: SNAPSHOTS as never, id: staged.id, user: manager, overrideAccess: false })
    await expect(payload.findByID({ collection: SNAPSHOTS as never, id: staged.id, disableErrors: true })).resolves.toBeNull()
  })

  it('withdrawing hides it from readers and is final', async () => {
    await update(id, { status: 'withdrawn' })
    expect((await findAs(reader)).docs.map((d) => (d as { id: unknown }).id)).not.toContain(id)
    expect((await findAs(manager)).docs.map((d) => (d as { id: unknown }).id)).toContain(id)
    await expect(update(id, { status: 'published' })).rejects.toThrow(/can't go from withdrawn to published/)
  })
})

describe('reading a stored snapshot that was changed in the database', () => {
  it('refuses to answer from it (500), instead of answering from changed data', async () => {
    const s = unfrozen(sealed.structures())
    s.version = 'tampered'
    const doc = (await create(sealSnapshot(s))) as { id: string | number }
    await update(doc.id, { status: 'published' })
    // Changed behind Payload's back, as a direct database edit would.
    const model = (payload.db as unknown as { collections: Record<string, { updateOne: (q: unknown, u: unknown) => Promise<unknown> }> }).collections[SNAPSHOTS]!
    await model.updateOne({ _id: doc.id }, { $set: { 'snapshot.concepts.0.rank': 'tampered' } })
    const res = await callEndpoint(payload, SNAPSHOTS, '/:id/search', String(doc.id), { q: 'Exemplum' }, reader)
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/no longer matches its checksum/)
  })
})
