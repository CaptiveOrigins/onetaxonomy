import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasErrors, sealSnapshot, type CuratedSelection, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import { checkPresetReferences, readSnapshotJson, reconcile, selectiveImport, validatePreset, type CommunityPreset } from '../src'
import checklistJson from '../../../fixtures/checklist.json'
import checklistV2Json from '../../../fixtures/checklist-v2.json'

const checklist = checklistJson as DatasetSnapshot
const v2 = checklistV2Json as DatasetSnapshot
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const threeTaxa: CuratedSelection = {
  id: 'three',
  title: 'Three nonadjacent taxa',
  version: '1',
  classification: 'fx:checklist',
  roots: ['fx:6', 'fx:13', 'fx:25'].map((concept) => ({ concept, policy: { kind: 'explicit' as const } })),
}

describe('selectiveImport (M3 acceptance)', () => {
  it('imports only the chosen taxa and their ancestor paths, and shows what was omitted', () => {
    const r = selectiveImport(checklist, threeTaxa, { id: 'curated', version: '1', createdAt: '2026-11-02T00:00:00.000Z' })
    expect(r.snapshot.concepts).toHaveLength(12)
    expect(hasErrors(r.diagnostics)).toBe(false)
    expect(r.snapshot.derivedFrom?.checksum).toBe(checklist.checksum)
    expect(r.coverage.map((g) => [g.name, g.dataset.included, g.dataset.omitted])).toEqual([
      ['Alphus secundus', 1, 1],
      ['Gammus quintus', 1, 0],
      ['Zetus nonus', 1, 0],
    ])
    // Batch of three clades in one selection; nothing from unselected branches.
    const names = new Set(r.snapshot.names.map((n) => n.name))
    for (const absent of ['Alphus primus', 'Betus', 'Deltiformes', 'Gammus quartus']) expect(names.has(absent)).toBe(false)
  })

  it('refuses a selection with errors instead of importing part of it', () => {
    expect(() => selectiveImport(checklist, { ...threeTaxa, roots: [{ concept: 'missing', policy: { kind: 'explicit' } }] }, { id: 'x', version: '1', createdAt: 'x' })).toThrow(/can't be applied/)
  })
})

describe('reconcile', () => {
  it('links by shared identifier, lists same-name candidates and ambiguity, never merges', () => {
    const r = reconcile(checklist, v2)
    expect(r.sharedIdentifier).toHaveLength(24)
    expect(r.ambiguous).toEqual([{ name: 'Alphus primus', a: ['fx:5'], b: ['fx:5', 'fx:28'] }])
    expect(r.onlyInA).toEqual([])
    expect(r.onlyInB).toEqual([])
    // Same names, other source, no shared identifiers: candidates only.
    const other = clone(v2)
    for (const c of other.concepts) c.externalIds = [{ source: 'other', id: c.id }]
    const byName = reconcile(checklist, other)
    expect(byName.sharedIdentifier).toEqual([])
    expect(byName.sameName.find((m) => m.name === 'Gammus quartus')).toEqual({ a: 'fx:12', b: 'fx:12', name: 'Gammus quartus', statusA: 'accepted', statusB: 'accepted', authorshipDiffers: false })
    expect(byName.onlyInA).toContain('fx:13')
    expect(checklist.concepts).toHaveLength(25)
  })
})

describe('readSnapshotJson', () => {
  const text = readFileSync(new URL('../../../fixtures/checklist.json', import.meta.url), 'utf8')
  it('verifies the checksum and validates', () => {
    expect(readSnapshotJson(text).checksum).toBe('verified')
    const tampered = JSON.parse(text) as DatasetSnapshot
    tampered.names[0]!.name = 'Changed'
    expect(readSnapshotJson(JSON.stringify(tampered)).checksum).toBe('mismatch')
    expect(() => readSnapshotJson(JSON.stringify({ ...tampered, schemaVersion: 2 }))).toThrow(/schema version 2/)
  })
})

describe('community presets', () => {
  const preset: CommunityPreset = {
    format: 'onetaxonomy-preset',
    formatVersion: 1,
    id: 'p',
    title: 'Three taxa',
    version: '1',
    references: [{ snapshot: 'fixture-checklist', version: '1', checksum: checklist.checksum! }],
    selections: [threeTaxa],
    style: { highlights: [{ label: 'Picked', kind: 'group', concepts: ['fx:6', 'fx:13'] }] },
  }

  it('accepts references and refuses shadow data', () => {
    expect(validatePreset(preset)).toEqual([])
    const shadow = { ...clone(preset), style: { concepts: [{ id: 'fx:6' }] } }
    expect(validatePreset(shadow)).toEqual(['style.concepts: presets reference taxonomic data, they don\'t contain it'])
    expect(validatePreset({ format: 'x' }).length).toBeGreaterThan(3)
  })

  it('checks pins and ids against the snapshots it is opened with', () => {
    expect(checkPresetReferences(preset, [checklist])).toEqual([])
    const moved = sealSnapshot({ ...clone(v2), id: 'fixture-checklist', checksum: undefined } as DatasetSnapshot)
    const problems = checkPresetReferences({ ...preset, selections: [{ ...threeTaxa, roots: [...threeTaxa.roots, { concept: 'fx:21', policy: { kind: 'explicit' } }] }] }, [moved])
    expect(problems[0]).toMatch(/checksum mismatch/)
    expect(problems[1]).toBe('Selection three: concept fx:21 not found')
  })
})
