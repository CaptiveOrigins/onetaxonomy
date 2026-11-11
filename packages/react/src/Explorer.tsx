'use client'

import {
  createHistory,
  describeAssessment,
  describeView,
  makeHighlight,
  dispatch as dispatchAction,
  inspectNode,
  nodeOverlays,
  acceptedTree,
  compareHierarchies,
  viewTree,
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
  type Phylogeny,
  type Projection,
  type TaxonomicView,
  type TraitSet,
  type ViewAction,
  type ViewHistory,
  type ViewOverlays,
} from '@captiveorigins/onetaxonomy-core'
import { radial, rectangular, type TreeLayout } from '@captiveorigins/onetaxonomy-layout'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from 'react'

import { dropOrder, drawnSubtree, dropTarget } from './drag.js'
import { citationLine, disclosureLines, downloadBlob, standaloneSvg, svgToPng } from './export.js'
import { Icon } from './icons.js'
import { ComparePanel, PHYLO_LABELS, rootedRecord, SupportControl, supportSummary, type PhyloLabels } from './Phylo.js'
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

export type ExplorerLabels = PhyloLabels & Record<
  | 'undo' | 'redo' | 'expandAll' | 'collapseAll' | 'rotate' | 'layout' | 'status' | 'allStatuses' | 'outline' | 'details' | 'nothingSelected' | 'clade' | 'group' | 'hidden' | 'rank' | 'lifeStatus' | 'focus' | 'unfocus'
  | 'zoomIn' | 'zoomOut' | 'fit' | 'download' | 'print' | 'canvas' | 'controls' | 'dragHint'
  | 'propose' | 'proposalTitle' | 'proposalAuthor' | 'proposalStart' | 'proposalCancel' | 'proposalHint' | 'proposalBy' | 'proposalLeave' | 'proposalNoMoves' | 'proposalUnder' | 'proposalRoot'
  | 'proposalRevert' | 'proposalAccepted' | 'proposalProposed' | 'proposalMoveUnder' | 'proposalGained' | 'proposalLost' | 'proposalCompare' | 'proposalDefaultTitle'
  | 'overlays' | 'support' | 'extinction' | 'trait' | 'noTrait' | 'noStatedValue' | 'mixed' | 'weakSupport'
  | 'selection' | 'checkClade' | 'addHighlight' | 'highlightName' | 'checkAgainst' | 'clearSelection' | 'remove' | 'multiHint'
  | 'downloadSvg' | 'downloadPng' | 'downloadView' | 'about' | 'sources' | 'references' | 'synonyms' | 'commonNames' | 'age' | 'branchLength' | 'unmapped' | 'traits'
  | 'keyboardHint' | 'extinct' | 'exportFailed',
  string
>

const LABELS: ExplorerLabels = {
  ...PHYLO_LABELS,
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
  canvas: 'Tree drawing: drag to pan, Ctrl or ⌘ + scroll to zoom, drag a taxon to reorder it among its siblings, double-click to fold. With the keyboard: arrow keys pan, + and − zoom, 0 fits, Escape clears the selection',
  controls: 'Drawing controls',
  propose: 'Propose changes',
  proposalTitle: 'Name of this proposal',
  proposalAuthor: 'Your name',
  proposalStart: 'Start proposing',
  proposalCancel: 'Cancel',
  proposalHint: 'Drag a taxon onto its new parent, or select it and choose below. The accepted data never changes.',
  proposalBy: 'Proposed by',
  proposalLeave: 'Leave Proposed mode',
  proposalNoMoves: 'No moves yet.',
  proposalUnder: 'under',
  proposalRoot: 'the top level',
  proposalRevert: 'Revert',
  proposalAccepted: 'Accepted',
  proposalProposed: 'Proposed',
  proposalMoveUnder: 'Move under',
  proposalGained: 'Gains',
  proposalLost: 'Loses',
  proposalCompare: 'Compare with the accepted arrangement',
  proposalDefaultTitle: 'My proposal',
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
  keyboardHint: 'In the outline: Up and Down move, Right and Left open and close, Home and End jump, typing finds a name, Space selects (Shift+Space adds), Enter opens a branch, Alt+Up and Alt+Down reorder.',
  extinct: 'extinct',
  exportFailed: 'Could not export the drawing:',
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
  /**
   * Other phylogenies to offer in "Compare with…", besides the dataset's own. The panel
   * appears when a phylogeny is shown and there is at least one other to compare with.
   */
  compareWith?: Phylogeny[]
  /**
   * Turns on "Midpoint root" and "Root on this tip/clade (outgroup)". Each makes a new
   * phylogeny record (with a new id and a `rooting` note) and hands it here; the record
   * shown is never changed. Where the new record goes, and how it is shown, is the host's
   * choice: add it to a new snapshot and show it, for example.
   */
  onRooted?: (record: Phylogeny) => void
}

