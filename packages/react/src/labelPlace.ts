/**
 * Where an inner node's name goes in a rectangular drawing.
 *
 * Each child's branch leaves the node's vertical line at the child's row and runs right, across the place where a
 * name beside the node sits. A name drawn through one of those branches reads as struck out, so the name goes in
 * the first of three spots that the branches leave clear: on the node's own row (the way a leaf's name sits), just
 * above the row, or just below it. When the rows are too close for any of them, it takes the spot with the most
 * room. The SVG and the canvas drawing both use this, so a name is in the same place in each.
 *
 * A leaf's name starts beside its dot. A folded branch is drawn as a triangle 12 units wide where the dot would
 * be, so its name starts past the triangle instead of on top of it.
 */

/** How far right of the node a leaf's name starts, in layout units: 8 past a dot, 16 past a folded branch's triangle. */
export function leafLabelX(folded: boolean): number {
  return folded ? FOLDED.width + FOLDED.gap : 8
}
/** The triangle that marks a folded branch, and the room between it and the name. */
export const FOLDED = { width: 12, gap: 4 } as const

/** A 12-unit name reaches this far above and below its baseline. */
const NAME = { above: 10, below: 3 }
/** The least room, in layout units, between a name and a branch. */
const ROOM = 2
/** The spots, in order of preference: `x` and the baseline `y`, in layout units from the node. */
const SPOTS = [
  { x: 8, y: 4 },
  { x: 4, y: -6 },
  { x: 4, y: 15 },
] as const

/**
 * The place for an inner node's name, in layout units from the node, given how far above (negative) or below
 * (positive) the node each child's row is.
 */
export function innerLabelAt(childRows: readonly number[]): { x: number; y: number } {
  let best: { x: number; y: number } = SPOTS[0]
  let bestRoom = -1
  for (const spot of SPOTS) {
    const top = spot.y - NAME.above
    const bottom = spot.y + NAME.below
    let room = Infinity
    for (const row of childRows) room = Math.min(room, row < top ? top - row : row > bottom ? row - bottom : 0)
    if (room >= ROOM) return spot
    if (room > bestRoom) {
      best = spot
      bestRoom = room
    }
  }
  return best
}
