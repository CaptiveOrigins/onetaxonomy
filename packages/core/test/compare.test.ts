import { describe, expect, it } from 'vitest'
import { comparePhylogenies, indexPhylogeny, sealSnapshot, snapshotChecksum, type DatasetSnapshot, type Phylogeny, type PhylogenyComparison } from '../src'
import { tiny } from './tiny-tree'

const compared = (r: ReturnType<typeof comparePhylogenies>): PhylogenyComparison => {
  if (r.status !== 'compared') throw new Error(`refused: ${r.message}`)
  return r
}
const sides = (list: { concepts: string[] }[]) => list.map((s) => s.concepts.map((c) => c.slice(2)).join(''))

describe('comparePhylogenies: Robinson-Foulds on shared tips', () => {
  it('unrooted: two different 5-taxon trees share no split (RF 4 of 4)', () => {
    // ((A,B),(C,D),E) has splits AB|CDE and CD|ABE; ((A,C),(B,D),E) has AC|BDE and BD|ACE.
    const r = compared(comparePhylogenies(tiny('((A,B),(C,D),E);', { id: 'a', rooted: false }), tiny('((A,C),(B,D),E);', { id: 'b', rooted: false })))
    expect(r).toMatchObject({ mode: 'unrooted', rf: 4, normalized: 1, splits: { a: 2, b: 2 }, reference: 'c:A', onlyInA: [], onlyInB: [] })
    // Each split is listed by the side without the reference concept c:A.
    expect(sides(r.inAOnly)).toEqual(['CDE', 'CD'])
    expect(sides(r.inBOnly)).toEqual(['BDE', 'BD'])
  })

  it('the same unrooted tree stored from different nodes has distance 0', () => {
    const r = compared(comparePhylogenies(tiny('(A,B,(C,(D,E)));', { rooted: false }), tiny('((A,B),C,(D,E));', { rooted: false })))
    expect(r).toMatchObject({ rf: 0, normalized: 0, splits: { a: 2, b: 2 }, inAOnly: [], inBOnly: [] })
  })

  it('rooted when both are rooted: clades AB vs AC differ (RF 2 of 6), unrooted RF 2 of 4', () => {
    const a = tiny('(((A,B),C),(D,E));', { id: 'a', rooted: true })
    const b = tiny('(((A,C),B),(D,E));', { id: 'b', rooted: true })
    // Rooted clusters: a = {AB, ABC, DE}, b = {AC, ABC, DE}.
    const rooted = compared(comparePhylogenies(a, b))
    expect(rooted).toMatchObject({ mode: 'rooted', rf: 2, splits: { a: 3, b: 3 } })
    expect(rooted.normalized).toBeCloseTo(1 / 3)
    expect(sides(rooted.inAOnly)).toEqual(['AB'])
    expect(rooted.inAOnly[0]!.node).toBe('n2')
    expect(sides(rooted.inBOnly)).toEqual(['AC'])
    expect(rooted.reference).toBeUndefined()
    // Unrooted, ABC|DE is one split: a = {AB|CDE, DE|ABC}, b = {AC|BDE, DE|ABC}.
    const unrooted = compared(comparePhylogenies(a, b, { mode: 'unrooted' }))
    expect(unrooted).toMatchObject({ mode: 'unrooted', rf: 2, normalized: 0.5, splits: { a: 2, b: 2 } })
    expect(unrooted.notes).toContain('Compared unrooted, as asked: the roots were ignored.')
  })

  it('a different root on the same unrooted topology matters only in rooted mode', () => {
    const a = tiny('((A,B),(C,D));', { rooted: true })
    const b = tiny('(A,(B,(C,D)));', { rooted: true })
    // Rooted clusters {AB, CD} vs {BCD, CD}: CD is shared, AB and BCD are not.
    expect(compared(comparePhylogenies(a, b))).toMatchObject({ mode: 'rooted', rf: 2, normalized: 0.5 })
    expect(compared(comparePhylogenies(a, b, { mode: 'unrooted' }))).toMatchObject({ rf: 0 })
  })

  it('compares unrooted, and says so, when only one hypothesis is rooted', () => {
    const r = compared(comparePhylogenies(tiny('((A,B),(C,D));', { rooted: true }), tiny('(A,B,(C,D));', { rooted: false })))
    expect(r.mode).toBe('unrooted')
    expect(r.rf).toBe(0)
    expect(r.notes).toContain('Compared unrooted because only one hypothesis is explicitly rooted.')
  })

  it('reports tips in only one tree and computes the distance on the shared ones', () => {
    // On shared A–E, a is ((A,B),(C,D),E) and b is ((A,B),C,(D,E)): AB shared, CD vs DE differ.
    const r = compared(comparePhylogenies(tiny('((A,B),(C,(D,F)),E);', { id: 'a', rooted: false }), tiny('((A,B),C,(D,(E,G)),H);', { id: 'b', rooted: false })))
    expect(r.shared).toEqual(['c:A', 'c:B', 'c:C', 'c:D', 'c:E'])
    expect(r.onlyInA).toEqual(['c:F'])
    expect(r.onlyInB).toEqual(['c:G', 'c:H'])
    expect(r).toMatchObject({ rf: 2, splits: { a: 2, b: 2 }, normalized: 0.5 })
    expect(sides(r.inAOnly)).toEqual(['CD'])
    expect(sides(r.inBOnly)).toEqual(['DE'])
    expect(r.notes[0]).toMatch(/5 shared tip\(s\); 1 only in a and 2 only in b/)
  })

  it('a polytomy contributes no split', () => {
    const r = compared(comparePhylogenies(tiny('((A,B,C),D,E);', { rooted: false }), tiny('(((A,B),C),D,E);', { rooted: false })))
    expect(r).toMatchObject({ rf: 1, splits: { a: 1, b: 2 } })
    expect(sides(r.inBOnly)).toEqual(['CDE'])
    expect(r.notes.some((n) => n.startsWith('A polytomy contributes no split'))).toBe(true)
  })

  it('with too few shared tips there is nothing to normalize', () => {
    const r = compared(comparePhylogenies(tiny('(A,B,C);', { rooted: false }), tiny('(A,(B,C));', { rooted: false })))
    expect(r).toMatchObject({ rf: 0, normalized: null, splits: { a: 0, b: 0 } })
  })

  it('accepts indexes as well as records', () => {
    const a = tiny('((A,B),(C,D),E);', { rooted: false })
    expect(compared(comparePhylogenies(indexPhylogeny(a), a)).rf).toBe(0)
  })
})

