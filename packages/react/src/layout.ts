import type { LayoutKind, Projection } from '@captiveorigins/onetaxonomy-core'
import { radial, rectangular, type TreeLayout } from '@captiveorigins/onetaxonomy-layout'

/**
 * Lays out a projection for a view's layout kind (sunburst is drawn as a rectangular outline here).
 * Kept out of the client files so a server can call it: `<TreeView layout={layoutFor(projection, kind)} />`.
 */
export function layoutFor(projection: Projection, kind: LayoutKind): TreeLayout {
  if (kind === 'radial') return radial(projection)
  if (kind === 'phylogram' || kind === 'time') return rectangular(projection, { scale: kind, width: 640 })
  return rectangular(projection)
}
