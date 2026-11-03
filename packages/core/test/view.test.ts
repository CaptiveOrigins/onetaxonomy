import { describe, expect, it } from 'vitest'
import {
  applyViewAction, createHistory, createView, dispatch, indexDataset, makeHighlight, parseView, projectView, redo, sealSnapshot,
  serializeView, snapshotChecksum, undo, validateView, ViewActionError, type TaxonomicView,
} from '../src'
import { amniotes, checklist, clone, structures } from './helpers'

const cl = indexDataset(checklist)
const am = indexDataset(sealSnapshot(clone(amniotes)))
const st = indexDataset(structures)
const labels = (v: TaxonomicView, d = cl) => projectView(d, v).nodes.map((n) => n.label)

describe('views: actions, undo/redo, projection (M4 acceptance)', () => {
  it('drag, collapse, filter and rotate with undo/redo, leaving the snapshot untouched', () => {
    const before = snapshotChecksum(checklist)
    const frozen = JSON.stringify(checklist)
    let h = createHistory(createView(cl, { id: 'v', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } }))
    h = dispatch(h, { type: 'reorder', node: 'fx:1', children: ['fx:22', 'fx:2', 'fx:14'] }, cl) // drag
    h = dispatch(h, { type: 'collapse', node: 'fx:2' }, cl)
    h = dispatch(h, { type: 'setFilter', filter: { ranks: ['class', 'order', 'family', 'genus', 'species'] } }, cl)
    h = dispatch(h, { type: 'rotate', node: 'fx:16' }, cl)
    const p = projectView(cl, h.present)
    expect(p.nodes.map((n) => n.label)).toEqual(['Exemplaria', 'Zetiformes', 'Zetidae', 'Zetus', 'Zetus nonus', 'Alphiformes', 'Deltiformes', 'Deltidae', 'Deltus', 'Deltus septimus', 'Deltus sextus', 'Epsilidae', 'Epsilus', 'Epsilus octavus'])
    expect(p.nodes.find((n) => n.id === 'fx:2')).toMatchObject({ collapsed: true, hiddenDescendants: 11 })
    expect(p.counts).toEqual({ total: 25, shown: 14, hidden: 0, filtered: 0, collapsed: 11, outsideFocus: 0 })

    h = undo(undo(h))
    expect(h.present.collapsed).toEqual(['fx:2'])
    expect(h.present.filter).toEqual({})
    h = redo(h)
    expect(h.present.filter.ranks).toHaveLength(5)
    h = dispatch(h, { type: 'expand', node: 'fx:2' }, cl)
    expect(h.future).toEqual([]) // a new action clears redo
    // Subspecies are filtered out but counted under their parent.
    expect(projectView(cl, h.present).nodes.find((n) => n.id === 'fx:6')).toMatchObject({ hiddenDescendants: 1, children: [] })
    expect(snapshotChecksum(checklist)).toBe(before)
    expect(JSON.stringify(checklist)).toBe(frozen)
  })

  it('refuses impossible actions', () => {
    const v = createView(cl, { id: 'v', title: 't', target: { kind: 'classification', id: 'fx:checklist' } })
    expect(() => applyViewAction(v, { type: 'collapse', node: 'nope' }, cl)).toThrow(ViewActionError)
    expect(() => applyViewAction(v, { type: 'reorder', node: 'fx:1', children: ['fx:2', 'fx:2', 'fx:14'] }, cl)).toThrow(/each of its 3 children once/)
    expect(() => applyViewAction(v, { type: 'setLayout', layout: 'time' }, cl)).toThrow(/no branch lengths or ages/)
    const fossil = createView(st, { id: 'f', title: 'f', target: { kind: 'phylogeny', id: 'fossil' } })
    expect(applyViewAction(fossil, { type: 'setLayout', layout: 'time' }, st).layout.kind).toBe('time')
    const unrooted = createView(st, { id: 'u', title: 'u', target: { kind: 'phylogeny', id: 'polytomy' } })
    expect(() => applyViewAction(unrooted, { type: 'setLayout', layout: 'phylogram' }, st)).toThrow(/invent them/)
    // A dispatch that changes nothing adds no history entry.
    const h = createHistory(v)
    expect(dispatch(h, { type: 'expand', node: 'fx:1' }, cl)).toBe(h)
  })

  it('focuses a subtree and hides branches, disclosing what is not drawn', () => {
    let v = createView(cl, { id: 'v', title: 't', target: { kind: 'classification', id: 'fx:checklist' } })
    v = applyViewAction(v, { type: 'focus', node: 'fx:2' }, cl)
    v = applyViewAction(v, { type: 'hide', node: 'fx:8' }, cl)
    const p = projectView(cl, v)
    expect(p.roots).toEqual(['fx:2'])
    expect(p.counts).toMatchObject({ shown: 10, hidden: 2, outsideFocus: 13 })
    expect(p.nodes.find((n) => n.id === 'fx:3')!.hiddenDescendants).toBe(2)
    expect(projectView(cl, v, { limit: 3 })).toMatchObject({ truncated: true, counts: { shown: 3 } })
  })

  it('treats unknown life status as its own value', () => {
    let v = createView(st, { id: 'v', title: 't', target: { kind: 'phylogeny', id: 'fossil' } })
    v = applyViewAction(v, { type: 'setFilter', filter: { status: ['unknown'] } }, st)
    const p = projectView(st, v)
    expect(p.nodes.filter((n) => n.isTip).map((n) => n.label)).toEqual(['G'])
    expect(p).toMatchObject({ lengthUnit: 'Ma', timeCalibrated: true, rooted: true })
  })
})

