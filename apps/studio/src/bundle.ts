import { indexDataset, snapshotChecksum, validateView, type DatasetSnapshot, type TaxonomicView } from '@captiveorigins/onetaxonomy-core'
import { validateLesson, type LessonDeck } from '@captiveorigins/onetaxonomy-education'
import { writeBundle, type Bundle, type BundleLesson, type BundleMedia, type BundleRead, type SnapshotPin } from '@captiveorigins/onetaxonomy-import'

import pkg from '../package.json'

/** Opening and saving `.onetaxonomy` bundles, without file access or UI, so it can be tested alone. */

export const APP = { app: 'OneTaxonomy for Mac', version: pkg.version }

/** What came in a bundle besides the dataset. It goes back out when the bundle is saved again. */
export type Carried = { views: TaxonomicView[]; lessons: BundleLesson[]; media: BundleMedia[] }
export const NOTHING_CARRIED: Carried = { views: [], lessons: [], media: [] }

type Ref = { id: string; version: string; checksum?: string }

/**
 * A snapshot's id, version and checksum, computed from its contents: an unsealed one gets the checksum it will have
 * once sealed, and one whose recorded checksum no longer matches (edited after sealing) is not taken at its word.
 */
export const pinOf = (s: DatasetSnapshot): Required<Ref> => ({ id: s.id, version: s.version, checksum: snapshotChecksum(s) })
const short = (checksum: string) => checksum.replace(/^sha256:/, '').slice(0, 12)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export type BundleOpening =
  | { kind: 'show'; snapshot: DatasetSnapshot; carried: Carried; notices: string[] }
  /** The bundle pins a different version of the dataset that is open: the person chooses, nothing is decided for them. */
  | { kind: 'relink'; pin: SnapshotPin; embedded: DatasetSnapshot | null; available: DatasetSnapshot; bundle: Bundle; notes: string[]; differences: string }

/** Thrown when a bundle can't be opened at all. The message lists every problem; nothing from the bundle is used. */
export class BundleRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundleRefusal'
  }
}

/** How the pinned snapshot and the open one differ, in a sentence. */
export function describeDifference(pin: Ref, available: DatasetSnapshot): string {
  const open = pinOf(available)
  if (pin.version !== open.version) return `This bundle was made with ${pin.id} version ${pin.version}; the dataset open now is version ${open.version}.`
  return `This bundle was made with ${pin.id} version ${pin.version}, and the dataset open now has the same version but different contents (checksum ${short(pin.checksum ?? '')}… in the bundle, ${short(open.checksum)}… open now).`
}

const sameAs = (ref: Ref, pin: Required<Ref>) => ref.id === pin.id && ref.version === pin.version && (!ref.checksum || ref.checksum === pin.checksum)

/** Checks each view and lesson against a dataset, pinned to it. Errors refuse the lot; warnings come back as notices. */
function fit(carried: Carried, snapshot: DatasetSnapshot): { carried: Carried; notices: string[]; problems: string[] } {
  const pin = pinOf(snapshot)
  const index = indexDataset(snapshot)
  const problems: string[] = []
  const notices: string[] = []
  const views = carried.views.map((v) => {
    const next = { ...v, snapshot: pin }
    for (const d of validateView(next, index)) (d.severity === 'error' ? problems : notices).push(`View “${v.title}”: ${d.message}`)
    return next
  })
  const lessons = carried.lessons.map((l) => {
    const next = { ...l, snapshot: pin }
    for (const d of validateLesson(next as unknown as LessonDeck, index)) (d.severity === 'error' ? problems : notices).push(`Lesson “${l.title}”: ${d.message}`)
    return next
  })
  return { carried: { views, lessons, media: carried.media }, notices, problems }
}

const carriedOf = (b: Bundle): Carried => ({ views: b.views, lessons: b.lessons, media: b.media })

function refuse(problems: string[], lead: string): never {
  throw new BundleRefusal(`${lead} ${problems.join(' ')}`)
}

function showWith(snapshot: DatasetSnapshot, bundle: Bundle, notes: string[]): Extract<BundleOpening, { kind: 'show' }> {
  const { carried, notices, problems } = fit(carriedOf(bundle), snapshot)
  if (problems.length) refuse(problems, "Nothing in this bundle was opened, because some of it doesn't fit its dataset:")
  return { kind: 'show', snapshot, carried, notices: [...notes, ...notices] }
}

