// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createView, indexDataset, makeHighlight, projectView, type DatasetIndex, type DatasetSnapshot, type Projection, type TaxonomicView } from '@captiveorigins/onetaxonomy-core'
import { radial, rectangular, type TreeLayout } from '@captiveorigins/onetaxonomy-layout'
import {
  CANVAS_THRESHOLD, canvasPlanOf, treeViewBox, chooseRenderer, describeLod, drawPlan, Explorer, hitTest, LIGHT_COLORS, planCanvas, prepareTree, shapeAt, shapePolygon, TreeView,
  type CanvasPlan, type Context2D, type PlanOptions,
} from '../src'
import { bigTree } from './bigTree'
import checklistJson from '../../../fixtures/checklist.json'

afterEach(cleanup)

const dataset = (tips: number) => indexDataset(bigTree(tips))
const viewOf = (d: DatasetIndex): TaxonomicView => createView(d, { id: 'v', title: 'Made-up', target: { kind: 'phylogeny', id: 'big' } })
const projected = (tips: number, edit: (v: TaxonomicView, d: DatasetIndex) => TaxonomicView = (v) => v) => {
  const d = dataset(tips)
  const v = edit(viewOf(d), d)
  return { d, v, p: projectView(d, v) }
}
/** A box that makes one layout unit `k` pixels on an 800 × 600 canvas, starting at the top left. */
const at = (k: number, x = 0, y = 0): Pick<PlanOptions, 'box' | 'width' | 'height'> => ({ box: { x, y, width: 800 / k, height: 600 / k }, width: 800, height: 600 })
const plan = (p: Projection, layout: TreeLayout, o: Pick<PlanOptions, 'box' | 'width' | 'height'> & Partial<PlanOptions>) => planCanvas(prepareTree(p, layout), o)
const node = (pl: CanvasPlan, id: string) => pl.nodes.find((n) => n.id === id)

