import type { Highlight, Id, NodeOverlay, ProjectedNode, Projection } from '@captiveorigins/onetaxonomy-core'
import type { LayoutEdge, LayoutNode, TreeLayout } from '@captiveorigins/onetaxonomy-layout'

import { shapeAt, shapePolygon, type MarkShape } from './shapes.js'

/**
 * Level of detail for the canvas renderer, kept pure so it can be tested and timed
 * without a browser. `prepareTree` indexes a projection and its layout once;
 * `planCanvas` decides, for one zoom and one canvas size, what is drawn: which nodes,
 * which labels, and which subtrees are too small to draw and become one wedge.
 * `drawPlan` paints a plan on any 2D context, and `hitTest` finds the node under a
 * point. Every decision to leave something out is counted, so the drawing can say
 * what it isn't showing (I13).
 */

export type ViewBox = { x: number; y: number; width: number; height: number }

/** Above this many drawn nodes, `renderer="auto"` draws on a canvas instead of SVG. */
export const CANVAS_THRESHOLD = 1000

export type Renderer = 'auto' | 'svg' | 'canvas'

/** Which renderer draws a layout: SVG up to `threshold` drawn nodes, canvas above, unless one is asked for. */
export function chooseRenderer(layout: TreeLayout, renderer: Renderer = 'auto', threshold: number = CANVAS_THRESHOLD): 'svg' | 'canvas' {
  if (renderer !== 'auto') return renderer
  return layout.nodes.length > threshold ? 'canvas' : 'svg'
}

/** The level-of-detail limits, in CSS pixels. */
export const LOD_DEFAULTS = {
  /** A name or support value is drawn only when its text would be at least this tall. */
  minLabelPx: 9,
  /** A subtree whose leaves would all fit in less than this (across the leaves) is drawn as one wedge. */
  mergeBelowPx: 1,
} as const

/** Sizes in layout units, the same as the SVG and its stylesheet. */
const SIZE = { label: 12, support: 10, axis: 11, leafDot: 3, innerDot: 2.5, halo: 7.5, trait: 5.5, badge: 7, labelReach: 220 }
/** Smallest sizes on screen for marks that carry meaning, in CSS pixels. */
const MIN_PX = { halo: 5, trait: 4, collapsed: 6, badge: 6, dot: 0.75 }
/** Text is measured by estimate (0.6 em per character), so the plan is the same in Node and in every browser. */
const CHAR_EM = 0.6

export type Transform = { k: number; tx: number; ty: number }

/** Layout units to CSS pixels, as SVG's default `xMidYMid meet` does for a viewBox. */
export function fitTransform(box: ViewBox, width: number, height: number): Transform {
  const k = Math.min(width / box.width, height / box.height)
  return { k, tx: (width - box.width * k) / 2 - box.x * k, ty: (height - box.height * k) / 2 - box.y * k }
}

/** The words drawn beside a node, the same as the SVG's: name, † and fossil age, and how many are folded away. */
export function nodeText(n: ProjectedNode, mark: NodeOverlay | undefined, hidden: (count: number) => string): string {
  const fossil = mark?.fossilAge ? ` ${mark.fossilAge.value}${mark.fossilAge.unit && mark.fossilAge.unit !== 'unspecified' ? ` ${mark.fossilAge.unit}` : ''}` : ''
  const name = `${n.label}${n.status === 'extinct' ? ` †${fossil}` : ''}`
  return n.collapsed && n.hiddenDescendants ? `${name} (${hidden(n.hiddenDescendants)})` : name
}

export const isItalicRank = (rank: string | undefined) => /^(genus|species|subspecies|variety|form)$/i.test(rank ?? '')

export type PreparedTree = {
  layout: TreeLayout
  /** Drawn nodes in preorder, so each subtree is the run `i` to `end[i]`. */
  nodes: ProjectedNode[]
  pos: LayoutNode[]
  edgeInto: (LayoutEdge | undefined)[]
  end: Int32Array
  leaves: Int32Array
  minX: Float64Array
  maxX: Float64Array
  minY: Float64Array
  maxY: Float64Array
  /** Radial layouts: the subtree's leaves span this many radians, out to this radius (for merging). */
  angleSpan: Float64Array
  outerRadius: Float64Array
  /** Everything the subtree draws, its edges included (a radial arc can bulge past its nodes): for culling. */
  drawBox: Float64Array
  /** A subtree holding a selected node is never merged, so the selection is always drawn. */
  hasSelected: Uint8Array
  /** Radial layouts: the leaves before and after each leaf in display order (-1 for none). */
  prevLeaf: Int32Array
  nextLeaf: Int32Array
}

