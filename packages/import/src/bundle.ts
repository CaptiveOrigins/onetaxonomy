import { canonicalJson, parseView, sealSnapshot, sha256Bytes, type DatasetSnapshot, type Id, type TaxonomicView } from '@extantape/onetaxonomy-core'

import { readSnapshotJson } from './json'
import { decodeUtf8, encodeUtf8, readZip, writeZip, type Inflate } from './zip'

/**
 * The `.onetaxonomy` bundle: a ZIP holding `manifest.json` and plain JSON files (snapshots, views, lessons) plus
 * media. The format is documented in docs/architecture/bundle-format.md so it can be read without OneTaxonomy.
 */

export const BUNDLE_FORMAT = 'onetaxonomy-bundle' as const
export const BUNDLE_FORMAT_VERSION = 1 as const

/** A snapshot the bundle's views and lessons were made with: its id, version and sealed checksum. `file` is set when it is embedded. */
export type SnapshotPin = { id: Id; version: string; checksum: string; file?: string }
export type BundleFileRole = 'snapshot' | 'view' | 'lesson' | 'media'
export type BundleFile = { path: string; role: BundleFileRole; sha256: string; bytes: number; mediaType?: string }

export type BundleManifest = {
  format: typeof BUNDLE_FORMAT
  formatVersion: typeof BUNDLE_FORMAT_VERSION
  createdAt: string
  createdBy: { app: string; version: string }
  title?: string
  snapshots: SnapshotPin[]
  files: BundleFile[]
}

/** A lesson deck as a bundle carries it. The education package reads and checks the rest; here only its pin matters. */
export type BundleLesson = { format: 'onetaxonomy-lesson'; formatVersion: number; id: Id; title: string; snapshot: { id: Id; version: string; checksum?: string }; [key: string]: unknown }
export type BundleMedia = { path: string; data: Uint8Array; mediaType?: string }

export type Bundle = {
  manifest: BundleManifest
  /** Embedded snapshots, sealed and matching their pins, in the manifest's order. */
  snapshots: DatasetSnapshot[]
  views: TaxonomicView[]
  lessons: BundleLesson[]
  media: BundleMedia[]
}

export type BundleProblemCode =
  | 'not-a-zip'
  | 'missing-manifest'
  | 'bad-json'
  | 'not-a-bundle'
  | 'unknown-format-version'
  | 'bad-manifest'
  | 'unsafe-path'
  | 'missing-file'
  | 'size-mismatch'
  | 'checksum-mismatch'
  | 'pin-mismatch'
  | 'bad-content'
  | 'unpinned'

/** Why a bundle can't be opened. `path` is the file inside the bundle, when there is one. */
export type BundleProblem = { code: BundleProblemCode; message: string; path?: string }

/** Either the whole bundle, with notes about things that don't stop it opening, or every problem found. Never part of one. */
export type BundleRead = { ok: true; bundle: Bundle; notes: string[] } | { ok: false; problems: BundleProblem[] }

const FOLDERS: Record<BundleFileRole, string> = { snapshot: 'snapshots/', view: 'views/', lesson: 'lessons/', media: 'media/' }

/** A path inside the bundle: relative, forward slashes, no `.` or `..` parts, in its role's folder. */
export function isSafeBundlePath(path: string, role?: BundleFileRole): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)) return false
  if (path.split('/').some((p) => p === '' || p === '.' || p === '..')) return false
  return role ? path.startsWith(FOLDERS[role]) && path.length > FOLDERS[role].length : true
}

const pretty = (value: unknown) => `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`
const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'item'
const samePin = (a: { id: Id; version: string }, b: { id: Id; version: string }) => a.id === b.id && a.version === b.version

export type WriteBundleInput = {
  createdAt: string
  createdBy: { app: string; version: string }
  title?: string
  /** Each snapshot is sealed on the way in. `embed: false` pins it without including it. */
  snapshots: { snapshot: DatasetSnapshot; embed: boolean }[]
  views?: TaxonomicView[]
  lessons?: BundleLesson[]
  /** `path` is the file's name inside `media/` (e.g. `media/photo.jpg`). */
  media?: BundleMedia[]
}

/**
 * Builds a bundle's bytes. Every view and lesson must pin one of the snapshots (id and version), or this throws
 * before building anything, so a bundle that writes is one that reads. JSON is pretty-printed with sorted keys.
 */
