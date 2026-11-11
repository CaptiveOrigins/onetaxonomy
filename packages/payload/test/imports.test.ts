import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { indexDataset, verifySnapshot, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import { writeZip } from '@captiveorigins/onetaxonomy-import'
import type { Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { oneTaxonomy, runImport } from '../src'
import { access, callEndpoint, makeUser, sealed, startPayload, usersCollection } from './helpers'

import checklistJson from '../../../fixtures/checklist.json'

const SNAPSHOTS = 'taxonomy-snapshots'
const IMPORTS = 'taxonomy-imports'
const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url))
const local = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

// URLs the host allows, answered from memory: the tests never touch the network.
const allowed: Record<string, string> = {
  'https://data.example.org/trees.nwk': local('trees.nwk').toString('utf8'),
  'https://data.example.org/broken.nwk': '((Alpha,Beta),Gamma',
}
const fetched: string[] = []
const hostFetch = ({ url }: { url: string }) => {
  fetched.push(url)
  if (!(url in allowed)) throw new Error(`${url} isn't on this site's list`)
  return allowed[url]!
}

let payload: Payload
let stop: () => Promise<void>
let manager: TypedUser
let reader: TypedUser
let thrower: TypedUser
let dir: string

const source = (id: string) => ({ id, title: `Illustrative ${id}`, citation: 'Illustrative teaching data with invented names. Not a scientific source.', license: 'CC0-1.0', illustrative: true })
// The same settings examples/build-fixtures.mjs uses, so the CSV import must give fixtures/checklist.json exactly.
const checklistSettings = {
  snapshot: { id: 'fixture-checklist', version: '1', createdAt: '2026-11-02T00:00:00.000Z' },
  source: { id: 'fixture-checklist', title: 'OneTaxonomy illustrative checklist (fictional taxa)', citation: 'Illustrative teaching data with invented names. Not a scientific source.', license: 'CC0-1.0', externalVersion: '1', illustrative: true },
  options: {
    idPrefix: 'fx',
    classification: { id: 'fx:checklist', title: 'Illustrative checklist', version: '1' },
    columns: { taxonID: 'taxonID', name: 'scientificName', parentID: 'parentNameUsageID', acceptedID: 'acceptedNameUsageID', status: 'taxonomicStatus', rank: 'taxonRank', authorship: 'scientificNameAuthorship', vernacular: [{ column: 'vernacular_en', locale: 'en' }, { column: 'vernacular_de', locale: 'de' }] },
  },
}
const treeSettings = (id: string, version = '1', options: Record<string, unknown> = {}) => ({
  snapshot: { id, version, createdAt: '2026-11-11T00:00:00.000Z' },
  source: source(id),
  options: { id: `${id}-tree`, version: '1', lengthUnit: 'substitutions-per-site', ...options },
})

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'onetaxonomy-uploads-'))
  ;({ payload, stop } = await startPayload({
    collections: [usersCollection(), { slug: 'media', upload: { staticDir: dir }, access: { read: ({ req }) => Boolean(req.user) }, fields: [] }],
    plugins: [oneTaxonomy({ access, imports: { uploads: { collection: 'media' }, fetch: hostFetch, maxBytes: 200_000, staleAfterMinutes: 5 } })],
  }))
  manager = await makeUser(payload, 'manager')
  reader = await makeUser(payload, 'reader')
  thrower = await makeUser(payload, 'thrower')
})
afterAll(async () => {
  await stop?.()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const upload = async (name: string, data: Buffer | Uint8Array, mimetype = 'text/plain') =>
  ((await payload.create({ collection: 'media' as never, data: {} as never, file: { data: Buffer.from(data), mimetype, name, size: data.length } })) as { id: string | number }).id
type Job = Record<string, any>
const makeJob = (data: Record<string, unknown>, user: TypedUser | null = manager, context: Record<string, unknown> = {}) =>
  payload.create({ collection: IMPORTS as never, data: data as never, user, overrideAccess: false, context }) as Promise<Job>
const snapshotCount = async () => (await payload.count({ collection: SNAPSHOTS as never })).totalDocs
const storedSnapshot = async (id: unknown) => (await payload.findByID({ collection: SNAPSHOTS as never, id: id as string, depth: 0 })) as Record<string, any>
const raw = () => (payload.db as unknown as { collections: Record<string, { updateOne: (q: unknown, u: unknown) => Promise<unknown> }> }).collections[IMPORTS]!

describe('importing each format into a staged, sealed snapshot', () => {
  it('a CSV checklist (upload) gives exactly the committed fixture, checksum and all, staged', async () => {
    const before = await snapshotCount()
    const job = await makeJob({ title: 'Checklist release 1', format: 'csv', file: await upload('checklist.csv', fixture('checklist.csv'), 'text/csv'), settings: checklistSettings })
    expect(job).toMatchObject({ status: 'done', phase: 'finished', checksum: checklistJson.checksum, attempts: 1, runBy: String(manager.id) })
    expect(job.inputSha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(job.message).toMatch(/staged snapshot fixture-checklist 1/)
    const snap = await storedSnapshot(job.snapshot)
    expect(snap).toMatchObject({ status: 'staged', snapshotId: 'fixture-checklist', version: '1', checksum: checklistJson.checksum })
    expect(snap.snapshot).toEqual(checklistJson)
    expect(await snapshotCount()).toBe(before + 1)
    expect(job.progress.map((p: { message: string }) => p.message)).toEqual([
      'Attempt 1: reading the file.',
      expect.stringMatching(/^Read \d+ bytes/),
      expect.stringMatching(/^\d+ concepts, \d+ names, 1 classifications and 0 phylogenies read, with 0 warning\(s\)\.$/),
      expect.stringMatching(/^Sealed \(sha256:/),
      expect.stringMatching(/^Stored as staged snapshot/),
    ])
  })

  it('a Darwin Core Archive (ZIP upload) of the same checklist', async () => {
    const zip = writeZip([{ path: 'taxon.csv', data: fixture('checklist.csv') }])
    const job = await makeJob({ format: 'dwca', file: await upload('checklist-dwca.zip', zip, 'application/zip'), settings: { ...checklistSettings, snapshot: { ...checklistSettings.snapshot, id: 'checklist-dwca' }, options: { idPrefix: 'fx' } } })
    expect(job.status).toBe('done')
    const snap = await storedSnapshot(job.snapshot)
    expect(snap.status).toBe('staged')
    expect(verifySnapshot(snap.snapshot)).toBe(true)
    expect(snap.snapshot.concepts.map((c: { id: string }) => c.id)).toEqual(checklistJson.concepts.map((c) => c.id))
  })

  it('a Newick tree read through the host\'s fetch, with labels mapped only as given', async () => {
    const job = await makeJob({ format: 'newick', url: 'https://data.example.org/trees.nwk', settings: treeSettings('newick-trees') })
    expect(job.status).toBe('done')
    expect(fetched).toContain('https://data.example.org/trees.nwk')
    const s = (await storedSnapshot(job.snapshot)).snapshot as DatasetSnapshot
    expect(s.phylogenies).toHaveLength(1)
    expect(s.phylogenies[0]).toMatchObject({ id: 'newick-trees-tree', rooted: true, lengthUnit: 'substitutions-per-site', sources: ['newick-trees'] })
    expect(s.phylogenies[0]!.nodes.every((n) => !n.concepts?.length)).toBe(true)
  })

  it('NEXUS trees, with the reader\'s warnings recorded', async () => {
    const job = await makeJob({ format: 'nexus', file: await upload('trees.nex', local('trees.nex')), settings: treeSettings('nexus-trees') })
    expect(job.status).toBe('done')
    expect(job.warningCount).toBe(1)
    expect(job.warnings).toEqual([expect.objectContaining({ code: 'skipped-block', line: 3 })])
    const s = (await storedSnapshot(job.snapshot)).snapshot as DatasetSnapshot
    expect(s.phylogenies.map((p) => [p.id, p.rooted])).toEqual([['nexus-trees-tree:1', true], ['nexus-trees-tree:2', false]])
  })

  it('phyloXML trees, listing the elements it skipped', async () => {
    const job = await makeJob({ format: 'phyloxml', file: await upload('trees.xml', local('trees.xml'), 'application/xml'), settings: treeSettings('phyloxml-trees') })
    expect(job.status).toBe('done')
    expect(job.warnings).toEqual([expect.objectContaining({ code: 'unsupported-element', message: expect.stringMatching(/sequence/) })])
    const s = (await storedSnapshot(job.snapshot)).snapshot as DatasetSnapshot
    expect(s.phylogenies[0]!.rooted).toBe(true)
  })

  it('a sealed OneTaxonomy JSON snapshot, kept exactly as sealed', async () => {
    const amniotes = sealed.amniotes()
    const job = await makeJob({ format: 'onetaxonomy-json', file: await upload('amniotes.json', Buffer.from(JSON.stringify(amniotes)), 'application/json'), settings: {} })
    expect(job).toMatchObject({ status: 'done', checksum: amniotes.checksum })
    expect((await storedSnapshot(job.snapshot)).snapshot).toEqual(amniotes)
  })
})

describe('idempotent', () => {
  it('the same file with the same settings is "already imported": the same snapshot, nothing new stored', async () => {
    const first = (await payload.find({ collection: IMPORTS as never, where: { checksum: { equals: checklistJson.checksum } }, depth: 0 })).docs[0] as Job
    const before = await snapshotCount()
    const again = await makeJob({ format: 'csv', file: await upload('checklist-again.csv', fixture('checklist.csv'), 'text/csv'), settings: checklistSettings })
    expect(again).toMatchObject({ status: 'already-imported', checksum: checklistJson.checksum, snapshot: first.snapshot })
    expect(again.message).toMatch(/^Already imported/)
    expect(await snapshotCount()).toBe(before)
  })

  it('running a finished job again changes nothing', async () => {
    const done = (await payload.find({ collection: IMPORTS as never, where: { status: { equals: 'done' } }, depth: 0, limit: 1 })).docs[0] as Job
    const before = await snapshotCount()
    const res = await callEndpoint(payload, IMPORTS, '/:id/run', String(done.id), {}, manager)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'done', snapshot: String(done.snapshot) })
    const after = (await payload.findByID({ collection: IMPORTS as never, id: done.id, depth: 0 })) as Job
    expect(after.attempts).toBe(1)
    expect(await snapshotCount()).toBe(before)
  })

  it('the same id and version with different content fails and stores nothing', async () => {
    const before = await snapshotCount()
    const changed = Buffer.from(fixture('checklist.csv').toString('utf8').replace('Exemplaria', 'Exemplariae'))
    const job = await makeJob({ format: 'csv', file: await upload('checklist-changed.csv', changed, 'text/csv'), settings: checklistSettings })
    expect(job.status).toBe('failed')
    expect(job.diagnostics).toEqual([expect.objectContaining({ code: 'version-taken', message: expect.stringMatching(/different content\. A changed dataset needs a new version/) })])
    expect(job.snapshot ?? null).toBeNull()
    expect(await snapshotCount()).toBe(before)
  })
})

describe('refused input stores nothing', () => {
  it('a malformed Newick file fails with the reader\'s diagnostic and position', async () => {
    const before = await snapshotCount()
    const job = await makeJob({ format: 'newick', url: 'https://data.example.org/broken.nwk', settings: treeSettings('broken', '1', { rooted: true }) })
    expect(job.status).toBe('failed')
    expect(job.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'malformed', message: expect.stringMatching(/can't be read as newick/), position: expect.any(Number) })])
    expect(job.phase).toBe('parsing')
    expect(await snapshotCount()).toBe(before)
  })

  it('malformed NEXUS names the line; a CSV without its columns says which are missing', async () => {
    const nex = await makeJob({ format: 'nexus', file: await upload('bad.nex', Buffer.from('#NEXUS\nBEGIN TREES;\n  TREE t = [&R] (a,b);\n')), settings: treeSettings('bad-nexus') })
    expect(nex.status).toBe('failed')
    expect(nex.diagnostics[0]).toMatchObject({ code: 'malformed', line: expect.any(Number), message: expect.stringMatching(/has no END/) })
    const csv = await makeJob({ format: 'csv', file: await upload('bad.csv', Buffer.from('id,name\n1,Alpha\n'), 'text/csv'), settings: { ...checklistSettings, snapshot: { ...checklistSettings.snapshot, id: 'bad-csv' }, options: {} } })
    expect(csv.diagnostics[0].message).toMatch(/Missing required column\(s\): taxonID, scientificName/)
  })

  it('a dataset with validation errors fails with core\'s diagnostics, and a changed sealed JSON is refused', async () => {
    const before = await snapshotCount()
    // A label mapped to a concept the snapshot doesn't have: a dangling reference.
    const job = await makeJob({ format: 'newick', url: 'https://data.example.org/trees.nwk', settings: { ...treeSettings('dangling'), labels: { Gamma: ['c:nowhere'] } } })
    expect(job.status).toBe('failed')
    expect(job.diagnostics.some((d: { severity: string; code: string }) => d.severity === 'error' && d.code === 'dangling-reference')).toBe(true)
    const tampered = { ...sealed.structures(), version: 'changed-after-sealing' }
    const json = await makeJob({ format: 'onetaxonomy-json', file: await upload('tampered.json', Buffer.from(JSON.stringify(tampered)), 'application/json'), settings: {} })
    expect(json.diagnostics[0]).toMatchObject({ code: 'checksum' })
    expect(await snapshotCount()).toBe(before)
  })

  it('a URL the host doesn\'t allow, and a file over the size limit, fail with the reason', async () => {
    const url = await makeJob({ format: 'newick', url: 'https://elsewhere.example.com/x.nwk', settings: treeSettings('elsewhere') })
    expect(url.diagnostics[0]).toMatchObject({ code: 'input', message: expect.stringMatching(/isn't on this site's list/) })
    const big = await makeJob({ format: 'csv', file: await upload('big.csv', Buffer.alloc(200_001, 'a'), 'text/csv'), settings: checklistSettings })
    expect(big.diagnostics[0].message).toMatch(/more than the 200000 this site reads/)
  })

  it('settings that can\'t make a snapshot are refused when the job is made: no job, no snapshot', async () => {
    const jobs = (await payload.count({ collection: IMPORTS as never })).totalDocs
    const file = await upload('checklist-3.csv', fixture('checklist.csv'), 'text/csv')
    await expect(makeJob({ format: 'csv', file, settings: { ...checklistSettings, snapshot: { id: 'x', version: '1' } } })).rejects.toThrow(/createdAt/)
    await expect(makeJob({ format: 'csv', file, settings: { snapshot: checklistSettings.snapshot } })).rejects.toThrow(/source record/)
    await expect(makeJob({ format: 'newick', url: 'https://data.example.org/trees.nwk', settings: { ...treeSettings('t'), options: {} } })).rejects.toThrow(/phylogeny id and version/)
    await expect(makeJob({ format: 'csv', file, url: 'https://data.example.org/trees.nwk', settings: checklistSettings })).rejects.toThrow(/one input/)
    await expect(makeJob({ format: 'csv', settings: checklistSettings })).rejects.toThrow(/one input/)
    await expect(makeJob({ format: 'csv', file, settings: { ...checklistSettings, options: { mapLabel: 'x' } } })).rejects.toThrow(/set by the plugin/)
    await expect(makeJob({ format: 'csv', file, settings: checklistSettings, status: 'done' })).rejects.toThrow(/starts as queued/)
    await expect(makeJob({ format: 'csv', file, settings: checklistSettings, checksum: 'sha256:made-up' })).rejects.toThrow(/set by running the job/)
    expect((await payload.count({ collection: IMPORTS as never })).totalDocs).toBe(jobs)
  })
})

describe('resuming after an interruption', () => {
  it('a job left running is refused while fresh, then starts again from the file once stale', async () => {
    const before = await snapshotCount()
    const job = await makeJob({ format: 'newick', url: 'https://data.example.org/trees.nwk', settings: treeSettings('resumed') }, manager, { onetaxonomyNoRun: true })
    expect(job.status).toBe('queued')
    // What a process that stopped while parsing leaves behind.
    await raw().updateOne({ _id: job.id }, { $set: { status: 'running', phase: 'parsing', startedAt: new Date(), attempts: 1 } })
    const fresh = await callEndpoint(payload, IMPORTS, '/:id/run', String(job.id), {}, manager)
    expect(fresh.status).toBe(409)
    expect(fresh.body.error).toMatch(/running since/)
    await raw().updateOne({ _id: job.id }, { $set: { startedAt: new Date(Date.now() - 6 * 60_000) } })
    const res = await callEndpoint(payload, IMPORTS, '/:id/run', String(job.id), {}, manager)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('done')
    const after = (await payload.findByID({ collection: IMPORTS as never, id: job.id, depth: 0 })) as Job
    expect(after.attempts).toBe(2)
    expect(after.progress[0].message).toBe('Attempt 2: the last run stopped while parsing; starting again from the file.')
    expect(await snapshotCount()).toBe(before + 1)
  })

  it('a job that stopped after storing finishes without storing twice, and says the snapshot is its own', async () => {
    const job = (await payload.find({ collection: IMPORTS as never, where: { 'settings.snapshot.id': { equals: 'resumed' } }, depth: 0 })).docs[0] as Job
    const before = await snapshotCount()
    await raw().updateOne({ _id: job.id }, { $set: { status: 'running', phase: 'storing', snapshot: null, startedAt: new Date(Date.now() - 6 * 60_000) } })
    const res = await callEndpoint(payload, IMPORTS, '/:id/run', String(job.id), {}, manager)
    expect(res.body).toMatchObject({ status: 'done', snapshot: String(job.snapshot), message: expect.stringMatching(/by this job's earlier attempt/) })
    expect(await snapshotCount()).toBe(before)
  })

  it('a failed job can be run again, and server code can run one with overrideAccess', async () => {
    const job = await makeJob({ format: 'newick', url: 'https://data.example.org/trees.nwk', settings: treeSettings('server-run') }, manager, { onetaxonomyNoRun: true })
    await raw().updateOne({ _id: job.id }, { $set: { status: 'failed' } })
    const { createLocalReq } = await import('payload')
    const req = await createLocalReq({}, payload)
    expect(await runImport(req, String(job.id))).toMatchObject({ ok: false, status: 404 })
    expect(await runImport(req, String(job.id), { overrideAccess: true })).toMatchObject({ ok: true, body: { status: 'done' } })
  })
})

describe('import access', () => {
  it('only managers make, list or run jobs; everyone else gets the same 404 as a missing job', async () => {
    const job = (await payload.find({ collection: IMPORTS as never, limit: 1, depth: 0 })).docs[0] as Job
    for (const user of [reader, thrower, null]) {
      await expect(makeJob({ format: 'newick', url: 'https://data.example.org/trees.nwk', settings: treeSettings('nope') }, user)).rejects.toThrow(/not allowed/i)
      const run = await callEndpoint(payload, IMPORTS, '/:id/run', String(job.id), {}, user)
      const missing = await callEndpoint(payload, IMPORTS, '/:id/run', '000000000000000000000000', {}, user)
      expect([run.status, missing.status]).toEqual([404, 404])
      expect(run.body).toEqual(missing.body)
    }
    await expect(payload.find({ collection: IMPORTS as never, user: reader, overrideAccess: false })).rejects.toThrow(/not allowed/i)
    expect((await payload.find({ collection: IMPORTS as never, user: manager, overrideAccess: false })).totalDocs).toBeGreaterThan(0)
  })

  it('a job\'s input and results can\'t be edited, even by server code; its title can', async () => {
    const job = (await payload.find({ collection: IMPORTS as never, where: { status: { equals: 'done' } }, limit: 1, depth: 0 })).docs[0] as Job
    await expect(payload.update({ collection: IMPORTS as never, id: job.id, data: { settings: { ...job.settings, snapshot: { ...job.settings.snapshot, version: '9' } } } as never, user: manager, overrideAccess: false })).rejects.toThrow(/Make a new job/)
    await expect(payload.update({ collection: IMPORTS as never, id: job.id, data: { status: 'queued' } as never })).rejects.toThrow(/results are set by running it/)
    await expect(payload.update({ collection: IMPORTS as never, id: job.id, data: { snapshot: null } as never })).rejects.toThrow(/results are set by running it/)
    const renamed = (await payload.update({ collection: IMPORTS as never, id: job.id, data: { title: 'Renamed' } as never, user: manager, overrideAccess: false })) as Job
    expect(renamed.title).toBe('Renamed')
  })

  it('a stored import is an ordinary staged snapshot: readers can\'t see it until it is published', async () => {
    const job = (await payload.find({ collection: IMPORTS as never, where: { 'settings.snapshot.id': { equals: 'newick-trees' } }, depth: 0 })).docs[0] as Job
    expect((await callEndpoint(payload, SNAPSHOTS, '/:id/export', String(job.snapshot), {}, reader)).status).toBe(404)
    await payload.update({ collection: SNAPSHOTS as never, id: job.snapshot, data: { status: 'published' } as never, user: manager, overrideAccess: false })
    const res = await callEndpoint(payload, SNAPSHOTS, '/:id/export', String(job.snapshot), {}, reader)
    expect(res.status).toBe(200)
    expect(indexDataset(res.body as DatasetSnapshot).phylogeny('newick-trees-tree').rooted).toBe(true)
  })
})