/** Indexes a projection and its layout once; reuse the result while only the zoom changes. */
export function prepareTree(projection: Projection, layout: TreeLayout): PreparedTree {
  const byId = new Map(projection.nodes.map((n) => [n.id, n]))
  const at = new Map(layout.nodes.map((n) => [n.id, n]))
  const edgeOf = new Map(layout.edges.map((e) => [e.child, e]))
  const order: ProjectedNode[] = []
  const seen = new Set<Id>()
  const stack = [...projection.roots].reverse()
  while (stack.length) {
    const id = stack.pop()!
    const n = byId.get(id)
    if (!n || !at.has(id) || seen.has(id)) continue
    seen.add(id)
    order.push(n)
    const kids = n.collapsed ? [] : n.children
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  // Anything the layout drew that the walk didn't reach (it shouldn't happen) is still drawn.
  for (const ln of layout.nodes) if (!seen.has(ln.id) && byId.has(ln.id)) order.push(byId.get(ln.id)!)

  const count = order.length
  const index = new Map(order.map((n, i) => [n.id, i]))
  const pos = order.map((n) => at.get(n.id)!)
  const end = new Int32Array(count)
  const leaves = new Int32Array(count)
  const minX = new Float64Array(count)
  const maxX = new Float64Array(count)
  const minY = new Float64Array(count)
  const maxY = new Float64Array(count)
  const hasSelected = new Uint8Array(count)
  const drawBox = new Float64Array(count * 4) // x0, y0, x1, y1 per node
  const minA = new Float64Array(count).fill(Infinity)
  const maxA = new Float64Array(count).fill(-Infinity)
  const outerRadius = new Float64Array(count)
  const edgeInto = order.map((n) => edgeOf.get(n.id))
  for (let i = count - 1; i >= 0; i--) {
    const p = pos[i]!
    end[i] = i + 1
    minX[i] = maxX[i] = p.x
    minY[i] = maxY[i] = p.y
    leaves[i] = p.leaf ? 1 : 0
    hasSelected[i] = order[i]!.selected ? 1 : 0
    let x0 = p.x, y0 = p.y, x1 = p.x, y1 = p.y
    for (const q of edgeInto[i]?.points ?? []) {
      if (q.x < x0) x0 = q.x
      if (q.x > x1) x1 = q.x
      if (q.y < y0) y0 = q.y
      if (q.y > y1) y1 = q.y
    }
    drawBox.set([x0, y0, x1, y1], i * 4)
    if (p.leaf && p.angle !== undefined) minA[i] = maxA[i] = p.angle
    outerRadius[i] = Math.hypot(p.x, p.y)
  }
  for (let i = count - 1; i >= 0; i--) {
    const parent = order[i]!.parent
    const j = parent === null ? undefined : index.get(parent)
    if (j === undefined || j >= i) continue
    end[j] = Math.max(end[j]!, end[i]!)
    leaves[j]! += leaves[i]!
    minX[j] = Math.min(minX[j]!, minX[i]!)
    maxX[j] = Math.max(maxX[j]!, maxX[i]!)
    minY[j] = Math.min(minY[j]!, minY[i]!)
    maxY[j] = Math.max(maxY[j]!, maxY[i]!)
    hasSelected[j]! |= hasSelected[i]!
    drawBox[j * 4] = Math.min(drawBox[j * 4]!, drawBox[i * 4]!)
    drawBox[j * 4 + 1] = Math.min(drawBox[j * 4 + 1]!, drawBox[i * 4 + 1]!)
    drawBox[j * 4 + 2] = Math.max(drawBox[j * 4 + 2]!, drawBox[i * 4 + 2]!)
    drawBox[j * 4 + 3] = Math.max(drawBox[j * 4 + 3]!, drawBox[i * 4 + 3]!)
    minA[j] = Math.min(minA[j]!, minA[i]!)
    maxA[j] = Math.max(maxA[j]!, maxA[i]!)
    outerRadius[j] = Math.max(outerRadius[j]!, outerRadius[i]!)
  }
  const angleSpan = new Float64Array(count)
  for (let i = 0; i < count; i++) angleSpan[i] = maxA[i]! >= minA[i]! ? maxA[i]! - minA[i]! : 0
  const prevLeaf = new Int32Array(count).fill(-1)
  const nextLeaf = new Int32Array(count).fill(-1)
  let last = -1
  for (let i = 0; i < count; i++) {
    if (!pos[i]!.leaf) continue
    if (last >= 0) {
      prevLeaf[i] = last
      nextLeaf[last] = i
    }
    last = i
  }
  return { layout, nodes: order, pos, edgeInto, end, leaves, minX, maxX, minY, maxY, angleSpan, outerRadius, drawBox, hasSelected, prevLeaf, nextLeaf }
}

export type Box = { x0: number; y0: number; x1: number; y1: number }

export type PlannedLabel = { text: string; x: number; y: number; angle: number; align: 'start' | 'end'; px: number; italic: boolean; bold: boolean; box: Box }

export type PlannedNode = {
  id: Id
  /** Position on the canvas, in CSS pixels (after any drag offset). */
  x: number
  y: number
  leaf: boolean
  dot: number
  extinct: boolean
  collapsed: boolean
  selected: boolean
  dropTarget: boolean
  dragging: boolean
  /** A subtree too small to draw: the wedge's corners and how many drawn nodes it holds below this one. */
  merged?: { count: number; points: [number, number][] }
  halo?: { color: string; shape: MarkShape; r: number }
  trait?: { shape: MarkShape; color?: string; mixed: boolean; r: number }
  badge?: { text: string; r: number; px: number }
  support?: { text: string; weak: boolean; px: number; x: number; y: number }
  label?: PlannedLabel
}

export type PlannedEdge = { points: [number, number][]; weak: boolean; dragging: boolean }

export type LodCounts = {
  /** Nodes drawn on the canvas (wedges count as one). */
  drawn: number
  /** Nodes left out because they are outside the visible area (pan or zoom to see them). */
  outOfView: number
  /** Subtrees drawn as one wedge, and the nodes inside them that aren't drawn one by one. */
  merged: { subtrees: number; nodes: number }
  /** Names and support values in view that are too small or too crowded to draw. */
  labelsOmitted: number
  labelsShown: number
}

export type CanvasPlan = {
  width: number
  height: number
  transform: Transform
  nodes: PlannedNode[]
  edges: PlannedEdge[]
  axis?: { line: [number, number, number]; ticks: { x: number; text: string }[]; unit: { text: string; x: number; y: number }; px: number }
  dimOthers: boolean
  counts: LodCounts
}

export type PlanOptions = {
  box: ViewBox
  /** Canvas size in CSS pixels. */
  width: number
  height: number
  highlights?: readonly Highlight[]
  overlays?: ReadonlyMap<Id, NodeOverlay>
  traitShapes?: ReadonlyMap<Id, MarkShape>
  badges?: ReadonlyMap<Id, string>
  drag?: { ids: ReadonlySet<Id>; dx: number; dy: number } | null
  dropTarget?: Id | null
  hiddenLabel?: (count: number) => string
  /** Words beside a wedge: how many nodes it stands for. */
  mergedLabel?: (count: number) => string
  minLabelPx?: number
  mergeBelowPx?: number
}

const DEFAULT_HIDDEN = (n: number) => `+${n} not shown`
const DEFAULT_MERGED = (n: number) => `${n} too small to draw here`

/** What to draw at one zoom: see the module comment for the rules. */
export function planCanvas(t: PreparedTree, o: PlanOptions): CanvasPlan {
  const { layout } = t
  const radialLayout = layout.kind === 'radial'
  const tr = fitTransform(o.box, o.width, o.height)
  const { k } = tr
  const sx = (x: number) => x * k + tr.tx
  const sy = (y: number) => y * k + tr.ty
  const minLabelPx = o.minLabelPx ?? LOD_DEFAULTS.minLabelPx
  const mergeBelowPx = o.mergeBelowPx ?? LOD_DEFAULTS.mergeBelowPx
  const hidden = o.hiddenLabel ?? DEFAULT_HIDDEN
  const mergedText = o.mergedLabel ?? DEFAULT_MERGED
  const color = new Map((o.highlights ?? []).map((h) => [h.id, h.color]))
  const shape = new Map((o.highlights ?? []).map((h, i) => [h.id, shapeAt(i)]))
  const drag = o.drag
  const ddx = drag ? drag.dx * k : 0
  const ddy = drag ? drag.dy * k : 0
  const labelPx = SIZE.label * k
  const supportPx = SIZE.support * k
  // Room for labels beyond a node, so a node just off the left edge still gets its name drawn.
  const reach = Math.max(8, SIZE.labelReach * k)
  const inView = (x: number, y: number) => x >= -reach && x <= o.width + 8 && y >= -reach && y <= o.height + reach

  const nodes: PlannedNode[] = []
  const edges: PlannedEdge[] = []
  const candidates: { node: PlannedNode; label: PlannedLabel; priority: number; order: number; i: number }[] = []
  const counts: LodCounts = { drawn: 0, outOfView: 0, merged: { subtrees: 0, nodes: 0 }, labelsOmitted: 0, labelsShown: 0 }

  // Points closer than half a pixel to the last one kept add nothing on screen (long radial arcs zoomed out).
  const edgePoints = (e: LayoutEdge, moving: boolean): [number, number][] => {
    const out: [number, number][] = []
    const last = e.points.length - 1
    e.points.forEach((p, j) => {
      const q: [number, number] = [sx(p.x) + (moving ? ddx : 0), sy(p.y) + (moving ? ddy : 0)]
      const prev = out[out.length - 1]
      if (!prev || j === last || Math.abs(q[0] - prev[0]) + Math.abs(q[1] - prev[1]) >= 0.5) out.push(q)
    })
    return out
  }
  const edgeVisible = (pts: [number, number][]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of pts) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return x1 >= 0 && x0 <= o.width && y1 >= 0 && y0 <= o.height
  }

  const count = t.nodes.length
  for (let i = 0; i < count; ) {
    const n = t.nodes[i]!
    const p = t.pos[i]!
    const moving = Boolean(drag?.ids.has(n.id))
    const below = t.end[i]! - i - 1
    const e = t.edgeInto[i]
    // A subtree wholly outside the view (and not being dragged) is skipped in one step, after its own edge.
    const b = i * 4
    if (!drag && (sx(t.drawBox[b + 2]!) < -reach || sx(t.drawBox[b]!) > o.width + 8 || sy(t.drawBox[b + 3]!) < -reach || sy(t.drawBox[b + 1]!) > o.height + reach)) {
      counts.outOfView += below + 1
      i = t.end[i]!
      continue
    }
    if (e) {
      const pts = edgePoints(e, moving)
      if (edgeVisible(pts)) edges.push({ points: pts, weak: Boolean(o.overlays?.get(n.id)?.support?.weak), dragging: moving })
    }
    // Merge: a subtree with two or more leaves that would all sit within `mergeBelowPx`
    // across the leaves: vertically in rectangular layouts, along the outer circle in radial ones.
    const span = radialLayout ? t.angleSpan[i]! * t.outerRadius[i]! : t.maxY[i]! - t.minY[i]!
    const merge = !p.leaf && below > 0 && t.leaves[i]! >= 2 && span * k < mergeBelowPx && !t.hasSelected[i] && !(o.dropTarget && t.nodes.slice(i, t.end[i]).some((d) => d.id === o.dropTarget))
    const x = sx(p.x) + (moving ? ddx : 0)
    const y = sy(p.y) + (moving ? ddy : 0)
    const subtreeVisible = sx(t.maxX[i]!) >= -reach && sx(t.minX[i]!) <= o.width + 8 && sy(t.maxY[i]!) >= -reach && sy(t.minY[i]!) <= o.height + reach
    if (merge) {
      if (!subtreeVisible) {
        counts.outOfView += below + 1
        i = t.end[i]!
        continue
      }
      counts.merged.subtrees++
      counts.merged.nodes += below
      const ox = moving ? ddx : 0
      const oy = moving ? ddy : 0
      let points: [number, number][]
      if (radialLayout) {
        // From the node out to the subtree's first and last leaves.
        let first = -1, lastLeaf = -1
        for (let j = i; j < t.end[i]!; j++) if (t.pos[j]!.leaf) { if (first < 0) first = j; lastLeaf = j }
        points = [[x, y], [sx(t.pos[first]!.x) + ox, sy(t.pos[first]!.y) + oy], [sx(t.pos[lastLeaf]!.x) + ox, sy(t.pos[lastLeaf]!.y) + oy]]
      } else {
        const half = Math.max(0.5, ((t.maxY[i]! - t.minY[i]!) * k) / 2)
        const far = Math.max(sx(t.maxX[i]!) + ox, x + 1)
        const mid = (sy(t.minY[i]!) + sy(t.maxY[i]!)) / 2 + oy
        points = [[x, y], [far, mid - half], [far, mid + half]]
      }
      const node = baseNode(n, x, y, p.leaf, moving)
      node.merged = { count: below, points }
      // A highlight inside the wedge is still shown, on the wedge, in its shape.
      for (let j = i; j < t.end[i]!; j++) {
        const h = t.nodes[j]!.highlights.find((id) => color.get(id))
        if (h) {
          node.halo = { color: color.get(h)!, shape: shape.get(h)!, r: Math.max(MIN_PX.halo, SIZE.halo * k) }
          break
        }
      }
      if (o.badges?.has(n.id)) node.badge = { text: o.badges.get(n.id)!, r: Math.max(MIN_PX.badge, SIZE.badge * k), px: Math.max(minLabelPx, 9 * k) }
      nodes.push(node)
      counts.drawn++
      const text = [nodeText(n, o.overlays?.get(n.id), hidden), `(${mergedText(below)})`].filter(Boolean).join(' ')
      if (labelPx < minLabelPx) counts.labelsOmitted++
      else {
        const [lx, ly] = radialLayout ? points[1]! : [points[1]![0], (points[1]![1] + points[2]![1]) / 2]
        candidates.push({ node, label: makeLabel(text, lx + 4, ly + labelPx / 3, 0, 'start', labelPx, false, false), priority: 2, order: i, i })
      }
      i = t.end[i]!
      continue
    }
    if (!inView(x, y)) {
      counts.outOfView++
      i++
      continue
    }
    const node = baseNode(n, x, y, p.leaf, moving)
    const mark = o.overlays?.get(n.id)
    const first = n.highlights.find((h) => color.get(h))
    if (first) node.halo = { color: color.get(first)!, shape: shape.get(first)!, r: Math.max(MIN_PX.halo, SIZE.halo * k) }
    if (mark?.trait) {
      const mixed = mark.trait.state === 'mixed'
      node.trait = { shape: mixed ? 'circle' : (o.traitShapes?.get(mark.trait.state) ?? 'circle'), mixed, r: Math.max(MIN_PX.trait, SIZE.trait * k), ...('color' in mark.trait && mark.trait.color ? { color: mark.trait.color } : {}) }
    }
    if (o.badges?.has(n.id)) node.badge = { text: o.badges.get(n.id)!, r: Math.max(MIN_PX.badge, SIZE.badge * k), px: Math.max(minLabelPx, 9 * k) }
    if (mark?.support) {
      if (supportPx >= minLabelPx) {
        node.support = { text: String(mark.support.value), weak: mark.support.weak, px: supportPx, x: x - 5 * k, y: y - 5 * k }
        counts.labelsShown++
      } else counts.labelsOmitted++
    }
    nodes.push(node)
    counts.drawn++
    // Labels: leaves always, inner nodes in rectangular layouts (as the SVG draws them).
    const text = p.leaf || !radialLayout ? nodeText(n, mark, hidden) : ''
    if (text && labelPx < minLabelPx && !n.selected) counts.labelsOmitted++ // too small: no need to place it
    else if (text) {
      const px = n.selected ? Math.max(labelPx, minLabelPx) : labelPx
      const bold = n.selected || node.dropTarget
      const italic = isItalicRank(n.rank)
      let label: PlannedLabel
      if (radialLayout) {
        const angle = p.angle ?? 0
        const flip = Math.cos(angle) < 0
        const rot = -angle + (flip ? Math.PI : 0)
        // The label's start, 8 units out along the rotated x axis, 4 down along its y axis.
        const ax = x + Math.cos(rot) * (flip ? -8 : 8) * k - Math.sin(rot) * 4 * k
        const ay = y + Math.sin(rot) * (flip ? -8 : 8) * k + Math.cos(rot) * 4 * k
        label = makeLabel(text, ax, ay, rot, flip ? 'end' : 'start', px, italic, bold)
      } else {
        label = p.leaf ? makeLabel(text, x + 8 * k, y + 4 * k, 0, 'start', px, italic, bold) : makeLabel(text, x + 4 * k, y - 6 * k, 0, 'start', px, italic, bold)
      }
      const priority = n.selected ? 0 : node.dropTarget || first || n.collapsed ? 1 : p.leaf ? 3 : 4
      candidates.push({ node, label, priority, order: i, i })
    }
    i++
  }

  placeLabels(t, candidates, counts, { minLabelPx, radialLayout, k, width: o.width, height: o.height })

  let axis: CanvasPlan['axis']
  if (layout.axis) {
    const xs = layout.axis.ticks.map((tick) => tick.x)
    const ay = sy(layout.height + 16)
    const px = Math.max(SIZE.axis * k, minLabelPx)
    axis = {
      line: [sx(Math.min(...xs)), sx(Math.max(...xs)), ay],
      ticks: layout.axis.ticks.map((tick) => ({ x: sx(tick.x), text: String(tick.value) })),
      unit: { text: layout.axis.direction === 'before-present' ? `${layout.axis.unit} before present` : layout.axis.unit, x: sx(layout.width), y: sy(layout.height + 50) },
      px,
    }
  }
  return { width: o.width, height: o.height, transform: tr, nodes, edges, ...(axis ? { axis } : {}), dimOthers: Boolean(drag), counts }

  function baseNode(n: ProjectedNode, x: number, y: number, leaf: boolean, moving: boolean): PlannedNode {
    return {
      id: n.id,
      x,
      y,
      leaf,
      dot: (leaf ? SIZE.leafDot : SIZE.innerDot) * k,
      extinct: n.status === 'extinct',
      collapsed: n.collapsed,
      selected: n.selected,
      dropTarget: o.dropTarget === n.id,
      dragging: moving,
    }
  }
}

