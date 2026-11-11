import type { DatasetIndex } from './dataset'
import type { Id, LengthUnit, LifeStatus } from './model'
import type { PhylogenyIndex } from './tree'
import { viewTree, type TaxonomicView, type ViewFilter } from './view'

export type ProjectedNode = {
  id: Id
  parent: Id | null
  /** Depth below the projection's root(s) (0 = a root). */
  depth: number
  /** Display label: the accepted name (classification) or the node label / mapped names (phylogeny). */
  label: string
  /** Taxon concepts this node stands for (the concept itself in a classification). */
  concepts: Id[]
  rank?: string
  status: LifeStatus
  /** A leaf of the data (not merely collapsed). */
  isTip: boolean
  collapsed: boolean
  /** Visible children, in display order. */
  children: Id[]
  /** Descendants not drawn under this node (collapsed, hidden or filtered): disclosed, never dropped silently (I13). */
  hiddenDescendants: number
  highlights: Id[]
  selected: boolean
  /** Moved by the view's proposal. */
  moved?: boolean
  /** Length of the edge into this node, in the projection's `lengthUnit` (phylogenies only). */
  length?: number
  age?: number
  support?: number
}

export type Projection = {
  kind: 'classification' | 'phylogeny'
  target: Id
  version: string
  /** Visible nodes in preorder (parents before children, display order). */
  nodes: ProjectedNode[]
  roots: Id[]
  /** `supportCollapsed`: internal nodes not drawn because the view collapses low-support branches (present only then). */
  counts: { total: number; shown: number; hidden: number; filtered: number; collapsed: number; outsideFocus: number; supportCollapsed?: number }
  truncated: boolean
  rooted?: boolean
  lengthUnit?: LengthUnit
  timeCalibrated?: boolean
  /**
   * Branches drawn as polytomies because their support is below the view's threshold
   * (`TaxonomicView.supportCollapse`). `collapsed` lists the nodes whose incoming branch
   * was removed from the drawing; their children hang from the node above, with that
   * branch's length added so distances from the root are unchanged. `withoutSupport`
   * counts internal branches with no support value: they are never collapsed, since
   * no value is not a low value.
   */
  supportCollapse?: { threshold: number; collapsed: Id[]; withoutSupport: number }
  /** The drawing shows a proposal, not the accepted arrangement. */
  proposed?: { title: string; author: string; moved: Id[] }
}

/**
 * Projects a view onto its hierarchy: which nodes to draw, in which order, with
 * counts of everything not drawn. Pure and deterministic; the snapshot is only read.
 */
