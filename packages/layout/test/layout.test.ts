import { describe, expect, it } from 'vitest'
import { applyViewAction, createView, indexDataset, projectView, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import { edgePath, LayoutError, radial, rectangular, sunburst } from '../src'
import checklistJson from '../../../fixtures/checklist.json'
import structuresJson from '../../../fixtures/structures.json'
import amniotesJson from '../../../fixtures/amniotes.json'

const cl = indexDataset(checklistJson as DatasetSnapshot)
const st = indexDataset(structuresJson as DatasetSnapshot)
const am = indexDataset(amniotesJson as DatasetSnapshot)
const project = (d: typeof cl, kind: 'classification' | 'phylogeny', id: string) => projectView(d, createView(d, { id: 'v', title: 't', target: { kind, id } }))

describe('rectangular', () => {
  it('spaces leaves evenly and centers parents over their children', () => {
    const p = project(am, 'phylogeny', 'archelosauria')
    const l = rectangular(p, { leafGap: 10, levelGap: 50 })
    const at = new Map(l.nodes.map((n) => [n.id, n]))
    const leaves = l.nodes.filter((n) => n.leaf).map((n) => n.y)
    expect(leaves).toEqual([0, 10, 20, 30, 40, 50])
    for (const n of p.nodes.filter((n) => n.children.length)) expect(at.get(n.id)!.y).toBe((at.get(n.children[0]!)!.y + at.get(n.children.at(-1)!)!.y) / 2)
    expect(l).toMatchObject({ kind: 'rectangular', diagram: 'phylogeny' })
    expect(edgePath(l.edges[0]!)).toMatch(/^M0 \d+(\.\d+)? L0 \d+ L50 \d+$/)
    // Same input, same numbers.
    expect(rectangular(p, { leafGap: 10, levelGap: 50 })).toEqual(l)
  })

  it('labels classifications as such and aligns leaves on request', () => {
    const p = project(cl, 'classification', 'fx:checklist')
    const l = rectangular(p, { alignLeaves: true, levelGap: 10 })
    expect(l.notice).toMatch(/not common ancestry/)
    expect(new Set(l.nodes.filter((n) => n.leaf).map((n) => n.x))).toEqual(new Set([50]))
  })

  it('treats a collapsed node as a leaf', () => {
    const v = applyViewAction(createView(cl, { id: 'v', title: 't', target: { kind: 'classification', id: 'fx:checklist' } }), { type: 'collapse', node: 'fx:2' }, cl)
    const l = rectangular(projectView(cl, v))
    expect(l.nodes.find((n) => n.id === 'fx:2')!.leaf).toBe(true)
    expect(l.nodes.some((n) => n.id === 'fx:3')).toBe(false)
  })

  it('draws lengths and dates only when the data has them', () => {
    expect(() => rectangular(project(cl, 'classification', 'fx:checklist'), { scale: 'phylogram' })).toThrow(LayoutError)
    expect(() => rectangular(project(st, 'phylogeny', 'polytomy'), { scale: 'phylogram' })).toThrow(/no stated unit/)
    expect(() => rectangular(project(st, 'phylogeny', 'unrooted'), { scale: 'time' })).toThrow(/time-calibrated/)
    const unrooted = rectangular(project(st, 'phylogeny', 'unrooted'), { scale: 'phylogram', width: 100 })
    expect(unrooted.notice).toMatch(/Unrooted/)
    expect(unrooted.axis).toMatchObject({ unit: 'substitutions-per-site', direction: 'from-root' })
    const fossil = rectangular(project(st, 'phylogeny', 'fossil'), { scale: 'time', width: 100 })
    expect(fossil.axis!.direction).toBe('before-present')
    expect(fossil.axis!.ticks[0]).toMatchObject({ value: 0, x: 100 })
    // x is proportional to cumulative branch length.
    const p = project(st, 'phylogeny', 'fossil')
    const len = new Map(p.nodes.map((n) => [n.id, n.length ?? 0]))
    const maxX = Math.max(...fossil.nodes.map((n) => n.x))
    const depthOf = (id: string): number => (p.nodes.find((n) => n.id === id)!.parent ? len.get(id)! + depthOf(p.nodes.find((n) => n.id === id)!.parent!) : 0)
    const maxDepth = Math.max(...p.nodes.map((n) => depthOf(n.id)))
    for (const n of fossil.nodes) expect(n.x).toBeCloseTo((depthOf(n.id) / maxDepth) * maxX)
  })
})

describe('radial and sunburst', () => {
  it('places leaves around the circle at radius = depth', () => {
    const l = radial(project(am, 'phylogeny', 'archelosauria'), { radiusStep: 10 })
    const root = l.nodes.find((n) => n.id === 'amniota')!
    expect(root).toMatchObject({ x: 0, y: 0 })
    const leafAngles = l.nodes.filter((n) => n.leaf).map((n) => n.angle!)
    expect(leafAngles).toEqual([...leafAngles].sort((a, b) => a - b))
    expect(new Set(leafAngles).size).toBe(6)
  })

  it('sunburst is for classifications, with angles by visible leaves', () => {
    expect(() => sunburst(project(am, 'phylogeny', 'archelosauria'))).toThrow(LayoutError)
    const s = sunburst(project(cl, 'classification', 'fx:checklist'))
    const root = s.arcs.find((a) => a.id === 'fx:1')!
    expect(root.endAngle - root.startAngle).toBeCloseTo(2 * Math.PI)
    const order = (id: string) => s.arcs.find((a) => a.id === id)!
    const alpha = order('fx:2')
    // Alphiformes has 5 of the 9 visible leaves.
    expect((alpha.endAngle - alpha.startAngle) / (2 * Math.PI)).toBeCloseTo(5 / 9)
    expect(s.notice).toMatch(/not numbers of species/)
  })
})
