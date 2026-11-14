import type { Id, TraitSet } from '@extantape/onetaxonomy-core'

/**
 * Shapes that tell highlights and trait states apart without color (WCAG 1.4.1). The
 * drawing and the legend use the same shape for the same thing, so a reader who can't
 * tell the colors apart can still match them. There are twelve, chosen to differ in
 * outline at 10 to 15 px (no pentagon or octagon, which look like circles that small).
 * After twelve they repeat, and the words in the legend and inspector tell them apart.
 */
export type MarkShape =
  | 'circle' | 'square' | 'diamond' | 'triangle' | 'triangle-down' | 'hexagon'
  | 'star' | 'plus' | 'cross' | 'triangle-left' | 'triangle-right' | 'hourglass'
export const MARK_SHAPES: readonly MarkShape[] = [
  'circle', 'square', 'diamond', 'triangle', 'triangle-down', 'hexagon',
  'star', 'plus', 'cross', 'triangle-left', 'triangle-right', 'hourglass',
]

export const shapeAt = (i: number): MarkShape => MARK_SHAPES[((i % MARK_SHAPES.length) + MARK_SHAPES.length) % MARK_SHAPES.length]!

const f = (n: number) => Number(n.toFixed(2))
const poly = (points: [number, number][]) => `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z`

/**
 * The corners of a shape centred on 0,0, about `r` from the centre, with roughly equal
 * areas; `null` for the circle. The SVG path and the canvas drawing both come from
 * these points, so the two renderers draw the same shapes.
 */
export function shapePolygon(shape: MarkShape, r: number): [number, number][] | null {
  switch (shape) {
    case 'square': {
      const s = r * 0.89
      return [[-s, -s], [s, -s], [s, s], [-s, s]]
    }
    case 'diamond': {
      const s = r * 1.2
      return [[0, -s], [s, 0], [0, s], [-s, 0]]
    }
    case 'triangle': {
      const s = r * 1.3
      return [[0, -s], [s * 0.95, s * 0.7], [-s * 0.95, s * 0.7]]
    }
    case 'triangle-down': {
      const s = r * 1.3
      return [[0, s], [s * 0.95, -s * 0.7], [-s * 0.95, -s * 0.7]]
    }
    case 'triangle-left': {
      const s = r * 1.3
      return [[-s, 0], [s * 0.7, -s * 0.95], [s * 0.7, s * 0.95]]
    }
    case 'triangle-right': {
      const s = r * 1.3
      return [[s, 0], [-s * 0.7, -s * 0.95], [-s * 0.7, s * 0.95]]
    }
    case 'hourglass': {
      const s = r * 1.05
      return [[-s, -s], [s, -s], [0, 0], [s, s], [-s, s], [0, 0]]
    }
    case 'star': {
      const outer = r * 1.4
      const inner = outer * 0.45
      return Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (Math.PI / 5) * i
        const d = i % 2 ? inner : outer
        return [d * Math.cos(a), d * Math.sin(a)] as [number, number]
      })
    }
    case 'plus': {
      const s = r * 1.15
      const w = s * 0.38
      return [[-w, -s], [w, -s], [w, -w], [s, -w], [s, w], [w, w], [w, s], [-w, s], [-w, w], [-s, w], [-s, -w], [-w, -w]]
    }
    case 'cross': {
      // The plus turned 45 degrees.
      const s = r * 1.15
      const w = s * 0.38
      const c = Math.SQRT1_2
      const turn = ([x, y]: [number, number]): [number, number] => [(x - y) * c, (x + y) * c]
      return ([[-w, -s], [w, -s], [w, -w], [s, -w], [s, w], [w, w], [w, s], [-w, s], [-w, w], [-s, w], [-s, -w], [-w, -w]] as [number, number][]).map(turn)
    }
    case 'hexagon':
      return Array.from({ length: 6 }, (_, i) => [r * 1.05 * Math.cos((Math.PI / 3) * i), r * 1.05 * Math.sin((Math.PI / 3) * i)] as [number, number])
    default:
      return null
  }
}

/** An SVG path for a shape centred on 0,0, about `r` from the centre, with roughly equal areas. */
export function shapePath(shape: MarkShape, r: number): string {
  const points = shapePolygon(shape, r)
  return points ? poly(points) : `M${f(-r)} 0 a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0 a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0 Z`
}

/** The shape for each state of a trait set, in the set's order. */
export const traitShapes = (trait: TraitSet | undefined): Map<Id, MarkShape> => new Map((trait?.states ?? []).map((s, i) => [s.id, shapeAt(i)]))

/** A legend swatch: the shape, in the color, decorative (the words beside it carry the meaning). */
export function ShapeSwatch({ shape, color, kind }: { shape: MarkShape; color?: string | undefined; kind?: 'mixed' | 'none' }) {
  return (
    <svg className="ot-swatch-shape" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true" focusable="false" data-shape={shape} data-trait={kind}>
      <path d={shapePath(shape, 5)} style={color ? { fill: color } : undefined} />
    </svg>
  )
}
