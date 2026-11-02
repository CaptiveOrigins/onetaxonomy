import { describe, expect, it } from 'vitest'

import { getAncestors, getChildren, getDescendants, getLineage, indexDataset, indexPhylogeny, HierarchyError } from '../src'
import { amniotes, structures } from './helpers'

const A = indexDataset(amniotes)
const H1 = A.phylogeny('archelosauria')

describe('traversal', () => {
  it('children keep input order (deterministic, I16)', () => {
    expect(getChildren(H1, 'sauria')).toEqual(['lepidosauria', 'archelosauria'])
    expect(getChildren(A.classification('traditional'), 'c:reptilia')).toEqual(['c:testudines', 'c:squamata', 'c:rhynchocephalia', 'c:crocodylia'])
  })
  it('ancestors, nearest first; lineage, root first', () => {
    expect(getAncestors(H1, 't-aves').ids).toEqual(['archosauria', 'archelosauria', 'sauria', 'amniota'])
    expect(getLineage(H1, 't-aves')).toEqual(['amniota', 'sauria', 'archelosauria', 'archosauria', 't-aves'])
  })
  it('descendants are bounded by depth and count, and say when they are cut', () => {
    expect(getDescendants(H1, 'sauria', { maxDepth: 1 })).toEqual({ ids: ['lepidosauria', 'archelosauria'], truncated: true })
    expect(getDescendants(H1, 'sauria', { limit: 3 })).toEqual({ ids: ['lepidosauria', 'archelosauria', 't-squamata'], truncated: true })
    expect(getDescendants(H1, 'sauria', { tipsOnly: true }).ids).toEqual(['t-squamata', 't-rhyncho', 't-testudines', 't-crocodylia', 't-aves'])
    expect(getDescendants(H1, 'archosauria')).toEqual({ ids: ['t-crocodylia', 't-aves'], truncated: false })
  })
  it('a classification forest has several roots, none invented', () => {
    expect(A.classification('traditional').roots).toEqual(['c:reptilia', 'c:aves', 'c:mammalia'])
  })
  it('refuses cycles and second parents', () => {
    const p = structuredClone(structures.phylogenies[0]!)
    p.edges.push({ id: 'loop', parent: 'a', child: 'root' })
    expect(() => indexPhylogeny(p)).toThrow(HierarchyError)
  })
  it('handles a deep chain without recursion', () => {
    const n = 20000
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }))
    const edges = nodes.slice(1).map((x, i) => ({ id: `e${i}`, parent: `n${i}`, child: x.id }))
    const deep = indexPhylogeny({ id: 'deep', title: 'deep', version: '1', sources: [], rooted: true, nodes, edges })
    expect(getAncestors(deep, `n${n - 1}`).ids).toHaveLength(n - 1)
  })
  it('finds names, including ambiguous ones (split concepts)', () => {
    const S = indexDataset(structures)
    expect(S.findByName('exemplum MAGNUM').map((r) => r.concept.id)).toEqual(['c:magnum-sl', 'c:magnum-ss'])
    expect(A.nameOf('c:aves')).toBe('Aves')
  })
})
