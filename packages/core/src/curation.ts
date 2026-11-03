import type { DatasetIndex } from './dataset'
import type { Id, TaxonConcept } from './model'
import { getChildren, type ClassificationIndex } from './tree'

/**
 * How much of a root's subtree a curated selection takes. Every policy is plain
 * data, so selections can be saved, diffed and shared; a `predicate` refers by
 * name to a function the caller supplies when applying the selection.
 */
export type SelectionPolicy =
  /** The root concept only (its ancestors still come along as context). */
  | { kind: 'explicit' }
  /** The root and everything under it in the classification. */
  | { kind: 'allAvailableDescendants' }
  /** The root and descendants down to `depth` levels below it. */
  | { kind: 'depth'; depth: number }
  /** Descendants whose rank (as the source states it, case-insensitive) is one of `ranks`, plus the root. */
  | { kind: 'rank'; ranks: string[] }
  /** Chosen representatives under the root, plus the root. */
  | { kind: 'representative'; concepts: Id[] }
  /** Descendants accepted by a named predicate supplied at apply time, plus the root. */
  | { kind: 'predicate'; predicate: string }

export type SelectionRoot = { concept: Id; policy: SelectionPolicy; label?: string; rationale?: string }

/**
 * A curated selection over one classification: which roots to take and how much
 * of each, what to leave out, and why. It references concepts by id and stores no
 * taxonomic data of its own, so it never becomes a shadow copy of the source.
 */
export type CuratedSelection = {
  id: Id
  title: string
  version: string
  classification: Id
  roots: SelectionRoot[]
  /** Subtrees left out (exclusion wins over every policy). */
  exclude?: { concept: Id; rationale?: string }[]
  rationale?: string
}

export type SelectionPredicate = (concept: TaxonConcept, context: { classification: ClassificationIndex; depthBelowRoot: number }) => boolean

export type SelectionDiagnostic = {
  severity: 'error' | 'warning'
  code: 'unknown-root' | 'unknown-exclusion' | 'unknown-predicate' | 'root-excluded' | 'not-under-root' | 'overlapping-roots' | 'limit-reached'
  message: string
  ids: Id[]
}

export type RootOutcome = {
  concept: Id
  status: 'applied' | 'unknown' | 'excluded'
  /** Concepts this root contributed (including the root). */
  curated: number
  /** Descendants of the root in the classification that are not included. */
  omitted: number
  /** Top-most omitted subtrees under the root (first `omittedLimit`), in classification order. */
  omittedBranches: Id[]
}

export type SelectionResult = {
  selection: { id: Id; version: string }
  classification: { id: Id; version: string }
  /** Concepts chosen by the policies, in classification order. */
  curated: Id[]
  /** Ancestors added so every curated concept keeps its path to a root (context, not curated). */
  ancestors: Id[]
  /** `curated` ∪ `ancestors`, in classification order. */
  included: Id[]
  excluded: Id[]
  roots: RootOutcome[]
  diagnostics: SelectionDiagnostic[]
  /** True when `limit` stopped the selection early. */
  truncated: boolean
}

export type ApplySelectionOptions = {
  predicates?: Record<string, SelectionPredicate>
  /** Maximum number of concepts to visit per root (default 1,000,000). */
  limit?: number
  /** How many omitted branches to list per root (default 50). */
  omittedLimit?: number
}

/**
 * Applies a curated selection to a dataset: chosen concepts plus their ancestor
 * paths, nothing from unselected branches. Pure and deterministic; it reports what
 * it left out instead of hiding it.
 */
