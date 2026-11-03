'use client'

import {
  createHistory,
  describeAssessment,
  describeView,
  makeHighlight,
  dispatch as dispatchAction,
  inspectNode,
  nodeOverlays,
  serializeView,
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
  type TraitSet,
  type ViewAction,
  type ViewHistory,
  type ViewOverlays,
} from '@captiveorigins/onetaxonomy-core'
import { radial, rectangular, type TreeLayout } from '@captiveorigins/onetaxonomy-layout'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from 'react'

import { dropOrder, drawnSubtree } from './drag.js'
import { citationLine, disclosureLines, downloadBlob, standaloneSvg, svgToPng } from './export.js'
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
  | 'zoomIn' | 'zoomOut' | 'fit' | 'download' | 'print' | 'canvas' | 'controls' | 'dragHint'
  | 'overlays' | 'support' | 'extinction' | 'trait' | 'noTrait' | 'noStatedValue' | 'mixed' | 'weakSupport'
  | 'selection' | 'checkClade' | 'addHighlight' | 'highlightName' | 'checkAgainst' | 'clearSelection' | 'remove' | 'multiHint'
  | 'downloadSvg' | 'downloadPng' | 'downloadView' | 'about' | 'sources' | 'references' | 'synonyms' | 'commonNames' | 'age' | 'branchLength' | 'unmapped' | 'traits',
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
  download: 'Download',
  print: 'Print',
  canvas: 'Tree drawing: drag to pan, Ctrl or ⌘ + scroll to zoom, drag a taxon to reorder it among its siblings, double-click to fold',
  controls: 'Drawing controls',
  dragHint: 'Drag a taxon up or down to reorder it among its siblings; double-click a branch to fold it.',
  overlays: 'Overlays',
  support: 'Support values',
  extinction: 'Extinct and fossils',
  trait: 'Color by',
  noTrait: 'No trait',
  noStatedValue: 'No stated value',
  mixed: 'Mixed states',
  weakSupport: 'Weak support (dashed)',
  selection: 'Selected',
  checkClade: 'Is this a clade?',
  addHighlight: 'Highlight',
  highlightName: 'Name',
  checkAgainst: 'Check against',
  clearSelection: 'Clear selection',
  remove: 'Remove',
  multiHint: 'Shift-click (or Ctrl/⌘) to select several taxa and check whether they form a clade.',
  downloadSvg: 'Drawing (SVG)',
  downloadPng: 'Image (PNG)',
  downloadView: 'View file (JSON)',
  about: 'About this diagram',
  sources: 'Sources',
  references: 'References',
  synonyms: 'Synonyms',
  commonNames: 'Common names',
  age: 'Age',
  branchLength: 'Branch length',
  unmapped: 'Not linked to a named taxon (a sample, population or unnamed lineage).',
  traits: 'Traits',
}

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
  const marks = useMemo(() => nodeOverlays(dataset, view, projection, { mixedLabel: labels.mixed }), [dataset, view, projection, labels.mixed])
  const disclosure = useMemo(() => describeView(dataset, view, projection), [dataset, view, projection])
  const details = useMemo(() => (selected && node ? inspectNode(dataset, view, selected) : null), [dataset, view, selected, node])
  const traits = dataset.snapshot.traits ?? []
  const hasSupport = projection.nodes.some((n) => n.support !== undefined)
  const hasExtinct = projection.nodes.some((n) => n.status === 'extinct')
  const overlays = view.overlays ?? {}
  const setOverlays = (next: ViewOverlays) => dispatch({ type: 'setOverlays', overlays: next })
  const choose = (id: Id, additive = false) =>
    dispatch({ type: 'select', nodes: additive ? (view.selected.includes(id) ? view.selected.filter((x) => x !== id) : [...view.selected, id]) : [id] })

  // Pan and zoom (same controls as OnePedigree): the box resets when the layout or focus changes.
  const full = useMemo(() => treeViewBox(layout), [layout])
  const [box, setBox] = useState<ViewBox | null>(null)
  const shown = box ?? full
  useEffect(() => setBox(null), [view.layout.kind, view.focus, view.target.id])
  const canvas = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number; box: ViewBox; node: Id | null; moved: boolean; additive: boolean } | null>(null)
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
    pointer.current = { x: e.clientX, y: e.clientY, box: shown, node: nodeId, moved: false, additive: e.shiftKey || e.ctrlKey || e.metaKey }
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
    if (!p.moved && p.node) choose(p.node, p.additive)
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
  const exported = () => {
    const svg = canvas.current?.querySelector('svg.ot-root') as SVGSVGElement | null
    return svg ? standaloneSvg(svg, disclosure, { sourcesLabel: labels.sources }) : null
  }
  const [menu, setMenu] = useState(false)
  const download = async (kind: 'svg' | 'png' | 'view') => {
    setMenu(false)
    if (kind === 'view') return downloadBlob(new Blob([serializeView(view)], { type: 'application/json' }), `${view.id}.onetaxonomy-view.json`)
    const text = exported()
    if (!text) return
    if (kind === 'svg') return downloadBlob(new Blob([text], { type: 'image/svg+xml' }), `${view.id}.svg`)
    downloadBlob(await svgToPng(text), `${view.id}.png`)
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
        {(hasSupport || hasExtinct || traits.length > 0) && <span className="ot-toolbar-gap" aria-hidden="true" />}
        {hasSupport && (
          <button type="button" aria-pressed={Boolean(overlays.support)} onClick={() => { const { support, ...rest } = overlays; setOverlays(support ? rest : { ...rest, support: {} }) }}>
            <Icon name="check" />
            {labels.support}
          </button>
        )}
        {hasExtinct && (
          <button type="button" aria-pressed={Boolean(overlays.extinction)} onClick={() => { const { extinction, ...rest } = overlays; setOverlays(extinction ? rest : { ...rest, extinction: true }) }}>
            <Icon name="dagger" />
            {labels.extinction}
          </button>
        )}
        {traits.length > 0 && (
          <label className="ot-select">
            <Icon name="palette" />
            <span>{labels.trait}</span>
            <select value={overlays.trait ?? ''} onChange={(e) => { const { trait: _, ...rest } = overlays; setOverlays(e.target.value ? { ...rest, trait: e.target.value } : rest) }}>
              <option value="">{labels.noTrait}</option>
              {traits.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.title}
                </option>
              ))}
            </select>
          </label>
        )}
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
            <div className="ot-menu">
              <button type="button" onClick={() => setMenu((m) => !m)} aria-label={labels.download} title={labels.download} aria-expanded={menu} aria-haspopup="menu">
                <Icon name="download" />
              </button>
              {menu && (
                <div className="ot-menu-list" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
                  <button type="button" role="menuitem" onClick={() => download('svg')}>
                    <Icon name="download" />
                    {labels.downloadSvg}
                  </button>
                  <button type="button" role="menuitem" onClick={() => download('png')}>
                    <Icon name="image" />
                    {labels.downloadPng}
                  </button>
                  <button type="button" role="menuitem" onClick={() => download('view')}>
                    <Icon name="file" />
                    {labels.downloadView}
                  </button>
                </div>
              )}
            </div>
            <button type="button" onClick={() => printDrawing(canvas.current)} aria-label={labels.print} title={labels.print}>
              <Icon name="print" />
            </button>
          </div>
          <TreeView projection={projection} layout={layout} highlights={view.highlights} title={title} interactive hiddenLabel={hidden} viewBox={shown} drag={drag} overlays={marks} />
          <div className="ot-print-disclosure" aria-hidden="true">
            {disclosureLines(disclosure, labels.sources).map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        </div>
        <div className="ot-side">
          <TreeOutline
            projection={projection}
            label={labels.outline}
            hiddenLabel={hidden}
            onToggle={(id) => dispatch({ type: 'toggle', node: id })}
            onSelect={(id, o) => choose(id, o?.additive)}
            onMove={move}
          />
          <section className="ot-inspector" aria-label={labels.details}>
            {view.selected.length > 1 ? (
              <CladeCheck dataset={dataset} view={view} projection={projection} dispatch={dispatch} labels={labels} />
            ) : node ? (
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
                  {details?.age && (
                    <>
                      <dt>{labels.age}</dt>
                      <dd>
                        {details.age.value}
                        {details.age.min !== undefined && details.age.max !== undefined ? ` (${details.age.min}–${details.age.max})` : ''} {details.age.unit !== 'unspecified' ? details.age.unit : ''}
                      </dd>
                    </>
                  )}
                  {details?.support && (
                    <>
                      <dt>{labels.support}</dt>
                      <dd>
                        {details.support.value}
                        {details.support.method ? ` (${details.support.method})` : ''}
                      </dd>
                    </>
                  )}
                  {details?.branchLength && (
                    <>
                      <dt>{labels.branchLength}</dt>
                      <dd>
                        {details.branchLength.value} {details.branchLength.unit !== 'unspecified' ? details.branchLength.unit : ''}
                      </dd>
                    </>
                  )}
                </dl>
                {details && <NodeFacts details={details} labels={labels} />}
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
                {(view.target.kind === 'classification' && dataset.snapshot.phylogenies.length > 0) && <CladeCheck dataset={dataset} view={view} projection={projection} dispatch={dispatch} labels={labels} single />}
                {renderDetails?.(node.id)}
              </>
            ) : (
              <p className="ot-hint">
                <Icon name="info" />
                {labels.nothingSelected} {labels.dragHint} {labels.multiHint}
              </p>
            )}
          </section>
        </div>
      </div>
      <Legend layout={layout} highlights={view.highlights} labels={labels} trait={traits.find((tr) => tr.id === overlays.trait)} support={Boolean(overlays.support)} onRemoveHighlight={(id) => dispatch({ type: 'removeHighlight', id })} />
      <details className="ot-about">
        <summary>
          <Icon name="book" />
          {labels.about}
        </summary>
        <ul>
          {disclosure.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {disclosure.citations.length > 0 && (
          <>
            <h4>{labels.sources}</h4>
            <ul>
              {disclosure.citations.map((c) => (
                <li key={c.source}>{citationLine(c)}</li>
              ))}
            </ul>
          </>
        )}
      </details>
    </div>
  )
}