describe('highlights: groups vs clades (I3)', () => {
  it('calls a highlight a clade only with support from the named hypothesis', () => {
    const v = createView(am, { id: 'v', title: 't', target: { kind: 'phylogeny', id: 'archelosauria' } })
    const archo = makeHighlight(am, v, { id: 'h1', label: 'Archosaurs', members: ['t-crocodylia', 't-aves'] })
    expect(archo.kind).toBe('clade')
    const reptiles = makeHighlight(am, v, { id: 'h2', label: 'Traditional reptiles', members: ['t-squamata', 't-rhyncho', 't-testudines', 't-crocodylia'] })
    expect(reptiles).toMatchObject({ kind: 'group', assessment: { status: 'not-monophyletic', missing: ['t-aves'] } })
    expect(() => applyViewAction(v, { type: 'addHighlight', highlight: { ...reptiles, kind: 'clade' } }, am)).toThrow(/not a supported clade/)
    const shown = applyViewAction(applyViewAction(v, { type: 'addHighlight', highlight: archo }, am), { type: 'addHighlight', highlight: reptiles }, am)
    expect(projectView(am, shown).nodes.find((n) => n.id === 't-aves')!.highlights).toEqual(['h1'])
    // Classification view: Reptilia assessed against a hypothesis is a group, with the reason kept.
    const cv = createView(am, { id: 'c', title: 'c', target: { kind: 'classification', id: 'traditional' } })
    expect(makeHighlight(am, cv, { id: 'r', label: 'Reptilia', members: ['c:reptilia'], hypothesis: 'archelosauria' })).toMatchObject({ kind: 'group', assessment: { status: 'not-monophyletic' } })
    expect(makeHighlight(am, cv, { id: 'r', label: 'Reptilia', members: ['c:reptilia'] }).assessment).toMatchObject({ status: 'indeterminate', reason: 'classification-only' })
  })
})

describe('serialization and validation', () => {
  it('round-trips views canonically and re-checks them when reopened', () => {
    let v = createView(am, { id: 'v', title: 't', target: { kind: 'phylogeny', id: 'archelosauria' } })
    v = applyViewAction(v, { type: 'addHighlight', highlight: makeHighlight(am, v, { id: 'h1', label: 'Archosaurs', members: ['t-crocodylia', 't-aves'] }) }, am)
    v = applyViewAction(v, { type: 'rotate', node: 'archosauria' }, am)
    const text = serializeView(v)
    expect(serializeView(parseView(text))).toBe(text)
    expect(validateView(parseView(text), am)).toEqual([])
    // Opened against the other hypothesis (same node ids for the tips): the clade claim is re-checked.
    const moved = { ...parseView(text), target: { kind: 'phylogeny' as const, id: 'anapsid-turtles' }, order: {} }
    // Still a clade there, but the claim was made against another hypothesis: flagged.
    expect(validateView(moved, am).map((d) => d.code)).toEqual(['stale-assessment'])
    const bad = { ...parseView(text), highlights: [{ ...v.highlights[0]!, members: ['t-testudines', 't-aves'] }] }
    expect(validateView(bad, am).map((d) => d.code)).toEqual(['unsupported-clade'])
    expect(validateView({ ...v, snapshot: { id: 'other', version: '9' }, collapsed: ['ghost'] }, am).map((d) => d.code)).toEqual(['snapshot-mismatch', 'unknown-node'])
    expect(() => parseView('{"format":"onetaxonomy-view","formatVersion":2}')).toThrow(/not supported/)
  })
})
