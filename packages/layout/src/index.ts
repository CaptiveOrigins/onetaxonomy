import { TIME_UNITS, type Id, type Projection, type ProjectedNode } from '@captiveorigins/onetaxonomy-core'

/**
 * Tree layouts as plain coordinates (M4). Pure and deterministic: the same
 * projection always gives the same numbers, so renderers (SVG, Canvas, PDF, a
 * desktop app) draw identical pictures. Every result says what kind of diagram it
 * is, so a classification is never presented as a phylogeny (invariant I2), and
 * lengths or dates are only drawn when the data has them (I9).
 */
export type Point = { x: number; y: number }

export type LayoutNode = Point & {
  id: Id
  /** Leaf of the drawing (a data tip, or a collapsed node). */
  leaf: boolean
  /** Radial layouts: angle in radians (0 = right, counter-clockwise), for label rotation. */
  angle?: number
}

export type LayoutEdge = { parent: Id; child: Id; points: Point[] }

export type Axis = { unit: string; direction: 'from-root' | 'before-present'; ticks: { value: number; x: number }[] }

export type TreeLayout = {
  kind: 'rectangular' | 'phylogram' | 'time' | 'radial'
  /** What the drawing shows: placement under an authority, or a hypothesis of descent. */
  diagram: 'classification' | 'phylogeny'
  /** One sentence for the legend (I2). */
  notice: string
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
  axis?: Axis
}

export type RectangularOptions = {
  /** Vertical distance between leaves. */
  leafGap?: number
  /** Horizontal distance between levels (cladogram). */
  levelGap?: number
  /** Width of the tree area for phylogram/time layouts. */
  width?: number
  /** `cladogram` (equal levels), `phylogram` (branch lengths), `time` (ages before present). */
  scale?: 'cladogram' | 'phylogram' | 'time'
  /** Leaves aligned at the right edge (cladograms only). */
  alignLeaves?: boolean
}

export class LayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayoutError'
  }
}

const NOTICE = {
  classification: 'Classification: nesting shows where a source places each taxon, not common ancestry.',
  phylogeny: 'Phylogenetic hypothesis: branching shows proposed common ancestry, relative to this hypothesis only.',
  unrooted: 'Unrooted hypothesis: drawn from an arbitrary node; the drawing does not show ancestry.',
}

const noticeOf = (p: Projection) => (p.kind === 'classification' ? NOTICE.classification : p.rooted === false ? NOTICE.unrooted : NOTICE.phylogeny)

function index(p: Projection) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const kids = (n: ProjectedNode) => (n.collapsed ? [] : n.children)
  // Leaf order: preorder over visible children (display order).
  const leaves: Id[] = []
  for (const n of p.nodes) if (kids(n).length === 0) leaves.push(n.id)
  return { byId, kids, leaves }
}

/** y for every node: leaves evenly spaced, parents midway between their first and last child. */
function verticals(p: Projection, leafGap: number) {
  const { byId, kids, leaves } = index(p)
  const y = new Map<Id, number>()
  leaves.forEach((id, i) => y.set(id, i * leafGap))
  for (let i = p.nodes.length - 1; i >= 0; i--) {
    const n = p.nodes[i]!
    const ch = kids(n)
    if (ch.length) y.set(n.id, (y.get(ch[0]!)! + y.get(ch.at(-1)!)!) / 2)
  }
  return { y, byId, kids, leaves }
}