function makeLabel(text: string, x: number, y: number, angle: number, align: 'start' | 'end', px: number, italic: boolean, bold: boolean): PlannedLabel {
  const w = text.length * px * CHAR_EM
  // The box an unrotated label covers; rotated (radial) labels use the neighbour rule instead.
  const x0 = align === 'start' ? x : x - w
  return { text, x, y, angle, align, px, italic, bold, box: { x0, y0: y - px * 0.8, x1: x0 + w, y1: y + px * 0.25 } }
}

/**
 * Labels are placed in priority order: the selection, then highlighted, folded and
 * drop-target nodes, then wedges, then leaves, then inner nodes; in drawing order
 * within each. A label is left out when its text would be under `minLabelPx` (the
 * selection's never is: it is drawn at least that size), when it would overlap one
 * already placed, or, in radial layouts, when the next leaf is closer than the text
 * is tall.
 */
function placeLabels(t: PreparedTree, candidates: { node: PlannedNode; label: PlannedLabel; priority: number; order: number; i: number }[], counts: LodCounts, o: { minLabelPx: number; radialLayout: boolean; k: number; width: number; height: number }) {
  candidates.sort((a, b) => a.priority - b.priority || a.order - b.order)
  const cell = 48
  const grid = new Map<number, Box[]>()
  const key = (cx: number, cy: number) => cx * 1_000_003 + cy
  const cells = (b: Box, f: (k: number) => boolean | void) => {
    for (let cx = Math.floor(b.x0 / cell); cx <= Math.floor(b.x1 / cell); cx++)
      for (let cy = Math.floor(b.y0 / cell); cy <= Math.floor(b.y1 / cell); cy++) if (f(key(cx, cy)) === true) return true
    return false
  }
  const overlaps = (b: Box) => cells(b, (c) => grid.get(c)?.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0))
  for (const c of candidates) {
    const { label } = c
    const forced = c.priority === 0
    if (!forced) {
      if (label.px < o.minLabelPx) {
        counts.labelsOmitted++
        continue
      }
      const b = label.box
      if (b.x1 < 0 || b.x0 > o.width || b.y1 < 0 || b.y0 > o.height) continue // off screen: panned away, not left out
      if (o.radialLayout && t.pos[c.i]!.leaf) {
        const near = Math.min(gap(t, c.i, t.prevLeaf[c.i]!), gap(t, c.i, t.nextLeaf[c.i]!)) * o.k
        if (near < label.px * 0.9) {
          counts.labelsOmitted++
          continue
        }
      } else if (!o.radialLayout && overlaps(b)) {
        counts.labelsOmitted++
        continue
      }
    }
    c.node.label = label
    counts.labelsShown++
    if (!o.radialLayout)
      cells(label.box, (key) => {
        const list = grid.get(key)
        if (list) list.push(label.box)
        else grid.set(key, [label.box])
      })
  }
}

