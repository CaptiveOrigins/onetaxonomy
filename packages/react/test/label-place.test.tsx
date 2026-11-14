// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createView, indexDataset, projectView, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import { rectangular, type TreeLayout } from '@extantape/onetaxonomy-layout'
import { innerLabelAt, leafLabelX, planCanvas, prepareTree, TreeView } from '../src'
import amniotesJson from '../../../fixtures/amniotes.json'
import checklistJson from '../../../fixtures/checklist.json'

/** A 12-unit name covers this band around its baseline; a branch inside it strikes the name out. */
const band = (y: number) => ({ top: y - 10, bottom: y + 3 })
const strikes = (y: number, rows: number[]) => rows.some((row) => row > band(y).top && row < band(y).bottom)

describe('where an inner node\'s name goes', () => {
  it('sits on the node\'s own row when no child branch leaves there', () => {
    // Two or four children one row (24 units) apart: the node is midway between two rows.
    expect(innerLabelAt([-12, 12])).toEqual({ x: 8, y: 4 })
    expect(innerLabelAt([-36, -12, 12, 36])).toEqual({ x: 8, y: 4 })
    expect(innerLabelAt([])).toEqual({ x: 8, y: 4 })
  })

  it('sits just above the row when a child branch leaves on it', () => {
    expect(innerLabelAt([0])).toEqual({ x: 4, y: -6 })
    expect(innerLabelAt([-24, 0, 24])).toEqual({ x: 4, y: -6 })
  })

  it('goes below when the row and the space above are both taken', () => {
    expect(innerLabelAt([-48, -6, 48])).toEqual({ x: 4, y: 15 })
  })

  it('is never struck through at the default row spacing, however the children fall', () => {
    for (const rows of [[-12, 12], [0], [-24, 0, 24], [-36, -12, 12, 36], [-48, -6, 48], [-60, 60], [-18, 18], [-30, 6, 30], [-30, -6, 30]]) {
      expect(strikes(innerLabelAt(rows).y, rows), JSON.stringify(rows)).toBe(false)
    }
  })

  it('takes the spot with the most room when rows are too close for any of them', () => {
    // Rows 8 apart: nothing is clear by 2 units, and the node's own row has the most room.
    expect(innerLabelAt([-8, 8])).toEqual({ x: 8, y: 4 })
    // Rows 5 apart: every spot is crossed, and one is still chosen, the same one every time.
    expect(innerLabelAt([-10, -5, 0, 5, 10])).toEqual(innerLabelAt([-10, -5, 0, 5, 10]))
  })
})

const data = indexDataset(amniotesJson as DatasetSnapshot)
const classes = projectView(data, createView(data, { id: 'v', title: 'Classes', target: { kind: 'classification', id: 'traditional' } }))

/** Each inner node's children's rows, measured from the node. */
function childRows(layout: TreeLayout) {
  const y = new Map(layout.nodes.map((n) => [n.id, n.y]))
  const rows = new Map<string, number[]>()
  for (const e of layout.edges) rows.set(e.parent, [...(rows.get(e.parent) ?? []), y.get(e.child)! - y.get(e.parent)!])
  return rows
}