/** A 2D context that records what is drawn. */
function recorder() {
  const calls: { op: string; args: unknown[]; fillStyle?: unknown; font?: string }[] = []
  const ctx: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1 }
  for (const op of ['save', 'restore', 'setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'fill', 'stroke', 'fillText', 'translate', 'rotate', 'setLineDash'])
    ctx[op] = (...args: unknown[]) => calls.push({ op, args, fillStyle: ctx.fillStyle, font: ctx.font as string })
  return { ctx: ctx as unknown as Context2D, calls }
}

describe('choosing the renderer', () => {
  it('draws SVG up to the threshold and canvas above it, unless one is asked for', () => {
    expect(CANVAS_THRESHOLD).toBe(1000)
    const at1000 = rectangular(projected(500).p) // 500 tips, 999 nodes
    const at1001 = rectangular(projected(501).p) // 1,001 nodes
    expect(at1000.nodes).toHaveLength(999)
    expect(at1001.nodes).toHaveLength(1001)
    expect(chooseRenderer(at1000)).toBe('svg')
    expect(chooseRenderer(at1001)).toBe('canvas')
    expect(chooseRenderer(at1001, 'svg')).toBe('svg')
    expect(chooseRenderer(at1000, 'canvas')).toBe('canvas')
    expect(chooseRenderer(at1000, 'auto', 500)).toBe('canvas')
    // Folding counts: the threshold is about drawn nodes, not the size of the data.
    const folded = projected(501, (v) => ({ ...v, collapsed: ['n1'] }))
    expect(chooseRenderer(rectangular(folded.p))).toBe('svg')
  })

  it('leaves the SVG exactly as it was below the threshold', () => {
    const p = projectView(indexDataset(checklistJson as DatasetSnapshot), createView(indexDataset(checklistJson as DatasetSnapshot), { id: 'v', title: 't', target: { kind: 'classification', id: 'fx:checklist' } }))
    const layout = rectangular(p)
    const auto = renderToStaticMarkup(<TreeView projection={p} layout={layout} title="t" />)
    expect(auto).toBe(renderToStaticMarkup(<TreeView projection={p} layout={layout} title="t" renderer="svg" />))
    expect(auto).toMatch(/^<svg/)
    expect(auto).not.toContain('<canvas')
  })

  it('gives the canvas role="img", the title as its name and the same description as the SVG', () => {
    const { p } = projected(600)
    render(<TreeView projection={p} layout={rectangular(p)} title="Made-up tree" canvasSize={{ width: 800, height: 600 }} />)
    const img = screen.getByRole('img', { name: 'Made-up tree' })
    expect(img.tagName).toBe('CANVAS')
    const description = (img.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent).join(' ')
    expect(description).toContain('Phylogenetic hypothesis: branching shows proposed common ancestry')
    expect(description).toContain('1199 of 1199 shown.')
    // At the fit zoom 600 tips don't fit: the note says so, and it is visible, not only read out.
    expect(description).toMatch(/too small or crowded to show/)
    expect(document.querySelector('.ot-lod-note')?.textContent).toMatch(/Zoom in to see them\./)
    expect(document.querySelector('[data-renderer="canvas"]')?.getAttribute('data-diagram')).toBe('phylogeny')
    // Nothing in the drawing takes Tab (ADR 0010).
    expect(document.querySelectorAll('[tabindex]')).toHaveLength(0)
  })
})

describe('level of detail', () => {
  it('shows names only where the text is at least 9 px, and always the selection', () => {
    const { p } = projected(64, (v) => ({ ...v, selected: ['t40'] }))
    const layout = rectangular(p)
    const near = plan(p, layout, at(1)) // 12 px text
    const tipsInView = near.nodes.filter((n) => n.leaf && n.y >= 0 && n.y <= 600)
    expect(tipsInView.length).toBeGreaterThanOrEqual(15)
    for (const n of tipsInView) expect(n.label?.px).toBe(12)
    expect(near.counts.labelsShown).toBeGreaterThanOrEqual(tipsInView.length)

    const far = plan(p, layout, at(0.7)) // 8.4 px: too small
    const labelled = far.nodes.filter((n) => n.label)
    expect(labelled.map((n) => n.id)).toEqual(['t40']) // only the selection
    expect(node(far, 't40')!.label!.px).toBe(9)
    expect(node(far, 't40')!.label!.bold).toBe(true)
    expect(far.counts.labelsOmitted).toBe(far.nodes.filter((n) => n.leaf).length - 1)
    expect(describeLod(far.counts)).toMatch(/^\d+ names and values are too small or crowded to show\. Zoom in to see them\.$/)
  })

  it('leaves out a name that would overlap one already placed, and counts it', () => {
    const { p } = projected(3)
    const layout = rectangular(p, { leafGap: 8 }) // tips 8 units apart, text 12 units tall
    const pl = plan(p, layout, at(1))
    const tips = pl.nodes.filter((n) => n.leaf)
    expect(tips.filter((n) => n.label)).toHaveLength(2) // the first and the third; the second would overlap the first
    expect(pl.counts.labelsOmitted).toBe(1)
  })

  it('in radial layouts, shows a leaf name only when its neighbours are as far apart as the text is tall', () => {
    const small = projected(8)
    const smallLayout = radial(small.p)
    const whole = treeViewBox(smallLayout)
    const few = plan(small.p, smallLayout, { box: whole, width: whole.width, height: whole.height }) // 1 px per unit, all in view
    expect(few.nodes.filter((n) => n.leaf && n.label)).toHaveLength(8)
    expect(few.nodes.find((n) => n.label)!.label!.angle).not.toBeUndefined()

    const big = projected(800)
    const layout = radial(big.p)
    const all = treeViewBox(layout)
    const many = plan(big.p, layout, { box: all, width: all.width, height: all.height })
    expect(many.counts.labelsOmitted).toBeGreaterThan(0)
    // 800 leaves round the circle: inner leaves are crowded, outer ones have room.
    expect(many.counts.labelsShown).toBeGreaterThan(0)
    const leaves = layout.nodes.filter((n) => n.leaf)
    for (const n of many.nodes.filter((x) => x.leaf && x.label)) {
      const i = leaves.findIndex((l) => l.id === n.id)
      const gaps = [leaves[i - 1], leaves[i + 1]].filter(Boolean).map((l) => Math.hypot(l!.x - leaves[i]!.x, l!.y - leaves[i]!.y))
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(12 * 0.9)
    }
  })

  it('draws subtrees under a pixel as wedges with counts, and every drawn node is accounted for', () => {
    const { p } = projected(5000)
    const layout = rectangular(p)
    const pl = plan(p, layout, at(600 / (layout.height + 40)))
    expect(pl.counts.merged.subtrees).toBeGreaterThan(0)
    const wedges = pl.nodes.filter((n) => n.merged)
    expect(wedges).toHaveLength(pl.counts.merged.subtrees)
    expect(wedges.reduce((s, w) => s + w.merged!.count, 0)).toBe(pl.counts.merged.nodes)
    // Drawn one by one, inside wedges, or out of view: nothing goes missing silently.
    expect(pl.counts.drawn + pl.counts.merged.nodes + pl.counts.outOfView).toBe(layout.nodes.length)
    expect(pl.counts.drawn).toBeLessThan(layout.nodes.length / 2)
    const text = describeLod(pl.counts, { outline: true })
    expect(text).toContain(`${pl.counts.merged.subtrees.toLocaleString('en-US')} branches are too small to draw at this zoom and are shown as wedges holding ${pl.counts.merged.nodes.toLocaleString('en-US')} nodes.`)
    expect(text).toMatch(/use the outline, which lists every taxon\.$/)
    // Zoomed in on 1–2k visible nodes, nothing is merged.
    const close = plan(p, layout, at(0.05))
    expect(close.counts.merged.subtrees).toBe(0)
  })

  it('in radial layouts, merges subtrees whose leaves span under a pixel along the outer circle', () => {
    const { p } = projected(5000)
    const layout = radial(p)
    const pl = plan(p, layout, { box: treeViewBox(layout), width: 800, height: 800 })
    expect(pl.counts.merged.subtrees).toBeGreaterThan(0)
    expect(pl.counts.drawn + pl.counts.merged.nodes + pl.counts.outOfView).toBe(layout.nodes.length)
    // Each wedge runs from its node out to its first and last leaves.
    for (const w of pl.nodes.filter((n) => n.merged)) expect(w.merged!.points).toHaveLength(3)
  })

  it('never merges the selection or the drop target away', () => {
    const { p } = projected(5000, (v) => ({ ...v, selected: ['t2500'] }))
    const layout = rectangular(p)
    const pl = plan(p, layout, { ...at(600 / layout.height), dropTarget: 't10' })
    expect(node(pl, 't2500')?.label?.text).toBe('Taxon 2500')
    expect(node(pl, 't10')?.dropTarget).toBe(true)
    expect(pl.counts.merged.subtrees).toBeGreaterThan(0)
  })

  it('keeps highlight colours and shapes, on nodes and on wedges that hold them', () => {
    const { p, v } = projected(5000, (v, d) => {
      const a = { ...makeHighlight(d, v, { id: 'a', label: 'A', members: ['t1', 't2'] }), color: '#ff0000' }
      const b = { ...makeHighlight(d, v, { id: 'b', label: 'B', members: ['t4000', 't4001'] }), color: '#0000ff' }
      return { ...v, highlights: [a, b] }
    })
    const layout = rectangular(p)
    const where = (id: string) => layout.nodes.find((n) => n.id === id)!
    // Close up: each node carries its highlight's colour and the shape of its place in the list, as in the SVG.
    const close = plan(p, layout, { ...at(1, where('t1').x - 100, where('t1').y - 100), highlights: v.highlights })
    expect(node(close, 't1')!.halo).toMatchObject({ color: '#ff0000', shape: shapeAt(0) })
    const other = plan(p, layout, { ...at(1, where('t4000').x - 100, where('t4000').y - 100), highlights: v.highlights })
    expect(node(other, 't4000')!.halo).toMatchObject({ color: '#0000ff', shape: shapeAt(1) })
    expect(shapeAt(1)).toBe('square')
    // Zoomed out: a wedge holding a highlighted node shows the highlight, in the same shape.
    const fit = plan(p, layout, { ...at(600 / layout.height), highlights: v.highlights })
    expect(fit.nodes.find((n) => n.merged && n.halo?.color === '#ff0000')?.halo?.shape).toBe('circle')
    expect(fit.nodes.find((n) => n.merged && n.halo?.color === '#0000ff')?.halo?.shape).toBe('square')
  })

  it('draws the same shapes as the SVG, sharp at the device pixel ratio', () => {
    const { p, v } = projected(4, (v, d) => ({ ...v, highlights: [{ ...makeHighlight(d, v, { id: 'a', label: 'A', members: ['t1', 't2'] }), color: '#ff0000' }, { ...makeHighlight(d, v, { id: 'b', label: 'B', members: ['t3', 't4'] }), color: '#00aa00' }] }))
    const pl = plan(p, rectangular(p), { ...at(1), highlights: v.highlights })
    const { ctx, calls } = recorder()
    drawPlan(ctx, pl, LIGHT_COLORS, { scale: 2 })
    expect(calls[0]).toEqual({ op: 'setTransform', args: [2, 0, 0, 2, 0, 0], fillStyle: '', font: '' })
    // The second highlight is a square: four corners from the same polygon as the SVG path.
    const square = shapePolygon('square', 7.5)!
    const t3 = node(pl, 't3')!
    const moves = calls.filter((c) => c.op === 'moveTo' && c.args[0] === t3.x + square[0]![0] && c.args[1] === t3.y + square[0]![1])
    expect(moves).toHaveLength(1)
    expect(calls.some((c) => c.op === 'fill' && c.fillStyle === '#00aa00')).toBe(true)
    expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual(expect.arrayContaining(['Taxon 1', 'Taxon 4']))
  })
})

describe('hit-testing', () => {
  it('finds a node by its dot, its name or its wedge, and nothing on empty canvas', () => {
    const { p } = projected(64)
    const pl = plan(p, rectangular(p), at(1))
    const t5 = node(pl, 't5')!
    expect(hitTest(pl, t5.x + 2, t5.y + 1)).toBe('t5')
    expect(hitTest(pl, t5.label!.box.x0 + 20, (t5.label!.box.y0 + t5.label!.box.y1) / 2)).toBe('t5')
    expect(hitTest(pl, 790, 590)).toBeNull()

    const big = projected(5000)
    const layout = rectangular(big.p)
    const fit = plan(big.p, layout, at(600 / layout.height))
    const wedge = fit.nodes.find((n) => n.merged)!
    const centre = wedge.merged!.points.reduce(([x, y], [px, py]) => [x + px / 3, y + py / 3], [0, 0])
    expect(hitTest(fit, centre[0]!, centre[1]!)).toBe(wedge.id)
  })
})

describe('the explorer on a large tree', () => {
  let recorded: ReturnType<typeof recorder>
  beforeEach(() => {
    recorded = recorder()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recorded.ctx as never)
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('draws on canvas at 2× for a high-density screen, selects by click, and keeps the outline', () => {
    const d = dataset(600)
    render(<Explorer dataset={d} initialView={viewOf(d)} title="Made-up tree" />)
    const canvas = screen.getByRole('img', { name: 'Made-up tree' }) as HTMLCanvasElement
    expect(canvas.tagName).toBe('CANVAS')
    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(1200)
    expect(recorded.calls.some((c) => c.op === 'stroke')).toBe(true)
    // The explorer's note mentions the outline, which stays the keyboard path (ADR 0010).
    expect(document.querySelector('.ot-lod-note')?.textContent).toMatch(/use the outline, which lists every taxon/)
    expect(screen.getByRole('tree')).toBeTruthy()

    // Zoom in (the + key) until names show, then click the dot of a drawn node.
    const area = canvas.closest('.ot-canvas') as HTMLElement
    for (let i = 0; i < 14; i++) fireEvent.keyDown(area, { key: '+' })
    const pl = canvasPlanOf(canvas)!
    const target = pl.nodes.find((n) => n.leaf && n.label && n.x > 0 && n.y > 0 && n.y < 600)!
    expect(target).toBeTruthy()
    fireEvent.pointerDown(canvas, { clientX: target.x, clientY: target.y })
    fireEvent.pointerUp(canvas, { clientX: target.x, clientY: target.y })
    expect(screen.getByRole('region', { name: 'Details' }).querySelector('h3')?.textContent).toBe(target.label!.text)
    expect(screen.getAllByRole('treeitem').find((i) => i.getAttribute('aria-selected') === 'true')?.textContent).toContain(target.label!.text)
    // A click on empty canvas selects nothing new.
    fireEvent.pointerDown(canvas, { clientX: 799, clientY: 1 })
    fireEvent.pointerUp(canvas, { clientX: 799, clientY: 1 })
    expect(screen.getByRole('region', { name: 'Details' }).querySelector('h3')?.textContent).toBe(target.label!.text)
  })

  it('says why SVG download is unavailable on canvas instead of doing nothing', () => {
    const d = dataset(600)
    render(<Explorer dataset={d} initialView={viewOf(d)} title="Made-up tree" />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Drawing \(SVG\)/ }))
    expect(document.body.textContent).toMatch(/SVG download needs the SVG drawing\. Download PNG instead/)
  })
})
