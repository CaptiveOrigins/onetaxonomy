// @vitest-environment jsdom
// Pan to the outline's selection (ADR 0010's follow-up, 2026-11-11). Made-up trees only; jsdom has no layout,
// so the SVG counts one layout unit per pixel and the canvas uses its default 800 × 600 plan.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createView, indexDataset, projectView, type DatasetIndex, type DatasetSnapshot, type TaxonomicView } from '@captiveorigins/onetaxonomy-core'
import { canvasPlanOf, Explorer, type ViewBox } from '../src'
import { revealBox, REVEAL_MARGIN_PX } from '../src/reveal'
import { bigTree } from './bigTree'
import checklistJson from '../../../fixtures/checklist.json'

const cl = indexDataset(checklistJson as DatasetSnapshot)
const clView = (): TaxonomicView => createView(cl, { id: 'v', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } })

/** Motion: `reduce`, `no-preference`, or `null` for a browser without `matchMedia`. */
function motion(pref: 'reduce' | 'no-preference' | null) {
  if (pref === null) return vi.stubGlobal('matchMedia', undefined)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === `(prefers-reduced-motion: ${pref})`, media: q, addEventListener() {}, removeEventListener() {} }))
}
/** requestAnimationFrame under the test's control: `run(ms)` plays the queued frames at that many ms from now. */
function frames() {
  let queue: FrameRequestCallback[] = []
  const raf = vi.fn((cb: FrameRequestCallback) => queue.push(cb))
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', () => (queue = []))
  const run = (ms: number) =>
    act(() => {
      const now = performance.now() + ms
      const q = queue
      queue = []
      q.forEach((cb) => cb(now))
    })
  return { raf, run, pending: () => queue.length }
}