const gap = (t: PreparedTree, i: number, j: number) => (j < 0 ? Infinity : Math.hypot(t.pos[i]!.x - t.pos[j]!.x, t.pos[i]!.y - t.pos[j]!.y))

/**
 * The node under a point on the canvas (CSS pixels from its top-left): a label or a
 * wedge it is inside, or the nearest node within `tolerance` pixels. `null` when there
 * is none, so a click there clears nothing and pans as on the SVG's background.
 */
export function hitTest(plan: CanvasPlan, x: number, y: number, tolerance = 6): Id | null {
  let best: Id | null = null
  let bestD = Infinity
  for (const n of plan.nodes) {
    let d = Math.hypot(n.x - x, n.y - y)
    const reach = Math.max(tolerance, n.dot + 2, n.halo?.r ?? 0, n.collapsed ? MIN_PX.collapsed + 2 : 0)
    if (d > reach) d = Infinity
    if (n.merged) {
      // Wedges are often under a pixel tall and stacked: on or within a pixel of one, the nearest centre wins.
      const near = nearPolygon(n.merged.points, x, y)
      if (near.box <= 1) d = Math.min(d, near.box + near.centre * 0.001)
    }
    if (n.label && inside(n.label, x, y)) d = 0
    if (d < bestD || (d === bestD && d !== Infinity)) {
      best = n.id
      bestD = d
    }
  }
  return best
}

