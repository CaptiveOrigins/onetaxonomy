import { describe, expect, it } from 'vitest'
import { applySelection, extractSubset, getCoverageReport, indexDataset, hasErrors, validateDataset, sealSnapshot, verifySnapshot, type CuratedSelection } from '../src'
import { checklist, clone } from './helpers'

const ds = indexDataset(checklist)
const base = { id: 'sel', title: 'Selection', version: '1', classification: 'fx:checklist' }
const sel = (s: Partial<CuratedSelection>): CuratedSelection => ({ ...base, roots: [], ...s })
const names = (ids: string[]) => ids.map((id) => ds.nameOf(id))

describe('applySelection', () => {
  // Results come in classification order (the source's own order), not traversal order.
  it('takes three nonadjacent taxa plus their ancestor paths, nothing else (M3 acceptance)', () => {
    const r = applySelection(ds, sel({ roots: [{ concept: 'fx:6', policy: { kind: 'explicit' } }, { concept: 'fx:13', policy: { kind: 'explicit' } }, { concept: 'fx:25', policy: { kind: 'explicit' } }] }))
    expect(names(r.curated)).toEqual(['Alphus secundus', 'Gammus quintus', 'Zetus nonus'])
    expect(names(r.ancestors)).toEqual(['Exemplaria', 'Alphiformes', 'Alphidae', 'Alphus', 'Gammidae', 'Gammus', 'Zetiformes', 'Zetidae', 'Zetus'])
    expect(r.included).toHaveLength(12)
    // Siblings and their subtrees stay out, and are reported as omitted.
    expect(r.included).not.toContain('fx:5')
    expect(r.included).not.toContain('fx:7')
    expect(r.included).not.toContain('fx:14')
    expect(r.diagnostics).toEqual([])
  })

  it('applies each policy', () => {
    const all = applySelection(ds, sel({ roots: [{ concept: 'fx:3', policy: { kind: 'allAvailableDescendants' } }] }))
    expect(names(all.curated)).toEqual(['Alphidae', 'Alphus', 'Alphus primus', 'Alphus secundus', 'Alphus secundus borealis', 'Betus', 'Betus tertius'])
    const depth = applySelection(ds, sel({ roots: [{ concept: 'fx:2', policy: { kind: 'depth', depth: 1 } }] }))
    expect(names(depth.curated)).toEqual(['Alphiformes', 'Alphidae', 'Gammidae'])
    const rank = applySelection(ds, sel({ roots: [{ concept: 'fx:14', policy: { kind: 'rank', ranks: ['Species'] } }] }))
    expect(names(rank.curated)).toEqual(['Deltiformes', 'Deltus sextus', 'Deltus septimus', 'Epsilus octavus'])
    expect(names(rank.ancestors)).toContain('Deltus')
    const rep = applySelection(ds, sel({ roots: [{ concept: 'fx:2', policy: { kind: 'representative', concepts: ['fx:9', 'fx:12'] } }] }))
    expect(names(rep.curated)).toEqual(['Alphiformes', 'Betus tertius', 'Gammus quartus'])
    const pred = applySelection(ds, sel({ roots: [{ concept: 'fx:1', policy: { kind: 'predicate', predicate: 'common' } }] }), {
      predicates: { common: (c) => (c.commonNames ?? []).some((n) => n.locale === 'en') },
    })
    expect(names(pred.curated)).toEqual(['Exemplaria', 'Alphus primus', 'Alphus secundus', 'Gammus quintus', 'Zetus nonus'])
  })

  it('lets exclusions win and reports the conflict', () => {
    const r = applySelection(ds, sel({ roots: [{ concept: 'fx:1', policy: { kind: 'allAvailableDescendants' } }], exclude: [{ concept: 'fx:14', rationale: 'not kept' }] }))
    expect(r.included).not.toContain('fx:17')
    expect(names(r.excluded)).toEqual(['Deltiformes', 'Deltidae', 'Deltus', 'Deltus sextus', 'Deltus septimus', 'Epsilidae', 'Epsilus', 'Epsilus octavus'])
    const rep = applySelection(ds, sel({ roots: [{ concept: 'fx:1', policy: { kind: 'representative', concepts: ['fx:17'] } }], exclude: [{ concept: 'fx:15' }] }))
    expect(rep.included).not.toContain('fx:17')
    expect(rep.diagnostics.map((d) => d.code)).toEqual(['root-excluded'])
  })

  it('reports unknown roots, unknown predicates, overlaps and the limit', () => {
    const r = applySelection(ds, sel({ roots: [{ concept: 'nope', policy: { kind: 'explicit' } }, { concept: 'fx:2', policy: { kind: 'predicate', predicate: 'missing' } }, { concept: 'fx:4', policy: { kind: 'explicit' } }] }))
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unknown-root', 'unknown-predicate', 'overlapping-roots'])
    expect(r.roots[0]!.status).toBe('unknown')
    const limited = applySelection(ds, sel({ roots: [{ concept: 'fx:1', policy: { kind: 'allAvailableDescendants' } }] }), { limit: 5 })
    expect(limited.truncated).toBe(true)
    expect(limited.curated).toHaveLength(6)
  })

  it('counts omitted branches per root, top-most first', () => {
    const r = applySelection(ds, sel({ roots: [{ concept: 'fx:1', policy: { kind: 'representative', concepts: ['fx:6'] } }] }))
    expect(r.roots[0]!.curated).toBe(2)
    expect(r.roots[0]!.omitted).toBe(24 - 4)
    expect(names(r.roots[0]!.omittedBranches)).toEqual(['Alphus primus', 'Alphus secundus borealis', 'Betus', 'Gammidae', 'Deltiformes', 'Zetiformes'])
  })
})

