import { describe, expect, it } from 'vitest'

import { assessTaxon, findMRCA, getCladeMembers, indexDataset, isMonophyletic } from '../src'
import { amniotes, structures } from './helpers'

const A = indexDataset(amniotes)
const S = indexDataset(structures)
const H1 = A.phylogeny('archelosauria')
const H2 = A.phylogeny('anapsid-turtles')
const traditional = A.classification('traditional')

describe('classification ≠ phylogeny (I2)', () => {
  it('a classification alone never certifies a clade', () => {
    const r = assessTaxon(traditional, 'c:reptilia', null)
    expect(r).toMatchObject({ status: 'indeterminate', reason: 'classification-only', hypothesis: null })
  })

  it('traditional Reptilia is not a clade: its MRCA also holds birds', () => {
    for (const h of [H1, H2]) {
      const r = assessTaxon(traditional, 'c:reptilia', h)
      expect(r.status).toBe('not-monophyletic')
      expect(r.missing).toEqual(['t-aves'])
      expect(r.hypothesis).toEqual({ id: h.id, version: '1' })
    }
  })

  it('a class with one mapped terminal is a (trivial) clade, and says so', () => {
    const r = assessTaxon(traditional, 'c:aves', H1)
    expect(r).toMatchObject({ status: 'monophyletic', caveats: ['single-terminal'] })
  })
})

describe('results depend on the hypothesis (conflicting trees)', () => {
  const turtlesAndArchosaurs = ['t-testudines', 't-crocodylia', 't-aves']
  it('Archelosauria is a clade in one hypothesis and not in the other', () => {
    expect(isMonophyletic(H1, turtlesAndArchosaurs)).toMatchObject({ status: 'monophyletic', mrca: 'archelosauria' })
    expect(isMonophyletic(H2, turtlesAndArchosaurs)).toMatchObject({ status: 'not-monophyletic', missing: ['t-squamata', 't-rhyncho'] })
  })

  it('MRCA is stated per hypothesis', () => {
    expect(findMRCA(H1, ['t-testudines', 't-aves'])).toMatchObject({ status: 'found', node: 'archelosauria', hypothesis: { id: 'archelosauria' } })
    expect(findMRCA(H2, ['t-testudines', 't-aves'])).toMatchObject({ status: 'found', node: 'reptiles', hypothesis: { id: 'anapsid-turtles' } })
  })

  it('an internal node in the selection stands for its whole clade', () => {
    expect(isMonophyletic(H1, ['archosauria', 't-testudines']).status).toBe('monophyletic')
  })
})

describe('polytomies (I6)', () => {
  const P = S.phylogeny('polytomy')
  it('soft (default): some branches of a polytomy are indeterminate, not a false no', () => {
    expect(isMonophyletic(P, ['a', 'b'])).toMatchObject({ status: 'indeterminate', reason: 'unresolved-polytomy', unresolvedAt: 'p', missing: ['c', 'd'] })
  })
  it('hard: the same group is not monophyletic', () => {
    expect(isMonophyletic(P, ['a', 'b'], { polytomies: 'hard' })).toMatchObject({ status: 'not-monophyletic', reason: 'missing-descendants' })
  })
  it('all branches of the polytomy are a clade', () => {
    expect(isMonophyletic(P, ['a', 'b', 'c', 'd'])).toMatchObject({ status: 'monophyletic', mrca: 'p' })
  })
  it('cutting through a resolved clade is not monophyletic even at a polytomy', () => {
    expect(isMonophyletic(P, ['a', 'e'])).toMatchObject({ status: 'not-monophyletic' })
  })
})

describe('rooting and forests (I5, I8)', () => {
  it('unrooted hypotheses give no MRCA or clade claims', () => {
    const U = S.phylogeny('unrooted')
    expect(findMRCA(U, ['c', 'd'])).toMatchObject({ status: 'indeterminate', reason: 'unrooted' })
    expect(isMonophyletic(U, ['c', 'd'])).toMatchObject({ status: 'indeterminate', reason: 'unrooted' })
    expect(getCladeMembers(U, 'u1')).toMatchObject({ status: 'indeterminate', reason: 'unrooted' })
  })
  it('no common ancestor is invented across a forest', () => {
    const F = S.phylogeny('forest')
    expect(findMRCA(F, ['a', 'g'])).toMatchObject({ status: 'none', reason: 'different-trees' })
    expect(isMonophyletic(F, ['a', 'g']).status).toBe('not-monophyletic')
    expect(isMonophyletic(F, ['a', 'b'])).toMatchObject({ status: 'monophyletic', caveats: ['partial-sampling'] })
  })
})

describe('unknown and unmapped (I7)', () => {
  it('unknown nodes are indeterminate, not errors or guesses', () => {
    expect(isMonophyletic(H1, ['t-aves', 'nope'])).toMatchObject({ status: 'indeterminate', reason: 'unknown-node' })
  })
  it('members without a node are reported as unmapped', () => {
    const snap = JSON.parse(JSON.stringify(amniotes))
    snap.phylogenies[0].nodes.find((n: { id: string }) => n.id === 't-rhyncho').concepts = []
    const r = assessTaxon(indexDataset(snap).classification('traditional'), 'c:reptilia', indexDataset(snap).phylogeny('archelosauria'))
    expect(r.unmapped).toEqual(['c:rhynchocephalia'])
    expect(r.caveats).toContain('unmapped-members')
    expect(r.missing).toContain('t-aves')
  })
  it('a taxon with no mapped member is indeterminate', () => {
    expect(assessTaxon(traditional, 'c:mammalia', S.phylogeny('polytomy') as never).status).toBe('indeterminate')
  })
})
