import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import schema from '../schema/snapshot.schema.json'
import { comparePhylogenies, findMRCA, indexPhylogeny, midpointRoot, rerootPhylogeny, RootingError, sealSnapshot, snapshotChecksum, validateDataset, type DatasetSnapshot, type Phylogeny } from '../src'
import { show, tiny } from './tiny-tree'

const out = { id: 'r', version: '1' }
const letters = [...'ABCDE']
const snapshotOf = (...phylogenies: Phylogeny[]): DatasetSnapshot => ({
  schemaVersion: 1, id: 's', version: '1', createdAt: '2026-11-11', sources: [{ id: 's', title: 'S', illustrative: true }],
  names: letters.map((l) => ({ id: `nm:${l}`, name: `Taxon ${l}` })),
  concepts: letters.map((l) => ({ id: `c:${l}`, acceptedName: `nm:${l}` })),
  classifications: [], phylogenies,
})
const code = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    if (e instanceof RootingError) return e.code
    throw e
  }
  return 'no error'
}

describe('rerootPhylogeny', () => {
  const unrooted = '(A:1,B:2,(C:3,D:4)90:5);'

  it('roots on a tip, splitting its branch in half by default, and records what it did', () => {
    const p = tiny(unrooted, { rooted: false, lengthUnit: 'substitutions-per-site' })
    const r = rerootPhylogeny(p, 'A', out)
    expect(show(r)).toBe('(A:0.5,(B:2,(C:3,D:4)90:5):0.5);')
    expect(r).toMatchObject({ id: 'r', version: '1', rooted: true, title: 'T (rerooted on A)', lengthUnit: 'substitutions-per-site', rooting: { method: 'outgroup', outgroup: ['A'], from: { id: 't', version: '1' } } })
    expect(r.rooting!.note).toMatch(/^Rerooted on the outgroup A \(A\) from t version 1 \(unrooted\)\. The root was placed at 0\.5/)
    expect(findMRCA(indexPhylogeny(r), ['C', 'D'])).toMatchObject({ status: 'found', node: 'n1' })
  })

  it('places the root where asked along the outgroup branch', () => {
    expect(show(rerootPhylogeny(tiny(unrooted, { rooted: false }), 'A', { ...out, position: 0.2 }))).toBe('(A:0.2,(B:2,(C:3,D:4)90:5):0.8);')
    expect(() => rerootPhylogeny(tiny(unrooted, { rooted: false }), 'A', { ...out, position: 2 })).toThrow(RangeError)
  })

  it('roots on a clade of several tips; both sides keep the split\'s support', () => {
    const r = rerootPhylogeny(tiny(unrooted, { rooted: false }), ['C', 'D'], out)
    expect(show(r)).toBe('((C:3,D:4)90:2.5,(A:1,B:2)90:2.5);')
  })

  it('keeps support with its split when branches turn around, and drops a two-way old root', () => {
    // 95 measures the split AB|CD and 70 the split ABC|D. Rooted on A, the clade with 95 is (C,D).
    const p = tiny('(((A:1,B:1)95:1,C:2)70:1,D:3);', { rooted: true })
    const r = rerootPhylogeny(p, 'A', out)
    expect(show(r)).toBe('(A:0.5,(B:1,(C:2,D:4)95:1):0.5);')
    expect(r.nodes.some((n) => n.id === 'n0')).toBe(false)
    expect(r.rooting!.note).toMatch(/from t version 1 \(rooted\)/)
    expect(r.rooting!.note).toMatch(/old root n0 had two branches/)
  })

  it('gives the same unrooted tree back (Robinson-Foulds 0) and a valid record', () => {
    const p = tiny('((A:1,B:1):1,(C:1,(D:1,E:1):1):1);', { rooted: true, lengthUnit: 'changes' })
    const r = rerootPhylogeny(p, ['D', 'E'], out)
    expect(comparePhylogenies(p, r, { mode: 'unrooted' })).toMatchObject({ status: 'compared', rf: 0 })
    expect(comparePhylogenies(p, r)).toMatchObject({ mode: 'rooted', rf: 2 }) // AB, CDE vs DE, ABC
    const snap = snapshotOf(p, r)
    expect(validateDataset(snap).filter((d) => d.severity === 'error')).toEqual([])
    expect(new Ajv2020({ strict: true }).compile(schema)(snap)).toBe(true)
  })

  it('refuses outgroups that are not one side of a branch, internal nodes, unknown ids and the whole tree', () => {
    const p = tiny(unrooted, { rooted: false })
    expect(code(() => rerootPhylogeny(p, ['A', 'C'], out))).toBe('outgroup-not-a-clade')
    expect(code(() => rerootPhylogeny(p, 'n1', out))).toBe('not-a-tip')
    expect(code(() => rerootPhylogeny(p, 'X', out))).toBe('unknown-node')
    expect(code(() => rerootPhylogeny(p, ['A', 'B', 'C', 'D'], out))).toBe('whole-tree')
    expect(code(() => rerootPhylogeny(p, [], out))).toBe('empty-outgroup')
  })

  it('refuses forests and time-calibrated hypotheses', () => {
    const forest = tiny('((A,B),(C,D));', { rooted: true })
    forest.edges = forest.edges.filter((e) => e.child !== 'n2')
    expect(code(() => rerootPhylogeny(forest, 'A', out))).toBe('forest')
    expect(code(() => rerootPhylogeny({ ...tiny(unrooted, { rooted: true }), timeCalibrated: true, lengthUnit: 'Ma' }, 'A', out))).toBe('time-calibrated')
  })

  it('never changes a sealed snapshot', () => {
    const sealed = sealSnapshot(snapshotOf(tiny('(((A:1,B:1)95:1,C:2)70:1,D:3);', { rooted: true })))
    const before = JSON.stringify(sealed)
    const r = rerootPhylogeny(sealed.phylogenies[0]!, 'A', out)
    const m = midpointRoot(sealed.phylogenies[0]!, { id: 'm', version: '1' })
    expect(JSON.stringify(sealed)).toBe(before)
    expect(snapshotChecksum(sealed)).toBe(sealed.checksum)
    // The results are new, unfrozen records that share nothing with the sealed one.
    expect(Object.isFrozen(r.nodes[1])).toBe(false)
    r.nodes[1]!.label = 'changed'
    m.nodes[1]!.label = 'changed'
    expect(JSON.stringify(sealed)).toBe(before)
  })
})

