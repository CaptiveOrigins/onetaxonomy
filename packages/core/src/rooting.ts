import type { Id, Phylogeny, PhyloEdge, PhyloNode, Support } from './model'

/** Why a rooting was refused. Nothing is changed; the input is never mutated. */
export class RootingError extends Error {
  constructor(
    message: string,
    readonly code: 'forest' | 'time-calibrated' | 'unknown-node' | 'not-a-tip' | 'empty-outgroup' | 'whole-tree' | 'outgroup-not-a-clade' | 'missing-lengths' | 'too-few-tips',
    readonly ids: Id[] = [],
  ) {
    super(message)
    this.name = 'RootingError'
  }
}

export type RootingOptions = {
  /** Id of the new phylogeny record. */
  id: Id
  version: string
  /** Default: the input's title with “(rerooted on …)” or “(midpoint-rooted)”. */
  title?: string
  /** Why this rooting was chosen, e.g. the study that names the outgroup. Kept in `rooting.note`. */
  note?: string
}

export type OutgroupRootingOptions = RootingOptions & {
  /**
   * Where the root goes along the branch that separates the outgroup, as the
   * fraction of its length on the outgroup's side. Default 0.5. The data doesn't
   * say where on that branch the root is; the choice is recorded.
   */
  position?: number
}

/** One undirected branch. Support belongs to the branch (the split), not to either end. */
type Branch = { a: Id; b: Id; length?: number; support?: Support; additionalSupport?: Support[]; edgeSupport?: Support }
type Graph = { nodes: Map<Id, PhyloNode>; adj: Map<Id, Branch[]>; branches: Branch[]; tips: Id[]; notes: string[] }

const other = (br: Branch, x: Id) => (br.a === x ? br.b : br.a)
const sum = (x?: number, y?: number) => (x === undefined || y === undefined ? undefined : x + y)

/**
 * The hypothesis as an undirected tree. Node support moves onto the branch above the
 * node, so it stays with the split it measures when the tree is re-oriented (a common
 * mistake when rerooting is to leave it on the node). A root with two branches is
 * suppressed: in the unrooted tree it is not a node.
 */
function toGraph(p: Phylogeny): Graph {
  const children = new Set(p.edges.map((e) => e.child))
  const roots = p.nodes.filter((n) => !children.has(n.id))
  if (roots.length !== 1) throw new RootingError(`${p.id} is a forest of ${roots.length} trees; root one tree at a time`, 'forest', roots.map((r) => r.id))
  if (p.timeCalibrated) throw new RootingError(`${p.id} is time-calibrated: its root comes from the dating analysis and can't be moved without new ages`, 'time-calibrated')
  const nodes = new Map(p.nodes.map((n) => [n.id, n]))
  const adj = new Map<Id, Branch[]>(p.nodes.map((n) => [n.id, []]))
  const branches: Branch[] = []
  for (const e of p.edges) {
    const child = nodes.get(e.child)!
    const br: Branch = {
      a: e.parent,
      b: e.child,
      ...(e.length !== undefined ? { length: e.length } : {}),
      ...(child.support ? { support: child.support } : {}),
      ...(child.additionalSupport ? { additionalSupport: child.additionalSupport } : {}),
      ...(e.support ? { edgeSupport: e.support } : {}),
    }
    branches.push(br)
    adj.get(e.parent)!.push(br)
    adj.get(e.child)!.push(br)
  }
  const notes: string[] = []
  const root = roots[0]!.id
  const rb = adj.get(root)!
  if (rb.length === 2) {
    // The two branches below a two-way root are one branch of the unrooted tree.
    const [x, y] = rb as [Branch, Branch]
    const u = other(x, root)
    const v = other(y, root)
    const supports = [x, y].filter((br) => br.support)
    if (supports.length === 2 && JSON.stringify(x.support) !== JSON.stringify(y.support))
      notes.push(`The two branches below the old root carried different support (${x.support!.value}, ${y.support!.value}) for the same split; ${x.support!.value} was kept.`)
    const merged: Branch = { a: u, b: v }
    const length = sum(x.length, y.length)
    if (length !== undefined) merged.length = length
    const kept = supports[0]
    if (kept) {
      merged.support = kept.support!
      if (kept.additionalSupport) merged.additionalSupport = kept.additionalSupport
    }
    const edgeSupport = x.edgeSupport ?? y.edgeSupport
    if (edgeSupport) merged.edgeSupport = edgeSupport
    if ((x.length === undefined) !== (y.length === undefined)) notes.push('One branch below the old root had no length, so the joined branch has none.')
    branches.splice(branches.indexOf(x), 1)
    branches.splice(branches.indexOf(y), 1)
    branches.push(merged)
    adj.set(u, adj.get(u)!.map((br) => (br === x ? merged : br)))
    adj.set(v, adj.get(v)!.map((br) => (br === y ? merged : br)))
    adj.delete(root)
    nodes.delete(root)
    notes.push(`The old root ${root}${roots[0]!.label ? ` (“${roots[0]!.label}”)` : ''} had two branches, so it is not a node of the unrooted tree and was dropped; its branches were joined.`)
  }
  const tips = [...adj].filter(([, bs]) => bs.length === 1).map(([id]) => id)
  return { nodes, adj, branches, tips, notes }
}

