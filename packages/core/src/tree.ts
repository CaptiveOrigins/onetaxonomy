import type { Classification, Id, Phylogeny, PhyloEdge, PhyloNode } from './model'

/**
 * A read-only index over one hierarchy: a classification or a phylogeny. Children
 * keep input order (deterministic). Built once per hierarchy; traversal is iterative
 * and bounded, so deep or large trees don't overflow the stack.
 */
export type TreeIndex = {
  kind: 'classification' | 'phylogeny'
  id: Id
  version: string
  ids: Id[]
  parent: ReadonlyMap<Id, Id | null>
  children: ReadonlyMap<Id, readonly Id[]>
  roots: readonly Id[]
  depth: ReadonlyMap<Id, number>
  rootOf: ReadonlyMap<Id, Id>
}

export type PhylogenyIndex = TreeIndex & {
  kind: 'phylogeny'
  rooted: boolean
  phylogeny: Phylogeny
  node: ReadonlyMap<Id, PhyloNode>
  /** Edge leading into each non-root node. */
  edgeTo: ReadonlyMap<Id, PhyloEdge>
  tips: readonly Id[]
  /** Explicit concept → node mappings (never inferred from labels). */
  nodesForConcept: ReadonlyMap<Id, readonly Id[]>
}

export type ClassificationIndex = TreeIndex & { kind: 'classification'; classification: Classification }

/** Thrown when a hierarchy can't be indexed (run `validateDataset` for full diagnostics). */
export class HierarchyError extends Error {
  constructor(
    message: string,
    readonly code: 'cycle' | 'duplicate-id' | 'dangling-parent' | 'multiple-parents',
    readonly ids: Id[],
  ) {
    super(message)
    this.name = 'HierarchyError'
  }
}

function build(kind: TreeIndex['kind'], id: Id, version: string, ids: Id[], links: [child: Id, parent: Id | null][]): TreeIndex {
  const known = new Set<Id>()
  for (const x of ids) {
    if (known.has(x)) throw new HierarchyError(`Duplicate id ${x}`, 'duplicate-id', [x])
    known.add(x)
  }
  const parent = new Map<Id, Id | null>(ids.map((x) => [x, null]))
  const children = new Map<Id, Id[]>(ids.map((x) => [x, []]))
  const seenChild = new Set<Id>()
  for (const [c, p] of links) {
    if (seenChild.has(c)) throw new HierarchyError(`${c} has more than one parent`, 'multiple-parents', [c])
    seenChild.add(c)
    if (p === null) continue
    if (!known.has(p) || !known.has(c)) throw new HierarchyError(`Link ${p} → ${c} names an unknown id`, 'dangling-parent', [c, p])
    parent.set(c, p)
    children.get(p)!.push(c)
  }
  const roots = ids.filter((x) => parent.get(x) === null)
  // Breadth-first from the roots; anything unreached sits on a cycle.
  const depth = new Map<Id, number>()
  const rootOf = new Map<Id, Id>()
  const queue: Id[] = []
  for (const r of roots) {
    depth.set(r, 0)
    rootOf.set(r, r)
    queue.push(r)
  }
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i]!
    for (const c of children.get(x)!) {
      depth.set(c, depth.get(x)! + 1)
      rootOf.set(c, rootOf.get(x)!)
      queue.push(c)
    }
  }
  if (depth.size !== ids.length) {
    const onCycle = ids.filter((x) => !depth.has(x))
    throw new HierarchyError(`Cycle through ${onCycle.slice(0, 5).join(', ')}`, 'cycle', onCycle)
  }
  return { kind, id, version, ids, parent, children, roots, depth, rootOf }
}

export function indexClassification(c: Classification): ClassificationIndex {
  const base = build(
    'classification',
    c.id,
    c.version,
    c.placements.map((p) => p.concept),
    c.placements.map((p) => [p.concept, p.parent]),
  )
  return { ...base, kind: 'classification', classification: c }
}

export function indexPhylogeny(p: Phylogeny): PhylogenyIndex {
  const base = build(
    'phylogeny',
    p.id,
    p.version,
    p.nodes.map((n) => n.id),
    p.edges.map((e) => [e.child, e.parent]),
  )
  const nodesForConcept = new Map<Id, Id[]>()
  for (const n of p.nodes) for (const c of n.concepts ?? []) nodesForConcept.set(c, [...(nodesForConcept.get(c) ?? []), n.id])
  return {
    ...base,
    kind: 'phylogeny',
    rooted: p.rooted,
    phylogeny: p,
    node: new Map(p.nodes.map((n) => [n.id, n])),
    edgeTo: new Map(p.edges.map((e) => [e.child, e])),
    tips: base.ids.filter((x) => base.children.get(x)!.length === 0),
    nodesForConcept,
  }
}

export type Bounds = {
  /** Stop after this many levels below the start (descendants) or above it (ancestors). */
  maxDepth?: number
  /** Return at most this many ids; `truncated` tells whether more existed. */
  limit?: number
}
export type BoundedIds = { ids: Id[]; truncated: boolean }

const has = (t: TreeIndex, id: Id) => {
  if (!t.parent.has(id)) throw new RangeError(`Unknown id ${id} in ${t.kind} ${t.id}`)
}

export function getChildren(t: TreeIndex, id: Id): readonly Id[] {
  has(t, id)
  return t.children.get(id)!
}

export function getParent(t: TreeIndex, id: Id): Id | null {
  has(t, id)
  return t.parent.get(id)!
}

/** Ancestors from the parent upward (nearest first). */
export function getAncestors(t: TreeIndex, id: Id, { maxDepth = Infinity, limit = Infinity }: Bounds = {}): BoundedIds {
  has(t, id)
  const ids: Id[] = []
  let p = t.parent.get(id)!
  while (p !== null && ids.length < maxDepth) {
    if (ids.length >= limit) return { ids, truncated: true }
    ids.push(p)
    p = t.parent.get(p)!
  }
  return { ids, truncated: p !== null }
}

/** The path from the root down to `id`, inclusive. */
export function getLineage(t: TreeIndex, id: Id): Id[] {
  return [...getAncestors(t, id).ids].reverse().concat(id)
}

/** Descendants in breadth-first order (excluding `id`), bounded by depth and count. */
export function getDescendants(t: TreeIndex, id: Id, { maxDepth = Infinity, limit = Infinity, tipsOnly = false }: Bounds & { tipsOnly?: boolean } = {}): BoundedIds {
  has(t, id)
  const ids: Id[] = []
  const start = t.depth.get(id)!
  const queue: Id[] = [...t.children.get(id)!]
  let truncated = false
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i]!
    const kids = t.children.get(x)!
    if (!tipsOnly || kids.length === 0) {
      if (ids.length >= limit) {
        truncated = true
        break
      }
      ids.push(x)
    }
    if (t.depth.get(x)! - start < maxDepth) queue.push(...kids)
    else if (kids.length) truncated = true
  }
  return { ids, truncated }
}

/** All terminals under `id` (itself if it is one). Unbounded: use on phylogenies you have indexed. */
export function tipsUnder(t: TreeIndex, id: Id): Id[] {
  return t.children.get(id)!.length === 0 ? [id] : getDescendants(t, id, { tipsOnly: true }).ids
}
