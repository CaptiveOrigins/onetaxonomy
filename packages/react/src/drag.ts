import type { Id, Projection } from '@captiveorigins/onetaxonomy-core'
import type { TreeLayout } from '@captiveorigins/onetaxonomy-layout'

/**
 * Where a dragged node lands among its siblings (click-and-drag rearranging).
 * Only the display order of one parent's children changes, never the tree: the
 * node can't be dropped under another parent. Rectangular layouts order siblings
 * by height, radial layouts by angle.
 *
 * `allChildren` is the parent's full child order (including children hidden by
 * filters or the user); hidden ones keep their place relative to their neighbours.
 * Returns the new full order, or null when nothing changes.
 */
export function dropOrder(projection: Projection, layout: TreeLayout, id: Id, delta: { dx: number; dy: number }, allChildren: readonly Id[]): Id[] | null {
  const node = projection.nodes.find((n) => n.id === id)
  if (!node?.parent) return null
  const parent = projection.nodes.find((n) => n.id === node.parent)!
  const at = new Map(layout.nodes.map((n) => [n.id, n]))
  const self = at.get(id)
  if (!self) return null
  const radial = layout.kind === 'radial'
  const coord = (x: number, y: number, near?: number) => {
    if (!radial) return y
    let a = Math.atan2(-y, x)
    // Unwrap to the turn closest to the original angle so siblings around 0/2π compare correctly.
    if (near !== undefined) while (a - near > Math.PI) a -= 2 * Math.PI
    if (near !== undefined) while (near - a > Math.PI) a += 2 * Math.PI
    return a
  }
  const original = radial ? (self.angle ?? coord(self.x, self.y)) : self.y
  const dropped = coord(self.x + delta.dx, self.y + delta.dy, original)
  const siblings = parent.children
  const position = (s: Id) => (s === id ? dropped : radial ? (at.get(s)!.angle ?? 0) : at.get(s)!.y)
  const visible = [...siblings].sort((a, b) => position(a) - position(b))
  if (visible.every((s, i) => s === siblings[i])) return null

  const full = allChildren.filter((c) => c !== id)
  const next = visible[visible.indexOf(id) + 1]
  if (next !== undefined) full.splice(full.indexOf(next), 0, id)
  else full.splice(full.indexOf(visible[visible.length - 2]!) + 1, 0, id)
  return full
}

/** The node and everything drawn below it (moves together while dragging). */
export function drawnSubtree(projection: Projection, id: Id): Set<Id> {
  const byId = new Map(projection.nodes.map((n) => [n.id, n]))
  const out = new Set<Id>()
  const stack = [id]
  while (stack.length) {
    const x = stack.pop()!
    out.add(x)
    const n = byId.get(x)
    if (n && !n.collapsed) stack.push(...n.children)
  }
  return out
}