describe('the drawing', () => {
  const layout = rectangular(classes)
  const reptilia = layout.nodes.find((n) => n.id === 'c:reptilia')!
  const rows = childRows(layout).get('c:reptilia')!

  it('has the case that was struck through: Reptilia midway between two of its four children\'s rows', () => {
    expect(reptilia.leaf).toBe(false)
    expect(rows).toEqual([-36, -12, 12, 36])
    // Where the name used to be drawn, 6 units above the node, the branch 12 units up ran through it.
    expect(strikes(-6, rows)).toBe(true)
  })

  it('SVG: no inner node\'s name is crossed by a branch to one of its children', () => {
    const svg = new DOMParser().parseFromString(renderToStaticMarkup(<TreeView projection={classes} layout={layout} title="Classes" />), 'image/svg+xml')
    const all = childRows(layout)
    let inner = 0
    for (const g of svg.querySelectorAll('.ot-node:not([data-leaf])')) {
      const label = g.querySelector('.ot-label')
      if (!label) continue
      inner += 1
      expect(strikes(Number(label.getAttribute('y')), all.get(g.getAttribute('data-id')!) ?? []), g.getAttribute('data-id')!).toBe(false)
    }
    expect(inner).toBeGreaterThan(0)
    const name = svg.querySelector('.ot-node[data-id="c:reptilia"] .ot-label')!
    expect([name.getAttribute('x'), name.getAttribute('y')]).toEqual(['8', '4'])
  })

  it('SVG: a leaf\'s name stays where it was', () => {
    const svg = new DOMParser().parseFromString(renderToStaticMarkup(<TreeView projection={classes} layout={layout} title="Classes" />), 'image/svg+xml')
    const name = svg.querySelector('.ot-node[data-id="c:aves"] .ot-label')!
    expect([name.getAttribute('x'), name.getAttribute('y')]).toEqual(['8', '4'])
  })

  it('canvas: the name is in the same place as in the SVG, at any zoom', () => {
    for (const k of [1, 2]) {
      const plan = planCanvas(prepareTree(classes, layout), { box: { x: -20, y: -60, width: 800 / k, height: 600 / k }, width: 800, height: 600 })
      const node = plan.nodes.find((n) => n.id === 'c:reptilia')!
      expect(node.label).toBeDefined()
      expect(node.label!.x - node.x).toBeCloseTo(8 * k)
      expect(node.label!.y - node.y).toBeCloseTo(4 * k)
    }
  })

  it('canvas and SVG agree on every inner node of a larger tree', () => {
    const cl = indexDataset(checklistJson as DatasetSnapshot)
    const p = projectView(cl, createView(cl, { id: 'v', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } }))
    const l = rectangular(p)
    const svg = new DOMParser().parseFromString(renderToStaticMarkup(<TreeView projection={p} layout={l} title="Checklist" />), 'image/svg+xml')
    const plan = planCanvas(prepareTree(p, l), { box: { x: -20, y: -20, width: 1600, height: 1200 }, width: 1600, height: 1200 })
    let compared = 0
    for (const g of svg.querySelectorAll('.ot-node:not([data-leaf])')) {
      const label = g.querySelector('.ot-label')
      const node = plan.nodes.find((n) => n.id === g.getAttribute('data-id'))
      if (!label || !node?.label) continue
      compared += 1
      expect(node.label.x - node.x).toBeCloseTo(Number(label.getAttribute('x')))
      expect(node.label.y - node.y).toBeCloseTo(Number(label.getAttribute('y')))
    }
    expect(compared).toBeGreaterThan(0)
  })
})

describe('a folded branch', () => {
  const cl = indexDataset(checklistJson as DatasetSnapshot)
  const folded = projectView(cl, { ...createView(cl, { id: 'v', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } }), collapsed: ['fx:2'] })
  const layout = rectangular(folded)
  const svg = () => new DOMParser().parseFromString(renderToStaticMarkup(<TreeView projection={folded} layout={layout} title="Checklist" />), 'image/svg+xml')

  it('SVG: the name starts past the triangle, not on top of it', () => {
    const g = svg().querySelector('.ot-node[data-id="fx:2"]')!
    // The triangle's far edge, read from its path: "M0 0 L12 -6 L12 6 Z".
    const edge = Math.max(...[...g.querySelector('.ot-node-collapsed')!.getAttribute('d')!.matchAll(/[ML](-?[\d.]+) /g)].map((m) => Number(m[1])))
    expect(edge).toBe(12)
    const x = Number(g.querySelector('.ot-label')!.getAttribute('x'))
    expect(x).toBe(leafLabelX(true))
    expect(x).toBeGreaterThanOrEqual(edge + 4)
  })

  it('SVG: an open leaf\'s name still starts 8 units out', () => {
    expect(leafLabelX(false)).toBe(8)
    const open = [...svg().querySelectorAll('.ot-node[data-leaf]:not([data-collapsed]) .ot-label')]
    expect(open.length).toBeGreaterThan(0)
    for (const label of open) expect(label.getAttribute('x')).toBe('8')
  })

  it('canvas: the name starts past the triangle at any zoom, including when the triangle is held at its smallest size', () => {
    // At 0.25 pixels a unit the triangle would be 3 px wide and is drawn 6 px wide instead.
    for (const k of [0.25, 1, 2]) {
      const plan = planCanvas(prepareTree(folded, layout), { box: { x: -20, y: -20, width: 800 / k, height: 600 / k }, width: 800, height: 600, minLabelPx: 1 })
      const node = plan.nodes.find((n) => n.id === 'fx:2')!
      expect(node.collapsed).toBe(true)
      expect(node.label, `k=${k}`).toBeDefined()
      const triangle = Math.max(6, 12 * k)
      expect(node.label!.x - node.x).toBeCloseTo(triangle + 4 * k)
    }
  })
})