beforeEach(() => motion('reduce'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const svgBox = (): ViewBox => {
  const [x, y, width, height] = document.querySelector('svg.ot-root')!.getAttribute('viewBox')!.split(' ').map(Number) as [number, number, number, number]
  return { x, y, width, height }
}
/** Each drawn SVG node's position, in layout units. */
const svgNodes = () =>
  [...document.querySelectorAll<SVGGElement>('svg.ot-root .ot-node[data-id]')].map((g) => {
    const [, x, y] = g.getAttribute('transform')!.match(/translate\(([-\d.e]+) ([-\d.e]+)\)/)!
    return { id: g.getAttribute('data-id')!, x: Number(x), y: Number(y), g }
  })
/** The margin `revealBox` keeps for this box: jsdom has no layout, so one unit is one pixel, capped at a quarter of the box. */
const marginOf = (b: ViewBox) => Math.min(REVEAL_MARGIN_PX, b.width / 4, b.height / 4) - 1e-6
const inside = (b: ViewBox, p: { x: number; y: number }, m = 0) => p.x >= b.x + m && p.x <= b.x + b.width - m && p.y >= b.y + m && p.y <= b.y + b.height - m
const itemFor = (label: string) => [...document.querySelectorAll('.ot-outline-label')].find((l) => l.textContent === label)!.closest<HTMLElement>('[role="treeitem"]')!
const labelOf = (id: string) => (cl.nameOf(id) ?? id)
const drawingArea = () => document.querySelector<HTMLElement>('.ot-canvas')!
const zoomIn = (times: number) => {
  for (let i = 0; i < times; i++) fireEvent.keyDown(drawingArea(), { key: '+' })
}
/** Selects a node from the outline with the keyboard, the way a keyboard user does: focus the item, press Space. */
const selectInOutline = (item: HTMLElement, shift = false) => {
  item.focus()
  fireEvent.keyDown(item, { key: ' ', shiftKey: shift })
}

describe('revealBox', () => {
  const box = { x: 0, y: 0, width: 400, height: 300 }
  const size = { width: 400, height: 300 }
  it('leaves a point that is on screen and clear of the margin alone', () => {
    expect(revealBox(box, [{ x: 200, y: 150 }], size)).toBeNull()
    expect(revealBox(box, [{ x: REVEAL_MARGIN_PX, y: REVEAL_MARGIN_PX }], size)).toBeNull()
  })
  it('pans the shortest way, to the margin, without zooming', () => {
    const r = revealBox(box, [{ x: 1000, y: 150 }], size)!
    expect(r.zoomed).toBe(false)
    expect(r.box).toEqual({ x: 1000 + REVEAL_MARGIN_PX - 400, y: 0, width: 400, height: 300 })
    // Inside the box but under the margin also pans, just far enough.
    expect(revealBox(box, [{ x: 10, y: 150 }], size)!.box.x).toBe(10 - REVEAL_MARGIN_PX)
  })
  it('counts the letterboxed area beside a narrower box as on screen, as SVG and the canvas draw it', () => {
    // A 400 × 300 box in an 800 × 300 drawing shows x from -200 to 600.
    expect(revealBox(box, [{ x: 550, y: 150 }], { width: 800, height: 300 })).toBeNull()
    expect(revealBox(box, [{ x: 590, y: 150 }], { width: 800, height: 300 })).not.toBeNull()
  })
  it('zooms out only as far as the points need, and never zooms in', () => {
    const r = revealBox(box, [{ x: 0, y: 150 }, { x: 1000, y: 150 }], size)!
    expect(r.zoomed).toBe(true)
    const k = 400 / r.box.width
    // Both points end exactly on the margin, in pixels.
    expect((0 - r.box.x) * k).toBeCloseTo(REVEAL_MARGIN_PX)
    expect((r.box.x + r.box.width - 1000) * k).toBeCloseTo(REVEAL_MARGIN_PX)
    expect(r.box.width / r.box.height).toBeCloseTo(400 / 300)
    expect(revealBox({ x: 0, y: 0, width: 4000, height: 3000 }, [{ x: 9000, y: 100 }], size)!.box.width).toBe(4000)
  })
})

describe('the SVG drawing follows the outline', () => {
  /** Zoomed in so most nodes are off screen; returns one off screen and one well inside. */
  function setup(zoom = 1) {
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    zoomIn(zoom)
    const b = svgBox()
    const nodes = svgNodes()
    const off = nodes.find((n) => !inside(b, n))!
    const on = nodes.find((n) => inside(b, n, REVEAL_MARGIN_PX + 1))!
    expect(off && on).toBeTruthy()
    return { b, off, on }
  }

  it('pans to a selected node that is off screen, and leaves the zoom alone', () => {
    const { b, off } = setup()
    selectInOutline(itemFor(labelOf(off.id)))
    const after = svgBox()
    expect(inside(after, off, marginOf(b))).toBe(true)
    expect(after.width).toBeCloseTo(b.width)
    expect(after.height).toBeCloseTo(b.height)
    // A plain pan announces nothing.
    expect(document.querySelector('.ot-reveal-status')!.textContent).toBe('')
  })

  it('does not move when the selected node is already on screen', () => {
    const { b, on } = setup()
    selectInOutline(itemFor(labelOf(on.id)))
    expect(svgBox()).toEqual(b)
    expect(screen.getByRole('region', { name: 'Details' }).querySelector('h3')?.textContent).toBe(labelOf(on.id))
  })

  it('keeps focus in the outline', () => {
    const { off } = setup()
    const item = itemFor(labelOf(off.id))
    selectInOutline(item)
    expect(document.activeElement).toBe(item)
    expect(item.getAttribute('aria-selected')).toBe('true')
  })

  it('does not move for a click in the drawing, even near its edge', () => {
    const { b } = setup()
    // A node inside the box but under the margin: the outline would pan to it, a click must not.
    const edge = svgNodes().find((n) => inside(b, n) && !inside(b, n, REVEAL_MARGIN_PX))!
    expect(edge).toBeTruthy()
    fireEvent.pointerDown(edge.g)
    fireEvent.pointerUp(edge.g)
    expect(screen.getByRole('region', { name: 'Details' }).querySelector('h3')?.textContent).toBe(labelOf(edge.id))
    expect(svgBox()).toEqual(b)
    // The same node chosen from the outline does pan.
    selectInOutline(itemFor(labelOf(edge.id)))
    expect(svgBox()).not.toEqual(b)
  })

  it('jumps without animating when reduced motion is asked for, or unknown', () => {
    const f = frames()
    const { off } = setup()
    selectInOutline(itemFor(labelOf(off.id)))
    expect(f.raf).not.toHaveBeenCalled()
    expect(inside(svgBox(), off, marginOf(svgBox()))).toBe(true)
    cleanup()
    motion(null)
    const s = setup()
    selectInOutline(itemFor(labelOf(s.off.id)))
    expect(f.raf).not.toHaveBeenCalled()
    expect(inside(svgBox(), s.off, marginOf(svgBox()))).toBe(true)
  })

  it('glides there over a few frames when motion is fine, with focus still in the outline', () => {
    motion('no-preference')
    const f = frames()
    const { b, off } = setup()
    const item = itemFor(labelOf(off.id))
    selectInOutline(item)
    expect(svgBox()).toEqual(b) // nothing has moved before the first frame
    f.run(100)
    const mid = svgBox()
    expect(mid).not.toEqual(b)
    expect(inside(mid, off, REVEAL_MARGIN_PX)).toBe(false)
    f.run(250)
    expect(inside(svgBox(), off, marginOf(svgBox()))).toBe(true)
    expect(f.pending()).toBe(0)
    expect(document.activeElement).toBe(item)
  })

  it('stops gliding when the person pans or zooms', () => {
    motion('no-preference')
    const f = frames()
    const { off } = setup()
    selectInOutline(itemFor(labelOf(off.id)))
    f.run(50)
    fireEvent.keyDown(drawingArea(), { key: '0' }) // fit
    expect(f.pending()).toBe(0)
  })

  it('zooms out just enough for a selection that cannot fit, and says so once', () => {
    const { b } = setup(3)
    const nodes = svgNodes()
    const far = [nodes[0]!, nodes.reduce((a, n) => (Math.hypot(n.x - nodes[0]!.x, n.y - nodes[0]!.y) > Math.hypot(a.x - nodes[0]!.x, a.y - nodes[0]!.y) ? n : a))]
    selectInOutline(itemFor(labelOf(far[0]!.id)))
    selectInOutline(itemFor(labelOf(far[1]!.id)), true)
    const after = svgBox()
    expect(after.width).toBeGreaterThan(b.width)
    for (const n of far) expect(inside(after, n, marginOf(b))).toBe(true)
    expect(document.querySelector('.ot-reveal-status')!.textContent).toBe('Zoomed out to show the selection.')
    expect(document.querySelector('.ot-reveal-status')!.getAttribute('role')).toBe('status')
  })
})

describe('the canvas drawing follows the outline', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  })
  const d: DatasetIndex = indexDataset(bigTree(600))
  const view = () => createView(d, { id: 'v', title: 'Made-up', target: { kind: 'phylogeny', id: 'big' } })
  const canvasEl = () => screen.getByRole('img', { name: 'Made-up tree' }) as HTMLCanvasElement
  const onScreen = (id: string, m = 0) => {
    const n = canvasPlanOf(canvasEl())!.nodes.find((x) => x.id === id)
    return Boolean(n && n.x >= m && n.x <= 800 - m && n.y >= m && n.y <= 600 - m)
  }
  const labelIn = (id: string) => projectView(d, view()).nodes.find((n) => n.id === id)!.label

  it('pans an off-screen selection into view, keeps focus in the outline, and leaves on-screen ones alone', () => {
    render(<Explorer dataset={d} initialView={view()} title="Made-up tree" />)
    expect(canvasEl().tagName).toBe('CANVAS')
    zoomIn(14)
    const tips = projectView(d, view()).nodes.filter((n) => n.isTip && n.label)
    const off = tips.find((n) => !onScreen(n.id))!
    expect(off).toBeTruthy()
    const item = itemFor(labelIn(off.id))
    selectInOutline(item)
    expect(onScreen(off.id, REVEAL_MARGIN_PX - 1)).toBe(true)
    expect(document.activeElement).toBe(item)
    expect(document.querySelector('.ot-reveal-status')!.textContent).toBe('')

    // Now on screen: choosing it again, or a neighbour well inside, doesn't move anything.
    const before = canvasPlanOf(canvasEl())!.nodes.map((n) => [n.id, n.x, n.y])
    const near = tips.find((n) => n.id !== off.id && onScreen(n.id, REVEAL_MARGIN_PX + 1))!
    selectInOutline(itemFor(labelIn(near.id)))
    expect(canvasPlanOf(canvasEl())!.nodes.map((n) => [n.id, n.x, n.y])).toEqual(before)
  })
})
