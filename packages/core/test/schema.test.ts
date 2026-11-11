import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import schema from '../schema/snapshot.schema.json'
import { acceptIntoSnapshot, extractSubset, applySelection, indexDataset, sealSnapshot } from '../src'
import { amniotes, checklist, checklistV2, clone, structures } from './helpers'

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)

describe('JSON Schema export', () => {
  it('accepts every fixture and derived snapshots', () => {
    const r = applySelection(indexDataset(checklist), { id: 's', title: 's', version: '1', classification: 'fx:checklist', roots: [{ concept: 'fx:6', policy: { kind: 'explicit' } }] })
    const subset = extractSubset(checklist, { id: 'x', version: '1', createdAt: 'x', classification: 'fx:checklist', include: r })
    const traits = { ...clone(amniotes), traits: [{ id: 't', title: 'T', source: 'fixture', states: [{ id: 'a', label: 'A', color: '#fff' }], values: [{ concept: 'c:aves', state: 'a', note: 'n' }] }] }
    const accepted = acceptIntoSnapshot(sealSnapshot(clone(amniotes)), { id: 'p', title: 'P', author: 'A', created: '2026-11-11T00:00:00Z', base: { kind: 'classification', id: 'traditional', version: '1' }, moves: [{ node: 'c:aves', from: null, to: 'c:reptilia' }] }, { version: '2', createdAt: '2026-11-11T00:00:00Z', acceptedBy: 'C' })
    for (const s of [amniotes, structures, checklist, checklistV2, subset, traits, accepted]) expect(validate(s), JSON.stringify(validate.errors)).toBe(true)
  })

  it('rejects structural mistakes', () => {
    const bad = clone(checklist) as unknown as Record<string, unknown>
    bad.schemaVersion = 2
    ;(bad.concepts as Record<string, unknown>[])[0]!.colour = 'green'
    ;(bad.classifications as { placements: unknown[] }[])[0]!.placements.push({ concept: 'x' })
    expect(validate(bad)).toBe(false)
    expect(validate.errors!.map((e) => e.instancePath).sort()).toEqual(['/classifications/0/placements/25', '/concepts/0', '/schemaVersion'])
  })
})
