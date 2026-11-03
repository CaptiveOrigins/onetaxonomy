import type { Highlight, Id, NodeOverlay, Projection } from '@captiveorigins/onetaxonomy-core'
import { edgePath, type TreeLayout } from '@captiveorigins/onetaxonomy-layout'
import { useId, type KeyboardEvent, type MouseEvent } from 'react'

export type TreeViewProps = {
  projection: Projection
  layout: TreeLayout
  /** Highlights from the view (colors and clade/group kind). */
  highlights?: Highlight[]
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
  /** Small numbered markers on nodes (e.g. lesson annotations), by node id. */
  badges?: ReadonlyMap<Id, string>
  /** Nodes are focusable and clickable. */
  interactive?: boolean
  onNodeClick?: (id: Id, event: MouseEvent<SVGGElement>) => void
  onNodeKeyDown?: (id: Id, event: KeyboardEvent<SVGGElement>) => void
  /** Word for folded descendants, e.g. "+12 hidden". */
  hiddenLabel?: (count: number) => string
  className?: string
}

const DEFAULT_HIDDEN = (n: number) => `+${n} not shown`

export type ViewBox = { x: number; y: number; width: number; height: number }

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
 * The tree as SVG. Renders on the server (no effects, no measuring) and in the
 * browser. Classes are stable (`ot-*`) and states are data attributes, so it can
 * be styled with the bundled stylesheet or entirely your own. The legend notice
 * (classification vs phylogeny) is part of the accessible description.
 */
export function TreeView(props: TreeViewProps) {
  const { projection, layout, highlights = [], title, padding = 16, interactive = false } = props
  const titleId = useId()
  const descId = useId()
  const radialLayout = layout.kind === 'radial'
  const box = props.viewBox ?? treeViewBox(layout, { padding, ...(props.labelWidth !== undefined ? { labelWidth: props.labelWidth } : {}) })
  const node = new Map(projection.nodes.map((n) => [n.id, n]))
  const color = new Map(highlights.map((h) => [h.id, h.color]))
  const hidden = props.hiddenLabel ?? DEFAULT_HIDDEN
  const moving = (id: Id) => Boolean(props.drag?.ids.has(id))
  const offset = props.drag ? `translate(${props.drag.dx} ${props.drag.dy})` : undefined
  const marks = props.overlays

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
          const hl = n.highlights.map((h) => color.get(h)).find(Boolean)
          const angle = ln.angle ?? 0
          const flip = radialLayout && Math.cos(angle) < 0
          const labelTransform = radialLayout ? `rotate(${(-angle * 180) / Math.PI + (flip ? 180 : 0)})` : undefined
          const mark = marks?.get(ln.id)
          const fossil = mark?.fossilAge ? ` ${mark.fossilAge.value}${mark.fossilAge.unit && mark.fossilAge.unit !== 'unspecified' ? ` ${mark.fossilAge.unit}` : ''}` : ''
          const name = `${n.label}${n.status === 'extinct' ? ` †${fossil}` : ''}`
          const text = n.collapsed && n.hiddenDescendants ? `${name} (${hidden(n.hiddenDescendants)})` : name
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
              {hl && <circle className="ot-node-halo" r={7} style={{ fill: hl }} />}
              {mark?.trait && <circle className="ot-trait" r={5.5} style={'color' in mark.trait && mark.trait.color ? { fill: mark.trait.color } : undefined} />}
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
                <text className="ot-label" x={ln.leaf ? (flip ? -8 : 8) : 4} y={ln.leaf ? 4 : -6} textAnchor={ln.leaf && flip ? 'end' : 'start'} transform={ln.leaf ? labelTransform : undefined} data-italic={/^(genus|species|subspecies|variety|form)$/i.test(n.rank ?? '') ? '' : undefined}>
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