/**
 * Interactive explorer: the drawing, the accessible outline, a toolbar (undo,
 * redo, expand/collapse, flip, layout, life-status filter) and an inspector. Every
 * change is a view action over the pinned snapshot; the data itself never changes.
 */
export function Explorer({ dataset, initialView, title, height = '32rem', labels: custom, onViewChange, renderDetails, compareWith = [], onRooted }: ExplorerProps) {
  const labels = { ...LABELS, ...custom }
  const t = useTaxonomyView(dataset, initialView, onViewChange ? { onChange: onViewChange } : {})
  const { view, projection, dispatch } = t
  const layout = useMemo(() => layoutFor(projection, view.layout.kind), [projection, view.layout.kind])
  const selected = view.selected[0] ?? null
  const node = selected ? projection.nodes.find((n) => n.id === selected) : undefined
  const statusValue = STATUS_FILTERS.find((f) => JSON.stringify(f.statuses ?? null) === JSON.stringify(view.filter.status ?? null))?.value ?? 'all'
  const hidden = (n: number) => `${n} ${labels.hidden}`
  const marks = useMemo(() => nodeOverlays(dataset, view, projection, { mixedLabel: labels.mixed }), [dataset, view, projection, labels.mixed])
  const phylogeny = view.target.kind === 'phylogeny' ? dataset.phylogeny(view.target.id).phylogeny : null
  const rooting = phylogeny?.rooting
  const rootingLine = rooting ? `${labels.rooting} ${rooting.note ?? rooting.method}` : null
  // The rooting note goes into the About list, exports and prints, next to the hypothesis it describes.
  const disclosure = useMemo(() => {
    const d = describeView(dataset, view, projection)
    if (!rootingLine) return d
    const at = d.lines.findIndex((l) => l.startsWith('Phylogenetic hypothesis:'))
    const lines = [...d.lines]
    lines.splice(at + 1, 0, rootingLine)
    return { ...d, lines }
  }, [dataset, view, projection, rootingLine])
  const others = useMemo(
    () => (phylogeny ? [...dataset.snapshot.phylogenies, ...compareWith.filter((p) => !dataset.snapshot.phylogenies.some((q) => q.id === p.id))].filter((p) => p.id !== phylogeny.id) : []),
    [dataset, compareWith, phylogeny],
  )
  const [rootError, setRootError] = useState<string | null>(null)
  const root = (node: Id | null) => {
    if (!phylogeny || !onRooted) return
    try {
      const record = rootedRecord(dataset, phylogeny.id, node, compareWith.map((p) => p.id))
      setRootError(null)
      onRooted(record)
    } catch (e) {
      setRootError((e as Error).message)
    }
  }
  const details = useMemo(() => (selected && node ? inspectNode(dataset, view, selected) : null), [dataset, view, selected, node])
  const traits = dataset.snapshot.traits ?? []
  const isUnrooted = view.target.kind === 'phylogeny' && !dataset.phylogeny(view.target.id).rooted
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
  const [proposing, setProposing] = useState(false)
  const proposal = view.proposal
  const landing = proposal && drag ? dropTarget(layout, drag.id, drag.ids, drag) : null

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
    if (n && (n.parent || proposal)) setDrag({ id: n.id, ids: drag?.id === n.id ? drag.ids : drawnSubtree(projection, n.id), dx, dy })
    else setBox({ ...p.box, x: p.box.x - dx, y: p.box.y - dy })
  }
  const onPointerUp = () => {
    const p = pointer.current
    pointer.current = null
    if (!p) return
    if (drag && landing) {
      setDrag(null)
      if (projection.nodes.find((n) => n.id === drag.id)?.parent !== landing) dispatch({ type: 'proposeMove', node: drag.id, to: landing })
      return
    }
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
  const [exportError, setExportError] = useState<string | null>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const menuList = useRef<HTMLDivElement>(null)
  // Menu button pattern: opening moves focus to the first item; Escape closes and returns focus to the button.
  useEffect(() => {
    if (menu) menuList.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [menu])
  const closeMenu = () => {
    setMenu(false)
    menuButton.current?.focus()
  }
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuList.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const to = (j: number) => {
      e.preventDefault()
      items[(j + items.length) % items.length]?.focus()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    } else if (e.key === 'ArrowDown') to(i + 1)
    else if (e.key === 'ArrowUp') to(i - 1)
    else if (e.key === 'Home') to(0)
    else if (e.key === 'End') to(items.length - 1)
    else if (e.key === 'Tab') {
      e.preventDefault()
      closeMenu()
    }
  }
  const download = async (kind: 'svg' | 'png' | 'view') => {
    closeMenu()
    setExportError(null)
    try {
      if (kind === 'view') return downloadBlob(new Blob([serializeView(view)], { type: 'application/json' }), `${view.id}.onetaxonomy-view.json`)
      const text = exported()
      if (!text) return
      if (kind === 'svg') return downloadBlob(new Blob([text], { type: 'image/svg+xml' }), `${view.id}.svg`)
      downloadBlob(await svgToPng(text), `${view.id}.png`)
    } catch (e) {
      // An async result the person is waiting for: say it failed, in the status region.
      setExportError(`${labels.exportFailed} ${(e as Error).message}`)
    }
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
        {!proposal && !isUnrooted && (
          <button type="button" onClick={() => setProposing((v) => !v)} aria-expanded={proposing}>
            <Icon name="grip" />
            {labels.propose}
          </button>
        )}
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
        <span className="ot-toolbar-gap" aria-hidden="true" />
        <SupportControl view={view} dispatch={dispatch} labels={labels} />
        {phylogeny && onRooted && (
          <button type="button" onClick={() => root(null)}>
            <Icon name="flip" />
            {labels.midpointRoot}
          </button>
        )}
        {(hasSupport || hasExtinct || traits.length > 0) && <span className="ot-toolbar-gap" aria-hidden="true" />}
        {hasSupport && (
          <button type="button" aria-pressed={Boolean(overlays.support)} onClick={() => { const { support, ...rest } = overlays; setOverlays(support ? rest : { ...rest, support: {} }) }}>
            <Icon name="support" />
            {labels.support}
          </button>
        )}
        {hasExtinct && (
          <button type="button" aria-pressed={Boolean(overlays.extinction)} onClick={() => { const { extinction, ...rest } = overlays; setOverlays(extinction ? rest : { ...rest, extinction: true }) }}>
            <Icon name="fossil" />
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
      {/* Always present, so a screen reader announces a refusal or a failed export when the text appears. */}
      <p className="ot-error" role="status">
        {t.error ?? rootError ?? exportError ?? ''}
      </p>
      {/* Support collapsing hides branches, so what it did is shown and announced as it changes. */}
      <p className="ot-notice ot-support-status" role="status">
        {supportSummary(projection, labels)}
      </p>
      {rootingLine && (
        <p className="ot-notice ot-rooting" role="note">
          {rootingLine}
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
            <button type="button" onClick={() => zoom(0.8)} aria-label={labels.zoomIn} data-tip={labels.zoomIn}>
              <Icon name="zoomIn" />
            </button>
            <button type="button" onClick={() => zoom(1.25)} aria-label={labels.zoomOut} data-tip={labels.zoomOut}>
              <Icon name="zoomOut" />
            </button>
            <button type="button" onClick={() => setBox(null)} aria-label={labels.fit} data-tip={labels.fit}>
              <Icon name="fit" />
            </button>
            <div className="ot-menu">
              <button ref={menuButton} type="button" onClick={() => setMenu((m) => !m)} aria-label={labels.download} data-tip={labels.download} aria-expanded={menu} aria-haspopup="menu">
                <Icon name="download" />
              </button>
              {menu && (
                <div ref={menuList} className="ot-menu-list" role="menu" aria-label={labels.download} onKeyDown={onMenuKeyDown}>
                  <button type="button" role="menuitem" tabIndex={-1} onClick={() => download('svg')}>
                    <Icon name="download" />
                    {labels.downloadSvg}
                  </button>
                  <button type="button" role="menuitem" tabIndex={-1} onClick={() => download('png')}>
                    <Icon name="image" />
                    {labels.downloadPng}
                  </button>
                  <button type="button" role="menuitem" tabIndex={-1} onClick={() => download('view')}>
                    <Icon name="file" />
                    {labels.downloadView}
                  </button>
                </div>
              )}
            </div>
            <button type="button" onClick={() => printDrawing(canvas.current)} aria-label={labels.print} data-tip={labels.print}>
              <Icon name="print" />
            </button>
          </div>
          <TreeView projection={projection} layout={layout} highlights={view.highlights} title={title} interactive hiddenLabel={hidden} viewBox={shown} drag={drag} dropTarget={landing ?? null} overlays={marks} />
          {proposal && (
            <p className="ot-proposed-badge" role="note">
              {labels.proposalBy} {proposal.author}: {proposal.title}
            </p>
          )}
          <div className="ot-print-disclosure" aria-hidden="true">
            {disclosureLines(disclosure, labels.sources).map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        </div>
        <div className="ot-side">
          {proposing && !proposal && (
            <ProposalStart
              labels={labels}
              onCancel={() => setProposing(false)}
              onStart={(title, author) => {
                dispatch({ type: 'startProposal', proposal: { id: `p${Date.now().toString(36)}`, title, author, created: new Date().toISOString() } })
                setProposing(false)
              }}
            />
          )}
          {proposal && <ProposalPanel dataset={dataset} view={view} dispatch={dispatch} labels={labels} />}
          <TreeOutline
            projection={projection}
            label={labels.outline}
            hiddenLabel={hidden}
            extinctLabel={labels.extinct}
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
                {proposal && <ProposalNode dataset={dataset} view={view} node={node.id} projection={projection} dispatch={dispatch} labels={labels} />}
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
                  {phylogeny && onRooted && dataset.phylogeny(phylogeny.id).parent.get(node.id) != null && (
                    <button type="button" onClick={() => root(node.id)}>
                      <Icon name="flip" />
                      {node.isTip ? labels.rootOnTip : labels.rootOnClade}
                    </button>
                  )}
                </div>
                {(view.target.kind === 'classification' && dataset.snapshot.phylogenies.length > 0) && <CladeCheck dataset={dataset} view={view} projection={projection} dispatch={dispatch} labels={labels} single />}
                {renderDetails?.(node.id)}
              </>
            ) : (
              <p className="ot-hint">
                <Icon name="info" />
                <span>
                  {labels.nothingSelected} {labels.dragHint} {labels.multiHint} {labels.keyboardHint}
                </span>
              </p>
            )}
          </section>
        </div>
      </div>
      <Legend layout={layout} highlights={view.highlights} labels={labels} trait={traits.find((tr) => tr.id === overlays.trait)} support={Boolean(overlays.support)} onRemoveHighlight={(id) => dispatch({ type: 'removeHighlight', id })} />
      {phylogeny && others.length > 0 && <ComparePanel key={phylogeny.id} dataset={dataset} view={view} others={others} dispatch={dispatch} labels={labels} />}
      {proposal && proposal.moves.length > 0 && <ProposalCompare dataset={dataset} view={view} labels={labels} title={title} />}
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
      {/* The status region stays mounted, so a new answer is announced when the selection or the hypothesis changes. */}
      <div role="status">
        {words && (
          <div className="ot-assessment-box">
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
      </div>
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

type ProposalProps = { dataset: DatasetIndex; view: TaxonomicView; labels: ExplorerLabels }

const nodeName = (dataset: DatasetIndex, view: TaxonomicView, id: Id | null, labels: ExplorerLabels) => {
  if (id === null) return labels.proposalRoot
  if (view.target.kind === 'classification') return dataset.nameOf(id) ?? id
  const n = dataset.phylogeny(view.target.id).node.get(id)
  return n?.label ?? (n?.concepts?.[0] ? dataset.nameOf(n.concepts[0]) : undefined) ?? id
}

/** Names a new proposal: a proposal always says whose it is. */
function ProposalStart({ labels, onStart, onCancel }: { labels: ExplorerLabels; onStart: (title: string, author: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  return (
    <form
      className="ot-proposal"
      onSubmit={(e) => {
        e.preventDefault()
        if (author.trim()) onStart(title.trim() || labels.proposalDefaultTitle, author.trim())
      }}
    >
      <h3>{labels.propose}</h3>
      <p className="ot-hint">{labels.proposalHint}</p>
      <label>
        {labels.proposalAuthor}
        <input value={author} onChange={(e) => setAuthor(e.target.value)} required />
      </label>
      <label>
        {labels.proposalTitle}
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="ot-inspector-actions">
        <button type="submit">{labels.proposalStart}</button>
        <button type="button" onClick={onCancel}>
          {labels.proposalCancel}
        </button>
      </div>
    </form>
  )
}

/** The moves so far, each reversible (undo and redo work too). */
function ProposalPanel({ dataset, view, dispatch, labels }: ProposalProps & { dispatch: (a: ViewAction) => void }) {
  const p = view.proposal!
  return (
    <section className="ot-proposal" aria-label={labels.propose}>
      <h3>
        {labels.proposalBy} {p.author}: {p.title}
      </h3>
      <p className="ot-hint">{labels.proposalHint}</p>
      {p.moves.length ? (
        <ul>
          {p.moves.map((m) => (
            <li key={m.node}>
              <span>
                <strong>{nodeName(dataset, view, m.node, labels)}</strong> {labels.proposalUnder} {nodeName(dataset, view, m.to, labels)}
              </span>
              <button type="button" onClick={() => dispatch({ type: 'revertMove', node: m.node })}>
                {labels.proposalRevert}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ot-hint">{labels.proposalNoMoves}</p>
      )}
      <div className="ot-inspector-actions">
        <button type="button" onClick={() => dispatch({ type: 'endProposal' })}>
          {labels.proposalLeave}
        </button>
      </div>
    </section>
  )
}

/** For the selected taxon: its accepted and proposed places, what its parent groups gain or lose, and a keyboard way to move it. */
function ProposalNode({ dataset, view, node, projection, dispatch, labels }: ProposalProps & { node: Id; projection: Projection; dispatch: (a: ViewAction) => void }) {
  const accepted = acceptedTree(dataset, view)
  const proposed = viewTree(dataset, view)
  const from = accepted.parent.get(node) ?? null
  const to = proposed.parent.get(node) ?? null
  const comparison = useMemo(() => compareHierarchies(accepted, proposed), [accepted, proposed])
  const change = comparison.changedGroups.find((g) => g.node === node)
  const under = new Set(drawnSubtree(projection, node))
  const name = (id: Id | null) => nodeName(dataset, view, id, labels)
  return (
    <div className="ot-proposal">
      <p>
        <strong>{labels.proposalAccepted}:</strong> {labels.proposalUnder} {name(from)}
        <br />
        <strong>{labels.proposalProposed}:</strong> {labels.proposalUnder} {name(to)}
      </p>
      {change && change.gained.length > 0 && (
        <p>
          <strong>{labels.proposalGained}:</strong> {change.gained.map(name).join(', ')}
        </p>
      )}
      {change && change.lost.length > 0 && (
        <p>
          <strong>{labels.proposalLost}:</strong> {change.lost.map(name).join(', ')}
        </p>
      )}
      <label>
        {labels.proposalMoveUnder}
        <select value={to ?? ''} onChange={(e) => dispatch({ type: 'proposeMove', node, to: e.target.value || null })}>
          {view.target.kind === 'classification' && <option value="">{labels.proposalRoot}</option>}
          {projection.nodes
            .filter((n) => !under.has(n.id) || n.id === to)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
        </select>
      </label>
    </div>
  )
}

/** The accepted and proposed trees side by side, same folds and filters. */
function ProposalCompare({ dataset, view, labels, title }: ProposalProps & { title: string }) {
  const accepted = useMemo(() => {
    const { proposal: _p, ...rest } = view
    return projectView(dataset, { ...rest, order: {} })
  }, [dataset, view])
  const proposed = useMemo(() => projectView(dataset, view), [dataset, view])
  return (
    <details className="ot-compare">
      <summary>{labels.proposalCompare}</summary>
      <div className="ot-compare-panes">
        <div>
          <h4>{labels.proposalAccepted}</h4>
          <TreeView projection={accepted} layout={layoutFor(accepted, 'rectangular')} highlights={[]} title={`${title}: ${labels.proposalAccepted}`} />
        </div>
        <div>
          <h4>
            {labels.proposalBy} {view.proposal!.author}
          </h4>
          <TreeView projection={proposed} layout={layoutFor(proposed, 'rectangular')} highlights={[]} title={`${title}: ${labels.proposalProposed}`} />
        </div>
      </div>
    </details>
  )
}