function inside(l: PlannedLabel, x: number, y: number) {
  if (!l.angle) return x >= l.box.x0 && x <= l.box.x1 && y >= l.box.y0 && y <= l.box.y1
  // Rotate the point into the label's frame.
  const c = Math.cos(-l.angle)
  const s = Math.sin(-l.angle)
  const dx = x - l.x
  const dy = y - l.y
  const rx = dx * c - dy * s
  const ry = dx * s + dy * c
  const w = l.text.length * l.px * CHAR_EM
  const x0 = l.align === 'start' ? 0 : -w
  return rx >= x0 && rx <= x0 + w && ry >= -l.px * 0.8 && ry <= l.px * 0.25
}

/** How far a point is from a wedge's bounding box (0 inside), and from its centre. */
function nearPolygon(pts: [number, number][], x: number, y: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0
  for (const [px, py] of pts) {
    x0 = Math.min(x0, px)
    x1 = Math.max(x1, px)
    y0 = Math.min(y0, py)
    y1 = Math.max(y1, py)
    cx += px / pts.length
    cy += py / pts.length
  }
  return { box: Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)), centre: Math.hypot(x - cx, y - cy) }
}

/**
 * One or two sentences on what the level of detail leaves out, or '' when nothing
 * is. Part of the canvas's accessible description and shown under it.
 */
