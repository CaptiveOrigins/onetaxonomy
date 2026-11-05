import { describe, expect, it } from 'vitest'
import {
  applyToClassification, applyToPhylogeny, applyViewAction, compareHierarchies, createHistory, createView, describeView, dispatch, indexClassification, indexDataset, indexPhylogeny, parseView, projectView,
  ProposalError, sealSnapshot, serializeView, snapshotChecksum, undo, validateView, ViewActionError, type Phylogeny, type Proposal, type TaxonomicView,
} from '../src'
import { amniotes, clone } from './helpers'

const snapshot = sealSnapshot(clone(amniotes))
const data = indexDataset(snapshot)
const cls = snapshot.classifications[0]!
const phy = snapshot.phylogenies[0]!
const proposal = (kind: 'classification' | 'phylogeny', moves: Proposal['moves'], o: Partial<Proposal> = {}): Proposal => ({
  id: 'p1', title: 'Birds are reptiles', author: 'A. Keeper', created: '2026-11-05T00:00:00Z',
  base: { kind, id: kind === 'classification' ? cls.id : phy.id, version: '1' }, moves, ...o,
})
const birdsIntoReptiles = { node: 'c:aves', from: null, to: 'c:reptilia' }

describe('proposals on a classification', () => {
  it('derives a new, labelled hierarchy and leaves the accepted one untouched', () => {
    const before = snapshotChecksum(snapshot)
    const frozen = JSON.stringify(cls)
    const p = applyToClassification(cls, proposal('classification', [birdsIntoReptiles]))
    expect(p.placements.find((x) => x.concept === 'c:aves')!.parent).toBe('c:reptilia')
    expect(p.title).toBe('Proposed by A. Keeper: Birds are reptiles')
    expect(p.id).not.toBe(cls.id)
    expect(p.proposed).toMatchObject({ author: 'A. Keeper', moved: ['c:aves'], base: { id: cls.id, version: '1' } })
    expect(JSON.stringify(cls)).toBe(frozen)
    expect(snapshotChecksum(snapshot)).toBe(before)
  })

  it('refuses cycles, unknown nodes, stale moves, repeats and other versions', () => {
    const bad = (moves: Proposal['moves'], o?: Partial<Proposal>) => () => applyToClassification(cls, proposal('classification', moves, o))
    expect(bad([{ node: 'c:reptilia', from: null, to: 'c:squamata' }])).toThrow(/own descendant/)
    expect(bad([{ node: 'c:reptilia', from: null, to: 'c:aves' }, birdsIntoReptiles])).toThrow(/own descendant/)
    expect(bad([{ node: 'c:aves', from: null, to: 'c:aves' }])).toThrow(/own parent/)
    expect(bad([{ node: 'nope', from: null, to: 'c:reptilia' }])).toThrow(/Unknown node/)
    expect(bad([{ node: 'c:aves', from: null, to: 'nope' }])).toThrow(/Unknown new parent/)
    expect(bad([{ node: 'c:aves', from: 'c:mammalia', to: 'c:reptilia' }])).toThrow(/no longer under/)
    expect(bad([birdsIntoReptiles, birdsIntoReptiles])).toThrow(/moved twice/)
    expect(bad([birdsIntoReptiles], { base: { kind: 'classification', id: cls.id, version: '2' } })).toThrow(ProposalError)
  })
})

describe('proposals on a phylogeny', () => {
  const lengths: Phylogeny = { ...clone(phy), lengthUnit: 'Ma', timeCalibrated: true,
    edges: phy.edges.map((e) => ({ ...e, length: 10 })),
    nodes: phy.nodes.map((n) => (n.id === 'archelosauria' || n.id === 'sauria' ? { ...n, support: { value: 95 }, age: { value: 200 } } : { ...n })) }
  const turtles = { node: 't-testudines', from: 'archelosauria', to: 'amniota' }

  it('only moves on rooted trees, and drops what the hypothesis never measured', () => {
    const p = applyToPhylogeny(lengths, proposal('phylogeny', [turtles]))
    const edge = p.edges.find((e) => e.child === 't-testudines')!
    expect(edge.parent).toBe('amniota')
    expect(edge.length).toBeUndefined()
    expect(p.edges.find((e) => e.child === 't-aves')!.length).toBe(10)
    expect(p.timeCalibrated).toBe(false)
    expect(p.nodes.find((n) => n.id === 'archelosauria')!.support).toBeUndefined()
    expect(p.nodes.find((n) => n.id === 'archelosauria')!.age).toBeUndefined()
    expect(lengths.nodes.find((n) => n.id === 'archelosauria')!.support).toEqual({ value: 95 })
    expect(() => applyToPhylogeny({ ...phy, rooted: false }, proposal('phylogeny', [turtles]))).toThrow(/unrooted/i)
  })

  it('refuses leaving a group empty, moving the root, and a root move', () => {
    const small = proposal('phylogeny', [{ node: 't-mammalia', from: 'amniota', to: null }])
    expect(() => applyToPhylogeny(phy, small)).toThrow(/keeps its root/)
    const both = proposal('phylogeny', [{ node: 't-crocodylia', from: 'archosauria', to: 'sauria' }, { node: 't-aves', from: 'archosauria', to: 'sauria' }])
    expect(() => applyToPhylogeny(phy, both)).toThrow(/leave archosauria empty/)
  })

  it('compares: moved, changed groups, clades broken and formed', () => {
    const accepted = indexPhylogeny(phy)
    const proposed = indexPhylogeny(applyToPhylogeny(phy, proposal('phylogeny', [turtles])))
    const c = compareHierarchies(accepted, proposed)
    expect(c.moved).toEqual([{ node: 't-testudines', from: 'archelosauria', to: 'amniota' }])
    expect(c.changedGroups.find((g) => g.node === 'archelosauria')).toEqual({ node: 'archelosauria', gained: [], lost: ['t-testudines'] })
    expect(c.changedGroups.find((g) => g.node === 'sauria')!.lost).toEqual(['t-testudines'])
    // Archelosauria (turtles + archosaurs) breaks; its remaining tips are the same set as Archosauria.
    expect(c.broken.map((b) => b.node)).toContain('archelosauria')
    expect(c.onlyInA).toEqual([])
    expect(compareHierarchies(accepted, accepted)).toMatchObject({ moved: [], broken: [], formed: [] })
  })

  it('compares classifications too', () => {
    const c = compareHierarchies(indexClassification(cls), indexClassification(applyToClassification(cls, proposal('classification', [birdsIntoReptiles]))))
    expect(c.moved).toEqual([{ node: 'c:aves', from: null, to: 'c:reptilia' }])
    expect(c.changedGroups).toEqual([{ node: 'c:reptilia', gained: ['c:aves'], lost: [] }])
  })
})