function niceTicks(max: number, count = 5): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const out: number[] = []
  for (let v = 0; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

/**
 * Rectangular (elbow) layout, root at the left. `phylogram` needs branch lengths
 * with a stated unit; `time` needs a time-calibrated hypothesis in a time unit.
 */
export function rectangular(p: Projection, o: RectangularOptions = {}): TreeLayout {
  const { leafGap = 24, levelGap = 120, scale = 'cladogram', alignLeaves = false } = o
  if (scale !== 'cladogram') {
    if (p.kind === 'classification') throw new LayoutError('A classification has no branch lengths or ages')
    if (!p.lengthUnit || p.lengthUnit === 'unspecified') throw new LayoutError('Branch lengths have no stated unit: a phylogram would invent them')
    if (scale === 'time' && (!p.timeCalibrated || !TIME_UNITS.includes(p.lengthUnit))) throw new LayoutError('Not time-calibrated in a time unit: a time scale would invent dates')
    const missing = p.nodes.filter((n) => n.parent !== null && n.length === undefined)
    if (missing.length) throw new LayoutError(`${missing.length} branch(es) have no length: draw a cladogram instead`)
  }
  const { y, byId, kids } = verticals(p, leafGap)

  // x: depth (cladogram) or cumulative length from the root (phylogram/time).
  const dist = new Map<Id, number>()
  for (const n of p.nodes) dist.set(n.id, n.parent === null ? 0 : dist.get(n.parent)! + (scale === 'cladogram' ? 1 : n.length!))
  const maxDepth = Math.max(0, ...dist.values())
  let x: (id: Id) => number
  let axis: Axis | undefined
  if (scale === 'cladogram') {
    x = (id) => {
      const n = byId.get(id)!
      return (alignLeaves && kids(n).length === 0 ? maxDepth : dist.get(id)!) * levelGap
    }
  } else {
    const width = o.width ?? 600
    const k = maxDepth > 0 ? width / maxDepth : 0
    x = (id) => dist.get(id)! * k
    axis =
      scale === 'time'
        ? { unit: p.lengthUnit!, direction: 'before-present', ticks: niceTicks(maxDepth).map((v) => ({ value: v, x: (maxDepth - v) * k })) }
        : { unit: p.lengthUnit!, direction: 'from-root', ticks: niceTicks(maxDepth).map((v) => ({ value: v, x: v * k })) }
  }

  const nodes: LayoutNode[] = p.nodes.map((n) => ({ id: n.id, x: x(n.id), y: y.get(n.id)!, leaf: kids(n).length === 0 }))
  const pos = new Map(nodes.map((n) => [n.id, n]))
  const edges: LayoutEdge[] = p.nodes
    .filter((n) => n.parent !== null && pos.has(n.parent))
    .map((n) => {
      const a = pos.get(n.parent!)!
      const b = pos.get(n.id)!
      return { parent: n.parent!, child: n.id, points: [{ x: a.x, y: a.y }, { x: a.x, y: b.y }, { x: b.x, y: b.y }] }
    })
  return {
    kind: scale === 'cladogram' ? 'rectangular' : scale,
    diagram: p.kind,
    notice: noticeOf(p),
    nodes,
    edges,
    width: Math.max(0, ...nodes.map((n) => n.x)),
    height: Math.max(0, ...nodes.map((n) => n.y)),
    ...(axis ? { axis } : {}),
  }
}

/** Radial cladogram: leaves around a circle in display order, depth as radius. */
export function radial(p: Projection, { radiusStep = 80, startAngle = 0, span = 2 * Math.PI }: { radiusStep?: number; startAngle?: number; span?: number } = {}): TreeLayout {
  const { byId, kids, leaves } = index(p)
  const angle = new Map<Id, number>()
  const full = Math.abs(span - 2 * Math.PI) < 1e-9
  const step = leaves.length > 1 ? span / (full ? leaves.length : leaves.length - 1) : 0
  leaves.forEach((id, i) => angle.set(id, startAngle + i * step))
  for (let i = p.nodes.length - 1; i >= 0; i--) {
    const n = p.nodes[i]!
    const ch = kids(n)
    if (ch.length) angle.set(n.id, (angle.get(ch[0]!)! + angle.get(ch.at(-1)!)!) / 2)
  }
  const depth = new Map<Id, number>()
  for (const n of p.nodes) depth.set(n.id, n.parent === null ? 0 : depth.get(n.parent)! + 1)
  const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0 // + 0 turns -0 into 0
  const at = (id: Id, r = depth.get(id)! * radiusStep, a = angle.get(id)!) => ({ x: round(r * Math.cos(a)), y: round(-r * Math.sin(a)) })
  const nodes: LayoutNode[] = p.nodes.map((n) => ({ id: n.id, ...at(n.id), leaf: kids(n).length === 0, angle: angle.get(n.id)! }))
  const edges: LayoutEdge[] = p.nodes
    .filter((n) => n.parent !== null && byId.has(n.parent))
    .map((n) => {
      const r = depth.get(n.parent!)! * radiusStep
      // Arc at the parent's radius from the parent's angle to the child's, then out to the child.
      const a0 = angle.get(n.parent!)!
      const a1 = angle.get(n.id)!
      const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 36)))
      const arc = Array.from({ length: steps + 1 }, (_, i) => at(n.parent!, r, a0 + ((a1 - a0) * i) / steps))
      return { parent: n.parent!, child: n.id, points: [...arc, at(n.id)] }
    })
  const extent = Math.max(0, ...depth.values()) * radiusStep
  return { kind: 'radial', diagram: p.kind, notice: noticeOf(p), nodes, edges, width: extent * 2, height: extent * 2 }
}

export type SunburstArc = { id: Id; depth: number; startAngle: number; endAngle: number; innerRadius: number; outerRadius: number }

/**
 * Sunburst for classifications only: rings are nesting levels, angles are
 * proportional to the number of visible leaves (not to species counts in nature).
 */
export function sunburst(p: Projection, { ringWidth = 60, innerRadius = 40 }: { ringWidth?: number; innerRadius?: number } = {}): { diagram: 'classification'; notice: string; arcs: SunburstArc[]; radius: number } {
  if (p.kind !== 'classification') throw new LayoutError('Sunburst is for classifications (nested ranks), not phylogenies')
  const { byId, kids } = index(p)
  const leafCount = new Map<Id, number>()
  for (let i = p.nodes.length - 1; i >= 0; i--) {
    const n = p.nodes[i]!
    const ch = kids(n)
    leafCount.set(n.id, ch.length ? ch.reduce((s, c) => s + leafCount.get(c)!, 0) : 1)
  }
  const total = p.roots.reduce((s, r) => s + (leafCount.get(r) ?? 0), 0) || 1
  const arcs: SunburstArc[] = []
  const place = (id: Id, start: number, depth: number) => {
    const sweep = (leafCount.get(id)! / total) * 2 * Math.PI
    arcs.push({ id, depth, startAngle: start, endAngle: start + sweep, innerRadius: innerRadius + depth * ringWidth, outerRadius: innerRadius + (depth + 1) * ringWidth })
    let s = start
    for (const c of kids(byId.get(id)!)) {
      place(c, s, depth + 1)
      s += (leafCount.get(c)! / total) * 2 * Math.PI
    }
  }
  // Recursion depth = tree depth (ranks), which is small for classifications.
  let s = 0
  for (const r of p.roots) {
    place(r, s, 0)
    s += (leafCount.get(r)! / total) * 2 * Math.PI
  }
  const maxDepth = Math.max(0, ...arcs.map((a) => a.depth))
  return { diagram: 'classification', notice: `${NOTICE.classification} Angles show visible leaves, not numbers of species.`, arcs, radius: innerRadius + (maxDepth + 1) * ringWidth }
}

/** An SVG path string for an edge (convenience for SVG renderers). */
export const edgePath = (e: LayoutEdge) => e.points.map((pt, i) => `${i ? 'L' : 'M'}${pt.x} ${pt.y}`).join(' ')
