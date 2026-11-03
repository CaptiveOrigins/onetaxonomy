import { describe, expect, it } from 'vitest'
import { diffSnapshots, referenceImpact } from '../src'
import { checklist, checklistV2 } from './helpers'

describe('diffSnapshots', () => {
  const d = diffSnapshots(checklist, checklistV2)

  it('finds added, removed, renamed, relocated and re-ranked concepts', () => {
    expect(d.added).toEqual(['fx:28'])
    expect(d.removed).toEqual(['fx:21'])
    expect(d.renamed).toEqual([
      { concept: 'fx:13', from: 'Gammus quintus', to: 'Gammus quintinus' },
      { concept: 'fx:19', from: 'Epsilidae', to: 'Epsilinae' },
    ])
    expect(d.rankChanged).toEqual([{ concept: 'fx:19', from: 'family', to: 'subfamily' }])
    expect(d.relocated).toEqual([
      { concept: 'fx:8', classification: 'fx:checklist', from: 'fx:3', to: 'fx:10' },
      { concept: 'fx:19', classification: 'fx:checklist', from: 'fx:14', to: 'fx:15' },
    ])
  })

  it('reports splits and lumps as candidates only', () => {
    expect(d.splitCandidates).toEqual([{ name: 'Alphus primus', from: 'fx:5', to: ['fx:5', 'fx:28'] }])
    expect(d.mergeCandidates).toEqual([{ name: 'Epsilus octavus', from: 'fx:21', into: 'fx:17', status: 'synonym' }])
  })

  it('tells saved references what changed without touching them', () => {
    const refs = ['fx:5', 'fx:13', 'fx:21', 'fx:25']
    const impact = referenceImpact(d, refs)
    expect(impact.map((i) => [i.id, i.change])).toEqual([
      ['fx:21', 'merge-candidate'],
      ['fx:13', 'renamed'],
      ['fx:5', 'split-candidate'],
    ])
    expect(refs).toEqual(['fx:5', 'fx:13', 'fx:21', 'fx:25'])
  })
})
