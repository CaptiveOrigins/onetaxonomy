/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createView, indexDataset, sealSnapshot, snapshotChecksum, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import { readBundle, writeBundle, type BundleLesson, type BundleRead } from '@extantape/onetaxonomy-import'

import { APP, BundleRefusal, bundleBytes, keepPinned, NOTHING_CARRIED, pinOf, planBundleOpen, planBundleSave, relinkToAvailable, type BundleOpening } from '../src/bundle'

// Made-up data: the fictional checklist (release 1 and release 2, same id).
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, `../../../fixtures/${name}.json`), 'utf8')) as DatasetSnapshot
const v1 = sealSnapshot(fixture('checklist'))
const v2 = sealSnapshot(fixture('checklist-v2'))
const viewOn = (s: DatasetSnapshot, extra = {}) => ({ ...createView(indexDataset(s), { id: 'main', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } }), ...extra })
const lessonOn = (s: DatasetSnapshot): BundleLesson => ({ format: 'onetaxonomy-lesson', formatVersion: 1, id: 'l1', title: 'Lesson one', version: '1', snapshot: pinOf(s), scenes: [], worksheets: [] })
const NOW = '2026-11-11T10:00:00.000Z'

const bundleOf = (s: DatasetSnapshot, embed: boolean, views = [viewOn(s)], lessons: BundleLesson[] = []) =>
  readBundle(writeBundle({ createdAt: NOW, createdBy: APP, snapshots: [{ snapshot: s, embed }], views, lessons }))
const refusal = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    expect(e).toBeInstanceOf(BundleRefusal)
    return (e as Error).message
  }
  throw new Error('expected a refusal')
}
const asRelink = (p: BundleOpening) => {
  if (p.kind !== 'relink') throw new Error(`expected a relink question, got ${p.kind}`)
  return p
}