describe('comparePhylogenies: refusals', () => {
  it('refuses a tip without an explicit concept mapping (never matched by label)', () => {
    const r = comparePhylogenies(tiny('((A,B),(C,D));', { id: 'a', rooted: true, unmapped: ['D'] }), tiny('((A,B),(C,D));', { rooted: true }))
    expect(r).toMatchObject({ status: 'refused', reason: 'unmapped-tips', hypothesis: { id: 'a' }, ids: ['D'] })
  })
  it('refuses a concept on two tips, or a tip with two concepts', () => {
    const twice = tiny('((A,B),(C,D));', { rooted: true })
    twice.nodes.find((n) => n.id === 'D')!.concepts = ['c:C']
    expect(comparePhylogenies(twice, tiny('((A,B),(C,D));', { rooted: true }))).toMatchObject({ status: 'refused', reason: 'ambiguous-tips', ids: ['c:C'] })
    const both = tiny('((A,B),(C,D));', { rooted: true })
    both.nodes.find((n) => n.id === 'D')!.concepts = ['c:D', 'c:E']
    expect(comparePhylogenies(both, tiny('((A,B),(C,D));', { rooted: true }))).toMatchObject({ status: 'refused', reason: 'ambiguous-tips', ids: ['D'] })
  })
  it('refuses forests', () => {
    const forest = tiny('((A,B),(C,D));', { rooted: true })
    forest.edges = forest.edges.filter((e) => e.child !== 'n2')
    expect(comparePhylogenies(forest, tiny('((A,B),(C,D));', { rooted: true }))).toMatchObject({ status: 'refused', reason: 'forest' })
  })
  it('refuses rooted comparison of an unrooted hypothesis', () => {
    expect(comparePhylogenies(tiny('((A,B),(C,D));', { rooted: true }), tiny('(A,B,(C,D));', { id: 'u', rooted: false }), { mode: 'rooted' })).toMatchObject({ status: 'refused', reason: 'unrooted', hypothesis: { id: 'u' } })
  })
})

describe('comparePhylogenies: sealed snapshots', () => {
  it('reads frozen hypotheses without changing them', () => {
    const snap: DatasetSnapshot = {
      schemaVersion: 1, id: 's', version: '1', createdAt: '2026-11-11', sources: [{ id: 's', title: 'S' }], names: [], concepts: [], classifications: [],
      phylogenies: [tiny('((A,B),(C,D),E);', { id: 'a', rooted: false }), tiny('((A,C),(B,D),E);', { id: 'b', rooted: false })],
    }
    const sealed = sealSnapshot(snap)
    const before = JSON.stringify(sealed)
    const [a, b] = sealed.phylogenies as [Phylogeny, Phylogeny]
    expect(compared(comparePhylogenies(a, b)).rf).toBe(4)
    expect(JSON.stringify(sealed)).toBe(before)
    expect(snapshotChecksum(sealed)).toBe(sealed.checksum)
  })
})
