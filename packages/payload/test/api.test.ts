import { applyViewAction, createView, indexDataset, parseView, sealSnapshot, type TaxonomicView } from '@captiveorigins/onetaxonomy-core'
import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { coverageOf, exportView, oneTaxonomy, projectedView, searchNames } from '../src'
import { access, callEndpoint, makeUser, sealed, startPayload, unfrozen, usersCollection } from './helpers'

const SNAPSHOTS = 'taxonomy-snapshots'
const VIEWS = 'taxonomy-views'
let payload: Payload
let stop: () => Promise<void>
let manager: TypedUser
let reader: TypedUser
let thrower: TypedUser
const ids: Record<string, string> = {}
const views: Record<string, string> = {}
const amniotesIndex = indexDataset(sealed.amniotes())
// A published view of the archelosauria hypothesis with the squamates folded away, so its disclosure has something to say.
const turtlesView: TaxonomicView = applyViewAction(createView(amniotesIndex, { id: 'v-turtles', title: 'Turtles with archosaurs', target: { kind: 'phylogeny', id: 'archelosauria' } }), { type: 'hide', node: 't-squamata' }, amniotesIndex)

beforeAll(async () => {
  ;({ payload, stop } = await startPayload({ collections: [usersCollection()], plugins: [oneTaxonomy({ access, limits: { maxResults: 5, maxMrcaNodes: 3 } })] }))
  manager = await makeUser(payload, 'manager')
  reader = await makeUser(payload, 'reader')
  thrower = await makeUser(payload, 'thrower')
  for (const [key, s] of Object.entries({ amniotes: sealed.amniotes(), structures: sealed.structures(), checklist: sealed.checklist() })) {
    const doc = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: s } as never })) as { id: string | number }
    ids[key] = String(doc.id)
    if (key !== 'checklist') await payload.update({ collection: SNAPSHOTS as never, id: doc.id, data: { status: 'published' } as never, user: manager, overrideAccess: false })
  }
  const makeView = async (title: string, snapshot: string | number, view: TaxonomicView, publish: boolean) => {
    const doc = (await payload.create({ collection: VIEWS as never, data: { title, snapshot, view } as never })) as { id: string | number }
    if (publish) await payload.update({ collection: VIEWS as never, id: doc.id, data: { status: 'published' } as never, user: manager, overrideAccess: false })
    return String(doc.id)
  }
  views.published = await makeView('Turtles with archosaurs', ids.amniotes!, turtlesView, true)
  views.draft = await makeView('Draft', ids.amniotes!, { ...createView(amniotesIndex, { id: 'v-draft', title: 'Draft', target: { kind: 'classification', id: 'traditional' } }) }, false)
  // A snapshot published, viewed, then withdrawn by its publisher.
  const old = unfrozen(sealed.amniotes())
  old.version = '0.9'
  const oldSealed = sealSnapshot(old)
  const oldDoc = (await payload.create({ collection: SNAPSHOTS as never, data: { snapshot: oldSealed } as never })) as { id: string | number }
  ids.withdrawn = String(oldDoc.id)
  await payload.update({ collection: SNAPSHOTS as never, id: oldDoc.id, data: { status: 'published' } as never, user: manager, overrideAccess: false })
  views.ofWithdrawn = await makeView('Old turtles', oldDoc.id, createView(indexDataset(oldSealed), { id: 'v-old', title: 'Old turtles', target: { kind: 'phylogeny', id: 'archelosauria' } }), true)
  await payload.update({ collection: SNAPSHOTS as never, id: oldDoc.id, data: { status: 'withdrawn' } as never, user: manager, overrideAccess: false })
})
afterAll(async () => stop?.())

const call = (path: string, key: string, query: Record<string, string | number>, user: TypedUser | null = reader) => callEndpoint(payload, SNAPSHOTS, path, ids[key] ?? key, query, user)

