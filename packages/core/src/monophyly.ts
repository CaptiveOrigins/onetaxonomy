import type { Id } from './model'
import { getLineage, tipsUnder, type ClassificationIndex, type PhylogenyIndex } from './tree'

/** Which hypothesis a result is relative to. Every evolutionary claim names one. */
export type HypothesisRef = { id: Id; version: string }

export type MrcaResult =
  | { status: 'found'; node: Id; hypothesis: HypothesisRef }
  | { status: 'indeterminate'; reason: 'unrooted' | 'unknown-node' | 'empty'; ids?: Id[]; hypothesis: HypothesisRef }
  | { status: 'none'; reason: 'different-trees'; hypothesis: HypothesisRef }

const ref = (p: PhylogenyIndex): HypothesisRef => ({ id: p.id, version: p.version })

/**
 * Most recent common ancestor of nodes in a rooted hypothesis. Unrooted trees and
 * nodes in different trees of a forest have none: no common ancestor is invented.
 */
export function findMRCA(p: PhylogenyIndex, nodeIds: readonly Id[]): MrcaResult {
  const hypothesis = ref(p)
  if (!nodeIds.length) return { status: 'indeterminate', reason: 'empty', hypothesis }
  const unknown = nodeIds.filter((x) => !p.parent.has(x))
  if (unknown.length) return { status: 'indeterminate', reason: 'unknown-node', ids: unknown, hypothesis }
  if (!p.rooted) return { status: 'indeterminate', reason: 'unrooted', hypothesis }
  const root = p.rootOf.get(nodeIds[0]!)!
  if (nodeIds.some((x) => p.rootOf.get(x) !== root)) return { status: 'none', reason: 'different-trees', hypothesis }
  // Common prefix of root→node lineages.
  let common = getLineage(p, nodeIds[0]!)
  for (const x of nodeIds.slice(1)) {
    const line = getLineage(p, x)
    let i = 0
    while (i < common.length && i < line.length && common[i] === line[i]) i++
    common = common.slice(0, i)
  }
  return { status: 'found', node: common.at(-1)!, hypothesis }
}

export type MonophylyStatus = 'monophyletic' | 'not-monophyletic' | 'indeterminate'

export type MonophylyReason =
  | 'classification-only'
  | 'unrooted'
  | 'unknown-node'
  | 'empty'
  | 'different-trees'
  | 'no-mapped-members'
  | 'unresolved-polytomy'
  | 'missing-descendants'
  | 'complete-clade'

export type MonophylyCaveat =
  | 'single-terminal'
  | 'partial-sampling'
  | 'sampling-unknown'
  | 'unmapped-members'

export type MonophylyResult = {
  status: MonophylyStatus
  reason: MonophylyReason
  /** Relative to this hypothesis only; null for classification-only checks. */
  hypothesis: HypothesisRef | null
  /** The selection's MRCA, when there is one. */
  mrca?: Id
  /** Terminals of the evaluated selection. */
  selected: Id[]
  /** Terminals under the MRCA that the selection leaves out (why it is not a clade). */
  missing: Id[]
  /** Terminals of the polytomy branches involved, when the answer depends on resolving it. */
  unresolvedAt?: Id
  caveats: MonophylyCaveat[]
  /** Members (e.g. species of a taxon) with no explicit node in the hypothesis. */
  unmapped?: Id[]
}

export type MonophylyOptions = {
  /**
   * `soft` (default): a polytomy means "unresolved", so a group of some of its branches
   * may or may not be a clade (indeterminate). `hard`: the polytomy is a claimed
   * simultaneous divergence, so such a group is not monophyletic.
   */
  polytomies?: 'soft' | 'hard'
}

const samplingCaveats = (p: PhylogenyIndex): MonophylyCaveat[] =>
  p.phylogeny.sampling === 'complete' ? [] : [p.phylogeny.sampling === 'partial' ? 'partial-sampling' : 'sampling-unknown']

/**
 * Whether the selected terminals form a clade in a rooted hypothesis: exactly the
 * MRCA and all its descendants. Internal nodes in the selection stand for all their
 * terminals. Judged on the full hypothesis, never on what a view shows.
 */
