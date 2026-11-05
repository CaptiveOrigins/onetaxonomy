import type { Classification, Id, PhyloEdge, Phylogeny } from './model'
import { indexClassification, indexPhylogeny, type TreeIndex } from './tree'

/**
 * Proposed mode: someone's own idea of where taxa belong, drawn on top of an accepted
 * hierarchy. A proposal is a list of moves, never an edit: `applyProposal` builds a new
 * derived hierarchy, marked as proposed, and the accepted data stays untouched (invariant
 * I1). It always names its author, so it can't be mistaken for an accepted arrangement.
 */
export type ProposalBase = { kind: 'classification' | 'phylogeny'; id: Id; version: string }

/** One taxon's new parent. `from` is its accepted parent, kept so a reader sees both. */
export type ProposalMove = { node: Id; from: Id | null; to: Id | null; note?: string }

export type Proposal = {
  id: Id
  title: string
  author: string
  /** ISO date; supplied by the caller (core stays pure). */
  created: string
  notes?: string
  base: ProposalBase
  /** At most one per node: moves always start from the accepted placement. */
  moves: ProposalMove[]
}

export type ProposedFrom = { proposal: Id; title: string; author: string; base: ProposalBase; moved: Id[] }
export type ProposedClassification = Classification & { proposed: ProposedFrom }
export type ProposedPhylogeny = Phylogeny & { proposed: ProposedFrom }

export class ProposalError extends Error {
  constructor(message: string, readonly node?: Id) {
    super(message)
    this.name = 'ProposalError'
  }
}

/** The new parent of every moved node; refuses unknown nodes, stale moves, duplicates and cycles. */
function checkedParents(ids: Iterable<Id>, parentOf: (id: Id) => Id | null, proposal: Proposal, allowRootMoves: boolean): Map<Id, Id | null> {
  const known = new Set(ids)
  const moved = new Map<Id, Id | null>()
  for (const m of proposal.moves) {
    if (!known.has(m.node)) throw new ProposalError(`Unknown node ${m.node}`, m.node)
    if (m.to !== null && !known.has(m.to)) throw new ProposalError(`Unknown new parent ${m.to}`, m.node)
    if (moved.has(m.node)) throw new ProposalError(`${m.node} is moved twice`, m.node)
    if (parentOf(m.node) !== m.from) throw new ProposalError(`${m.node} is no longer under ${m.from ?? 'the root'} in this version`, m.node)
    if (m.to === m.node) throw new ProposalError(`${m.node} can’t be its own parent`, m.node)
    if (m.to === null && !allowRootMoves) throw new ProposalError('A move here needs a new parent: a rooted hypothesis keeps its root', m.node)
    moved.set(m.node, m.to)
  }
  const parent = (id: Id) => (moved.has(id) ? moved.get(id)! : parentOf(id))
  for (const m of proposal.moves) {
    // Walk up from each moved node; meeting it again means it was moved under its own descendant.
    let at = parent(m.node)
    for (let steps = 0; at !== null; steps++) {
      if (at === m.node || steps > known.size) throw new ProposalError(`Moving ${m.node} under ${m.to} would put it under its own descendant`, m.node)
      at = parent(at)
    }
  }
  return moved
}

const checkBase = (proposal: Proposal, kind: ProposalBase['kind'], base: { id: Id; version: string }) => {
  const b = proposal.base
  if (b.kind !== kind || b.id !== base.id) throw new ProposalError(`This proposal is based on ${b.kind} ${b.id}, not ${kind} ${base.id}`)
  if (b.version !== base.version) throw new ProposalError(`This proposal is based on version ${b.version}; this is version ${base.version}`)
}

const proposedFrom = (p: Proposal): ProposedFrom => ({ proposal: p.id, title: p.title, author: p.author, base: p.base, moved: p.moves.map((m) => m.node) })

const derived = (id: Id, p: Proposal) => ({
  id: `${id}~${p.id}`,
  title: `Proposed by ${p.author}: ${p.title}`,
  version: `${p.base.version}+${p.id}`,
})

/** Applies a proposal to a classification. */
export function applyToClassification(base: Classification, proposal: Proposal): ProposedClassification {
  checkBase(proposal, 'classification', base)
  const index = indexClassification(base)
  const moved = checkedParents(index.ids, (id) => index.parent.get(id) ?? null, proposal, true)
  return {
    ...base,
    ...derived(base.id, proposal),
    // A moved placement is the proposer's, so it doesn't keep the source's provenance.
    placements: base.placements.map((p) => (moved.has(p.concept) ? { concept: p.concept, parent: moved.get(p.concept)! } : { ...p })),
    proposed: proposedFrom(proposal),
  }
}

/**
 * Applies a proposal to a rooted phylogeny (prune and regraft). What the hypothesis
 * measured can't be carried over to a tree it never tested: a moved branch loses its
 * length, every group whose members changed loses its support values, and the tree is no
 * longer time-calibrated. Unrooted hypotheses are refused, since they imply no ancestry.
 */