export function applySelection(dataset: DatasetIndex, selection: CuratedSelection, options: ApplySelectionOptions = {}): SelectionResult {
  const { predicates = {}, limit = 1_000_000, omittedLimit = 50 } = options
  const cls = dataset.classification(selection.classification)
  const diagnostics: SelectionDiagnostic[] = []
  let truncated = false

  // Excluded subtrees first: exclusion wins over every policy.
  const excluded = new Set<Id>()
  for (const { concept } of selection.exclude ?? []) {
    if (!cls.parent.has(concept)) {
      diagnostics.push({ severity: 'warning', code: 'unknown-exclusion', message: `Excluded concept ${concept} is not in classification ${cls.id}`, ids: [concept] })
      continue
    }
    const stack = [concept]
    while (stack.length) {
      const x = stack.pop()!
      if (excluded.has(x)) continue
      excluded.add(x)
      stack.push(...cls.children.get(x)!)
    }
  }

  const curated = new Set<Id>()
  const contributed = new Map<Id, Set<Id>>()
  for (const root of selection.roots) {
    const mine = new Set<Id>()
    contributed.set(root.concept, mine)
    if (!cls.parent.has(root.concept)) {
      diagnostics.push({ severity: 'error', code: 'unknown-root', message: `Root ${root.concept} is not in classification ${cls.id}`, ids: [root.concept] })
      continue
    }
    if (excluded.has(root.concept)) {
      diagnostics.push({ severity: 'warning', code: 'root-excluded', message: `Root ${root.concept} lies inside an excluded subtree`, ids: [root.concept] })
      continue
    }
    const take = (x: Id) => {
      if (!excluded.has(x)) mine.add(x)
    }
    take(root.concept)
    const p = root.policy
    if (p.kind === 'representative') {
      for (const c of p.concepts) {
        if (!isUnder(cls, c, root.concept)) {
          diagnostics.push({ severity: 'warning', code: 'not-under-root', message: `Representative ${c} is not under root ${root.concept}`, ids: [c, root.concept] })
          continue
        }
        if (excluded.has(c)) diagnostics.push({ severity: 'warning', code: 'root-excluded', message: `Representative ${c} lies inside an excluded subtree`, ids: [c] })
        take(c)
      }
    } else if (p.kind !== 'explicit') {
      const predicate = p.kind === 'predicate' ? predicates[p.predicate] : undefined
      if (p.kind === 'predicate' && !predicate) {
        diagnostics.push({ severity: 'error', code: 'unknown-predicate', message: `No predicate named “${p.predicate}” was supplied`, ids: [root.concept] })
      } else {
        const ranks = p.kind === 'rank' ? new Set(p.ranks.map((r) => r.toLowerCase())) : null
        // Breadth-first walk below the root; excluded subtrees are never entered.
        const queue: [Id, number][] = getChildren(cls, root.concept).map((c) => [c, 1])
        let visited = 0
        for (let i = 0; i < queue.length; i++) {
          const [x, d] = queue[i]!
          if (excluded.has(x)) continue
          if (++visited > limit) {
            truncated = true
            diagnostics.push({ severity: 'warning', code: 'limit-reached', message: `Stopped after ${limit} concepts under ${root.concept}`, ids: [root.concept] })
            break
          }
          if (p.kind === 'depth' && d > p.depth) continue
          const concept = dataset.concept.get(x)
          const keep =
            p.kind === 'allAvailableDescendants' ||
            p.kind === 'depth' ||
            (ranks !== null && ranks.has((concept?.rank ?? '').toLowerCase())) ||
            (predicate !== undefined && concept !== undefined && predicate(concept, { classification: cls, depthBelowRoot: d }))
          if (keep) take(x)
          for (const c of cls.children.get(x)!) queue.push([c, d + 1])
        }
      }
    }
    for (const x of mine) curated.add(x)
  }

  // Roots nested in other roots are fine (a deeper root can take more), but say so.
  const rootIds = selection.roots.map((r) => r.concept).filter((r) => cls.parent.has(r))
  for (const r of rootIds) {
    const outer = rootIds.find((o) => o !== r && isUnder(cls, r, o))
    if (outer) diagnostics.push({ severity: 'warning', code: 'overlapping-roots', message: `Root ${r} lies under root ${outer}`, ids: [r, outer] })
  }

  // Ancestor closure: every curated concept keeps its path to a classification root.
  const ancestors = new Set<Id>()
  for (const x of curated) {
    let p = cls.parent.get(x)!
    while (p !== null && !curated.has(p) && !ancestors.has(p)) {
      ancestors.add(p)
      p = cls.parent.get(p)!
    }
  }

  const inOrder = (s: Set<Id>) => cls.ids.filter((x) => s.has(x))
  const included = new Set([...curated, ...ancestors])
  const roots: RootOutcome[] = selection.roots.map((root) => {
    if (!cls.parent.has(root.concept)) return { concept: root.concept, status: 'unknown', curated: 0, omitted: 0, omittedBranches: [] }
    if (excluded.has(root.concept)) return { concept: root.concept, status: 'excluded', curated: 0, omitted: 0, omittedBranches: [] }
    const { omitted, branches } = omissions(cls, root.concept, included, omittedLimit)
    return { concept: root.concept, status: 'applied', curated: contributed.get(root.concept)!.size, omitted, omittedBranches: branches }
  })

  return {
    selection: { id: selection.id, version: selection.version },
    classification: { id: cls.id, version: cls.version },
    curated: inOrder(curated),
    ancestors: inOrder(ancestors),
    included: inOrder(included),
    excluded: inOrder(excluded),
    roots,
    diagnostics,
    truncated,
  }
}

/** Whether `id` is `ancestor` or lies below it. */
export function isUnder(cls: ClassificationIndex, id: Id, ancestor: Id): boolean {
  if (!cls.parent.has(id)) return false
  let p: Id | null = id
  while (p !== null) {
    if (p === ancestor) return true
    p = cls.parent.get(p)!
  }
  return false
}

/** Counts descendants of `root` outside `included` and lists the top-most omitted subtrees. */
export function omissions(cls: ClassificationIndex, root: Id, included: ReadonlySet<Id>, branchLimit = 50): { omitted: number; branches: Id[] } {
  let omitted = 0
  const branches: Id[] = []
  const stack: [Id, boolean][] = [...cls.children.get(root)!].reverse().map((c) => [c, false])
  while (stack.length) {
    const [x, insideOmitted] = stack.pop()!
    const out = !included.has(x)
    if (out) {
      omitted++
      if (!insideOmitted && branches.length < branchLimit) branches.push(x)
    }
    for (const c of [...cls.children.get(x)!].reverse()) stack.push([c, insideOmitted || out])
  }
  return { omitted, branches }
}