describe('search by name', () => {
  it('finds a scientific name exactly, case aside, with its concept, status and authorship', async () => {
    const res = await call('/:id/search', 'amniotes', { q: 'aves' })
    expect(res.status).toBe(200)
    expect(res.body.snapshot).toMatchObject({ id: 'fixture-amniotes', version: '1', doc: ids.amniotes })
    expect(res.body.results).toEqual([expect.objectContaining({ concept: 'c:aves', name: 'Aves', status: 'accepted', match: 'exact' })])
  })

  it('lists every concept using a name: a split is two results, never merged', async () => {
    const res = await call('/:id/search', 'structures', { q: 'exemplum magnum' })
    expect(res.body.results.map((r: { concept: string }) => r.concept)).toEqual(['c:magnum-sl', 'c:magnum-ss'])
  })

  it('puts exact matches before prefixes, finds synonyms, and bounds results with truncated', async () => {
    const manage = await callEndpoint(payload, SNAPSHOTS, '/:id/search', ids.checklist!, { q: 'alphus' }, manager)
    expect(manage.status).toBe(200)
    const hits = manage.body.results as { name: string; match: string; status: string }[]
    expect(hits[0]).toMatchObject({ name: 'Alphus', match: 'exact' })
    expect(hits.slice(1).every((h) => h.match === 'prefix')).toBe(true)
    expect(hits.length).toBe(5)
    expect(manage.body.truncated).toBe(false)
    const wide = await callEndpoint(payload, SNAPSHOTS, '/:id/search', ids.checklist!, { q: 'alph' }, manager)
    expect(wide.body.results).toHaveLength(5) // the plugin's maxResults, of 7
    expect(wide.body.truncated).toBe(true)
    const syn = await callEndpoint(payload, SNAPSHOTS, '/:id/search', ids.checklist!, { q: 'alphus primoides' }, manager)
    expect(syn.body.results).toEqual([expect.objectContaining({ concept: 'fx:5', status: 'synonym', acceptedName: 'Alphus primus' })])
    const asked = await callEndpoint(payload, SNAPSHOTS, '/:id/search', ids.checklist!, { q: 'alph', limit: 2 }, manager)
    expect(asked.body.results).toHaveLength(2)
    const clamped = await callEndpoint(payload, SNAPSHOTS, '/:id/search', ids.checklist!, { q: 'alph', limit: 1000 }, manager)
    expect(clamped.body.results).toHaveLength(5)
  })

  it('searches common names only in the locale asked for', async () => {
    const none = await callEndpoint(payload, SNAPSHOTS, '/:id/search', ids.checklist!, { q: 'zweites' }, manager)
    expect(none.body.results).toEqual([])
    const de = await callEndpoint(payload, SNAPSHOTS, '/:id/search', ids.checklist!, { q: 'zweites', locale: 'de' }, manager)
    expect(de.body.results).toEqual([expect.objectContaining({ concept: 'fx:6', name: 'zweites Alpha', status: 'common', locale: 'de', acceptedName: 'Alphus secundus' })])
    const en = await callEndpoint(payload, SNAPSHOTS, '/:id/search', ids.checklist!, { q: 'zweites', locale: 'en' }, manager)
    expect(en.body.results).toEqual([])
  })

  it('refuses an empty or very long query (400)', async () => {
    expect((await call('/:id/search', 'amniotes', { q: '  ' })).status).toBe(400)
    expect((await call('/:id/search', 'amniotes', { q: 'a'.repeat(201) })).status).toBe(400)
  })

  it('is callable from host code with a request, under the same access', async () => {
    const req = await createLocalReq({ user: reader as never }, payload)
    const r = await searchNames(req, ids.amniotes!, { q: 'squ' })
    expect(r.ok && r.body.results.map((h) => h.concept)).toEqual(['c:squamata'])
    const anon = await createLocalReq({}, payload)
    anon.user = null
    expect(await searchNames(anon, ids.amniotes!, { q: 'squ' })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('ancestors and descendants', () => {
  it('walks a classification up from a concept, with names', async () => {
    const res = await call('/:id/ancestors', 'amniotes', { classification: 'traditional', node: 'c:testudines' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'found', hierarchy: { kind: 'classification', id: 'traditional' }, node: { id: 'c:testudines', label: 'Testudines' }, truncated: false })
    expect(res.body.items).toEqual([{ id: 'c:reptilia', label: 'Reptilia' }])
  })

  it('walks a rooted phylogeny down, bounded by depth and by the result limit', async () => {
    const all = await call('/:id/descendants', 'amniotes', { phylogeny: 'archelosauria', node: 'sauria' })
    expect(all.body.items.map((i: { id: string }) => i.id)).toEqual(['lepidosauria', 'archelosauria', 't-squamata', 't-rhyncho', 't-testudines'])
    expect(all.body.truncated).toBe(true) // maxResults 5 of 7
    const shallow = await call('/:id/descendants', 'amniotes', { phylogeny: 'archelosauria', node: 'sauria', maxDepth: 1 })
    expect(shallow.body).toMatchObject({ truncated: true, items: [{ id: 'lepidosauria' }, { id: 'archelosauria' }] })
    const up = await call('/:id/ancestors', 'amniotes', { phylogeny: 'archelosauria', node: 't-aves' })
    expect(up.body.items.map((i: { id: string }) => i.id)).toEqual(['archosauria', 'archelosauria', 'sauria', 'amniota'])
    expect(up.body.node).toEqual({ id: 't-aves', label: 'Aves', concepts: ['c:aves'] })
  })

  it('makes no ancestry claim in an unrooted phylogeny (indeterminate, I5)', async () => {
    const res = await call('/:id/ancestors', 'structures', { phylogeny: 'unrooted', node: 'c' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'indeterminate', reason: 'unrooted' })
    expect(res.body.items).toBeUndefined()
  })

  it('answers 404 for an unknown hierarchy or node, and 400 without exactly one hierarchy or a node', async () => {
    expect((await call('/:id/ancestors', 'amniotes', { phylogeny: 'nope', node: 'sauria' })).status).toBe(404)
    expect((await call('/:id/ancestors', 'amniotes', { phylogeny: 'archelosauria', node: 'nope' })).status).toBe(404)
    expect((await call('/:id/ancestors', 'amniotes', { node: 'sauria' })).status).toBe(400)
    expect((await call('/:id/ancestors', 'amniotes', { phylogeny: 'archelosauria', classification: 'traditional', node: 'sauria' })).status).toBe(400)
    expect((await call('/:id/descendants', 'amniotes', { phylogeny: 'archelosauria' })).status).toBe(400)
  })
})

describe('MRCA', () => {
  it('finds the most recent common ancestor in a rooted hypothesis, naming the hypothesis', async () => {
    const res = await call('/:id/mrca', 'amniotes', { phylogeny: 'archelosauria', nodes: 't-crocodylia,t-aves' })
    expect(res.status).toBe(200)
    expect(res.body.result).toEqual({ status: 'found', node: 'archosauria', hypothesis: { id: 'archelosauria', version: expect.any(String) } })
    // The other hypothesis gives another answer for turtles: answers are per hypothesis.
    const a = await call('/:id/mrca', 'amniotes', { phylogeny: 'archelosauria', nodes: 't-testudines,t-aves' })
    expect(a.body.result.node).toBe('archelosauria')
  })

  it('invents no common ancestor across a forest, and none in an unrooted tree', async () => {
    expect((await call('/:id/mrca', 'structures', { phylogeny: 'forest', nodes: 'a,g' })).body.result).toMatchObject({ status: 'none', reason: 'different-trees' })
    expect((await call('/:id/mrca', 'structures', { phylogeny: 'unrooted', nodes: 'c,d' })).body.result).toMatchObject({ status: 'indeterminate', reason: 'unrooted' })
  })

  it('refuses a classification, too many nodes, and no nodes (400); unknown nodes are 404', async () => {
    const cls = await call('/:id/mrca', 'amniotes', { classification: 'traditional', nodes: 'c:aves,c:squamata' })
    expect(cls.status).toBe(400)
    expect(cls.body.error).toMatch(/not common ancestry/)
    expect((await call('/:id/mrca', 'amniotes', { phylogeny: 'archelosauria', nodes: 't-aves,t-crocodylia,t-squamata,t-testudines' })).status).toBe(400)
    expect((await call('/:id/mrca', 'amniotes', { phylogeny: 'archelosauria', nodes: '' })).status).toBe(400)
    expect((await call('/:id/mrca', 'amniotes', { phylogeny: 'archelosauria', nodes: 't-aves,nope' })).status).toBe(404)
  })
})

describe('access', () => {
  const endpoints: [string, Record<string, string>][] = [
    ['/:id/search', { q: 'alphus' }],
    ['/:id/ancestors', { classification: 'fx:checklist', node: 'fx:5' }],
    ['/:id/descendants', { classification: 'fx:checklist', node: 'fx:1' }],
    ['/:id/mrca', { phylogeny: 'x', nodes: 'a' }],
  ]

  it('answers 404 for a staged snapshot to readers on every endpoint, exactly as for one that does not exist', async () => {
    for (const [path, q] of endpoints) {
      const staged = await call(path, 'checklist', q, reader)
      const missing = await call(path, '000000000000000000000000', q, reader)
      const garbage = await call(path, 'not-an-id', q, reader)
      expect([staged.status, missing.status, garbage.status]).toEqual([404, 404, 404])
      expect(staged.body).toEqual(missing.body)
    }
  })

  it('answers 404 to anonymous requests and when the host check throws (fails closed)', async () => {
    for (const [path, q] of endpoints) {
      expect((await call(path, 'amniotes', { ...q, q: 'aves' }, null)).status).toBe(404)
      expect((await call(path, 'amniotes', { ...q, q: 'aves' }, thrower)).status).toBe(404)
    }
  })

})

describe('coverage', () => {
  it('reports each root group of a classification, with every concept included by default', async () => {
    const res = await call('/:id/coverage', 'amniotes', { classification: 'traditional' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ classification: { id: 'traditional', version: '1' }, included: 'all', note: expect.stringMatching(/never estimates/) })
    expect(res.body.groups.map((g: { concept: string }) => g.concept)).toEqual(['c:reptilia', 'c:aves', 'c:mammalia'])
    expect(res.body.groups[0]).toMatchObject({ name: 'Reptilia', dataset: { total: 5, included: 5, omitted: 0 }, knownToScience: 'not-stated' })
  })

  it('counts a listed selection, what a hypothesis maps, and ids outside the classification', async () => {
    const res = await call('/:id/coverage', 'amniotes', { classification: 'traditional', phylogeny: 'archelosauria', groups: 'c:reptilia', included: 'c:testudines,c:crocodylia,c:nowhere' })
    expect(res.status).toBe(200)
    expect(res.body.included).toEqual({ listed: 3, inClassification: 2, notInClassification: ['c:nowhere'] })
    expect(res.body.phylogeny).toMatchObject({ id: 'archelosauria' })
    const [reptilia] = res.body.groups
    expect(reptilia.dataset).toMatchObject({ total: 5, included: 2 })
    expect(reptilia.dataset.omittedBranches.sort()).toEqual(['c:rhynchocephalia', 'c:squamata'])
    expect(reptilia.hypothesis).toEqual({ id: 'archelosauria', version: expect.any(String), sampling: 'complete', mapped: 2, unmapped: 0 })
  })

  it('answers 400 without a classification or past the limits, 404 for an unknown hierarchy or group', async () => {
    expect((await call('/:id/coverage', 'amniotes', {})).status).toBe(400)
    expect((await call('/:id/coverage', 'amniotes', { classification: 'traditional', groups: 'c:reptilia,c:aves,c:mammalia,c:testudines,c:squamata,c:crocodylia' })).status).toBe(400) // maxResults 5
    expect((await call('/:id/coverage', 'amniotes', { classification: 'nope' })).status).toBe(404)
    expect((await call('/:id/coverage', 'amniotes', { classification: 'traditional', phylogeny: 'nope' })).status).toBe(404)
    expect((await call('/:id/coverage', 'amniotes', { classification: 'traditional', groups: 'c:nowhere' })).status).toBe(404)
  })

  it('is callable from host code, under the same access', async () => {
    const anon = await createLocalReq({}, payload)
    anon.user = null
    expect(await coverageOf(anon, ids.amniotes!, { classification: 'traditional' })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('projected views', () => {
  it('projects a published view with core\'s projection and its disclosure', async () => {
    const res = await callEndpoint(payload, VIEWS, '/:id/projection', views.published!, {}, reader)
    expect(res.status).toBe(200)
    expect(res.body.view).toMatchObject({ doc: views.published, id: 'v-turtles', status: 'published' })
    expect(res.body.source).toMatchObject({ id: 'fixture-amniotes', version: '1', status: 'published', withdrawn: false })
    const p = res.body.projection
    expect(p).toMatchObject({ kind: 'phylogeny', target: 'archelosauria', truncated: false })
    expect(p.counts.hidden).toBe(1)
    expect(p.nodes.map((n: { id: string }) => n.id)).not.toContain('t-squamata')
    expect(res.body.disclosure.lines).toEqual(expect.arrayContaining([expect.stringMatching(/^Phylogenetic hypothesis: .*rooted; complete sampling\.$/), expect.stringMatching(/1 hidden/), expect.stringMatching(/^Data: snapshot fixture-amniotes 1 /)]))
    expect(res.body.disclosure.illustrative).toBe(true)
  })

  it('caps the nodes at the request\'s limit, within the plugin\'s, and says it was truncated', async () => {
    const res = await callEndpoint(payload, VIEWS, '/:id/projection', views.published!, { limit: 3 }, reader)
    expect(res.body.projection.nodes).toHaveLength(3)
    expect(res.body.projection.truncated).toBe(true)
    expect(res.body.disclosure.lines).toContain('The drawing was truncated at its node limit.')
  })

  it('keeps a published view of a withdrawn snapshot readable, flagged and disclosed, never silently hidden', async () => {
    const res = await callEndpoint(payload, VIEWS, '/:id/projection', views.ofWithdrawn!, {}, reader)
    expect(res.status).toBe(200)
    expect(res.body.source).toMatchObject({ version: '0.9', status: 'withdrawn', withdrawn: true })
    expect(res.body.disclosure.lines).toContainEqual(expect.stringMatching(/^Source withdrawn: snapshot fixture-amniotes 0\.9 was withdrawn by its publisher/))
    // The snapshot itself stays hidden from readers.
    expect((await call('/:id/search', 'withdrawn', { q: 'aves' })).status).toBe(404)
  })

  it('shows draft views to managers only; readers, anonymous requests and throwing checks get the same 404 as a missing view', async () => {
    expect((await callEndpoint(payload, VIEWS, '/:id/projection', views.draft!, {}, manager)).status).toBe(200)
    for (const path of ['/:id/projection', '/:id/export']) {
      const draft = await callEndpoint(payload, VIEWS, path, views.draft!, {}, reader)
      const missing = await callEndpoint(payload, VIEWS, path, '000000000000000000000000', {}, reader)
      const garbage = await callEndpoint(payload, VIEWS, path, 'not-an-id', {}, reader)
      expect([draft.status, missing.status, garbage.status]).toEqual([404, 404, 404])
      expect(draft.body).toEqual(missing.body)
      expect((await callEndpoint(payload, VIEWS, path, views.published!, {}, null)).status).toBe(404)
      expect((await callEndpoint(payload, VIEWS, path, views.published!, {}, thrower)).status).toBe(404)
    }
    const req = await createLocalReq({ user: reader as never }, payload)
    expect(await projectedView(req, views.draft!)).toMatchObject({ ok: false, status: 404 })
  })
})

describe('exports', () => {
  it('downloads a published snapshot exactly as sealed, as a JSON attachment', async () => {
    const endpoint = (payload.collections[SNAPSHOTS as never]!.config.endpoints as { path: string; handler: (r: unknown) => Promise<Response> }[]).find((e) => e.path === '/:id/export')!
    const req = await createLocalReq({ user: reader as never }, payload)
    ;(req as { url: string }).url = `http://localhost/api/${SNAPSHOTS}/${ids.amniotes}/export`
    req.routeParams = { id: ids.amniotes! }
    const res = await endpoint.handler(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="fixture-amniotes-1.json"')
    expect(JSON.parse(await res.text())).toEqual(sealed.amniotes())
  })

  it('exports a view as its plain view file, with the snapshot it pins and its disclosure', async () => {
    const res = await callEndpoint(payload, VIEWS, '/:id/export', views.published!, {}, reader)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ format: 'onetaxonomy-view-export', formatVersion: 1, source: { id: 'fixture-amniotes', status: 'published', withdrawn: false } })
    expect(parseView(JSON.stringify(res.body.view))).toEqual(turtlesView)
    expect(res.body.disclosure.lines.length).toBeGreaterThan(1)
    const old = await callEndpoint(payload, VIEWS, '/:id/export', views.ofWithdrawn!, {}, reader)
    expect(old.body.source.withdrawn).toBe(true)
    expect(old.body.disclosure.lines).toContainEqual(expect.stringMatching(/^Source withdrawn/))
    const req = await createLocalReq({ user: reader as never }, payload)
    expect(await exportView(req, views.published!)).toMatchObject({ ok: true })
  })

  it('answers 404 for a staged or withdrawn snapshot to readers, and to anonymous requests and throwing checks', async () => {
    for (const key of ['checklist', 'withdrawn', '000000000000000000000000']) expect((await call('/:id/export', key, {}, reader)).status).toBe(404)
    expect((await call('/:id/export', 'checklist', {}, manager)).status).toBe(200)
    expect((await call('/:id/export', 'amniotes', {}, null)).status).toBe(404)
    expect((await call('/:id/export', 'amniotes', {}, thrower)).status).toBe(404)
    for (const user of [null, thrower]) expect((await call('/:id/coverage', 'amniotes', { classification: 'traditional' }, user)).status).toBe(404)
    expect((await call('/:id/coverage', 'checklist', { classification: 'fx:checklist' }, reader)).status).toBe(404)
  })
})

describe('a view changed in the database', () => {
  it('answers 500 with the reason when its pin no longer matches its snapshot, instead of answering from it', async () => {
    const id = await (async () => {
      const doc = (await payload.create({ collection: VIEWS as never, data: { title: 'To tamper', snapshot: ids.amniotes, view: { ...turtlesView, id: 'v-tamper' } } as never })) as { id: string | number }
      return doc.id
    })()
    const model = (payload.db as unknown as { collections: Record<string, { updateOne: (q: unknown, u: unknown) => Promise<unknown> }> }).collections[VIEWS]!
    await model.updateOne({ _id: id }, { $set: { 'view.snapshot.checksum': 'sha256:changed' } })
    const res = await callEndpoint(payload, VIEWS, '/:id/projection', String(id), {}, manager)
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/no longer pins the snapshot/)
  })
})
