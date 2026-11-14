import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasErrors, sealSnapshot, validateDataset, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import { csvAdapter, DARWIN_CORE_COLUMNS, parseDelimited, parseDelimitedRecords, readChecklistTable, toSnapshot } from '../src'
import checklistJson from '../../../fixtures/checklist.json'

const fixture = (f: string) => readFileSync(new URL(`../../../fixtures/${f}`, import.meta.url), 'utf8')
const source = { id: 'src', title: 'Test source' }

describe('parseDelimited', () => {
  it('handles quotes, doubled quotes, embedded delimiters and line breaks, CRLF and a BOM', () => {
    expect(parseDelimited('﻿a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"multi\nline",\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'he said "hi"'],
      ['2', 'multi\nline', ''],
    ])
    expect(parseDelimited('a\t"b\n1\t"2', { delimiter: '\t', quote: null })).toEqual([['a', '"b'], ['1', '"2']])
    expect(parseDelimitedRecords('x,y\n1\n')).toEqual([{ x: '1', y: '' }])
    expect(() => parseDelimited('a,"open')).toThrow(/Unclosed/)
  })
})

describe('CSV checklist adapter', () => {
  it('reproduces the fixture snapshot from fixtures/checklist.csv', async () => {
    const adapter = csvAdapter({
      source: (checklistJson as DatasetSnapshot).sources[0]!,
      idPrefix: 'fx',
      classification: { id: 'fx:checklist', title: 'Illustrative checklist', version: '1' },
      columns: { ...DARWIN_CORE_COLUMNS, vernacular: [{ column: 'vernacular_en', locale: 'en' }, { column: 'vernacular_de', locale: 'de' }] },
    })
    expect(adapter.describe().id).toBe('csv-checklist')
    const result = await adapter.read(fixture('checklist.csv'))
    expect(result.warnings).toEqual([])
    const snap = sealSnapshot(toSnapshot(result, { id: 'fixture-checklist', version: '1', createdAt: '2026-11-02T00:00:00.000Z' }))
    expect(snap.checksum).toBe((checklistJson as DatasetSnapshot).checksum)
  })

  it('turns synonyms into usages, keeps provisional status and source ids', () => {
    const r = readChecklistTable(fixture('checklist.csv'), { source, idPrefix: 'x' })
    const primus = r.concepts.find((c) => c.id === 'x:5')!
    expect(primus.usages).toEqual([{ name: 'x:name:26', status: 'synonym', source: 'src' }])
    expect(r.concepts.find((c) => c.id === 'x:18')!.usages).toEqual([{ name: 'x:name:18', status: 'provisional', source: 'src' }])
    expect(r.concepts.some((c) => c.id === 'x:26')).toBe(false)
    expect(r.rawIds['x:5']).toBe('5')
    expect(primus.externalIds).toEqual([{ source: 'src', id: '5' }])
  })

  it('reports problems and handles them conservatively', () => {
    const csv = [
      'id,parent,accepted,status,name',
      '1,,,accepted,Root',
      '2,1,,accepted,Child',
      '2,1,,accepted,Duplicate',
      '3,99,,accepted,Orphan',
      '4,,1,synonym,Old root name',
      '5,4,,accepted,Under a synonym',
      '6,,77,synonym,Lost synonym',
      '7,1,,weird,Odd status',
      '8,1,,accepted,',
    ].join('\n')
    const r = readChecklistTable(csv, { source, columns: { taxonID: 'id', parentID: 'parent', acceptedID: 'accepted', status: 'status', name: 'name', rank: 'rank' } })
    expect(r.warnings.map((w) => w.code)).toEqual(['missing-column', 'duplicate-id', 'missing-name', 'unknown-status', 'synonym-without-accepted', 'missing-parent', 'parent-is-synonym'])
    const parent = new Map(r.classification!.placements.map((p) => [p.concept, p.parent]))
    expect(parent.get('src:3')).toBeNull()
    expect(parent.get('src:5')).toBe('src:1')
    expect(r.concepts.find((c) => c.id === 'src:7')!.usages![0]!.status).toBe('unknown')
    const snap = toSnapshot(r, { id: 's', version: '1', createdAt: 'x' })
    snap.sources = [source]
    expect(hasErrors(validateDataset(snap))).toBe(false)
  })

  it('requires the id and name columns', () => {
    expect(() => readChecklistTable('a,b\n1,2', { source })).toThrow(/Missing required column/)
  })
})