/** Splits branch `br` with a new root node, `fraction` of its length on `br.a`'s side, and orients everything away from it. */
function orient(p: Phylogeny, g: Graph, root: { node: Id } | { branch: Branch; lengths: [toA: number, toB: number] | undefined; first?: Id }, o: RootingOptions, rooting: NonNullable<Phylogeny['rooting']>): Phylogeny {
  const prefix = o.id
  let rootId: Id
  const adj = new Map([...g.adj].map(([k, v]) => [k, [...v]]))
  const nodes: PhyloNode[] = []
  if ('node' in root) rootId = root.node
  else {
    rootId = `${prefix}:root`
    for (let i = 2; g.nodes.has(rootId); i++) rootId = `${prefix}:root${i}`
    const { branch: br, lengths } = root
    const toA: Branch = { a: rootId, b: br.a, ...(lengths ? { length: lengths[0] } : {}) }
    const toB: Branch = { a: rootId, b: br.b, ...(lengths ? { length: lengths[1] } : {}) }
    // Both new branches are the same split: its support goes to each side that is a clade of more than one tip.
    for (const nb of [toA, toB]) {
      if (adj.get(nb.b)!.length > 1) Object.assign(nb, br.support ? { support: br.support } : {}, br.additionalSupport ? { additionalSupport: br.additionalSupport } : {}, br.edgeSupport ? { edgeSupport: br.edgeSupport } : {})
    }
    adj.set(br.a, adj.get(br.a)!.map((x) => (x === br ? toA : x)))
    adj.set(br.b, adj.get(br.b)!.map((x) => (x === br ? toB : x)))
    adj.set(rootId, root.first === br.b ? [toB, toA] : [toA, toB])
    nodes.push({ id: rootId, annotations: { insertedBy: `${rooting.method} rooting` } })
  }
  const edges: PhyloEdge[] = []
  const seen = new Set<Id>([rootId])
  const queue: Id[] = [rootId]
  if ('node' in root) nodes.push(strip(g.nodes.get(rootId)!))
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i]!
    for (const br of adj.get(x)!) {
      const c = other(br, x)
      if (seen.has(c)) continue
      seen.add(c)
      queue.push(c)
      nodes.push({ ...strip(g.nodes.get(c)!), ...(br.support ? { support: br.support } : {}), ...(br.additionalSupport ? { additionalSupport: br.additionalSupport } : {}) })
      edges.push({ id: `${prefix}:e${edges.length}`, parent: x, child: c, ...(br.length !== undefined ? { length: br.length } : {}), ...(br.edgeSupport ? { support: br.edgeSupport } : {}) })
    }
  }
  const { timeCalibrated: _t, rooting: _r, ...rest } = p
  return { ...rest, id: o.id, version: o.version, title: o.title ?? p.title, rooted: true, rooting, nodes, edges }
}

/** A node without its support (support is re-attached from its branch). Copies, never shares, the input's arrays. */
function strip(n: PhyloNode): PhyloNode {
  const { support: _s, additionalSupport: _a, ...rest } = n
  return JSON.parse(JSON.stringify(rest)) as PhyloNode
}