export function writeBundle(input: WriteBundleInput): Uint8Array {
  if (!input.snapshots.length) throw new Error('A bundle pins at least one snapshot')
  const used = new Set<string>(['manifest.json'])
  const unique = (folder: string, base: string, ext: string) => {
    let path = `${folder}${base}${ext}`
    for (let n = 2; used.has(path); n++) path = `${folder}${base}-${n}${ext}`
    used.add(path)
    return path
  }
  const entries: { path: string; data: Uint8Array; role: BundleFileRole; mediaType?: string }[] = []
  const pins: SnapshotPin[] = []
  for (const { snapshot, embed } of input.snapshots) {
    const sealed = sealSnapshot(snapshot)
    if (pins.some((p) => samePin(p, sealed))) throw new Error(`Snapshot ${sealed.id} ${sealed.version} is listed twice`)
    const pin: SnapshotPin = { id: sealed.id, version: sealed.version, checksum: sealed.checksum! }
    if (embed) {
      pin.file = unique('snapshots/', fileSlug(`${sealed.id}-${sealed.version}`), '.json')
      // The same text Save snapshot… writes, so the file inside is an ordinary sealed snapshot.
      entries.push({ path: pin.file, data: encodeUtf8(`${JSON.stringify(sealed, null, 2)}\n`), role: 'snapshot' })
    }
    pins.push(pin)
  }
  const pinned = (what: string, ref: { id: Id; version: string }) => {
    if (!pins.some((p) => samePin(p, ref))) throw new Error(`${what} was made with ${ref.id} ${ref.version}, which this bundle doesn't pin`)
  }
  for (const v of input.views ?? []) {
    pinned(`View “${v.title}”`, v.snapshot)
    entries.push({ path: unique('views/', fileSlug(v.id), '.view.json'), data: encodeUtf8(pretty(v)), role: 'view' })
  }
  for (const l of input.lessons ?? []) {
    pinned(`Lesson “${l.title}”`, l.snapshot)
    entries.push({ path: unique('lessons/', fileSlug(l.id), '.lesson.json'), data: encodeUtf8(pretty(l)), role: 'lesson' })
  }
  for (const m of input.media ?? []) {
    if (!isSafeBundlePath(m.path, 'media') || used.has(m.path)) throw new Error(`${m.path} is not a usable media path (it must be media/<name>, once)`)
    used.add(m.path)
    entries.push({ path: m.path, data: m.data, role: 'media', ...(m.mediaType ? { mediaType: m.mediaType } : {}) })
  }
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    ...(input.title ? { title: input.title } : {}),
    snapshots: pins,
    files: entries.map((e) => ({ path: e.path, role: e.role, sha256: sha256Bytes(e.data), bytes: e.data.length, ...(e.mediaType ? { mediaType: e.mediaType } : {}) })),
  }
  // The manifest goes first, so a person (or a tool) who opens the ZIP sees it at the top.
  return writeZip([{ path: 'manifest.json', data: encodeUtf8(`${JSON.stringify(manifest, null, 2)}\n`) }, ...entries], { modified: input.createdAt })
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function checkManifest(value: unknown, problems: BundleProblem[]): BundleManifest | null {
  const bad = (message: string) => {
    problems.push({ code: 'bad-manifest', path: 'manifest.json', message })
    return null
  }
  if (!isObject(value) || value.format !== BUNDLE_FORMAT) {
    problems.push({ code: 'not-a-bundle', path: 'manifest.json', message: 'manifest.json is not a OneTaxonomy bundle manifest (its format isn’t “onetaxonomy-bundle”).' })
    return null
  }
  if (value.formatVersion !== BUNDLE_FORMAT_VERSION) {
    problems.push({
      code: 'unknown-format-version',
      path: 'manifest.json',
      message: `This bundle is format version ${String(value.formatVersion)}, and this version of OneTaxonomy reads version ${BUNDLE_FORMAT_VERSION}. A newer OneTaxonomy may open it.`,
    })
    return null
  }
  if (!isString(value.createdAt)) return bad('manifest.json has no createdAt date.')
  if (!isObject(value.createdBy) || !isString(value.createdBy.app) || typeof value.createdBy.version !== 'string') return bad('manifest.json doesn’t say what made it (createdBy).')
  if (!Array.isArray(value.snapshots) || !value.snapshots.length) return bad('manifest.json pins no snapshot.')
  for (const [i, p] of value.snapshots.entries()) {
    if (!isObject(p) || !isString(p.id) || !isString(p.version) || !isString(p.checksum) || !/^sha256:[0-9a-f]{64}$/.test(p.checksum)) return bad(`Snapshot pin ${i + 1} in manifest.json needs an id, a version and a sha256: checksum.`)
    if (p.file !== undefined && !isString(p.file)) return bad(`Snapshot pin ${i + 1} in manifest.json has a file that isn’t a path.`)
  }
  if (!Array.isArray(value.files)) return bad('manifest.json has no files list.')
  for (const [i, f] of value.files.entries()) {
    if (!isObject(f) || !isString(f.path) || !['snapshot', 'view', 'lesson', 'media'].includes(f.role as string) || !isString(f.sha256) || !/^[0-9a-f]{64}$/.test(f.sha256) || typeof f.bytes !== 'number')
      return bad(`File ${i + 1} in manifest.json needs a path, a role (snapshot, view, lesson or media), a sha256 and a size in bytes.`)
  }
  return value as unknown as BundleManifest
}