describe('Proposed mode in a view', () => {
  const start = { type: 'startProposal', proposal: { id: 'p1', title: 'Birds are reptiles', author: 'A. Keeper', created: '2026-11-05T00:00:00Z' } } as const
  const view = () => createView(data, { id: 'v', title: 'Amniotes', target: { kind: 'classification', id: cls.id } })
  const proposing = (v: TaxonomicView = view()) => applyViewAction(v, start, data)

  it('draws the proposal, marks what moved, says so everywhere, and undoes', () => {
    let h = createHistory(view())
    h = dispatch(h, start, data)
    h = dispatch(h, { type: 'proposeMove', node: 'c:aves', to: 'c:reptilia' }, data)
    const drawn = projectView(data, h.present)
    expect(drawn.nodes.find((n) => n.id === 'c:aves')).toMatchObject({ parent: 'c:reptilia', moved: true })
    expect(drawn.proposed).toEqual({ title: 'Birds are reptiles', author: 'A. Keeper', moved: ['c:aves'] })
    const said = describeView(data, h.present, drawn)
    expect(said.title).toBe('Proposed by A. Keeper: Amniotes')
    expect(said.lines[0]).toMatch(/^PROPOSED by A\. Keeper.*Not an accepted arrangement/)
    h = undo(h)
    expect(projectView(data, h.present).nodes.find((n) => n.id === 'c:aves')!.parent).toBeNull()
    // The dataset's own hierarchy never changed.
    expect(data.classification(cls.id).parent.get('c:aves')).toBeNull()
  })

  it('moving back to the accepted parent removes the move; revert does too', () => {
    const moved = applyViewAction(proposing(), { type: 'proposeMove', node: 'c:aves', to: 'c:reptilia' }, data)
    expect(applyViewAction(moved, { type: 'proposeMove', node: 'c:aves', to: null }, data).proposal!.moves).toEqual([])
    expect(applyViewAction(moved, { type: 'revertMove', node: 'c:aves' }, data).proposal!.moves).toEqual([])
    // A second move of one node replaces the first and still starts from the accepted parent.
    const twice = applyViewAction(moved, { type: 'proposeMove', node: 'c:aves', to: 'c:mammalia' }, data)
    expect(twice.proposal!.moves).toEqual([{ node: 'c:aves', from: null, to: 'c:mammalia' }])
    expect(applyViewAction(moved, { type: 'endProposal' }, data).proposal).toBeUndefined()
  })

  it('refuses cycles through the reducer, moves without a proposal, and a time scale', () => {
    expect(() => applyViewAction(proposing(), { type: 'proposeMove', node: 'c:reptilia', to: 'c:squamata' }, data)).toThrow(ViewActionError)
    expect(() => applyViewAction(view(), { type: 'proposeMove', node: 'c:aves', to: 'c:reptilia' }, data)).toThrow(/Start a proposal/)
    const v = createView(data, { id: 'v', title: 'x', target: { kind: 'phylogeny', id: phy.id } })
    expect(() => applyViewAction(v, { type: 'startProposal', proposal: start.proposal }, indexDataset({ ...snapshot, phylogenies: [{ ...phy, rooted: false }] }))).toThrow(/unrooted/i)
    const moved = applyViewAction(applyViewAction(v, start, data), { type: 'proposeMove', node: 't-testudines', to: 'amniota' }, data)
    expect(() => applyViewAction(moved, { type: 'setLayout', layout: 'time' }, data)).toThrow(/invent/)
  })

  it('travels with the view file and is checked on opening', () => {
    const moved = applyViewAction(proposing(), { type: 'proposeMove', node: 'c:aves', to: 'c:reptilia' }, data)
    const back = parseView(serializeView(moved))
    expect(back.proposal).toEqual(moved.proposal)
    expect(validateView(back, data)).toEqual([])
    expect(projectView(data, back).nodes.find((n) => n.id === 'c:aves')!.moved).toBe(true)
    const stale = { ...back, proposal: { ...back.proposal!, base: { ...back.proposal!.base, version: '9' } } }
    expect(validateView(stale, data).map((d) => d.code)).toContain('proposal')
  })
})