describe('opening a bundle in the Mac app', () => {
  it('shows the embedded dataset and carries its views and lessons when nothing else is open', async () => {
    const plan = planBundleOpen(await bundleOf(v1, true, [viewOn(v1)], [lessonOn(v1)]), null)
    expect(plan.kind).toBe('show')
    if (plan.kind !== 'show') return
    expect(plan.snapshot).toEqual(JSON.parse(JSON.stringify(v1)))
    expect(plan.carried.views.map((v) => v.id)).toEqual(['main'])
    expect(plan.carried.lessons.map((l) => l.id)).toEqual(['l1'])
  })

  it('asks nothing when the open dataset is the pinned one', async () => {
    const plan = planBundleOpen(await bundleOf(v1, false), v1)
    expect(plan.kind).toBe('show')
  })

  it('treats an open, unsealed copy with the same contents as the pinned one', async () => {
    const { checksum: _c, ...unsealed } = v1
    expect(planBundleOpen(await bundleOf(v1, false), unsealed as DatasetSnapshot).kind).toBe('show')
  })

  it('asks when the open dataset is another version, and keeping the pinned one uses the embedded copy', async () => {
    const plan = asRelink(planBundleOpen(await bundleOf(v1, true), v2))
    expect(plan.differences).toBe('This bundle was made with fixture-checklist version 1; the dataset open now is version 2.')
    const kept = keepPinned(plan)
    expect(kept.snapshot.version).toBe('1')
    expect(kept.carried.views[0]!.snapshot).toEqual(pinOf(v1))
  })

  it('relinking moves every view and lesson to the open version, and says so', async () => {
    const plan = asRelink(planBundleOpen(await bundleOf(v1, true, [viewOn(v1)], [lessonOn(v1)]), v2))
    const relinked = relinkToAvailable(plan)
    expect(relinked.snapshot).toBe(v2)
    expect(relinked.carried.views[0]!.snapshot).toEqual(pinOf(v2))
    expect(relinked.carried.lessons[0]!.snapshot).toEqual(pinOf(v2))
    expect(relinked.notices[0]).toBe('Relinked 2 views and lessons from fixture-checklist version 1 to version 2. The bundle file is unchanged; Save as bundle… writes the relinked copy.')
  })

  it('names a same-version, different-contents dataset by checksum', async () => {
    const edited = { ...fixture('checklist'), sources: [] } as DatasetSnapshot
    const plan = asRelink(planBundleOpen(await bundleOf(v1, true), edited))
    expect(plan.differences).toMatch(/same version but different contents \(checksum [0-9a-f]{12}… in the bundle, [0-9a-f]{12}… open now\)/)
  })

  it('refuses to relink when a view doesn’t fit the open version, and changes nothing', async () => {
    // fx:21 is in release 1 only.
    const plan = asRelink(planBundleOpen(await bundleOf(v1, true, [viewOn(v1, { hidden: ['fx:21'] })]), v2))
    expect(refusal(() => relinkToAvailable(plan))).toMatch(/^Can't relink to version 2: some of the bundle doesn't fit it, so nothing was changed\. View “Checklist”: 1 node\(s\) not in this classification/)
    expect(keepPinned(plan).snapshot.version).toBe('1')
  })

  it('can’t keep a pinned version the bundle doesn’t include, and says what to open', async () => {
    const plan = asRelink(planBundleOpen(await bundleOf(v1, false), v2))
    expect(plan.embedded).toBeNull()
    expect(refusal(() => keepPinned(plan))).toMatch(/doesn't include fixture-checklist version 1, so it can't be kept/)
    expect(relinkToAvailable(plan).snapshot).toBe(v2)
  })

  it('refuses a bundle without its dataset when that dataset isn’t open', async () => {
    expect(refusal(() => planBundleOpen({ ok: true, notes: [], bundle: { manifest: { format: 'onetaxonomy-bundle', formatVersion: 1, createdAt: NOW, createdBy: APP, snapshots: [{ ...pinOf(v1) }], files: [] }, snapshots: [], views: [], lessons: [], media: [] } }, null))).toBe(
      "This bundle doesn't include its dataset. It was made with fixture-checklist version 1: open that snapshot first, then open the bundle again.",
    )
  })

  it('refuses a damaged bundle whole, listing every problem', () => {
    const read: BundleRead = { ok: false, problems: [{ code: 'missing-file', path: 'views/a.view.json', message: 'views/a.view.json is listed in the manifest but isn’t in the bundle.' }, { code: 'checksum-mismatch', path: 'media/b.png', message: 'media/b.png doesn’t match its checksum.' }] }
    expect(refusal(() => planBundleOpen(read, v1))).toBe('This bundle is damaged or incomplete, so nothing in it was opened. views/a.view.json is listed in the manifest but isn’t in the bundle. media/b.png doesn’t match its checksum.')
  })

  it('refuses a bundle whose embedded view doesn’t fit its own dataset, rather than opening part of it', async () => {
    const broken = viewOn(v1, { target: { kind: 'phylogeny', id: 'no-such-tree' } })
    const read = (await bundleOf(v1, true)) as Extract<BundleRead, { ok: true }>
    expect(refusal(() => planBundleOpen({ ...read, bundle: { ...read.bundle, views: [broken] } }, null))).toMatch(/^Nothing in this bundle was opened, because some of it doesn't fit its dataset: View “Checklist”: Unknown phylogeny no-such-tree/)
  })

  it('refuses a bundle that pins more than one dataset', async () => {
    const read = await readBundle(writeBundle({ createdAt: NOW, createdBy: APP, snapshots: [{ snapshot: v1, embed: true }, { snapshot: v2, embed: true }] }))
    expect(refusal(() => planBundleOpen(read, null))).toBe('This bundle pins 2 datasets, and OneTaxonomy for Mac opens bundles with one.')
  })
})

describe('saving a bundle from the Mac app', () => {
  it('round trip: what is saved opens again with the same dataset, view and lesson', async () => {
    const view = viewOn(v1, { collapsed: [] })
    const save = planBundleSave(v1, view, { ...NOTHING_CARRIED, lessons: [lessonOn(v1)] })
    expect(save.relinked).toEqual([])
    expect(save.problems).toEqual([])
    const plan = planBundleOpen(await readBundle(bundleBytes(v1, save, { embed: true, now: NOW, title: 'Checklist' })), null)
    if (plan.kind !== 'show') throw new Error('expected it to open')
    expect(plan.snapshot.checksum).toBe(v1.checksum)
    expect(plan.carried.views).toEqual([{ ...view, snapshot: pinOf(v1) }])
    expect(plan.carried.lessons.map((l) => l.title)).toEqual(['Lesson one'])
  })

  it('pins an unsealed dataset by the checksum it gets when sealed, without calling that a relink', () => {
    const { checksum: _c, ...unsealed } = v1
    const save = planBundleSave(unsealed as DatasetSnapshot, viewOn(unsealed as DatasetSnapshot), NOTHING_CARRIED)
    expect(save.relinked).toEqual([])
    expect(save.carried.views[0]!.snapshot.checksum).toBe(snapshotChecksum(v1))
  })

  it('the view on screen replaces a carried view with its id; others made with another version are named before saving', () => {
    const carried = { ...NOTHING_CARRIED, views: [viewOn(v1), viewOn(v1, { id: 'other', title: 'Other' })], lessons: [lessonOn(v1)] }
    const save = planBundleSave(v2, viewOn(v2), carried)
    expect(save.carried.views.map((v) => v.id)).toEqual(['other', 'main'])
    expect(save.relinked).toEqual(['View “Other” (made with version 1)', 'Lesson “Lesson one” (made with version 1)'])
    expect(save.carried.views.every((v) => v.snapshot.version === '2')).toBe(true)
  })

  it('won’t build a bundle while something doesn’t fit the dataset', () => {
    const save = planBundleSave(v2, null, { ...NOTHING_CARRIED, views: [viewOn(v1, { hidden: ['fx:21'] })] })
    expect(save.problems).toHaveLength(1)
    expect(() => bundleBytes(v2, save, { embed: true, now: NOW })).toThrow(/not in this classification/)
  })

  it('records the app and its version in the manifest', async () => {
    const r = await readBundle(bundleBytes(v1, planBundleSave(v1, null, NOTHING_CARRIED), { embed: false, now: NOW }))
    if (!r.ok) throw new Error('expected it to open')
    expect(r.bundle.manifest.createdBy).toEqual({ app: 'OneTaxonomy for Mac', version: JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')).version })
  })
})