export function describeLod(c: LodCounts, { outline = false }: { outline?: boolean } = {}): string {
  const parts: string[] = []
  if (c.merged.subtrees) parts.push(`${n(c.merged.subtrees)} ${c.merged.subtrees === 1 ? 'branch is' : 'branches are'} too small to draw at this zoom and ${c.merged.subtrees === 1 ? 'is' : 'are'} shown as ${c.merged.subtrees === 1 ? 'a wedge' : 'wedges'} holding ${n(c.merged.nodes)} ${c.merged.nodes === 1 ? 'node' : 'nodes'}.`)
  if (c.labelsOmitted) parts.push(`${n(c.labelsOmitted)} ${c.labelsOmitted === 1 ? 'name or value is' : 'names and values are'} too small or crowded to show.`)
  if (!parts.length) return ''
  parts.push(outline ? 'Zoom in to see them, or use the outline, which lists every taxon.' : 'Zoom in to see them.')
  return parts.join(' ')
}

const n = (v: number) => v.toLocaleString('en-US')

/** The colors the canvas paints with: the stylesheet's custom properties, read from the canvas. */
export type CanvasColors = { edge: string; node: string; text: string; selectedText: string; selected: string; muted: string; warning: string; surface: string; font: string; badgeText: string }

export const LIGHT_COLORS: CanvasColors = { edge: '#a08a83', node: '#4c312c', text: '#1d2330', selectedText: '#a65f20', selected: '#cf8137', muted: '#5b6577', warning: '#b45309', surface: '#ffffff', font: "system-ui, -apple-system, 'Segoe UI', sans-serif", badgeText: '#1d2330' }

