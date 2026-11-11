import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createView, indexDataset, sealSnapshot, sha256Bytes, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'

import { BUNDLE_FORMAT_VERSION, crc32, isSafeBundlePath, readBundle, readZip, writeBundle, writeZip, type BundleLesson, type BundleProblem } from '../src'
import { makeZip } from './zip-helper'

const amniotes = JSON.parse(readFileSync(join(__dirname, '../../../fixtures/amniotes.json'), 'utf8')) as DatasetSnapshot
const sealed = sealSnapshot(amniotes)
const view = createView(indexDataset(sealed), { id: 'main', title: 'Archelosauria', target: { kind: 'phylogeny', id: 'archelosauria' } })
const lesson: BundleLesson = { format: 'onetaxonomy-lesson', formatVersion: 1, id: 'turtles', title: 'Where turtles go', version: '1', snapshot: { id: sealed.id, version: sealed.version, checksum: sealed.checksum! }, scenes: [], worksheets: [] }
const photo = { path: 'media/shell.png', data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]), mediaType: 'image/png' }
const base = { createdAt: '2026-11-11T09:30:00.000Z', createdBy: { app: 'OneTaxonomy for Mac', version: '0.1.1' } }
const full = () => writeBundle({ ...base, title: 'Turtles', snapshots: [{ snapshot: amniotes, embed: true }], views: [view], lessons: [lesson], media: [photo] })

const text = (b: Uint8Array) => new TextDecoder().decode(b)
const bytes = (s: string) => new TextEncoder().encode(s)

/** Rewrites a bundle's entries, to make the damaged and tampered files the reader has to catch. */
async function tamper(bundle: Uint8Array, change: (files: Map<string, Uint8Array>) => void) {
  const files = await readZip(bundle)
  change(files)
  return writeZip([...files].map(([path, data]) => ({ path, data })))
}
const editJson = (files: Map<string, Uint8Array>, path: string, edit: (v: Record<string, unknown>) => void) => {
  const v = JSON.parse(text(files.get(path)!)) as Record<string, unknown>
  edit(v)
  files.set(path, bytes(JSON.stringify(v, null, 2)))
}
/** Keeps the manifest's size and checksum for a file in step with an edit, so only the check under test fails. */
const relist = (files: Map<string, Uint8Array>, path: string) =>
  editJson(files, 'manifest.json', (m) => {
    const f = (m.files as { path: string; sha256: string; bytes: number }[]).find((x) => x.path === path)!
    f.sha256 = sha256Bytes(files.get(path)!)
    f.bytes = files.get(path)!.length
  })

async function problems(b: Uint8Array): Promise<BundleProblem[]> {
  const r = await readBundle(b)
  if (r.ok) throw new Error('expected the bundle to be refused')
  return r.problems
}

