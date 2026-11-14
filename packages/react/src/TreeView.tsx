import type { Highlight, Id, NodeOverlay, Projection } from '@extantape/onetaxonomy-core'
import { edgePath, type TreeLayout } from '@extantape/onetaxonomy-layout'
import { useId, type KeyboardEvent, type MouseEvent } from 'react'

import { CanvasTreeView } from './CanvasTreeView.js'
import { CANVAS_THRESHOLD, chooseRenderer, isItalicRank, nodeText, type LodCounts, type Renderer, type ViewBox } from './canvasPlan.js'
import { innerLabelAt, leafLabelX } from './labelPlace.js'
import { shapeAt, shapePath, type MarkShape } from './shapes.js'

export type TreeViewProps = {
  projection: Projection
  layout: TreeLayout
  /** Highlights from the view (colors and clade/group kind). Each is drawn in its own shape too, by its place in this list. */
  highlights?: Highlight[]
  /** A shape per trait state, so states differ by more than color (`traitShapes(set)`). Default: circles. */
  traitShapes?: ReadonlyMap<Id, MarkShape>
  /** Accessible title of the drawing. */
  title: string
  /** Space around the drawing, in layout units. Default 16. */
  padding?: number
  /** Room for labels to the right of leaves (rectangular layouts). Default 220. */
  labelWidth?: number
  /** Override the viewBox (zoom and pan). */
  viewBox?: ViewBox
  /** A node being dragged: it and its drawn subtree are shown offset (layout units). */
  drag?: { ids: ReadonlySet<Id>; dx: number; dy: number } | null
  /** Overlay marks per node (`nodeOverlays` from core): support, fossil ages, observed trait states. */
  overlays?: ReadonlyMap<Id, NodeOverlay>
  /** The node a dragged taxon would land on (Proposed mode). */
  dropTarget?: Id | null
  /** Small numbered markers on nodes (e.g. lesson annotations), by node id. */
  badges?: ReadonlyMap<Id, string>
  /** Nodes are focusable and clickable. */
  interactive?: boolean
  /** A node was clicked: an SVG `<g>`, or the canvas when the canvas renderer draws the tree. */
  onNodeClick?: (id: Id, event: MouseEvent<Element>) => void
  onNodeKeyDown?: (id: Id, event: KeyboardEvent<SVGGElement>) => void
  /** Word for folded descendants, e.g. "+12 hidden". */
  hiddenLabel?: (count: number) => string
  className?: string
  /**
   * `auto` (default) draws SVG up to `canvasThreshold` drawn nodes and a canvas above
   * it; `svg` or `canvas` forces one. The canvas has level of detail (`planCanvas`).
   */
  renderer?: Renderer
  /** Drawn nodes above which `auto` uses the canvas. Default `CANVAS_THRESHOLD` (1,000). */
  canvasThreshold?: number
  /** Canvas only: a fixed size in CSS pixels. Without it the canvas fills its container. */
  canvasSize?: { width: number; height: number }
  /** Canvas only: level-of-detail limits (see `LOD_DEFAULTS`). */
  lod?: { minLabelPx?: number; mergeBelowPx?: number }
  /** Canvas only: words beside a subtree drawn as one wedge. */
  mergedLabel?: (count: number) => string
  /** Canvas only: the note on what the level of detail leaves out (default `describeLod`). Return '' for none. */
  lodNote?: (counts: LodCounts) => string
}

const DEFAULT_HIDDEN = (n: number) => `+${n} not shown`

export type { ViewBox }
export { CANVAS_THRESHOLD }

