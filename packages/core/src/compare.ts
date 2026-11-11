import type { Id, Phylogeny } from './model'
import type { HypothesisRef } from './monophyly'
import { indexPhylogeny, type PhylogenyIndex } from './tree'

/**
 * One split (unrooted comparison) or clade (rooted comparison) that a hypothesis
 * has and the other lacks, on the shared tips. `concepts` is one side of the split:
 * for an unrooted split, the side without `reference` (see `PhylogenyComparison`);
 * for a rooted clade, the clade's members. `node` is the node in the hypothesis that
 * has it (whose incoming branch makes the split, or the clade's MRCA).
 */
export type ComparedSplit = { concepts: Id[]; node: Id }

export type PhylogenyComparison = {
  status: 'compared'
  /** `rooted` only when both hypotheses are explicitly rooted (or when asked and both are). */
  mode: 'rooted' | 'unrooted'
  a: HypothesisRef
  b: HypothesisRef
  /** Concepts mapped to a tip in both hypotheses (sorted). Only these are compared. */
  shared: Id[]
  /** Concepts at a tip of `a` only, and of `b` only: reported, never silently pruned. */
  onlyInA: Id[]
  onlyInB: Id[]
  /** Nontrivial splits (or clades) of each hypothesis restricted to the shared concepts. */
  splits: { a: number; b: number }
  /** Robinson-Foulds distance: splits in one and not the other, counted both ways. */
  rf: number
  /**
   * `rf / (splits.a + splits.b)`: 0 = same topology on the shared tips, 1 = no split
   * in common. For two fully resolved trees this equals `rf / 2(n − 3)` (unrooted) or
   * `rf / 2(n − 2)` (rooted). `null` when neither has a nontrivial split to compare.
   */
  normalized: number | null
  /** Splits or clades present in `a` but not in `b`, and the reverse. */
  inAOnly: ComparedSplit[]
  inBOnly: ComparedSplit[]
  /** Unrooted mode: the concept whose side is never reported (the smallest shared id), so each split is listed one way. */
  reference?: Id
  /** Plain-language caveats that apply to this answer. */
  notes: string[]
}

export type ComparisonRefusal = {
  status: 'refused'
  reason:
    /** A tip has no explicit concept mapping: tips are matched only through concepts, never by label. */
    | 'unmapped-tips'
    /** A tip maps to more than one concept, or a concept to more than one tip: which one to compare is unclear. */
    | 'ambiguous-tips'
    /** A hypothesis is a forest: Robinson-Foulds is defined on one tree. */
    | 'forest'
    /** Rooted comparison was asked for, but a hypothesis is not explicitly rooted. */
    | 'unrooted'
  hypothesis: HypothesisRef
  /** The tips or concepts that caused the refusal. */
  ids: Id[]
  message: string
}

export type CompareOptions = {
  /**
   * `auto` (default): rooted only when both hypotheses are explicitly rooted,
   * otherwise unrooted. `unrooted` ignores the roots. `rooted` refuses an unrooted hypothesis.
   */
  mode?: 'auto' | 'rooted' | 'unrooted'
}

const asIndex = (p: Phylogeny | PhylogenyIndex): PhylogenyIndex => ('kind' in p && p.kind === 'phylogeny' ? (p as PhylogenyIndex) : indexPhylogeny(p as Phylogeny))
const ref = (p: PhylogenyIndex): HypothesisRef => ({ id: p.id, version: p.version })

/** Tip → its one concept, or a refusal. */
function tipConcepts(p: PhylogenyIndex): { byTip: Map<Id, Id> } | ComparisonRefusal {
  const hypothesis = ref(p)
  if (p.roots.length !== 1) return { status: 'refused', reason: 'forest', hypothesis, ids: [...p.roots], message: `${p.id} is a forest of ${p.roots.length} trees; compare one tree at a time.` }
  const unmapped = p.tips.filter((t) => !(p.node.get(t)!.concepts ?? []).length)
  if (unmapped.length)
    return { status: 'refused', reason: 'unmapped-tips', hypothesis, ids: unmapped, message: `${unmapped.length} tip(s) of ${p.id} have no explicit concept mapping; tips are matched by concept, never by label.` }
  const multi = p.tips.filter((t) => p.node.get(t)!.concepts!.length > 1)
  if (multi.length) return { status: 'refused', reason: 'ambiguous-tips', hypothesis, ids: multi, message: `${multi.length} tip(s) of ${p.id} map to more than one concept.` }
  const byTip = new Map<Id, Id>()
  const seen = new Map<Id, Id>()
  const repeated = new Set<Id>()
  for (const t of p.tips) {
    const c = p.node.get(t)!.concepts![0]!
    if (seen.has(c)) repeated.add(c)
    seen.set(c, t)
    byTip.set(t, c)
  }
  if (repeated.size)
    return { status: 'refused', reason: 'ambiguous-tips', hypothesis, ids: [...repeated], message: `${repeated.size} concept(s) map to more than one tip of ${p.id} (for example several samples); choose one tip per concept first.` }
  return { byTip }
}

