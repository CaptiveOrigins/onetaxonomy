import type { DatasetIndex } from './dataset'
import type { Id, LifeStatus } from './model'
import { assessTaxon, isMonophyletic, type HypothesisRef, type MonophylyResult } from './monophyly'
import { canonicalJson } from './snapshot'
import type { TreeIndex } from './tree'

/**
 * Views (M4): how a hierarchy is *shown*. A view is plain JSON over a pinned
 * snapshot; every change is a `ViewAction` applied by a pure reducer, so the
 * scientific data never changes (invariant I1), undo/redo is a list of states, and
 * a classroom (Phase 2) only needs to share actions.
 */
export const VIEW_FORMAT_VERSION = 1 as const

export type ViewTarget = { kind: 'classification' | 'phylogeny'; id: Id }

export type ViewFilter = {
  /** Life status to show (`unknown` is its own value, I11). Absent = all. */
  status?: LifeStatus[]
  /** Stated ranks to show (case-insensitive). Absent = all. */
  ranks?: string[]
  /** Only concepts from these sources. Absent = all. */
  sources?: Id[]
}

/**
 * A highlighted set of members. `group` is any set; `clade` only when a
 * monophyly assessment against a named hypothesis said so (I3), kept with it.
 */
export type Highlight = {
  id: Id
  label: string
  kind: 'group' | 'clade'
  members: Id[]
  color?: string
  assessment?: MonophylyResult
}

export type LayoutKind = 'rectangular' | 'radial' | 'phylogram' | 'time' | 'sunburst'

export type TaxonomicView = {
  format: 'onetaxonomy-view'
  formatVersion: typeof VIEW_FORMAT_VERSION
  id: Id
  title: string
  snapshot: { id: Id; version: string; checksum?: string }
  target: ViewTarget
  /** Show only this subtree (null = whole hierarchy). */
  focus: Id | null
  collapsed: Id[]
  hidden: Id[]
  /** Display order of a node's children (drag and rotate), by node id. Never changes the data. */
  order: Record<Id, Id[]>
  filter: ViewFilter
  highlights: Highlight[]
  layout: { kind: LayoutKind }
  selected: Id[]
}

export type ViewAction =
  | { type: 'collapse'; node: Id }
  | { type: 'expand'; node: Id }
  | { type: 'toggle'; node: Id }
  | { type: 'collapseAll' }
  | { type: 'expandAll' }
  | { type: 'hide'; node: Id }
  | { type: 'show'; node: Id }
  | { type: 'rotate'; node: Id }
  | { type: 'reorder'; node: Id; children: Id[] }
  | { type: 'resetOrder'; node?: Id }
  | { type: 'focus'; node: Id | null }
  | { type: 'setFilter'; filter: ViewFilter }
  | { type: 'addHighlight'; highlight: Highlight }
  | { type: 'removeHighlight'; id: Id }
  | { type: 'setLayout'; layout: LayoutKind }
  | { type: 'select'; nodes: Id[] }

export class ViewActionError extends Error {
  constructor(
    message: string,
    readonly action: ViewAction,
  ) {
    super(message)
    this.name = 'ViewActionError'
  }
}

/** The hierarchy a view shows. */
export function viewTree(dataset: DatasetIndex, view: Pick<TaxonomicView, 'target'>): TreeIndex {
  return view.target.kind === 'classification' ? dataset.classification(view.target.id) : dataset.phylogeny(view.target.id)
}

export function createView(dataset: DatasetIndex, o: { id: Id; title: string; target: ViewTarget; layout?: LayoutKind }): TaxonomicView {
  viewTree(dataset, o) // throws on an unknown target
  const s = dataset.snapshot
  return {
    format: 'onetaxonomy-view',
    formatVersion: VIEW_FORMAT_VERSION,
    id: o.id,
    title: o.title,
    snapshot: { id: s.id, version: s.version, ...(s.checksum ? { checksum: s.checksum } : {}) },
    target: o.target,
    focus: null,
    collapsed: [],
    hidden: [],
    order: {},
    filter: {},
    highlights: [],
    layout: { kind: o.layout ?? 'rectangular' },
    selected: [],
  }
}

const without = (list: Id[], x: Id) => list.filter((y) => y !== x)
const withOne = (list: Id[], x: Id) => (list.includes(x) ? list : [...list, x])

/**
 * Applies one action and returns a new view (the old one is untouched). Refuses
 * actions on unknown nodes, reorders that aren't a permutation of the children,
 * layouts the hierarchy can't support and clade highlights without support.
 */