export function readColors(el: Element | null): CanvasColors {
  if (!el || typeof getComputedStyle !== 'function') return LIGHT_COLORS
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    edge: v('--ot-edge', LIGHT_COLORS.edge),
    node: v('--ot-node', v('--ot-ink', LIGHT_COLORS.node)),
    text: v('--ot-text', LIGHT_COLORS.text),
    selectedText: v('--ot-selected-text', LIGHT_COLORS.selectedText),
    selected: v('--ot-selected', LIGHT_COLORS.selected),
    muted: v('--ot-muted', LIGHT_COLORS.muted),
    warning: v('--ot-warning', LIGHT_COLORS.warning),
    surface: v('--ot-surface', LIGHT_COLORS.surface),
    font: v('--ot-font', LIGHT_COLORS.font),
    badgeText: LIGHT_COLORS.badgeText,
  }
}

/** The parts of a 2D context the drawing uses, so tests can record calls. */
export type Context2D = Pick<
  CanvasRenderingContext2D,
  'save' | 'restore' | 'setTransform' | 'clearRect' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'arc' | 'fill' | 'stroke' | 'fillText' | 'translate' | 'rotate' | 'setLineDash'
> & { fillStyle: CanvasRenderingContext2D['fillStyle']; strokeStyle: CanvasRenderingContext2D['strokeStyle']; lineWidth: number; font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline; globalAlpha: number }

/**
 * Paints a plan. `scale` is the device pixel ratio (or more, for export), so the
 * drawing is sharp on high-density screens; the plan itself stays in CSS pixels.
 */
