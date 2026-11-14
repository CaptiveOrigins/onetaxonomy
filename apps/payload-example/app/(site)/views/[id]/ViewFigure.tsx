import type { Highlight, LayoutKind, Projection } from '@extantape/onetaxonomy-core'
import { layoutFor, TreeOutline, treeViewBox, TreeView } from '@extantape/onetaxonomy-react'

/** The parts of a stored view the drawing needs. */
export type StoredView = { layout: { kind: LayoutKind }; highlights: Highlight[] }

/** How far the drawing may be enlarged: 1.5 keeps its 12 px names at 18 px or less on a wide page. */
const LARGEST = 1.5

/**
 * The drawing, then the same tree as an outline for keyboards and screen readers. This is a Server Component:
 * `TreeView` is drawn on the server as SVG, and `TreeOutline` is a client component that gets plain data.
 */
export function ViewFigure({ projection, stored, title }: { projection: Projection; stored: StoredView; title: string }) {
  const layout = layoutFor(projection, stored.layout.kind)
  return (
    <>
      {/* The drawing scrolls sideways on a narrow screen, so the box takes focus and the arrow keys scroll it. */}
      <div className="figure" role="group" aria-label={`Drawing: ${title}`} tabIndex={0} style={{ ['--widest' as string]: `${Math.round(treeViewBox(layout).width * LARGEST)}px` }}>
        <TreeView projection={projection} layout={layout} highlights={stored.highlights} title={title} />
      </div>
      <h2>The same tree as an outline</h2>
      <TreeOutline projection={projection} label={title} />
    </>
  )
}
