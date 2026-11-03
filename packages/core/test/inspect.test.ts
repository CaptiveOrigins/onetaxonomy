import { describe, expect, it } from 'vitest'
import { applyViewAction, createView, describeAssessment, describeView, indexDataset, inspectNode, makeHighlight, nodeOverlays, projectView, validateDataset, validateView, ViewActionError, type DatasetSnapshot } from '../src'
import { amniotes, clone, structures } from './helpers'

const withTraits = (): DatasetSnapshot => {
  const s = clone(amniotes)
  s.traits = [
    {
      id: 'repro',
      title: 'Reproduction (illustrative)',
      source: 'fixture',
      states: [{ id: 'egg', label: 'Lays eggs', color: '#eeb684' }, { id: 'live', label: 'Live birth' }],
      values: [{ concept: 'c:testudines', state: 'egg' }, { concept: 'c:aves', state: 'egg' }, { concept: 'c:mammalia', state: 'live', note: 'monotremes excepted' }],
    },
  ]
  s.profiles = [{ concept: 'c:testudines', status: 'extant', summary: 'Turtles.', citations: ['Example 2026'] }]
  return s
}

describe('inspector, overlays and disclosures (M5)', () => {
  it('validates trait sets: unknown concept, state, source and duplicate values', () => {
    const s = withTraits()
    expect(validateDataset(s).filter((d) => d.severity === 'error')).toEqual([])
    s.traits![0]!.values.push({ concept: 'c:nope', state: 'egg' }, { concept: 'c:aves', state: 'claws' })
    s.traits![0]!.source = 'missing'
    expect(validateDataset(s).filter((d) => d.severity === 'error').map((d) => d.code)).toEqual(['missing-source', 'dangling-reference', 'dangling-reference', 'duplicate-id'])
  })

  it('inspects a classification node with names, profile, traits and citations', () => {
    const d = indexDataset(withTraits())
    const view = createView(d, { id: 'v', title: 'T', target: { kind: 'classification', id: 'traditional' } })
    const n = inspectNode(d, view, 'c:testudines')
    expect(n).toMatchObject({ kind: 'classification', unmapped: false, traits: [{ set: 'repro', state: 'Lays eggs' }], references: ['Example 2026'] })
    expect(n.concepts[0]).toMatchObject({ id: 'c:testudines', name: 'Testudines', status: 'extant', profile: { summary: 'Turtles.' } })
    expect(n.citations).toEqual([expect.objectContaining({ source: 'fixture', illustrative: true })])
    expect(() => inspectNode(d, view, 'nope')).toThrow(RangeError)
  })

  it('inspects phylogeny nodes: unmapped internal nodes, ages with units', () => {
    const d = indexDataset(structures)
    const view = createView(d, { id: 'v', title: 'F', target: { kind: 'phylogeny', id: 'fossil' } })
    expect(inspectNode(d, view, 'f0')).toMatchObject({ unmapped: true, concepts: [], age: { value: 100, min: 90, max: 112, unit: 'Ma' } })
    expect(inspectNode(d, view, 'x')).toMatchObject({ unmapped: false, label: 'X', age: { value: 66, unit: 'Ma' } })
  })

  it('overlays show only stated values: support (phylogeny only), fossils, observed traits', () => {
    const s = clone(structures)
    s.phylogenies.find((p) => p.id === 'fossil')!.nodes.find((n) => n.id === 'f1')!.support = { value: 0.62, method: 'posterior' }
    const d = indexDataset(s)
    let view = createView(d, { id: 'v', title: 'F', target: { kind: 'phylogeny', id: 'fossil' } })
    view = applyViewAction(view, { type: 'setOverlays', overlays: { support: { threshold: 0.95 }, extinction: true } }, d)
    const marks = nodeOverlays(d, view, projectView(d, view))
    expect(marks.get('f1')).toEqual({ support: { value: 0.62, method: 'posterior', weak: true } })
    expect(marks.get('x')).toEqual({ extinct: true, fossilAge: { value: 66, unit: 'Ma' } })
    expect(marks.has('y')).toBe(false)
    expect(applyViewAction(view, { type: 'setOverlays', overlays: {} }, d).overlays).toBeUndefined()

    const t = indexDataset(withTraits())
    const cls = createView(t, { id: 'c', title: 'C', target: { kind: 'classification', id: 'traditional' } })
    expect(() => applyViewAction(cls, { type: 'setOverlays', overlays: { support: {} } }, t)).toThrow(ViewActionError)
    expect(() => applyViewAction(cls, { type: 'setOverlays', overlays: { trait: 'nope' } }, t)).toThrow(ViewActionError)
    const colored = applyViewAction(cls, { type: 'setOverlays', overlays: { trait: 'repro' } }, t)
    const tm = nodeOverlays(t, colored, projectView(t, colored))
    expect(tm.get('c:testudines')).toEqual({ trait: { state: 'egg', label: 'Lays eggs', color: '#eeb684' } })
    expect(tm.get('c:mammalia')).toEqual({ trait: { state: 'live', label: 'Live birth' } })
    expect(tm.has('c:reptilia')).toBe(false) // never inferred for ancestors
    expect(validateView({ ...colored, overlays: { trait: 'gone' } }, t).map((x) => x.code)).toEqual(['unknown-trait'])
  })

  it('describes a view for exports: kind, hidden counts, order, groups, data and illustrative sources', () => {
    const d = indexDataset(structures)
    let view = createView(d, { id: 'v', title: 'Fossils', target: { kind: 'phylogeny', id: 'fossil' } })
    view = applyViewAction(view, { type: 'collapse', node: 'f1' }, d)
    const p = projectView(d, view)
    const text = describeView(d, view, p).lines.join('\n')
    expect(text).toMatch(/^Phylogenetic hypothesis: .*rooted; partial sampling/)
    expect(text).toMatch(/of \d+ nodes shown; \d+ not shown \(\d+ folded\)/)
    expect(text).toMatch(/snapshot /)
    expect(describeView(d, view, p).illustrative).toBe(true)
    const c = indexDataset(amniotes)
    const cv = createView(c, { id: 'c', title: 'C', target: { kind: 'classification', id: 'traditional' } })
    expect(describeView(c, cv, projectView(c, cv)).lines[0]).toMatch(/not common ancestry/)
  })
})

describe('describeAssessment', () => {
  it('explains clades, non-clades and missing hypotheses in words, with names', () => {
    const d = indexDataset(amniotes)
    const v = createView(d, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } })
    const yes = describeAssessment(d, makeHighlight(d, v, { id: 'h', label: 'Archosaurs', members: ['t-crocodylia', 't-aves'] }).assessment!)
    expect(yes.headline).toMatch(/^A clade in Turtles with archosaurs \(illustrative\) \(version /)
    const no = describeAssessment(d, makeHighlight(d, v, { id: 'h', label: 'Reptiles', members: ['t-squamata', 't-testudines', 't-crocodylia'] }).assessment!)
    expect(no.headline).toMatch(/^Not a clade/)
    expect(no.details[0]).toMatch(/Also descended from that ancestor: .*Aves/)
    const cls = createView(d, { id: 'c', title: 'C', target: { kind: 'classification', id: 'traditional' } })
    expect(describeAssessment(d, makeHighlight(d, cls, { id: 'h', label: 'R', members: ['c:reptilia'] }).assessment!).headline).toMatch(/Choose a phylogenetic hypothesis/)
  })
})