const PALETTE = ['#cf8137', '#2f7d5c', '#91645d', '#3b6fb6', '#b9a8d9', '#d9a400']

/**
 * The clade selector: check whether the selected taxa form a clade in the hypothesis
 * (or, for one taxon of a classification, in a chosen phylogeny), with the reason in
 * words, then keep it as a highlight: a clade only when supported, otherwise a group.
 */
function CladeCheck({ dataset, view, projection, dispatch, labels, single = false }: { dataset: DatasetIndex; view: TaxonomicView; projection: Projection; dispatch: (a: ViewAction) => void; labels: ExplorerLabels; single?: boolean }) {
  const phylogenies = dataset.snapshot.phylogenies
  const [against, setAgainst] = useState(phylogenies[0]?.id ?? '')
  const [name, setName] = useState('')
  const members = view.selected
  const result = useMemo(() => {
    if (view.target.kind === 'classification' && members.length !== 1) return null
    return makeHighlight(dataset, view, { id: `h-${members.join('-')}`, label: name || members.map((m) => projection.nodes.find((n) => n.id === m)?.label ?? m).join(', '), members, ...(view.target.kind === 'classification' && against ? { hypothesis: against } : {}) })
  }, [dataset, view, members, name, against, projection])
  const words = result?.assessment ? describeAssessment(dataset, result.assessment) : null
  const nameOf = (id: Id) => projection.nodes.find((n) => n.id === id)?.label ?? id
  return (
    <div className="ot-clade-check" data-status={result?.assessment?.status}>
      {!single && (
        <>
          <h3 className="ot-inspector-title">
            {labels.selection} ({members.length})
          </h3>
          <p className="ot-selection">{members.map(nameOf).join(', ')}</p>
        </>
      )}
      {view.target.kind === 'classification' && (
        <label className="ot-select">
          <span>{labels.checkAgainst}</span>
          <select value={against} onChange={(e) => setAgainst(e.target.value)}>
            {phylogenies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {words && (
        <div className="ot-assessment-box" role="status">
          <p>
            <strong>{labels.checkClade}</strong> {words.headline}
          </p>
          {words.details.map((d, i) => (
            <p key={i} className="ot-hint">
              {d}
            </p>
          ))}
        </div>
      )}
      {result && (
        <form
          className="ot-inspector-actions"
          onSubmit={(e) => {
            e.preventDefault()
            const id = `h${Date.now().toString(36)}`
            dispatch({ type: 'addHighlight', highlight: { ...result, id, color: PALETTE[view.highlights.length % PALETTE.length]! } })
            setName('')
          }}
        >
          <label className="ot-select">
            <span>{labels.highlightName}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={result.label} />
          </label>
          <button type="submit">
            <Icon name="palette" />
            {labels.addHighlight} ({result.kind === 'clade' ? labels.clade : labels.group})
          </button>
        </form>
      )}
      {!single && (
        <button type="button" onClick={() => dispatch({ type: 'select', nodes: [] })}>
          <Icon name="close" />
          {labels.clearSelection}
        </button>
      )}
    </div>
  )
}

function NodeFacts({ details, labels }: { details: NonNullable<ReturnType<typeof inspectNode>>; labels: ExplorerLabels }) {
  const c = details.concepts.length === 1 ? details.concepts[0] : undefined
  const profile = c?.profile
  return (
    <div className="ot-facts">
      {details.unmapped && <p className="ot-hint">{labels.unmapped}</p>}
      {c?.authorship && <p className="ot-authorship">{c.name} {c.authorship}</p>}
      {profile?.summary && <p>{profile.summary}</p>}
      {c && c.synonyms.length > 0 && (
        <p>
          <span className="ot-fact-label">{labels.synonyms}:</span> {c.synonyms.join(', ')}
        </p>
      )}
      {c && c.commonNames.length > 0 && (
        <p>
          <span className="ot-fact-label">{labels.commonNames}:</span> {c.commonNames.map((n) => `${n.name} (${n.locale})`).join(', ')}
        </p>
      )}
      {details.traits.length > 0 && (
        <p>
          <span className="ot-fact-label">{labels.traits}:</span> {details.traits.map((tr) => `${tr.title}: ${tr.state}${tr.note ? ` (${tr.note})` : ''}`).join('; ')}
        </p>
      )}
      {details.references.length > 0 && (
        <p>
          <span className="ot-fact-label">{labels.references}:</span> {details.references.join('; ')}
        </p>
      )}
      {details.citations.length > 0 && (
        <p className="ot-citations">
          <span className="ot-fact-label">{labels.sources}:</span> {details.citations.map(citationLine).join('; ')}
        </p>
      )}
    </div>
  )
}

const viewChildren = (dataset: DatasetIndex, view: TaxonomicView, id: Id): readonly Id[] =>
  (view.target.kind === 'classification' ? dataset.classification(view.target.id) : dataset.phylogeny(view.target.id)).children.get(id) ?? []

function HighlightList({ highlights, labels, onRemove }: { highlights: Highlight[]; labels: Pick<ExplorerLabels, 'clade' | 'group'> & Partial<Pick<ExplorerLabels, 'remove'>>; onRemove?: (id: Id) => void }) {
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
          {onRemove && (
            <button type="button" className="ot-remove" onClick={() => onRemove(h.id)} aria-label={`${labels.remove ?? 'Remove'} ${h.label}`} title={labels.remove}>
              <Icon name="close" size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** What the drawing is (classification vs phylogeny) and what each highlight is. */
export function Legend({
  layout,
  highlights,
  labels: custom,
  trait,
  support,
  onRemoveHighlight,
}: {
  layout: TreeLayout
  highlights: Highlight[]
  labels?: Partial<Pick<ExplorerLabels, 'clade' | 'group' | 'noStatedValue' | 'weakSupport' | 'mixed' | 'remove'>>
  /** The trait set the drawing is colored by (its states become legend entries). */
  trait?: TraitSet | undefined
  support?: boolean
  onRemoveHighlight?: (id: Id) => void
}) {
  const labels = { clade: LABELS.clade, group: LABELS.group, noStatedValue: LABELS.noStatedValue, weakSupport: LABELS.weakSupport, mixed: LABELS.mixed, remove: LABELS.remove, ...custom }
  return (
    <div className="ot-legend">
      <p className="ot-notice">{layout.notice}</p>
      <HighlightList highlights={highlights} labels={labels} {...(onRemoveHighlight ? { onRemove: onRemoveHighlight } : {})} />
      {trait && (
        <ul className="ot-legend-traits" aria-label={trait.title}>
          {trait.states.map((s) => (
            <li key={s.id}>
              <span className="ot-swatch" data-trait={s.id} style={s.color ? { background: s.color } : undefined} aria-hidden="true" />
              {s.label}
            </li>
          ))}
          <li>
            <span className="ot-swatch" data-trait="mixed" aria-hidden="true" />
            {labels.mixed}
          </li>
          <li>
            <span className="ot-swatch" data-trait="none" aria-hidden="true" />
            {labels.noStatedValue}
          </li>
        </ul>
      )}
      {support && <p className="ot-notice">{labels.weakSupport}</p>}
    </div>
  )
}