describe('getCoverageReport', () => {
  it('keeps dataset coverage apart from what science knows, which only the caller states', () => {
    const r = applySelection(ds, sel({ roots: [{ concept: 'fx:2', policy: { kind: 'rank', ranks: ['species'] } }] }))
    const [g] = getCoverageReport(ds, { classification: 'fx:checklist', included: r, knownToScience: { 'fx:2': { count: 40, rank: 'species', source: 'illustrative count' } } })
    expect(g!.name).toBe('Alphiformes')
    expect(g!.dataset).toMatchObject({ total: 12, included: 11, omitted: 1, includedByRank: { order: 1, family: 2, genus: 3, species: 5 } })
    expect(names(g!.dataset.omittedBranches)).toEqual(['Alphus secundus borealis'])
    expect(g!.knownToScience).toEqual({ count: 40, rank: 'species', source: 'illustrative count', includedAtRank: 5 })
    const [h] = getCoverageReport(ds, { classification: 'fx:checklist', included: r.included, groups: ['fx:14'] })
    expect(h!.knownToScience).toBe('not-stated')
    expect(h!.dataset.included).toBe(0)
  })
})

describe('extractSubset', () => {
  it('copies only the selection, with provenance, and stays valid', () => {
    const r = applySelection(ds, sel({ roots: [{ concept: 'fx:5', policy: { kind: 'explicit' } }, { concept: 'fx:25', policy: { kind: 'explicit' } }] }))
    const sub = extractSubset(checklist, { id: 'sub', version: '1', createdAt: '2026-11-02T00:00:00.000Z', classification: 'fx:checklist', include: r })
    expect(sub.concepts.map((c) => c.id)).toEqual(r.included.slice().sort((a, b) => checklist.concepts.findIndex((c) => c.id === a) - checklist.concepts.findIndex((c) => c.id === b)))
    // The synonym of Alphus primus comes along as a name; unrelated names don't.
    expect(sub.names.map((n) => n.name)).toContain('Alphus primoides')
    expect(sub.names.map((n) => n.name)).not.toContain('Betus tertia')
    expect(sub.derivedFrom).toEqual({ snapshot: 'fixture-checklist', version: '1', checksum: checklist.checksum, selection: { id: 'sel', version: '1' } })
    expect(hasErrors(validateDataset(sub))).toBe(false)
    expect(verifySnapshot(sealSnapshot(clone(sub)))).toBe(true)
  })

  it('keeps trait values only for copied concepts, with their source', () => {
    const src = { ...clone(checklist), traits: [{ id: 't', title: 'T', source: checklist.sources[0]!.id, states: [{ id: 'a', label: 'A' }], values: [{ concept: 'fx:5', state: 'a' }, { concept: 'fx:9', state: 'a' }] }] }
    const sub = extractSubset(src, { id: 's', version: '1', createdAt: 'x', classification: 'fx:checklist', include: applySelection(ds, sel({ roots: [{ concept: 'fx:5', policy: { kind: 'explicit' } }] })) })
    expect(sub.traits).toEqual([{ ...src.traits[0], values: [{ concept: 'fx:5', state: 'a' }] }])
    expect(hasErrors(validateDataset(sub))).toBe(false)
  })

  it('refuses a set that would orphan a placement', () => {
    expect(() => extractSubset(checklist, { id: 's', version: '1', createdAt: 'x', classification: 'fx:checklist', include: ['fx:5'] })).toThrow(/lose its parent/)
  })
})
