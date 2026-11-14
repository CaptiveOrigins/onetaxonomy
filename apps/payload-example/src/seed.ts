import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createView, indexDataset, sealSnapshot, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import { runImport } from '@extantape/payload-plugin-onetaxonomy'
import { createLocalReq, type Payload, type TypedUser } from 'payload'

import amniotes from '../../../fixtures/amniotes.json'
import structures from '../../../fixtures/structures.json'

const SNAPSHOTS = 'taxonomy-snapshots'
const VIEWS = 'taxonomy-views'
const IMPORTS = 'taxonomy-imports'
const SOURCES = 'sources'
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * What the checklist job reads `fixtures/checklist.csv` with. These are the settings `fixtures/checklist.json` was
 * made with, so running the job gives that snapshot, checksum and all.
 */
const CHECKLIST = {
  snapshot: { id: 'fixture-checklist', version: '1', createdAt: '2026-11-02T00:00:00.000Z' },
  source: { id: 'fixture-checklist', title: 'OneTaxonomy illustrative checklist (fictional taxa)', citation: 'Illustrative teaching data with invented names. Not a scientific source.', license: 'CC0-1.0', externalVersion: '1', illustrative: true },
  options: {
    idPrefix: 'fx',
    classification: { id: 'fx:checklist', title: 'Illustrative checklist', version: '1' },
    columns: { taxonID: 'taxonID', name: 'scientificName', parentID: 'parentNameUsageID', acceptedID: 'acceptedNameUsageID', status: 'taxonomicStatus', rank: 'taxonRank', authorship: 'scientificNameAuthorship', vernacular: [{ column: 'vernacular_en', locale: 'en' }, { column: 'vernacular_de', locale: 'de' }] },
  },
}

/**
 * Fills an empty site, once: two accounts (with the password in `EXAMPLE_PASSWORD`, which `pnpm dev` makes up), one
 * published snapshot with two published views, one staged snapshot that only a curator sees, and two import jobs
 * over made-up files: one waiting to be run, and one that failed, with its reason. The snapshots and files are the
 * repository's illustrative fixtures, not real data.
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

  // Import jobs. The site starts in this app's folder, so the fixtures are two folders up.
  const csv = await readFile(path.resolve(process.cwd(), '../../fixtures/checklist.csv')).catch(() => null)
  if (!csv) {
    payload.logger.info('OneTaxonomy example: fixtures/checklist.csv wasn\'t found from here, so no import jobs were added.')
    return
  }
  const upload = async (name: string, data: Buffer) => ((await payload.create({ collection: SOURCES as never, data: {} as never, file: { data, mimetype: 'text/csv', name, size: data.length }, user })) as { id: string | number }).id
  // Waiting: a curator runs it from its page in the admin.
  await payload.create({ collection: IMPORTS as never, data: { title: 'Checklist, release 1', format: 'csv', file: await upload('checklist.csv', csv), settings: CHECKLIST } as never, user })
  // Failed: the file lacks the columns the settings name. Nothing is stored, and the job says why.
  const broken = (await payload.create({
    collection: IMPORTS as never,
    data: { title: 'A checklist with columns missing (fails on purpose)', format: 'csv', file: await upload('columns-missing.csv', Buffer.from('id,name\n1,Alphus primus\n')), settings: { ...CHECKLIST, snapshot: { ...CHECKLIST.snapshot, id: 'fixture-columns-missing' } } } as never,
    user,
  })) as { id: string | number }
  await runImport(await createLocalReq({ user }, payload), String(broken.id))
}
