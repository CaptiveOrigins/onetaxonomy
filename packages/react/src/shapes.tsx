import type { Id, TraitSet } from '@captiveorigins/onetaxonomy-core'

/**
 * Shapes that tell highlights and trait states apart without color (WCAG 1.4.1). The
 * drawing and the legend use the same shape for the same thing, so a reader who can't
 * tell the colors apart can still match them. After six they repeat.
 */
export type MarkShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'triangle-down' | 'hexagon'
export const MARK_SHAPES: readonly MarkShape[] = ['circle', 'square', 'diamond', 'triangle', 'triangle-down', 'hexagon']

export const shapeAt = (i: number): MarkShape => MARK_SHAPES[((i % MARK_SHAPES.length) + MARK_SHAPES.length) % MARK_SHAPES.length]!

const f = (n: number) => Number(n.toFixed(2))
const poly = (points: [number, number][]) => `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z`

/** An SVG path for a shape centred on 0,0, about `r` from the centre, with roughly equal areas. */
export function shapePath(shape: MarkShape, r: number): string {
  switch (shape) {
    case 'square': {
      const s = r * 0.89
      return poly([[-s, -s], [s, -s], [s, s], [-s, s]])
    }
    case 'diamond': {
      const s = r * 1.2
      return poly([[0, -s], [s, 0], [0, s], [-s, 0]])
    }
    case 'triangle': {
      const s = r * 1.3
      return poly([[0, -s], [s * 0.95, s * 0.7], [-s * 0.95, s * 0.7]])
    }
    case 'triangle-down': {
      const s = r * 1.3
      return poly([[0, s], [s * 0.95, -s * 0.7], [-s * 0.95, -s * 0.7]])
    }
    case 'hexagon':
      return poly(Array.from({ length: 6 }, (_, i) => [r * 1.05 * Math.cos((Math.PI / 3) * i), r * 1.05 * Math.sin((Math.PI / 3) * i)] as [number, number]))
    default:
      return `M${f(-r)} 0 a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0 a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0 Z`
  }
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