describe('midpointRoot', () => {
  it('roots halfway along the longest tip-to-tip path and says it assumed equal rates', () => {
    // Longest path B–D = 2 + 2 + 7 = 11; its midpoint is 5.5 from D, inside D's branch.
    const r = midpointRoot(tiny('(A:1,B:2,(C:1,D:7):2);', { rooted: false, lengthUnit: 'substitutions-per-site' }), { id: 'm', version: '1' })
    const len = (child: string) => r.edges.find((e) => e.child === child)!.length!
    expect(show(r).replace(/:[0-9.]+/g, '')).toBe('((C,(A,B)),D);')
    expect(len('n1')).toBeCloseTo(1.5)
    expect(len('D')).toBeCloseTo(5.5)
    expect(r).toMatchObject({ rooted: true, title: 'T (midpoint-rooted)', rooting: { method: 'midpoint', from: { id: 't', version: '1' } } })
    expect(r.rooting!.note).toMatch(/between D and B \(11 substitutions-per-site\)\. This assumes roughly equal rates/)
    expect(r.rooting!.outgroup).toBeUndefined()
  })

  it('roots on a node when the midpoint falls on one, and reports a tied longest path', () => {
    const r = midpointRoot(tiny('(A:2,B:1,C:2);', { rooted: false }), { id: 'm', version: '1' })
    expect(show(r)).toBe('(A:2,B:1,C:2);')
    expect(r.rooted).toBe(true)
    const tied = midpointRoot(tiny('(A:1,B:1,C:2);', { rooted: false }), { id: 'm', version: '1' })
    expect(tied.rooting!.note).toMatch(/longest path is not unique/)
  })

  it('refuses when a branch has no length', () => {
    expect(code(() => midpointRoot(tiny('(A:1,B,(C:1,D:1):1);', { rooted: false }), { id: 'm', version: '1' }))).toBe('missing-lengths')
  })
})