export function isMonophyletic(p: PhylogenyIndex, selection: readonly Id[], { polytomies = 'soft' }: MonophylyOptions = {}): MonophylyResult {
  const hypothesis = ref(p)
  const base = { hypothesis, missing: [] as Id[], caveats: samplingCaveats(p) }
  const unknown = selection.filter((x) => !p.parent.has(x))
  if (unknown.length) return { ...base, status: 'indeterminate', reason: 'unknown-node', selected: [...selection] }
  const selected = [...new Set(selection.flatMap((x) => tipsUnder(p, x)))]
  if (!selected.length) return { ...base, status: 'indeterminate', reason: 'empty', selected }
  const mrca = findMRCA(p, selected)
  if (mrca.status === 'none') return { ...base, status: 'not-monophyletic', reason: 'different-trees', selected }
  if (mrca.status === 'indeterminate') return { ...base, status: 'indeterminate', reason: mrca.reason, selected }
  const inSel = new Set(selected)
  const missing = tipsUnder(p, mrca.node).filter((x) => !inSel.has(x))
  const caveats = [...base.caveats, ...(selected.length === 1 ? (['single-terminal'] as const) : [])]
  if (!missing.length) return { ...base, caveats, status: 'monophyletic', reason: 'complete-clade', mrca: mrca.node, selected }
  // Not every terminal under the MRCA is selected. If the MRCA is a polytomy and the
  // selection takes whole branches of it, only a resolution of the polytomy could tell.
  const branches = p.children.get(mrca.node)!
  if (polytomies === 'soft' && branches.length > 2) {
    const whole = branches.every((b) => {
      const tips = tipsUnder(p, b)
      const n = tips.filter((t) => inSel.has(t)).length
      return n === 0 || n === tips.length
    })
    if (whole) return { ...base, caveats, status: 'indeterminate', reason: 'unresolved-polytomy', mrca: mrca.node, selected, missing, unresolvedAt: mrca.node }
  }
  return { ...base, caveats, status: 'not-monophyletic', reason: 'missing-descendants', mrca: mrca.node, selected, missing }
}

/** All terminals of the clade rooted at `node` (rooted hypotheses only). */
export function getCladeMembers(p: PhylogenyIndex, node: Id): { status: 'found'; members: Id[]; hypothesis: HypothesisRef } | { status: 'indeterminate'; reason: 'unrooted' | 'unknown-node'; hypothesis: HypothesisRef } {
  if (!p.parent.has(node)) return { status: 'indeterminate', reason: 'unknown-node', hypothesis: ref(p) }
  if (!p.rooted) return { status: 'indeterminate', reason: 'unrooted', hypothesis: ref(p) }
  return { status: 'found', members: tipsUnder(p, node), hypothesis: ref(p) }
}

/**
 * Whether a taxon (a concept and its descendants in a classification) is a clade in a
 * phylogeny. Members are matched to terminals only through explicit concept mappings;
 * unmapped members are reported, not guessed. Without a phylogeny the answer is
 * `indeterminate` (`classification-only`): a rank or a name is not evidence.
 */
export function assessTaxon(classification: ClassificationIndex, concept: Id, phylogeny: PhylogenyIndex | null, options: MonophylyOptions = {}): MonophylyResult {
  if (!classification.parent.has(concept)) throw new RangeError(`Unknown concept ${concept} in classification ${classification.id}`)
  if (!phylogeny) return { status: 'indeterminate', reason: 'classification-only', hypothesis: null, selected: [], missing: [], caveats: [] }
  const members = [concept, ...descendantsAll(classification, concept)]
  const mapped: Id[] = []
  const unmapped: Id[] = []
  for (const m of members) {
    const nodes = phylogeny.nodesForConcept.get(m)
    if (nodes?.length) mapped.push(...nodes)
    else if (classification.children.get(m)!.length === 0) unmapped.push(m) // only terminal members need a node
  }
  if (!mapped.length)
    return { status: 'indeterminate', reason: 'no-mapped-members', hypothesis: { id: phylogeny.id, version: phylogeny.version }, selected: [], missing: [], caveats: [], unmapped }
  const result = isMonophyletic(phylogeny, mapped, options)
  return unmapped.length ? { ...result, unmapped, caveats: [...result.caveats, 'unmapped-members'] } : result
}

function descendantsAll(t: ClassificationIndex, id: Id): Id[] {
  const out: Id[] = []
  const queue = [...t.children.get(id)!]
  for (let i = 0; i < queue.length; i++) {
    out.push(queue[i]!)
    queue.push(...t.children.get(queue[i]!)!)
  }
  return out
}
