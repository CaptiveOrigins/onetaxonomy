import type { ViewBox } from './canvasPlan.js'

/** How close to the drawing's edge, in CSS pixels, a selected node may sit before the drawing pans. */
export const REVEAL_MARGIN_PX = 40

/** How long the pan takes when motion is allowed, in milliseconds. */
export const REVEAL_MS = 200

export type Reveal = { box: ViewBox; zoomed: boolean }

/**
 * The view box that brings `points` (layout units) into view, at least `margin` CSS
 * pixels inside the drawing's edge, or `null` when they already are.
 *
 * Both renderers fit the box into the drawing as SVG's default `xMidYMid meet` does, so
 * the area on screen can be wider or taller than the box; that whole area counts as
 * visible. The answer pans as little as it can. It zooms out only when the points can't
 * fit at the current zoom, and then by the smallest factor that fits them; it never zooms in.
 * `size` is the drawing's size in CSS pixels; without one (not laid out yet) the box is
 * taken as one unit per pixel.
 */
export function revealBox(box: ViewBox, points: readonly { x: number; y: number }[], size: { width: number; height: number } | null, margin = REVEAL_MARGIN_PX): Reveal | null {
  if (!points.length || !(box.width > 0) || !(box.height > 0)) return null
  const width = size && size.width > 0 ? size.width : box.width
  const height = size && size.height > 0 ? size.height : box.height
  const k = Math.min(width / box.width, height / box.height)
  // The area on screen, in layout units, and the margin in layout units (never more than a quarter of it).
  const vw = width / k
  const vh = height / k
  const vx = box.x - (vw - box.width) / 2
  const vy = box.y - (vh - box.height) / 2
  const m = Math.min(margin / k, vw / 4, vh / 4)
  const x0 = Math.min(...points.map((p) => p.x))
  const x1 = Math.max(...points.map((p) => p.x))
  const y0 = Math.min(...points.map((p) => p.y))
  const y1 = Math.max(...points.map((p) => p.y))
  if (x0 >= vx + m && x1 <= vx + vw - m && y0 >= vy + m && y1 <= vy + vh - m) return null

  // Zoom out (about the centre) only as far as the points need. The margin is in pixels, so it grows with the factor.
  const f = Math.max(1, (x1 - x0) / (vw - 2 * m), (y1 - y0) / (vh - 2 * m))
  const fw = vw * f
  const fh = vh * f
  const fm = m * f
  let nx = vx + (vw - fw) / 2
  let ny = vy + (vh - fh) / 2
  // Then pan the shortest way that brings every point inside the margin.
  if (x0 < nx + fm) nx = x0 - fm
  else if (x1 > nx + fw - fm) nx = x1 - fw + fm
  if (y0 < ny + fm) ny = y0 - fm
  else if (y1 > ny + fh - fm) ny = y1 - fh + fm
  const bw = box.width * f
  const bh = box.height * f
  return { box: { x: nx + (fw - bw) / 2, y: ny + (fh - bh) / 2, width: bw, height: bh }, zoomed: f > 1 }
}

/** Whether the person asked for less motion. Unknown (no `matchMedia`) counts as yes: a jump is never wrong. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof window.requestAnimationFrame !== 'function') return true
  return !window.matchMedia('(prefers-reduced-motion: no-preference)').matches
}

/** A box part of the way from `a` to `b` (`t` from 0 to 1), eased out. */
export function between(a: ViewBox, b: ViewBox, t: number): ViewBox {
  const e = 1 - (1 - Math.min(1, Math.max(0, t))) ** 3
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, width: a.width + (b.width - a.width) * e, height: a.height + (b.height - a.height) * e }
}