const describeFrom = (p: Phylogeny) => `${p.id} version ${p.version} (${p.rooted ? `rooted${p.rooting ? ` by ${p.rooting.method}` : ''}` : 'unrooted'})`

/**
 * Roots a hypothesis on an outgroup: one tip, or several tips that together form
 * one side of a branch (a clade in every rooting). Returns a new phylogeny record
 * that says it was rerooted, on what, and from which record; the input is not
 * changed (sealed snapshots stay sealed). Node support stays with its split, and a
 * two-way old root is dropped because it isn't a node of the unrooted tree.
 *
 * Refuses forests, time-calibrated hypotheses (their root comes from the dating),
 * unknown or internal node ids, and outgroups that aren't one side of a branch.
 */
export function rerootPhylogeny(p: Phylogeny, outgroup: Id | readonly Id[], o: OutgroupRootingOptions): Phylogeny {
  const wanted = [...new Set(typeof outgroup === 'string' ? [outgroup] : outgroup)]
  if (!wanted.length) throw new RootingError('Name at least one outgroup tip', 'empty-outgroup')
  const fraction = o.position ?? 0.5
  if (!(fraction >= 0 && fraction <= 1)) throw new RangeError('position must be between 0 and 1')
  const g = toGraph(p)
  const unknown = wanted.filter((x) => !p.nodes.some((n) => n.id === x))
  if (unknown.length) throw new RootingError(`Unknown node(s) in ${p.id}: ${unknown.join(', ')}`, 'unknown-node', unknown)
  const tipSet = new Set(g.tips)
  const internal = wanted.filter((x) => !tipSet.has(x))
  if (internal.length) throw new RootingError(`Outgroup must be given as tips; ${internal.join(', ')} ${internal.length === 1 ? 'is' : 'are'} not (an internal node has no fixed side in an unrooted tree)`, 'not-a-tip', internal)
  if (wanted.length >= g.tips.length) throw new RootingError('The outgroup is the whole tree; leave at least one tip in the ingroup', 'whole-tree', wanted)

  // Tips on the far side of each branch, seen from the first ingroup tip.
  const out = new Set(wanted)
  const start = g.tips.find((t) => !out.has(t))!
  const below = new Map<Id, number>() // outgroup tips beyond a node, away from `start`
  const total = new Map<Id, number>() // all tips beyond it
  const parentBranch = new Map<Id, Branch>()
  const order: Id[] = [start]
  const seen = new Set([start])
  for (let i = 0; i < order.length; i++) {
    const x = order[i]!
    for (const br of g.adj.get(x)!) {
      const c = other(br, x)
      if (seen.has(c)) continue
      seen.add(c)
      parentBranch.set(c, br)
      order.push(c)
    }
  }
  for (const x of [...order].reverse()) {
    const kids = g.adj.get(x)!.filter((br) => br !== parentBranch.get(x)).map((br) => other(br, x))
    const isTip = g.adj.get(x)!.length === 1
    below.set(x, (out.has(x) ? 1 : 0) + kids.reduce((n, k) => n + below.get(k)!, 0))
    total.set(x, (isTip && x !== start ? 1 : 0) + kids.reduce((n, k) => n + total.get(k)!, 0))
  }
  const hit = order.find((x) => x !== start && below.get(x) === wanted.length && total.get(x) === wanted.length)
  if (!hit)
    throw new RootingError(`The outgroup (${wanted.join(', ')}) is not one side of any branch of ${p.id}: it isn't a clade however the tree is rooted`, 'outgroup-not-a-clade', wanted)
  const br = parentBranch.get(hit)!
  // The outgroup's share of the branch first, the rest by subtraction (so 0.2 stays 0.2, not 0.19999…).
  const toOutgroup = br.length !== undefined ? br.length * fraction : undefined
  const lengths: [number, number] | undefined = toOutgroup === undefined ? undefined : br.a === hit ? [toOutgroup, br.length! - toOutgroup] : [br.length! - toOutgroup, toOutgroup]
  const label = wanted.map((x) => p.nodes.find((n) => n.id === x)!.label ?? x).join(', ')
  const rooting = {
    method: 'outgroup',
    note: [
      `Rerooted on the outgroup ${label} (${wanted.join(', ')}) from ${describeFrom(p)}.`,
      br.length !== undefined ? `The root was placed at ${fraction} of the outgroup branch's length from the outgroup; the data doesn't say where on that branch it lies.` : '',
      ...g.notes,
      o.note ?? '',
    ].filter(Boolean).join(' '),
    outgroup: wanted,
    from: { id: p.id, version: p.version },
  }
  return orient(p, g, { branch: br, lengths, first: hit }, { ...o, title: o.title ?? `${p.title} (rerooted on ${label})` }, rooting)
}