export function projectView(dataset: DatasetIndex, view: TaxonomicView, { limit = 10_000 }: { limit?: number } = {}): Projection {
  const tree = viewTree(dataset, view)
  const movedIds = new Set(view.proposal?.moves.map((m) => m.node) ?? [])
  const phy = view.target.kind === 'phylogeny' ? (tree as PhylogenyIndex) : null
  const profileStatus = new Map((dataset.snapshot.profiles ?? []).filter((p) => p.status).map((p) => [p.concept, p.status!]))

  const conceptsOf = (id: Id): Id[] => (phy ? [...(phy.node.get(id)!.concepts ?? [])] : [id])
  const statusOf = (id: Id): LifeStatus => {
    if (phy) {
      const own = phy.node.get(id)!.status
      if (own) return own
    }
    const statuses = [...new Set(conceptsOf(id).map((c) => profileStatus.get(c) ?? 'unknown'))]
    return statuses.length === 1 ? statuses[0]! : 'unknown'
  }
  const rankOf = (id: Id) => {
    const cs = conceptsOf(id)
    return cs.length === 1 ? dataset.concept.get(cs[0]!)?.rank : undefined
  }
  const labelOf = (id: Id) => {
    if (!phy) return dataset.nameOf(id) ?? id
    const n = phy.node.get(id)!
    return n.label ?? conceptsOf(id).map((c) => dataset.nameOf(c) ?? c).join(' / ')
  }
  const sourcesOf = (id: Id) => conceptsOf(id).flatMap((c) => {
    const con = dataset.concept.get(c)
    return con?.provenance ? [con.provenance.source] : []
  })
  const passes = filterTest(view.filter, { statusOf, rankOf, sourcesOf })

  const hidden = new Set(view.hidden)
  const collapsed = new Set(view.collapsed)
  const selected = new Set(view.selected)
  const highlightsOf = new Map<Id, Id[]>()
  for (const h of view.highlights) for (const m of h.members) highlightsOf.set(m, [...(highlightsOf.get(m) ?? []), h.id])
  const kids = (id: Id) => {
    const data = tree.children.get(id)!
    const custom = view.order[id]
    return custom && custom.length === data.length ? custom : data
  }

  const starts = view.focus !== null ? [view.focus] : [...tree.roots]
  // Post-order: does a node or any descendant pass the filter (structure is kept for passing descendants)?
  const keep = new Map<Id, boolean>()
  const size = new Map<Id, number>() // subtree size including the node
  const stack: [Id, boolean][] = starts.map((s) => [s, false])
  while (stack.length) {
    const [id, done] = stack.pop()!
    const ch = tree.children.get(id)!
    if (!done) {
      stack.push([id, true])
      for (const c of ch) stack.push([c, false])
      continue
    }
    keep.set(id, passes(id) || ch.some((c) => keep.get(c)))
    size.set(id, 1 + ch.reduce((n, c) => n + size.get(c)!, 0))
  }

  const total = tree.ids.length
  const inScope = starts.reduce((n, s) => n + size.get(s)!, 0)
  const counts: Projection['counts'] = { total, shown: 0, hidden: 0, filtered: 0, collapsed: 0, outsideFocus: total - inScope }
  const nodes: ProjectedNode[] = []
  const byId = new Map<Id, ProjectedNode>()
  let truncated = false
  const walk: { id: Id; parent: Id | null; depth: number; extra?: number | undefined }[] = [...starts].reverse().map((id) => ({ id, parent: null, depth: 0 }))
  const roots: Id[] = []
  // Support collapsing (display only): an internal, non-start node below the threshold is not drawn;
  // its children are drawn under its parent. Explicitly collapsed nodes are the user's choice and stay.
  const threshold = phy && view.supportCollapse ? view.supportCollapse.threshold : null
  const supportOf = (id: Id) => phy!.node.get(id)!.support?.value ?? phy!.edgeTo.get(id)?.support?.value
  const supportCollapsed: Id[] = []
  let withoutSupport = 0
  while (walk.length) {
    const { id, parent, depth, extra } = walk.pop()!
    const parentNode = parent !== null ? byId.get(parent)! : null
    if (hidden.has(id)) {
      counts.hidden += size.get(id)!
      if (parentNode) parentNode.hiddenDescendants += size.get(id)!
      continue
    }
    if (!keep.get(id)) {
      counts.filtered += size.get(id)!
      if (parentNode) parentNode.hiddenDescendants += size.get(id)!
      continue
    }
    if (threshold !== null && parent !== null && tree.children.get(id)!.length > 0 && !collapsed.has(id)) {
      const value = supportOf(id)
      if (value === undefined) withoutSupport++
      else if (value < threshold) {
        supportCollapsed.push(id)
        counts.supportCollapsed = (counts.supportCollapsed ?? 0) + 1
        // The removed branch's length is added to the children's, so distances from the root stay the same.
        // A missing length stays missing (NaN): the children are then drawn without one, never with a guess.
        const carried = (phy!.edgeTo.get(id)?.length ?? Number.NaN) + (extra ?? 0)
        for (const c of [...kids(id)].reverse()) walk.push({ id: c, parent, depth, extra: carried })
        continue
      }
    }
    if (nodes.length >= limit) {
      truncated = true
      continue
    }
    const data = phy?.node.get(id)
    const edge = phy?.edgeTo.get(id)
    const node: ProjectedNode = {
      id,
      parent,
      depth,
      label: labelOf(id),
      concepts: conceptsOf(id),
      ...(rankOf(id) ? { rank: rankOf(id)! } : {}),
      status: statusOf(id),
      isTip: tree.children.get(id)!.length === 0,
      collapsed: collapsed.has(id) && tree.children.get(id)!.length > 0,
      children: [],
      hiddenDescendants: 0,
      highlights: highlightsOf.get(id) ?? [],
      selected: selected.has(id),
      ...(movedIds.has(id) ? { moved: true } : {}),
      ...(edge?.length !== undefined && !Number.isNaN(extra) ? { length: edge.length + (extra ?? 0) } : {}),
      ...(data?.age ? { age: data.age.value } : {}),
      ...(data?.support ? { support: data.support.value } : {}),
    }
    nodes.push(node)
    byId.set(id, node)
    counts.shown++
    if (parentNode) parentNode.children.push(id)
    else roots.push(id)
    if (node.collapsed) {
      const below = size.get(id)! - 1
      node.hiddenDescendants += below
      counts.collapsed += below
      continue
    }
    for (const c of [...kids(id)].reverse()) walk.push({ id: c, parent: id, depth: depth + 1 })
  }

  return {
    kind: view.target.kind,
    target: tree.id,
    version: tree.version,
    nodes,
    roots,
    counts,
    truncated,
    ...(threshold !== null ? { supportCollapse: { threshold, collapsed: supportCollapsed, withoutSupport } } : {}),
    ...(view.proposal ? { proposed: { title: view.proposal.title, author: view.proposal.author, moved: [...movedIds] } } : {}),
    ...(phy ? { rooted: phy.rooted, ...(phy.phylogeny.lengthUnit ? { lengthUnit: phy.phylogeny.lengthUnit } : {}), timeCalibrated: Boolean(phy.phylogeny.timeCalibrated) } : {}),
  }
}

function filterTest(f: ViewFilter, get: { statusOf: (id: Id) => LifeStatus; rankOf: (id: Id) => string | undefined; sourcesOf: (id: Id) => Id[] }) {
  const ranks = f.ranks ? new Set(f.ranks.map((r) => r.toLowerCase())) : null
  const status = f.status ? new Set(f.status) : null
  const sources = f.sources ? new Set(f.sources) : null
  return (id: Id) =>
    (!status || status.has(get.statusOf(id))) &&
    (!ranks || ranks.has((get.rankOf(id) ?? '').toLowerCase())) &&
    (!sources || get.sourcesOf(id).some((s) => sources.has(s)))
}
