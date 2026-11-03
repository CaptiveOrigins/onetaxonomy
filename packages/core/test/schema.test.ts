import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import schema from '../schema/snapshot.schema.json'
import { extractSubset, applySelection, indexDataset } from '../src'
import { amniotes, checklist, checklistV2, clone, structures } from './helpers'

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)

describe('JSON Schema export', () => {
  it('accepts every fixture and derived snapshots', () => {
    const r = applySelection(indexDataset(checklist), { id: 's', title: 's', version: '1', classification: 'fx:checklist', roots: [{ concept: 'fx:6', policy: { kind: 'explicit' } }] })
    const subset = extractSubset(checklist, { id: 'x', version: '1', createdAt: 'x', classification: 'fx:checklist', include: r })
    const traits = { ...clone(amniotes), traits: [{ id: 't', title: 'T', source: 'fixture', states: [{ id: 'a', label: 'A', color: '#fff' }], values: [{ concept: 'c:aves', state: 'a', note: 'n' }] }] }
    for (const s of [amniotes, structures, checklist, checklistV2, subset, traits]) expect(validate(s), JSON.stringify(validate.errors)).toBe(true)
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
