'use client'

import {
  createHistory,
  dispatch as dispatchAction,
  layoutProblem,
  projectView,
  redo as redoHistory,
  undo as undoHistory,
  type DatasetIndex,
  type Highlight,
  type Id,
  type LayoutKind,
  type LifeStatus,
  type Projection,
  type TaxonomicView,
  type ViewAction,
  type ViewHistory,
} from '@captiveorigins/onetaxonomy-core'
import { radial, rectangular, type TreeLayout } from '@captiveorigins/onetaxonomy-layout'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from 'react'

import { dropOrder, drawnSubtree } from './drag.js'
import { Icon } from './icons.js'
import { TreeOutline } from './TreeOutline.js'
import { treeViewBox, TreeView, type ViewBox } from './TreeView.js'

export type UseTaxonomyView = {
  view: TaxonomicView
  projection: Projection
  dispatch: (action: ViewAction) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** The last refused action's reason (e.g. a layout the data can't support). */
  error: string | null
}

/** View state with undo/redo. Every change goes through the pure core reducer. */
export function useTaxonomyView(dataset: DatasetIndex, initial: TaxonomicView, { onChange }: { onChange?: (view: TaxonomicView) => void } = {}): UseTaxonomyView {
  const [history, setHistory] = useState<ViewHistory>(() => createHistory(initial))
  const [error, setError] = useState<string | null>(null)
  const update = useCallback(
    (next: (h: ViewHistory) => ViewHistory) =>
      setHistory((h) => {
        const n = next(h)
        if (n !== h) onChange?.(n.present)
        return n
      }),
    [onChange],
  )
  const dispatch = useCallback(
    (action: ViewAction) => {
      try {
        // Validate outside the state updater so the error can be shown.
        dispatchAction(history, action, dataset)
        setError(null)
        update((h) => dispatchAction(h, action, dataset))
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [dataset, history, update],
  )
  const projection = useMemo(() => projectView(dataset, history.present), [dataset, history.present])
  return {
    view: history.present,
    projection,
    dispatch,
    undo: () => update(undoHistory),
    redo: () => update(redoHistory),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    error,
  }
}

/** Lays out a projection for a view's layout kind (sunburst is drawn as a rectangular outline here). */
export function layoutFor(projection: Projection, kind: LayoutKind): TreeLayout {
  if (kind === 'radial') return radial(projection)
  if (kind === 'phylogram' || kind === 'time') return rectangular(projection, { scale: kind, width: 640 })
  return rectangular(projection)
}

export type ExplorerLabels = Record<
  | 'undo' | 'redo' | 'expandAll' | 'collapseAll' | 'rotate' | 'layout' | 'status' | 'allStatuses' | 'outline' | 'details' | 'nothingSelected' | 'clade' | 'group' | 'hidden' | 'rank' | 'lifeStatus' | 'focus' | 'unfocus'
  | 'zoomIn' | 'zoomOut' | 'fit' | 'download' | 'print' | 'canvas' | 'controls' | 'dragHint',
  string
>

const LABELS: ExplorerLabels = {
  undo: 'Undo',
  redo: 'Redo',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  rotate: 'Flip children',
  layout: 'Layout',
  status: 'Show',
  allStatuses: 'Living, extinct and unknown',
  outline: 'Tree outline',
  details: 'Details',
  nothingSelected: 'Choose a taxon in the tree or the outline.',
  clade: 'Clade',
  group: 'Group',
  hidden: 'not shown',
  rank: 'Rank',
  lifeStatus: 'Status',
  focus: 'Show only this branch',
  unfocus: 'Show everything',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Fit to view',
  download: 'Download SVG',
  print: 'Print',
  canvas: 'Tree drawing: drag to pan, Ctrl or ⌘ + scroll to zoom, drag a taxon to reorder it among its siblings, double-click to fold',
  controls: 'Drawing controls',
  dragHint: 'Drag a taxon up or down to reorder it among its siblings; double-click a branch to fold it.',
}

/** Properties copied into downloaded SVGs (they carry no stylesheet). */
const INLINE = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'visibility', 'display']

/** Prints only this drawing: everything else on the page is hidden while printing. */
function printDrawing(el: HTMLElement | null) {
  if (!el) return window.print()
  el.setAttribute('data-ot-printing', '')
  document.documentElement.setAttribute('data-ot-printing', '')
  const done = () => {
    el.removeAttribute('data-ot-printing')
    document.documentElement.removeAttribute('data-ot-printing')
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

const LAYOUTS: LayoutKind[] = ['rectangular', 'radial', 'phylogram', 'time']
const STATUS_FILTERS: { value: string; statuses?: LifeStatus[] }[] = [{ value: 'all' }, { value: 'extant', statuses: ['extant'] }, { value: 'extinct', statuses: ['extinct'] }, { value: 'unknown', statuses: ['unknown'] }]

export type ExplorerProps = {
  dataset: DatasetIndex
  initialView: TaxonomicView
  title: string
  /** Height of the drawing area (CSS length). Default 32rem. */
  height?: string
  labels?: Partial<ExplorerLabels>
  onViewChange?: (view: TaxonomicView) => void
  /** Extra content in the inspector for the selected node (e.g. a link to its page). */
  renderDetails?: (id: Id) => ReactNode
}

/**
 * Interactive explorer: the drawing, the accessible outline, a toolbar (undo,
 * redo, expand/collapse, flip, layout, life-status filter) and an inspector. Every
 * change is a view action over the pinned snapshot; the data itself never changes.
 */
export function Explorer({ dataset, initialView, title, height = '32rem', labels: custom, onViewChange, renderDetails }: ExplorerProps) {
  const labels = { ...LABELS, ...custom }
  const t = useTaxonomyView(dataset, initialView, onViewChange ? { onChange: onViewChange } : {})
  const { view, projection, dispatch } = t
  const layout = useMemo(() => layoutFor(projection, view.layout.kind), [projection, view.layout.kind])
  const selected = view.selected[0] ?? null
  const node = selected ? projection.nodes.find((n) => n.id === selected) : undefined
  const statusValue = STATUS_FILTERS.find((f) => JSON.stringify(f.statuses ?? null) === JSON.stringify(view.filter.status ?? null))?.value ?? 'all'
  const hidden = (n: number) => `${n} ${labels.hidden}`

  // Pan and zoom (same controls as OnePedigree): the box resets when the layout or focus changes.
  const full = useMemo(() => treeViewBox(layout), [layout])
  const [box, setBox] = useState<ViewBox | null>(null)
  const shown = box ?? full
  useEffect(() => setBox(null), [view.layout.kind, view.focus, view.target.id])
  const canvas = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number; box: ViewBox; node: Id | null; moved: boolean } | null>(null)
  const [drag, setDrag] = useState<{ id: Id; ids: Set<Id>; dx: number; dy: number } | null>(null)

  const scale = () => {
    const r = canvas.current?.querySelector('svg.ot-root')?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return 1
    return Math.max(shown.width / r.width, shown.height / r.height)
  }
  const zoom = (factor: number) => {
    const cx = shown.x + shown.width / 2
    const cy = shown.y + shown.height / 2
    setBox({ x: cx - (shown.width * factor) / 2, y: cy - (shown.height * factor) / 2, width: shown.width * factor, height: shown.height * factor })
  }
  const pan = (fx: number, fy: number) => setBox({ ...shown, x: shown.x + shown.width * fx, y: shown.y + shown.height * fy })

  const allChildren = (parent: Id) => view.order[parent] ?? viewChildren(dataset, view, parent)
  const move = (id: Id, direction: -1 | 1) => {
    const n = projection.nodes.find((x) => x.id === id)
    if (!n?.parent) return
    const siblings = [...allChildren(n.parent)]
    const i = siblings.indexOf(id)
    const j = i + direction
    if (i < 0 || j < 0 || j >= siblings.length) return
    ;[siblings[i], siblings[j]] = [siblings[j]!, siblings[i]!]
    dispatch({ type: 'reorder', node: n.parent, children: siblings })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as Element
    if (target.closest('button, a, select, .ot-floating')) return
    const nodeId = target.closest('.ot-node')?.getAttribute('data-id') ?? null
    pointer.current = { x: e.clientX, y: e.clientY, box: shown, node: nodeId, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pointer.current
    if (!p) return
    const k = scale()
    const dx = (e.clientX - p.x) * k
    const dy = (e.clientY - p.y) * k
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return
    p.moved = true
    const n = p.node ? projection.nodes.find((x) => x.id === p.node) : undefined
    if (n?.parent) setDrag({ id: n.id, ids: drag?.id === n.id ? drag.ids : drawnSubtree(projection, n.id), dx, dy })
    else setBox({ ...p.box, x: p.box.x - dx, y: p.box.y - dy })
  }
  const onPointerUp = () => {
    const p = pointer.current
    pointer.current = null
    if (!p) return
    if (drag) {
      const parent = projection.nodes.find((n) => n.id === drag.id)?.parent
      const order = parent ? dropOrder(projection, layout, drag.id, drag, allChildren(parent)) : null
      setDrag(null)
      if (order && parent) dispatch({ type: 'reorder', node: parent, children: order })
      return
    }
    if (!p.moved && p.node) dispatch({ type: 'select', nodes: [p.node] })
  }
  const onDoubleClick = (e: { target: EventTarget }) => {
    const id = (e.target as Element).closest('.ot-node')?.getAttribute('data-id')
    const n = id ? projection.nodes.find((x) => x.id === id) : undefined
    if (n && !n.isTip) dispatch({ type: 'toggle', node: n.id })
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    // Zoom only with Ctrl/⌘ (and trackpad pinch, which sets ctrlKey); plain scrolling scrolls the page.
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    zoom(e.deltaY > 0 ? 1.1 : 0.9)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === '+' || e.key === '=') zoom(0.8)
    else if (e.key === '-') zoom(1.25)
    else if (e.key === '0') setBox(null)
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      pan(e.key === 'ArrowLeft' ? -0.1 : e.key === 'ArrowRight' ? 0.1 : 0, e.key === 'ArrowUp' ? -0.1 : e.key === 'ArrowDown' ? 0.1 : 0)
    } else if (e.key === 'Escape') dispatch({ type: 'select', nodes: [] })
  }
  const download = () => {
    const svg = canvas.current?.querySelector('svg.ot-root')
    if (!svg) return
    const copy = svg.cloneNode(true) as SVGSVGElement
    const src = svg.querySelectorAll('*')
    copy.querySelectorAll('*').forEach((el, i) => {
      const cs = getComputedStyle(src[i]!)
      for (const prop of INLINE) (el as SVGElement).style.setProperty(prop, cs.getPropertyValue(prop))
    })
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${view.id}.svg` })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="ot-explorer">
      <div className="ot-toolbar" role="toolbar" aria-label={title}>
        <button type="button" onClick={t.undo} disabled={!t.canUndo}>
          <Icon name="undo" />
          {labels.undo}
        </button>
        <button type="button" onClick={t.redo} disabled={!t.canRedo}>
          <Icon name="redo" />
          {labels.redo}
        </button>
        <span className="ot-toolbar-gap" aria-hidden="true" />
        <button type="button" onClick={() => dispatch({ type: 'expandAll' })}>
          <Icon name="expand" />
          {labels.expandAll}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'collapseAll' })}>
          <Icon name="collapse" />
          {labels.collapseAll}
        </button>
        <span className="ot-toolbar-gap" aria-hidden="true" />
        <label className="ot-select">
          <Icon name="layout" />
          <span>{labels.layout}</span>
          <select value={view.layout.kind} onChange={(e) => dispatch({ type: 'setLayout', layout: e.target.value as LayoutKind })}>
            {LAYOUTS.map((k) => {
              const problem = layoutProblem(dataset, view.target, k)
              return (
                <option key={k} value={k} disabled={Boolean(problem)} title={problem ?? undefined}>
                  {k}
                </option>
              )
            })}
          </select>
        </label>
        <label className="ot-select">
          <Icon name="filter" />
          <span>{labels.status}</span>
          <select
            value={statusValue}
            onChange={(e) => {
              const f = STATUS_FILTERS.find((x) => x.value === e.target.value)!
              const { status: _, ...rest } = view.filter
              dispatch({ type: 'setFilter', filter: f.statuses ? { ...rest, status: f.statuses } : rest })
            }}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.value === 'all' ? labels.allStatuses : f.value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {t.error && (
        <p className="ot-error" role="status">
          {t.error}
        </p>
      )}
      <div className="ot-panes">
        <div
          ref={canvas}
          className="ot-canvas"
          style={{ height }}
          tabIndex={0}
          role="group"
          aria-label={labels.canvas}
          data-dragging={drag ? '' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pointer.current = null
            setDrag(null)
          }}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
        >
          <div className="ot-floating" role="toolbar" aria-label={labels.controls}>
            <button type="button" onClick={() => zoom(0.8)} aria-label={labels.zoomIn} title={labels.zoomIn}>
              <Icon name="plus" />
            </button>
            <button type="button" onClick={() => zoom(1.25)} aria-label={labels.zoomOut} title={labels.zoomOut}>
              <Icon name="minus" />
            </button>
            <button type="button" onClick={() => setBox(null)} aria-label={labels.fit} title={labels.fit}>
              <Icon name="fit" />
            </button>
            <button type="button" onClick={download} aria-label={labels.download} title={labels.download}>
              <Icon name="download" />
            </button>
            <button type="button" onClick={() => printDrawing(canvas.current)} aria-label={labels.print} title={labels.print}>
              <Icon name="print" />
            </button>
          </div>
          <TreeView projection={projection} layout={layout} highlights={view.highlights} title={title} interactive hiddenLabel={hidden} viewBox={shown} drag={drag} />
        </div>
        <div className="ot-side">
          <TreeOutline
            projection={projection}
            label={labels.outline}
            hiddenLabel={hidden}
            onToggle={(id) => dispatch({ type: 'toggle', node: id })}
            onSelect={(id) => dispatch({ type: 'select', nodes: [id] })}
            onMove={move}
          />
          <section className="ot-inspector" aria-label={labels.details}>
            {node ? (
              <>
                <h3 className="ot-inspector-title">{node.label}</h3>
                <dl>
                  {node.rank && (
                    <>
                      <dt>{labels.rank}</dt>
                      <dd>{node.rank}</dd>
                    </>
                  )}
                  <dt>{labels.lifeStatus}</dt>
                  <dd>{node.status}</dd>
                </dl>
                {node.hiddenDescendants > 0 && <p>{hidden(node.hiddenDescendants)}</p>}
                <HighlightList highlights={view.highlights.filter((h) => node.highlights.includes(h.id))} labels={labels} />
                <div className="ot-inspector-actions">
                  {!node.isTip && (
                    <button type="button" onClick={() => dispatch({ type: 'rotate', node: node.id })}>
                      <Icon name="flip" />
                      {labels.rotate}
                    </button>
                  )}
                  <button type="button" onClick={() => dispatch({ type: 'focus', node: view.focus === node.id ? null : node.id })}>
                    <Icon name={view.focus === node.id ? 'unfocus' : 'focus'} />
                    {view.focus === node.id ? labels.unfocus : labels.focus}
                  </button>
                </div>
                {renderDetails?.(node.id)}
              </>
            ) : (
              <p className="ot-hint">
                <Icon name="info" />
                {labels.nothingSelected} {labels.dragHint}
              </p>
            )}
          </section>
        </div>
      </div>
      <Legend layout={layout} highlights={view.highlights} labels={labels} />
    </div>
  )
}

const viewChildren = (dataset: DatasetIndex, view: TaxonomicView, id: Id): readonly Id[] =>
  (view.target.kind === 'classification' ? dataset.classification(view.target.id) : dataset.phylogeny(view.target.id)).children.get(id) ?? []

function HighlightList({ highlights, labels }: { highlights: Highlight[]; labels: Pick<ExplorerLabels, 'clade' | 'group'> }) {
  if (!highlights.length) return null
  return (
    <ul className="ot-highlights">
      {highlights.map((h) => (
        <li key={h.id} data-kind={h.kind}>
          <span className="ot-swatch" style={h.color ? { background: h.color } : undefined} aria-hidden="true" />
          {h.label} · {h.kind === 'clade' ? labels.clade : labels.group}
          {h.assessment?.hypothesis && (
            <span className="ot-assessment">
              {' '}
              ({h.assessment.status}, {h.assessment.hypothesis.id} v{h.assessment.hypothesis.version})
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** What the drawing is (classification vs phylogeny) and what each highlight is. */
export function Legend({ layout, highlights, labels: custom }: { layout: TreeLayout; highlights: Highlight[]; labels?: Partial<Pick<ExplorerLabels, 'clade' | 'group'>> }) {
  const labels = { clade: LABELS.clade, group: LABELS.group, ...custom }
  return (
    <div className="ot-legend">
      <p className="ot-notice">{layout.notice}</p>
      <HighlightList highlights={highlights} labels={labels} />
    </div>
  )
}