/**
 * Midpoint rooting, only when asked for: the root goes halfway along the longest
 * tip-to-tip path. It assumes roughly equal rates of change across lineages, so the
 * new record says it was midpoint-rooted and is not an outgroup rooting. Needs a
 * length on every branch; refuses otherwise, and refuses forests and time-calibrated
 * hypotheses. The input is not changed.
 */
export function midpointRoot(p: Phylogeny, o: RootingOptions): Phylogeny {
  const g = toGraph(p)
  if (g.tips.length < 2) throw new RootingError('Midpoint rooting needs at least two tips', 'too-few-tips')
  const missing = g.branches.filter((br) => br.length === undefined)
  if (missing.length) throw new RootingError(`${missing.length} branch(es) have no length; midpoint rooting would invent them`, 'missing-lengths', missing.map((br) => br.b))
  const farthest = (from: Id) => {
    const dist = new Map<Id, number>([[from, 0]])
    const via = new Map<Id, Branch>()
    const queue = [from]
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i]!
      for (const br of g.adj.get(x)!) {
        const c = other(br, x)
        if (dist.has(c)) continue
        dist.set(c, dist.get(x)! + br.length!)
        via.set(c, br)
        queue.push(c)
      }
    }
    // Ties go to the tip that comes first in the input, so the result is deterministic.
    const others = g.tips.filter((t) => t !== from)
    let best = others[0]!
    for (const t of others) if (dist.get(t)! > dist.get(best)! + 1e-12) best = t
    const ties = g.tips.filter((t) => t !== best && Math.abs(dist.get(t)! - dist.get(best)!) <= 1e-12)
    return { best, dist, via, ties }
  }
  const x = farthest(g.tips[0]!).best
  const { best: y, dist, via, ties } = farthest(x)
  const half = dist.get(y)! / 2
  // Walk from y back toward x until the midpoint is passed.
  let at = y
  let fromY = 0
  let root: Parameters<typeof orient>[2] | null = null
  while (at !== x) {
    const br = via.get(at)!
    const next = other(br, at)
    if (Math.abs(fromY - half) <= 1e-12) {
      root = { node: at }
      break
    }
    if (fromY + br.length! > half + 1e-12) {
      // The midpoint is inside this branch, (half − fromY) from `at`.
      const fromAt = half - fromY
      root = { branch: br, lengths: br.a === at ? [fromAt, br.length! - fromAt] : [br.length! - fromAt, fromAt] }
      break
    }
    fromY += br.length!
    at = next
  }
  root ??= { node: x }
  const name = (id: Id) => g.nodes.get(id)!.label ?? id
  const rooting = {
    method: 'midpoint',
    note: [
      `Midpoint-rooted from ${describeFrom(p)}: the root is halfway along the longest tip-to-tip path, between ${name(x)} and ${name(y)} (${dist.get(y)} ${p.lengthUnit ?? 'units not stated'}). This assumes roughly equal rates of change across lineages; it is not an outgroup rooting.`,
      ties.length ? `Other tips are as far from ${name(x)} as ${name(y)} (${ties.map(name).join(', ')}); the longest path is not unique, so another midpoint rooting is equally valid.` : '',
      ...g.notes,
      o.note ?? '',
    ].filter(Boolean).join(' '),
    from: { id: p.id, version: p.version },
  }
  return orient(p, g, root, { ...o, title: o.title ?? `${p.title} (midpoint-rooted)` }, rooting)
}