export function applyToPhylogeny(base: Phylogeny, proposal: Proposal): ProposedPhylogeny {
  checkBase(proposal, 'phylogeny', base)
  if (!base.rooted) throw new ProposalError('An unrooted hypothesis has no ancestry to rearrange: root it first')
  const index = indexPhylogeny(base)
  const moved = checkedParents(index.ids, (id) => index.parent.get(id) ?? null, proposal, false)
  for (const m of proposal.moves) {
    if (m.from === null) throw new ProposalError('The root stays where it is: move the taxa under it instead', m.node)
    const left = index.children.get(m.from)!.filter((c) => !moved.has(c) || moved.get(c) === m.from).length
    const arriving = proposal.moves.some((o) => o.to === m.from)
    if (left === 0 && !arriving) throw new ProposalError(`Moving ${m.node} would leave ${m.from} empty: move ${m.from} itself instead`, m.node)
  }
  const edges = base.edges.map((e): PhyloEdge => {
    const to = moved.get(e.child)
    // `to` is never null here: root moves were refused above.
    if (!to) return { ...e }
    const { length: _length, support: _support, ...rest } = e
    return { ...rest, parent: to }
  })
  const next: Phylogeny = { ...base, edges }
  const changed = changedGroups(index, indexPhylogeny(next))
  const { timeCalibrated: _time, ...withoutCalibration } = base
  return {
    ...withoutCalibration,
    ...derived(base.id, proposal),
    ...(base.timeCalibrated ? { timeCalibrated: false } : {}),
    nodes: base.nodes.map((n) => {
      if (!changed.has(n.id)) return { ...n }
      const { support: _s, additionalSupport: _a, age: _age, ...rest } = n
      return rest
    }),
    edges: edges.map((e): PhyloEdge => {
      if (!changed.has(e.child) || !e.support) return e
      const { support: _s, ...rest } = e
      return rest
    }),
    proposed: proposedFrom(proposal),
  }
}

const tipsBelow = (t: TreeIndex) => {
  const tips = new Map<Id, Id[]>()
  const order = [...t.ids].sort((a, b) => t.depth.get(b)! - t.depth.get(a)!)
  for (const id of order) {
    const kids = t.children.get(id)!
    tips.set(id, kids.length ? kids.flatMap((c) => tips.get(c)!).sort() : [id])
  }
  return tips
}

const keyOf = (tips: Id[]) => tips.join('\u0000')

function changedGroups(a: TreeIndex, b: TreeIndex): Set<Id> {
  const ta = tipsBelow(a)
  const tb = tipsBelow(b)
  return new Set(a.ids.filter((id) => tb.has(id) && keyOf(ta.get(id)!) !== keyOf(tb.get(id)!)))
}

export type HierarchyComparison = {
  /** Same node, different parent. */
  moved: { node: Id; from: Id | null; to: Id | null }[]
  /** Groups that kept their node but changed members. */
  changedGroups: { node: Id; gained: Id[]; lost: Id[] }[]
  /** Sets of tips that form a group in `a` but not in `b` (phylogenies: clades that break). */
  broken: { node: Id; tips: Id[] }[]
  /** Sets of tips that form a group in `b` but not in `a` (phylogenies: clades that form). */
  formed: { node: Id; tips: Id[] }[]
  /** Nodes only one side has (different hierarchies can be compared too). */
  onlyInA: Id[]
  onlyInB: Id[]
}

/** What differs between two hierarchies over the same ids, such as accepted vs proposed. */
export function compareHierarchies(a: TreeIndex, b: TreeIndex): HierarchyComparison {
  const inB = new Set(b.ids)
  const inA = new Set(a.ids)
  const ta = tipsBelow(a)
  const tb = tipsBelow(b)
  const groups = (tree: TreeIndex, tips: Map<Id, Id[]>) => tree.ids.filter((id) => tree.children.get(id)!.length > 0).map((id) => ({ node: id, tips: tips.get(id)! }))
  const ga = groups(a, ta)
  const gb = groups(b, tb)
  const keysA = new Set(ga.map((g) => keyOf(g.tips)))
  const keysB = new Set(gb.map((g) => keyOf(g.tips)))
  const moved: HierarchyComparison['moved'] = []
  const changed: HierarchyComparison['changedGroups'] = []
  for (const id of a.ids) {
    if (!inB.has(id)) continue
    const from = a.parent.get(id) ?? null
    const to = b.parent.get(id) ?? null
    if (from !== to) moved.push({ node: id, from, to })
    const before = ta.get(id)!
    const after = tb.get(id)!
    if (a.children.get(id)!.length && keyOf(before) !== keyOf(after)) {
      const was = new Set(before)
      const now = new Set(after)
      changed.push({ node: id, gained: after.filter((t) => !was.has(t)), lost: before.filter((t) => !now.has(t)) })
    }
  }
  return {
    moved,
    changedGroups: changed,
    broken: ga.filter((g) => !keysB.has(keyOf(g.tips))),
    formed: gb.filter((g) => !keysA.has(keyOf(g.tips))),
    onlyInA: a.ids.filter((id) => !inB.has(id)),
    onlyInB: b.ids.filter((id) => !inA.has(id)),
  }
}