export function applyViewAction(view: TaxonomicView, action: ViewAction, dataset: DatasetIndex): TaxonomicView {
  const tree = viewTree(dataset, view)
  const known = (id: Id) => {
    if (!tree.parent.has(id)) throw new ViewActionError(`Unknown node ${id} in ${view.target.kind} ${view.target.id}`, action)
  }
  switch (action.type) {
    case 'collapse':
      known(action.node)
      return { ...view, collapsed: withOne(view.collapsed, action.node) }
    case 'expand':
      known(action.node)
      return { ...view, collapsed: without(view.collapsed, action.node) }
    case 'toggle':
      known(action.node)
      return { ...view, collapsed: view.collapsed.includes(action.node) ? without(view.collapsed, action.node) : [...view.collapsed, action.node] }
    case 'collapseAll':
      return { ...view, collapsed: tree.ids.filter((x) => tree.children.get(x)!.length > 0 && tree.parent.get(x) !== null) }
    case 'expandAll':
      return { ...view, collapsed: [] }
    case 'hide':
      known(action.node)
      return { ...view, hidden: withOne(view.hidden, action.node) }
    case 'show':
      known(action.node)
      return { ...view, hidden: without(view.hidden, action.node) }
    case 'rotate': {
      known(action.node)
      const current = view.order[action.node] ?? [...tree.children.get(action.node)!]
      return { ...view, order: { ...view.order, [action.node]: [...current].reverse() } }
    }
    case 'reorder': {
      known(action.node)
      const kids = tree.children.get(action.node)!
      const same = action.children.length === kids.length && new Set(action.children).size === kids.length && action.children.every((c) => kids.includes(c))
      if (!same) throw new ViewActionError(`Reorder of ${action.node} must list each of its ${kids.length} children once`, action)
      return { ...view, order: { ...view.order, [action.node]: [...action.children] } }
    }
    case 'resetOrder': {
      if (action.node === undefined) return { ...view, order: {} }
      const { [action.node]: _, ...rest } = view.order
      return { ...view, order: rest }
    }
    case 'focus':
      if (action.node !== null) known(action.node)
      return { ...view, focus: action.node }
    case 'setFilter':
      return { ...view, filter: structuredCloneFilter(action.filter) }
    case 'addHighlight': {
      for (const m of action.highlight.members) known(m)
      if (action.highlight.kind === 'clade' && action.highlight.assessment?.status !== 'monophyletic')
        throw new ViewActionError(`“${action.highlight.label}” is not a supported clade here; add it as a group (use makeHighlight)`, action)
      return { ...view, highlights: [...view.highlights.filter((h) => h.id !== action.highlight.id), action.highlight] }
    }
    case 'removeHighlight':
      return { ...view, highlights: view.highlights.filter((h) => h.id !== action.id) }
    case 'setLayout': {
      const problem = layoutProblem(dataset, view.target, action.layout)
      if (problem) throw new ViewActionError(problem, action)
      return { ...view, layout: { kind: action.layout } }
    }
    case 'select':
      for (const n of action.nodes) known(n)
      return { ...view, selected: [...new Set(action.nodes)] }
  }
}

const structuredCloneFilter = (f: ViewFilter): ViewFilter => ({
  ...(f.status ? { status: [...f.status] } : {}),
  ...(f.ranks ? { ranks: [...f.ranks] } : {}),
  ...(f.sources ? { sources: [...f.sources] } : {}),
})

/** Why a layout can't show this hierarchy truthfully (null = it can). */
export function layoutProblem(dataset: DatasetIndex, target: ViewTarget, layout: LayoutKind): string | null {
  if (target.kind === 'classification') {
    return layout === 'phylogram' || layout === 'time' ? 'A classification has no branch lengths or ages: use rectangular, radial or sunburst' : null
  }
  if (layout === 'sunburst') return 'Sunburst is for classifications (nested ranks), not phylogenies'
  const p = dataset.phylogeny(target.id).phylogeny
  if (layout === 'phylogram' && (!p.lengthUnit || p.lengthUnit === 'unspecified' || !p.edges.some((e) => e.length !== undefined)))
    return 'This hypothesis has no branch lengths with a stated unit: a phylogram would invent them'
  if (layout === 'time' && !p.timeCalibrated) return 'This hypothesis is not time-calibrated: a time scale would invent dates'
  return null
}

/**
 * Builds a highlight that is a `clade` only when the members form one in the named
 * hypothesis; otherwise a `group`, keeping the assessment so the reason can be shown.
 * In a phylogeny view, members are its node ids; in a classification view, a single
 * concept can be assessed against a hypothesis through explicit concept mappings.
 */
export function makeHighlight(dataset: DatasetIndex, view: TaxonomicView, o: { id: Id; label: string; members: Id[]; color?: string; hypothesis?: Id }): Highlight {
  let assessment: MonophylyResult | undefined
  if (view.target.kind === 'phylogeny') assessment = isMonophyletic(dataset.phylogeny(view.target.id), o.members)
  else if (o.members.length === 1) assessment = assessTaxon(dataset.classification(view.target.id), o.members[0]!, o.hypothesis ? dataset.phylogeny(o.hypothesis) : null)
  return {
    id: o.id,
    label: o.label,
    kind: assessment?.status === 'monophyletic' ? 'clade' : 'group',
    members: [...o.members],
    ...(o.color ? { color: o.color } : {}),
    ...(assessment ? { assessment } : {}),
  }
}