describe('.onetaxonomy bundles', () => {
  it('round trip: the snapshot, view, lesson and media come back as written, with the manifest describing them', async () => {
    const r = await readBundle(full())
    if (!r.ok) throw new Error(r.problems.map((p) => p.message).join('\n'))
    const { manifest, snapshots, views, lessons, media } = r.bundle
    expect(r.notes).toEqual([])
    expect(manifest).toMatchObject({ format: 'onetaxonomy-bundle', formatVersion: BUNDLE_FORMAT_VERSION, createdAt: base.createdAt, createdBy: base.createdBy, title: 'Turtles' })
    expect(manifest.snapshots).toEqual([{ id: 'fixture-amniotes', version: '1', checksum: sealed.checksum, file: 'snapshots/fixture-amniotes-1.json' }])
    expect(manifest.files.map((f) => [f.path, f.role])).toEqual([
      ['snapshots/fixture-amniotes-1.json', 'snapshot'],
      ['views/main.view.json', 'view'],
      ['lessons/turtles.lesson.json', 'lesson'],
      ['media/shell.png', 'media'],
    ])
    expect(snapshots).toEqual([JSON.parse(JSON.stringify(sealed))])
    expect(views).toEqual([view])
    expect(lessons).toEqual([lesson])
    expect(media).toEqual([{ ...photo, data: photo.data }])
  })

  it('is readable without OneTaxonomy: the manifest comes first, and every file is plain JSON with real CRCs', async () => {
    const b = full()
    const files = await readZip(b)
    expect([...files.keys()][0]).toBe('manifest.json')
    const manifest = JSON.parse(text(files.get('manifest.json')!)) as { files: { path: string; sha256: string }[] }
    for (const f of manifest.files) expect(sha256Bytes(files.get(f.path)!)).toBe(f.sha256)
    // The embedded snapshot is the same text Save snapshot… writes.
    expect(text(files.get('snapshots/fixture-amniotes-1.json')!)).toBe(`${JSON.stringify(sealed, null, 2)}\n`)
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926)
    if (existsSync('/usr/bin/unzip')) {
      const dir = mkdtempSync(join(tmpdir(), 'onetaxonomy-bundle-'))
      try {
        writeFileSync(join(dir, 'made-up.onetaxonomy'), b)
        expect(execFileSync('/usr/bin/unzip', ['-t', join(dir, 'made-up.onetaxonomy')], { encoding: 'utf8' })).toMatch(/No errors detected/)
        expect(JSON.parse(execFileSync('/usr/bin/unzip', ['-p', join(dir, 'made-up.onetaxonomy'), 'views/main.view.json'], { encoding: 'utf8' }))).toEqual(view)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('can pin a snapshot without embedding it', async () => {
    const r = await readBundle(writeBundle({ ...base, snapshots: [{ snapshot: amniotes, embed: false }], views: [view] }))
    if (!r.ok) throw new Error('expected it to open')
    expect(r.bundle.snapshots).toEqual([])
    expect(r.bundle.manifest.snapshots).toEqual([{ id: 'fixture-amniotes', version: '1', checksum: sealed.checksum }])
    expect(r.bundle.views).toEqual([view])
  })

  it('refuses to write a view or lesson made with a snapshot the bundle doesn’t pin, or an unsafe media path', () => {
    const other = { ...view, snapshot: { id: 'fixture-amniotes', version: '2' } }
    expect(() => writeBundle({ ...base, snapshots: [{ snapshot: amniotes, embed: true }], views: [other] })).toThrow(/doesn't pin/)
    expect(() => writeBundle({ ...base, snapshots: [{ snapshot: amniotes, embed: true }], media: [{ path: 'media/../x', data: new Uint8Array() }] })).toThrow(/media path/)
    expect(() => writeBundle({ ...base, snapshots: [] })).toThrow(/at least one/)
  })

  it('gives files with the same id different names', async () => {
    const r = await readBundle(writeBundle({ ...base, snapshots: [{ snapshot: amniotes, embed: true }], views: [view, { ...view, title: 'Again' }] }))
    if (!r.ok) throw new Error('expected it to open')
    expect(r.bundle.manifest.files.map((f) => f.path)).toEqual(['snapshots/fixture-amniotes-1.json', 'views/main.view.json', 'views/main-2.view.json'])
  })

  describe('damaged-file diagnostics: each names the problem and the file, and nothing is returned', () => {
    it('not a ZIP', async () => {
      expect(await problems(bytes('{"format":"onetaxonomy-bundle"}'))).toMatchObject([{ code: 'not-a-zip' }])
      const cut = full().slice(0, 400)
      expect((await problems(cut))[0]!.code).toBe('not-a-zip')
    })
    it('no manifest', async () => {
      expect(await problems(makeZip({ 'views/main.view.json': '{}' }))).toMatchObject([{ code: 'missing-manifest', path: 'manifest.json' }])
    })
    it('bad JSON in the manifest', async () => {
      expect(await problems(makeZip({ 'manifest.json': '{"format": "onetaxonomy-bundle",' }))).toMatchObject([{ code: 'bad-json', path: 'manifest.json' }])
    })
    it('a ZIP that is something else', async () => {
      expect(await problems(makeZip({ 'manifest.json': '{"format":"something-else"}' }))).toMatchObject([{ code: 'not-a-bundle' }])
    })
    it('an unknown format version', async () => {
      const b = await tamper(full(), (f) => editJson(f, 'manifest.json', (m) => (m.formatVersion = 2)))
      const [p] = await problems(b)
      expect(p).toMatchObject({ code: 'unknown-format-version', path: 'manifest.json' })
      expect(p!.message).toMatch(/format version 2.*reads version 1/)
    })
    it('a manifest missing what it must say', async () => {
      const b = await tamper(full(), (f) => editJson(f, 'manifest.json', (m) => delete m.snapshots))
      expect(await problems(b)).toMatchObject([{ code: 'bad-manifest', message: 'manifest.json pins no snapshot.' }])
    })
    it('a listed file that is missing', async () => {
      const b = await tamper(full(), (f) => f.delete('views/main.view.json'))
      expect(await problems(b)).toMatchObject([{ code: 'missing-file', path: 'views/main.view.json', message: 'views/main.view.json is listed in the manifest but isn’t in the bundle.' }])
    })
    it('a checksum mismatch (same size, different bytes)', async () => {
      const b = await tamper(full(), (f) => {
        const m = f.get('media/shell.png')!.slice()
        m[7] = 0
        f.set('media/shell.png', m)
      })
      expect(await problems(b)).toMatchObject([{ code: 'checksum-mismatch', path: 'media/shell.png' }])
    })
    it('a size mismatch', async () => {
      const b = await tamper(full(), (f) => f.set('media/shell.png', Uint8Array.from([1, 2])))
      expect(await problems(b)).toMatchObject([{ code: 'size-mismatch', path: 'media/shell.png' }])
    })
    it('several problems are all listed', async () => {
      const b = await tamper(full(), (f) => {
        f.delete('views/main.view.json')
        f.set('media/shell.png', Uint8Array.from([1, 2]))
      })
      expect((await problems(b)).map((p) => p.code)).toEqual(['missing-file', 'size-mismatch'])
    })
    it('bad JSON in a view, even with a checksum to match', async () => {
      const b = await tamper(full(), (f) => {
        f.set('views/main.view.json', bytes('{"format": "onetaxonomy-view", '))
        relist(f, 'views/main.view.json')
      })
      expect(await problems(b)).toMatchObject([{ code: 'bad-json', path: 'views/main.view.json' }])
    })
    it('an embedded snapshot edited after sealing, even with the manifest updated to match', async () => {
      const b = await tamper(full(), (f) => {
        editJson(f, 'snapshots/fixture-amniotes-1.json', (s) => (s.version = '1-edited'))
        relist(f, 'snapshots/fixture-amniotes-1.json')
      })
      expect(await problems(b)).toMatchObject([{ code: 'checksum-mismatch', path: 'snapshots/fixture-amniotes-1.json' }])
    })
    it('an embedded snapshot that isn’t the one pinned', async () => {
      const other = sealSnapshot({ ...amniotes, version: '2' })
      const b = await tamper(full(), (f) => {
        f.set('snapshots/fixture-amniotes-1.json', bytes(JSON.stringify(other, null, 2)))
        relist(f, 'snapshots/fixture-amniotes-1.json')
      })
      expect(await problems(b)).toMatchObject([{ code: 'pin-mismatch', path: 'snapshots/fixture-amniotes-1.json' }])
    })
    it('a view made with a snapshot the manifest doesn’t pin', async () => {
      const b = await tamper(full(), (f) => {
        editJson(f, 'views/main.view.json', (v) => (v.snapshot = { id: 'fixture-amniotes', version: '0' }))
        relist(f, 'views/main.view.json')
      })
      expect(await problems(b)).toMatchObject([{ code: 'unpinned', path: 'views/main.view.json' }])
    })
    it('a path that climbs out of its folder', async () => {
      const b = await tamper(full(), (f) =>
        editJson(f, 'manifest.json', (m) => ((m.files as { path: string }[]).find((x) => x.path === 'media/shell.png')!.path = 'media/../../shell.png')),
      )
      expect(await problems(b)).toMatchObject([{ code: 'unsafe-path', path: 'media/../../shell.png' }])
      expect(isSafeBundlePath('/etc/passwd')).toBe(false)
      expect(isSafeBundlePath('views/a.json', 'media')).toBe(false)
      expect(isSafeBundlePath('media/a.png', 'media')).toBe(true)
    })
  })

  it('leaves out files the manifest doesn’t list, and says so', async () => {
    const b = await tamper(full(), (f) => f.set('notes.txt', bytes('hello')))
    const r = await readBundle(b)
    if (!r.ok) throw new Error('expected it to open')
    expect(r.notes).toEqual(['notes.txt is in the bundle but not in its manifest, so it was left out.'])
  })
})