export function drawPlan(ctx: Context2D, plan: CanvasPlan, colors: CanvasColors, { scale = 1, background }: { scale?: number; background?: string } = {}) {
  const { k } = plan.transform
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, plan.width, plan.height)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, plan.width, plan.height)
  }
  const edgeWidth = Math.max(1, 1.5 * k)
  // Edges in at most four batched paths: plain, weak (dashed), and the same while dragging.
  for (const weak of [false, true]) {
    for (const dragging of [false, true]) {
      const batch = plan.edges.filter((e) => e.weak === weak && e.dragging === dragging)
      if (!batch.length) continue
      ctx.beginPath()
      for (const e of batch) {
        e.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      }
      ctx.setLineDash(dragging ? [4, 3] : weak ? [5, 4] : [])
      ctx.globalAlpha = plan.dimOthers && !dragging ? 0.5 : 1
      ctx.strokeStyle = colors.edge
      ctx.lineWidth = edgeWidth
      ctx.stroke()
    }
  }
  ctx.setLineDash([])
  ctx.globalAlpha = 1
  if (plan.axis) {
    const a = plan.axis
    ctx.strokeStyle = colors.muted
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(a.line[0], a.line[2])
    ctx.lineTo(a.line[1], a.line[2])
    for (const tick of a.ticks) {
      ctx.moveTo(tick.x, a.line[2])
      ctx.lineTo(tick.x, a.line[2] + 5 * k)
    }
    ctx.stroke()
    ctx.fillStyle = colors.muted
    ctx.font = `${a.px}px ${colors.font}`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'center'
    for (const tick of a.ticks) ctx.fillText(tick.text, tick.x, a.line[2] + 18 * k)
    ctx.textAlign = 'end'
    ctx.fillText(a.unit.text, a.unit.x, a.unit.y)
  }
  for (const n of plan.nodes) {
    if (n.halo) {
      shape(ctx, n.halo.shape, n.x, n.y, n.halo.r)
      ctx.globalAlpha = 0.35
      ctx.fillStyle = n.halo.color
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = n.halo.color
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    if (n.trait) {
      shape(ctx, n.trait.shape, n.x, n.y, n.trait.r)
      if (n.trait.mixed) {
        ctx.setLineDash([2, 2])
        ctx.strokeStyle = colors.muted
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.globalAlpha = 0.85
        ctx.fillStyle = n.trait.color ?? colors.muted
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = colors.node
        ctx.lineWidth = 0.75
        ctx.stroke()
      }
    }
    if (n.merged) {
      // A wedge: the edge color, outlined in the node color, so it reads as "more here".
      ctx.beginPath()
      n.merged.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = colors.edge
      ctx.fill()
      ctx.strokeStyle = colors.node
      ctx.lineWidth = 1
      ctx.stroke()
    } else if (n.collapsed) {
      const s = Math.max(MIN_PX.collapsed, 12 * k)
      ctx.beginPath()
      ctx.moveTo(n.x, n.y)
      ctx.lineTo(n.x + s, n.y - s / 2)
      ctx.lineTo(n.x + s, n.y + s / 2)
      ctx.closePath()
      ctx.fillStyle = colors.node
      ctx.fill()
    } else if (n.dropTarget) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, Math.max(8 * k, 4), 0, Math.PI * 2)
      ctx.fillStyle = colors.selected
      ctx.fill()
    } else if (n.dot >= MIN_PX.dot) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.dot, 0, Math.PI * 2)
      if (n.extinct) {
        ctx.strokeStyle = colors.node
        ctx.lineWidth = 1
        ctx.stroke()
      } else {
        ctx.fillStyle = colors.node
        ctx.fill()
      }
    }
    if (n.badge) {
      const bx = n.x - Math.max(12 * k, n.badge.r)
      const by = n.y - Math.max(12 * k, n.badge.r)
      ctx.beginPath()
      ctx.arc(bx, by, n.badge.r, 0, Math.PI * 2)
      ctx.fillStyle = colors.selected
      ctx.fill()
      ctx.fillStyle = colors.badgeText
      ctx.font = `700 ${n.badge.px}px ${colors.font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(n.badge.text, bx, by)
    }
    if (n.support) {
      ctx.fillStyle = n.support.weak ? colors.warning : colors.muted
      ctx.font = `${n.support.px}px ${colors.font}`
      ctx.textAlign = 'end'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(n.support.text, n.support.x, n.support.y)
    }
    if (n.label) {
      const l = n.label
      ctx.fillStyle = l.bold ? colors.selectedText : colors.text
      ctx.font = `${l.italic ? 'italic ' : ''}${l.bold ? '600 ' : ''}${l.px}px ${colors.font}`
      ctx.textAlign = l.align
      ctx.textBaseline = 'alphabetic'
      if (l.angle) {
        ctx.save()
        ctx.translate(l.x, l.y)
        ctx.rotate(l.angle)
        ctx.fillText(l.text, 0, 0)
        ctx.restore()
      } else ctx.fillText(l.text, l.x, l.y)
    }
  }
}

function shape(ctx: Context2D, s: MarkShape, x: number, y: number, r: number) {
  ctx.beginPath()
  const pts = shapePolygon(s, r)
  if (!pts) {
    ctx.arc(x, y, r, 0, Math.PI * 2)
    return
  }
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)))
  ctx.closePath()
}