export type ViewDiagnostic = {
  severity: 'error' | 'warning'
  code: 'format' | 'snapshot-mismatch' | 'unknown-target' | 'unknown-node' | 'bad-order' | 'unsupported-clade' | 'stale-assessment' | 'layout'
  message: string
  ids?: Id[]
}

/** Checks a (possibly hand-edited or older) view against the dataset it is opened with. */
export function validateView(view: TaxonomicView, dataset: DatasetIndex): ViewDiagnostic[] {
  const out: ViewDiagnostic[] = []
  if (view.format !== 'onetaxonomy-view' || view.formatVersion !== VIEW_FORMAT_VERSION) out.push({ severity: 'error', code: 'format', message: `Not a version ${VIEW_FORMAT_VERSION} OneTaxonomy view` })
  const s = dataset.snapshot
  if (view.snapshot.id !== s.id || view.snapshot.version !== s.version || (view.snapshot.checksum && s.checksum && view.snapshot.checksum !== s.checksum))
    out.push({ severity: 'warning', code: 'snapshot-mismatch', message: `View was made for ${view.snapshot.id} ${view.snapshot.version}; this is ${s.id} ${s.version}. Check what changed (diffSnapshots) before relying on it.` })
  let tree: TreeIndex
  try {
    tree = viewTree(dataset, view)
  } catch {
    return [...out, { severity: 'error', code: 'unknown-target', message: `Unknown ${view.target.kind} ${view.target.id}` }]
  }
  const ids = [...view.collapsed, ...view.hidden, ...view.selected, ...(view.focus ? [view.focus] : []), ...Object.keys(view.order), ...view.highlights.flatMap((h) => h.members)]
  const unknown = [...new Set(ids.filter((x) => !tree.parent.has(x)))]
  if (unknown.length) out.push({ severity: 'error', code: 'unknown-node', message: `${unknown.length} node(s) not in this ${view.target.kind}`, ids: unknown })
  for (const [node, kids] of Object.entries(view.order)) {
    const actual = tree.children.get(node)
    if (actual && (kids.length !== actual.length || !kids.every((k) => actual.includes(k)))) out.push({ severity: 'error', code: 'bad-order', message: `Saved order of ${node} doesn't match its children`, ids: [node] })
  }
  for (const h of view.highlights) {
    if (h.kind !== 'clade') continue
    const now = makeHighlight(dataset, view, { id: h.id, label: h.label, members: h.members, ...(hypothesisOf(h.assessment) && view.target.kind === 'classification' ? { hypothesis: hypothesisOf(h.assessment)!.id } : {}) })
    if (now.kind !== 'clade') out.push({ severity: 'error', code: 'unsupported-clade', message: `“${h.label}” is shown as a clade but is ${now.assessment?.status ?? 'not assessed'} here: show it as a group`, ids: [h.id] })
    else if (JSON.stringify(hypothesisOf(now.assessment)) !== JSON.stringify(hypothesisOf(h.assessment))) out.push({ severity: 'warning', code: 'stale-assessment', message: `“${h.label}” was assessed against another hypothesis version`, ids: [h.id] })
  }
  const lp = layoutProblem(dataset, view.target, view.layout.kind)
  if (lp) out.push({ severity: 'error', code: 'layout', message: lp })
  return out
}

const hypothesisOf = (a?: MonophylyResult): HypothesisRef | null => a?.hypothesis ?? null

/** Canonical JSON (stable key order) of a view: the same view always serializes the same. */
export const serializeView = (view: TaxonomicView): string => canonicalJson(view)

export function parseView(text: string): TaxonomicView {
  const v = JSON.parse(text) as TaxonomicView
  if (v?.format !== 'onetaxonomy-view') throw new Error('Not a OneTaxonomy view')
  if (v.formatVersion !== VIEW_FORMAT_VERSION) throw new Error(`View format version ${String(v.formatVersion)} is not supported`)
  return v
}

/** Undo/redo as a list of immutable states. */
export type ViewHistory = { past: TaxonomicView[]; present: TaxonomicView; future: TaxonomicView[] }

export const createHistory = (view: TaxonomicView): ViewHistory => ({ past: [], present: view, future: [] })

export function dispatch(h: ViewHistory, action: ViewAction, dataset: DatasetIndex, { limit = 200 } = {}): ViewHistory {
  const next = applyViewAction(h.present, action, dataset)
  if (serializeView(next) === serializeView(h.present)) return h
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] }
}

export const undo = (h: ViewHistory): ViewHistory => (h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h)
export const redo = (h: ViewHistory): ViewHistory => (h.future.length ? { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) } : h)