/** The box that shows the whole drawing with room for labels (the "fit" view). */
export function treeViewBox(layout: TreeLayout, { padding = 16, labelWidth }: { padding?: number; labelWidth?: number } = {}): ViewBox {
  const radialLayout = layout.kind === 'radial'
  const lw = labelWidth ?? (radialLayout ? 160 : 220)
  const xs = layout.nodes.map((n) => n.x)
  const ys = layout.nodes.map((n) => n.y)
  const minX = Math.min(0, ...xs) - padding - (radialLayout ? lw : 0)
  const minY = Math.min(0, ...ys) - padding - (radialLayout ? lw / 2 : 0)
  const maxX = Math.max(0, ...xs) + padding + lw
  const maxY = Math.max(0, ...ys) + padding + (layout.axis ? 36 : 0) + (radialLayout ? lw / 2 : 0)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * The tree as SVG, or on a canvas for large trees. SVG renders on the server (no
 * effects, no measuring) and in the browser. Classes are stable (`ot-*`) and states
 * are data attributes, so it can be styled with the bundled stylesheet or entirely
 * your own. The legend notice (classification vs phylogeny) is part of the
 * accessible description. Above `canvasThreshold` drawn nodes (1,000 by default)
 * `renderer="auto"` hands the same props to `CanvasTreeView`.
 */
export function TreeView(props: TreeViewProps) {
  if (chooseRenderer(props.layout, props.renderer, props.canvasThreshold) === 'canvas') return <CanvasTreeView {...props} />
  return <SvgTreeView {...props} />
}

function SvgTreeView(props: TreeViewProps) {
  const { projection, layout, highlights = [], title, padding = 16, interactive = false } = props
  const titleId = useId()
  const descId = useId()
  const radialLayout = layout.kind === 'radial'
  const box = props.viewBox ?? treeViewBox(layout, { padding, ...(props.labelWidth !== undefined ? { labelWidth: props.labelWidth } : {}) })
  const node = new Map(projection.nodes.map((n) => [n.id, n]))
  const color = new Map(highlights.map((h) => [h.id, h.color]))
  const shape = new Map(highlights.map((h, i) => [h.id, shapeAt(i)]))
  const hidden = props.hiddenLabel ?? DEFAULT_HIDDEN
  const moving = (id: Id) => Boolean(props.drag?.ids.has(id))
  const offset = props.drag ? `translate(${props.drag.dx} ${props.drag.dy})` : undefined
  const marks = props.overlays
  // How far above or below each inner node its children's rows are: its name is placed clear of their branches.
  const rowOf = new Map(layout.nodes.map((n) => [n.id, n.y]))
  const childRows = new Map<Id, number[]>()
  if (!radialLayout) {
    for (const e of layout.edges) {
      const from = rowOf.get(e.parent)
      const to = rowOf.get(e.child)
      if (from === undefined || to === undefined) continue
      const rows = childRows.get(e.parent)
      if (rows) rows.push(to - from)
      else childRows.set(e.parent, [to - from])
    }
  }

  return (
    <svg
      className={['ot-root', props.className].filter(Boolean).join(' ')}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-diagram={layout.diagram}
      data-layout={layout.kind}
    >
      <title id={titleId}>{title}</title>
      <desc id={descId}>{`${layout.notice} ${projection.counts.shown} of ${projection.counts.total} shown.`}</desc>
      <g className="ot-edges">
        {layout.edges.map((e) => (
          <path
            key={`${e.parent}>${e.child}`}
            className="ot-edge"
            d={edgePath(e)}
            data-highlighted={node.get(e.child)?.highlights.length ? '' : undefined}
            data-weak={marks?.get(e.child)?.support?.weak ? '' : undefined}
            data-dragging={moving(e.child) ? '' : undefined}
            transform={moving(e.child) ? offset : undefined}
          />
        ))}
      </g>
      {layout.axis && (
        <g className="ot-axis" aria-hidden="true">
          <line className="ot-axis-line" x1={Math.min(...layout.axis.ticks.map((t) => t.x))} x2={Math.max(...layout.axis.ticks.map((t) => t.x))} y1={layout.height + 16} y2={layout.height + 16} />
          {layout.axis.ticks.map((t) => (
            <g key={t.value} transform={`translate(${t.x} ${layout.height + 16})`}>
              <line className="ot-axis-tick" y2={5} />
              <text className="ot-axis-label" y={18} textAnchor="middle">
                {t.value}
              </text>
            </g>
          ))}
          <text className="ot-axis-unit" x={layout.width} y={layout.height + 50} textAnchor="end">
            {layout.axis.direction === 'before-present' ? `${layout.axis.unit} before present` : layout.axis.unit}
          </text>
        </g>
      )}
      <g className="ot-nodes">
        {layout.nodes.map((ln) => {
          const n = node.get(ln.id)
          if (!n) return null
          const first = n.highlights.find((h) => color.get(h))
          const hl = first ? color.get(first) : undefined
          const angle = ln.angle ?? 0
          const flip = radialLayout && Math.cos(angle) < 0
          const labelTransform = radialLayout ? `rotate(${(-angle * 180) / Math.PI + (flip ? 180 : 0)})` : undefined
          const mark = marks?.get(ln.id)
          const text = nodeText(n, mark, hidden)
          const inner = ln.leaf ? undefined : innerLabelAt(childRows.get(ln.id) ?? [])
          return (
            <g
              key={ln.id}
              className="ot-node"
              transform={`translate(${ln.x + (moving(ln.id) ? props.drag!.dx : 0)} ${ln.y + (moving(ln.id) ? props.drag!.dy : 0)})`}
              data-dragging={moving(ln.id) ? '' : undefined}
              data-id={ln.id}
              data-leaf={ln.leaf ? '' : undefined}
              data-collapsed={n.collapsed ? '' : undefined}
              data-selected={n.selected ? '' : undefined}
              data-moved={n.moved ? '' : undefined}
              data-drop-target={props.dropTarget === ln.id ? '' : undefined}
              data-status={n.status}
              data-rank={n.rank}
              data-trait={mark?.trait?.state}
              {...(interactive
                ? {
                    tabIndex: -1,
                    role: 'button',
                    'aria-label': text,
                    onClick: props.onNodeClick ? (e: MouseEvent<SVGGElement>) => props.onNodeClick!(ln.id, e) : undefined,
                    onKeyDown: props.onNodeKeyDown ? (e: KeyboardEvent<SVGGElement>) => props.onNodeKeyDown!(ln.id, e) : undefined,
                  }
                : {})}
            >
              {hl && <path className="ot-node-halo" data-shape={shape.get(first!)} d={shapePath(shape.get(first!)!, 7.5)} style={{ fill: hl, stroke: hl }} />}
              {mark?.trait && (() => {
                const s = mark.trait.state === 'mixed' ? 'circle' : (props.traitShapes?.get(mark.trait.state) ?? 'circle')
                return <path className="ot-trait" data-shape={s} d={shapePath(s, 5.5)} style={'color' in mark.trait && mark.trait.color ? { fill: mark.trait.color } : undefined} />
              })()}
              {props.badges?.has(ln.id) && (
                <g className="ot-badge" transform="translate(-12 -12)" aria-hidden="true">
                  <circle r={7} />
                  <text y={3.5} textAnchor="middle">
                    {props.badges.get(ln.id)}
                  </text>
                </g>
              )}
              {mark?.support && (
                <text className="ot-support" x={-5} y={-5} textAnchor="end" data-weak={mark.support.weak ? '' : undefined}>
                  {mark.support.value}
                </text>
              )}
              {n.collapsed ? <path className="ot-node-collapsed" d="M0 0 L12 -6 L12 6 Z" /> : <circle className="ot-node-dot" r={ln.leaf ? 3 : 2.5} />}
              {(ln.leaf || !radialLayout) && text && (
                <text className="ot-label" x={inner ? inner.x : flip ? -8 : leafLabelX(n.collapsed)} y={inner ? inner.y : 4} textAnchor={ln.leaf && flip ? 'end' : 'start'} transform={ln.leaf ? labelTransform : undefined} data-italic={isItalicRank(n.rank) ? '' : undefined}>
                  {text}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