/** Shared-concept set under each node, post-order, restricted to `shared`. */
function clusters(p: PhylogenyIndex, byTip: Map<Id, Id>, shared: Set<Id>): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>()
  const stack: [Id, boolean][] = [[p.roots[0]!, false]]
  while (stack.length) {
    const [id, done] = stack.pop()!
    const kids = p.children.get(id)!
    if (!done && kids.length) {
      stack.push([id, true])
      for (const c of [...kids].reverse()) stack.push([c, false])
      continue
    }
    if (!kids.length) {
      const c = byTip.get(id)!
      out.set(id, shared.has(c) ? [c] : [])
    } else out.set(id, kids.flatMap((k) => out.get(k)!))
  }
  return out
}

/**
 * Compares two phylogenetic hypotheses by their topology on the tips they share,
 * matched only through explicit concept mappings. Returns the Robinson-Foulds
 * distance (raw and normalized) and the splits (unrooted) or clades (rooted) each
 * has that the other lacks. Tips present in only one hypothesis are listed, not
 * silently pruned; the distance is computed on the shared tips only.
 *
 * Unrooted by default; rooted when both are explicitly rooted. Branch lengths and
 * support values are not used: a weakly supported split counts the same as a strong one.
 */
export function comparePhylogenies(a: Phylogeny | PhylogenyIndex, b: Phylogeny | PhylogenyIndex, { mode = 'auto' }: CompareOptions = {}): PhylogenyComparison | ComparisonRefusal {
  const ia = asIndex(a)
  const ib = asIndex(b)
  for (const p of [ia, ib])
    if (mode === 'rooted' && !p.rooted) return { status: 'refused', reason: 'unrooted', hypothesis: ref(p), ids: [], message: `${p.id} is not rooted; root it explicitly first (rerootPhylogeny), or compare unrooted.` }
  const ta = tipConcepts(ia)
  if ('status' in ta) return ta
  const tb = tipConcepts(ib)
  if ('status' in tb) return tb
  const ca = new Set(ta.byTip.values())
  const cb = new Set(tb.byTip.values())
  const shared = [...ca].filter((c) => cb.has(c)).sort()
  const sharedSet = new Set(shared)
  const onlyInA = [...ca].filter((c) => !cb.has(c)).sort()
  const onlyInB = [...cb].filter((c) => !ca.has(c)).sort()
  const rooted = mode === 'rooted' || (mode === 'auto' && ia.rooted && ib.rooted)
  const n = shared.length
  const reference = shared[0]

  const splitsOf = (p: PhylogenyIndex, byTip: Map<Id, Id>) => {
    const cl = clusters(p, byTip, sharedSet)
    const out = new Map<string, ComparedSplit>()
    // Breadth-first so that, when restriction makes a node and its child equal, the upper node is named.
    for (const id of [...p.ids].sort((x, y) => p.depth.get(x)! - p.depth.get(y)!)) {
      if (p.parent.get(id) === null) continue // the root has no branch above it
      let side = cl.get(id)!
      if (rooted) {
        if (side.length < 2 || side.length >= n) continue
      } else {
        if (side.length < 2 || side.length > n - 2) continue
        if (side.includes(reference!)) {
          const inSide = new Set(side)
          side = shared.filter((c) => !inSide.has(c))
        }
      }
      const sorted = [...side].sort()
      const key = sorted.join('\u0000')
      if (!out.has(key)) out.set(key, { concepts: sorted, node: id })
    }
    return out
  }
  const sa = splitsOf(ia, ta.byTip)
  const sb = splitsOf(ib, tb.byTip)
  const inAOnly = [...sa].filter(([k]) => !sb.has(k)).map(([, v]) => v)
  const inBOnly = [...sb].filter(([k]) => !sa.has(k)).map(([, v]) => v)
  const rf = inAOnly.length + inBOnly.length
  const total = sa.size + sb.size

  const notes: string[] = []
  if (onlyInA.length || onlyInB.length) notes.push(`Compared on ${n} shared tip(s); ${onlyInA.length} only in ${ia.id} and ${onlyInB.length} only in ${ib.id} were left out of the distance.`)
  if (!rooted && (ia.rooted || ib.rooted)) notes.push(mode === 'unrooted' ? 'Compared unrooted, as asked: the roots were ignored.' : 'Compared unrooted because only one hypothesis is explicitly rooted.')
  if (!total) notes.push(`No nontrivial ${rooted ? 'clades' : 'splits'} among the shared tips, so there is nothing to normalize by.`)
  if ([ia, ib].some((p) => p.ids.some((x) => p.children.get(x)!.length > (p.parent.get(x) === null && !rooted ? 3 : 2))))
    notes.push('A polytomy contributes no split: an unresolved hypothesis differs from a resolved one by the splits it leaves out.')
  notes.push('Support values and branch lengths are not used.')

  return {
    status: 'compared',
    mode: rooted ? 'rooted' : 'unrooted',
    a: ref(ia),
    b: ref(ib),
    shared,
    onlyInA,
    onlyInB,
    splits: { a: sa.size, b: sb.size },
    rf,
    normalized: total ? rf / total : null,
    inAOnly,
    inBOnly,
    ...(rooted ? {} : { reference: reference! }),
    notes,
  }
}
