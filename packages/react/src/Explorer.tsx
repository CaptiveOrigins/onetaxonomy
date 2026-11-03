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
import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { TreeOutline } from './TreeOutline'
import { TreeView } from './TreeView'

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
  'undo' | 'redo' | 'expandAll' | 'collapseAll' | 'rotate' | 'layout' | 'status' | 'allStatuses' | 'outline' | 'details' | 'nothingSelected' | 'clade' | 'group' | 'hidden' | 'rank' | 'lifeStatus' | 'focus' | 'unfocus',
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

  const move = (id: Id, direction: -1 | 1) => {
    const n = projection.nodes.find((x) => x.id === id)
    if (!n?.parent) return
    const siblings = [...(view.order[n.parent] ?? viewChildren(dataset, view, n.parent))]
    const i = siblings.indexOf(id)
    const j = i + direction
    if (i < 0 || j < 0 || j >= siblings.length) return
    ;[siblings[i], siblings[j]] = [siblings[j]!, siblings[i]!]
    dispatch({ type: 'reorder', node: n.parent, children: siblings })
  }

  return (
    <div className="ot-explorer">
      <div className="ot-toolbar" role="toolbar" aria-label={title}>
        <button type="button" onClick={t.undo} disabled={!t.canUndo}>
          {labels.undo}
        </button>
        <button type="button" onClick={t.redo} disabled={!t.canRedo}>
          {labels.redo}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'expandAll' })}>
          {labels.expandAll}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'collapseAll' })}>
          {labels.collapseAll}
        </button>
        <label>
          {labels.layout}{' '}
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
        <label>
          {labels.status}{' '}
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
        <div className="ot-canvas" style={{ height }}>
          <TreeView
            projection={projection}
            layout={layout}
            highlights={view.highlights}
            title={title}
            interactive
            hiddenLabel={hidden}
            onNodeClick={(id) => dispatch({ type: 'select', nodes: [id] })}
          />
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
                      {labels.rotate}
                    </button>
                  )}
                  <button type="button" onClick={() => dispatch({ type: 'focus', node: view.focus === node.id ? null : node.id })}>
                    {view.focus === node.id ? labels.unfocus : labels.focus}
                  </button>
                </div>
                {renderDetails?.(node.id)}
              </>
            ) : (
              <p>{labels.nothingSelected}</p>
            )}
          </section>
        </div>
      </div>
      <Legend layout={layout} highlights={view.highlights} labels={labels} />
    </div>
  )
}

const viewChildren = (dataset: DatasetIndex, view: TaxonomicView, id: Id) =>
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