/**
 * Reads a bundle's bytes and checks all of it before returning any: the manifest and its format version, every
 * listed file's presence, size and SHA-256, the JSON in each, that embedded snapshots are sealed and match their
 * pins, and that each view and lesson pins a snapshot the manifest lists. Problems are collected, not just the
 * first; any problem means `ok: false` and nothing is returned. Files in the ZIP that the manifest doesn't list are
 * left out and named in `notes`.
 */
export async function readBundle(bytes: Uint8Array, { inflate }: { inflate?: Inflate } = {}): Promise<BundleRead> {
  let zip: Map<string, Uint8Array>
  try {
    zip = await readZip(bytes, inflate)
  } catch (e) {
    return { ok: false, problems: [{ code: 'not-a-zip', message: `This isn’t a readable ZIP file, so it isn’t a bundle or it is damaged (${e instanceof Error ? e.message : String(e)}).` }] }
  }
  const raw = zip.get('manifest.json')
  if (!raw) return { ok: false, problems: [{ code: 'missing-manifest', path: 'manifest.json', message: 'There is no manifest.json at the top of this ZIP, so it isn’t a OneTaxonomy bundle or it is damaged.' }] }
  const problems: BundleProblem[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeUtf8(raw))
  } catch (e) {
    return { ok: false, problems: [{ code: 'bad-json', path: 'manifest.json', message: `manifest.json isn’t valid JSON (${e instanceof Error ? e.message : String(e)}).` }] }
  }
  const manifest = checkManifest(parsed, problems)
  if (!manifest) return { ok: false, problems }

  const seen = new Set<string>()
  const contents = new Map<string, Uint8Array>()
  for (const f of manifest.files) {
    if (!isSafeBundlePath(f.path, f.role)) {
      problems.push({ code: 'unsafe-path', path: f.path, message: `${f.path} isn’t a path a bundle may use for a ${f.role} (it must be inside ${FOLDERS[f.role]}, with no “..”).` })
      continue
    }
    if (seen.has(f.path)) {
      problems.push({ code: 'bad-manifest', path: f.path, message: `${f.path} is listed twice in manifest.json.` })
      continue
    }
    seen.add(f.path)
    const data = zip.get(f.path)
    if (!data) problems.push({ code: 'missing-file', path: f.path, message: `${f.path} is listed in the manifest but isn’t in the bundle.` })
    else if (data.length !== f.bytes) problems.push({ code: 'size-mismatch', path: f.path, message: `${f.path} is ${data.length} bytes, but the manifest says ${f.bytes}: it has changed or is damaged.` })
    else if (sha256Bytes(data) !== f.sha256) problems.push({ code: 'checksum-mismatch', path: f.path, message: `${f.path} doesn’t match its checksum in the manifest: it has changed or is damaged.` })
    else contents.set(f.path, data)
  }
  const notes = [...zip.keys()].filter((p) => p !== 'manifest.json' && !seen.has(p)).map((p) => `${p} is in the bundle but not in its manifest, so it was left out.`)

  const json = (path: string): unknown => {
    try {
      return JSON.parse(decodeUtf8(contents.get(path)!))
    } catch (e) {
      problems.push({ code: 'bad-json', path, message: `${path} isn’t valid JSON (${e instanceof Error ? e.message : String(e)}).` })
      return undefined
    }
  }

  const snapshots: DatasetSnapshot[] = []
  for (const pin of manifest.snapshots) {
    if (!pin.file) continue
    const listed = manifest.files.find((f) => f.path === pin.file)
    if (!listed || listed.role !== 'snapshot') {
      problems.push({ code: 'bad-manifest', path: pin.file, message: `The pin for ${pin.id} ${pin.version} names ${pin.file}, which the manifest doesn’t list as a snapshot.` })
      continue
    }
    if (!contents.has(pin.file)) continue // already reported
    const text = decodeUtf8(contents.get(pin.file)!)
    try {
      JSON.parse(text)
    } catch (e) {
      problems.push({ code: 'bad-json', path: pin.file, message: `${pin.file} isn’t valid JSON (${e instanceof Error ? e.message : String(e)}).` })
      continue
    }
    try {
      const { snapshot, diagnostics, checksum } = readSnapshotJson(text)
      const errors = diagnostics.filter((d) => d.severity === 'error')
      if (checksum !== 'verified') problems.push({ code: 'checksum-mismatch', path: pin.file, message: `${pin.file} is ${checksum === 'unsealed' ? 'not sealed' : 'not what was sealed: its checksum doesn’t match its content'}.` })
      else if (snapshot.id !== pin.id || snapshot.version !== pin.version || snapshot.checksum !== pin.checksum)
        problems.push({ code: 'pin-mismatch', path: pin.file, message: `${pin.file} is ${snapshot.id} ${snapshot.version}, but the manifest pins ${pin.id} ${pin.version} with a different checksum.` })
      else if (errors.length) problems.push({ code: 'bad-content', path: pin.file, message: `${pin.file} can’t be used: ${errors[0]!.message}` })
      else snapshots.push(snapshot)
    } catch (e) {
      problems.push({ code: 'bad-content', path: pin.file, message: `${pin.file} isn’t a OneTaxonomy snapshot (${e instanceof Error ? e.message : String(e)}).` })
    }
  }
  for (const f of manifest.files.filter((x) => x.role === 'snapshot' && contents.has(x.path)))
    if (!manifest.snapshots.some((p) => p.file === f.path)) problems.push({ code: 'bad-manifest', path: f.path, message: `${f.path} is listed as a snapshot but no pin names it.` })

  const pinnedRef = (path: string, ref: unknown) => {
    const r = isObject(ref) ? ref : {}
    const pin = manifest.snapshots.find((p) => p.id === r.id && p.version === r.version)
    if (!pin) problems.push({ code: 'unpinned', path, message: `${path} was made with ${String(r.id)} ${String(r.version)}, which the manifest doesn’t pin.` })
    else if (r.checksum !== undefined && r.checksum !== pin.checksum) problems.push({ code: 'pin-mismatch', path, message: `${path} was made with a different ${pin.id} ${pin.version} than the one pinned (the checksums differ).` })
    else return true
    return false
  }

  const views: TaxonomicView[] = []
  const lessons: BundleLesson[] = []
  const media: BundleMedia[] = []
  for (const f of manifest.files) {
    if (!contents.has(f.path)) continue
    if (f.role === 'view') {
      const value = json(f.path)
      if (value === undefined) continue
      try {
        const view = parseView(JSON.stringify(value))
        if (pinnedRef(f.path, view.snapshot)) views.push(view)
      } catch (e) {
        problems.push({ code: 'bad-content', path: f.path, message: `${f.path} isn’t a OneTaxonomy view (${e instanceof Error ? e.message : String(e)}).` })
      }
    } else if (f.role === 'lesson') {
      const value = json(f.path)
      if (value === undefined) continue
      if (!isObject(value) || value.format !== 'onetaxonomy-lesson' || !isString(value.id)) problems.push({ code: 'bad-content', path: f.path, message: `${f.path} isn’t a OneTaxonomy lesson.` })
      else if (pinnedRef(f.path, value.snapshot)) lessons.push(value as BundleLesson)
    } else if (f.role === 'media') media.push({ path: f.path, data: contents.get(f.path)!, ...(f.mediaType ? { mediaType: f.mediaType } : {}) })
  }

  if (problems.length) return { ok: false, problems }
  return { ok: true, bundle: { manifest, snapshots, views, lessons, media }, notes }
}