/**
 * What to do with a bundle that was read. `available` is the dataset open now, if any. A damaged bundle is refused
 * with every problem listed. A bundle with more than one pinned snapshot is refused (the Mac app shows one dataset).
 * If the open dataset is the pinned one, nothing is asked. If it is the same dataset in another version (or the same
 * version with other contents), the person is asked. Otherwise the embedded snapshot is shown, or, when there isn't
 * one, the bundle is refused with what to open first.
 */
export function planBundleOpen(read: BundleRead, available: DatasetSnapshot | null): BundleOpening {
  if (!read.ok) refuse(read.problems.map((p) => p.message), 'This bundle is damaged or incomplete, so nothing in it was opened.')
  const { bundle, notes } = read
  if (bundle.manifest.snapshots.length !== 1)
    throw new BundleRefusal(`This bundle pins ${bundle.manifest.snapshots.length} datasets, and OneTaxonomy for Mac opens bundles with one.`)
  const pin = bundle.manifest.snapshots[0]!
  const embedded = bundle.snapshots[0] ?? null
  if (available && available.id === pin.id) {
    if (sameAs(pin, pinOf(available))) return showWith(embedded ?? available, bundle, notes)
    return { kind: 'relink', pin, embedded, available, bundle, notes, differences: describeDifference(pin, available) }
  }
  if (embedded) return showWith(embedded, bundle, notes)
  throw new BundleRefusal(`This bundle doesn't include its dataset. It was made with ${pin.id} version ${pin.version}: open that snapshot first, then open the bundle again.`)
}

/** Keep the version the bundle pins: its embedded snapshot replaces the open one. */
export function keepPinned(plan: Extract<BundleOpening, { kind: 'relink' }>): Extract<BundleOpening, { kind: 'show' }> {
  if (!plan.embedded) throw new BundleRefusal(`This bundle doesn't include ${plan.pin.id} version ${plan.pin.version}, so it can't be kept. Relink to the open version, or open that version's snapshot first.`)
  return showWith(plan.embedded, plan.bundle, plan.notes)
}

/** Relink to the open version: every view and lesson is checked against it and pinned to it, or none is. */
export function relinkToAvailable(plan: Extract<BundleOpening, { kind: 'relink' }>): Extract<BundleOpening, { kind: 'show' }> {
  const { carried, notices, problems } = fit(carriedOf(plan.bundle), plan.available)
  if (problems.length) refuse(problems, `Can't relink to version ${plan.available.version}: some of the bundle doesn't fit it, so nothing was changed.`)
  const n = carried.views.length + carried.lessons.length
  const moved = `Relinked ${plural(n, 'view or lesson', 'views and lessons')} from ${plan.pin.id} version ${plan.pin.version} to version ${plan.available.version}. The bundle file is unchanged; Save as bundle… writes the relinked copy.`
  return { kind: 'show', snapshot: plan.available, carried, notices: [moved, ...plan.notes, ...notices] }
}

export type BundleSave = { carried: Carried; relinked: string[]; problems: string[] }

/**
 * What Save as bundle… would write with the dataset on screen. The view on screen joins the carried ones (replacing
 * one with its id). Anything made with another version of the dataset (a bundle's view, after a tree was added) is
 * named in `relinked`, so the person sees it before saving; anything that doesn't fit the dataset is in `problems`,
 * and saving waits until there are none.
 */
export function planBundleSave(snapshot: DatasetSnapshot, current: TaxonomicView | null, carried: Carried): BundleSave {
  const pin = pinOf(snapshot)
  const views = current ? [...carried.views.filter((v) => v.id !== current.id), current] : carried.views
  const relinked = [...views.filter((v) => !sameAs(v.snapshot, pin)).map((v) => `View “${v.title}” (made with version ${v.snapshot.version})`), ...carried.lessons.filter((l) => !sameAs(l.snapshot, pin)).map((l) => `Lesson “${l.title}” (made with version ${l.snapshot.version})`)]
  const { carried: fitted, problems } = fit({ views, lessons: carried.lessons, media: carried.media }, snapshot)
  return { carried: fitted, relinked, problems }
}

export function bundleBytes(snapshot: DatasetSnapshot, save: BundleSave, { embed, now, title }: { embed: boolean; now: string; title?: string }): Uint8Array {
  if (save.problems.length) throw new Error(save.problems.join(' '))
  return writeBundle({ createdAt: now, createdBy: APP, ...(title ? { title } : {}), snapshots: [{ snapshot, embed }], ...save.carried })
}
