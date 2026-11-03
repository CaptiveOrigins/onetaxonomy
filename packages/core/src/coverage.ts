import { omissions, type SelectionResult } from './curation'
import type { DatasetIndex } from './dataset'
import type { Id } from './model'

/**
 * A count of described taxa supplied by the caller, with its source (e.g. "species
 * described in Testudines, per <checklist>, as of 2026"). OneTaxonomy never
 * estimates how many taxa science knows: absent this, it says "not stated".
 */
export type KnownCount = { count: number; rank: string; source: string; asOf?: string }

export type GroupCoverage = {
  concept: Id
  name: string | undefined
  /** Coverage within this dataset's classification. */
  dataset: {
    /** The group and its descendants in the classification. */
    total: number
    included: number
    omitted: number
    /** Included concepts per rank (rank as stated by the source; '' = none stated). */
    includedByRank: Record<string, number>
    /** Top-most omitted subtrees, in classification order. */
    omittedBranches: Id[]
  }
  /** Coverage within a phylogenetic hypothesis, when one is given. */
  hypothesis?: {
    id: Id
    version: string
    sampling: 'complete' | 'partial' | 'unknown'
    /** Included concepts mapped to at least one node of the hypothesis. */
    mapped: number
    /** Included concepts the hypothesis does not map. */
    unmapped: number
  }
  /** What is known to science, only as supplied by the caller. */
  knownToScience: (KnownCount & { includedAtRank: number }) | 'not-stated'
}

export type CoverageOptions = {
  classification: Id
  /** The included concepts, e.g. a `SelectionResult` or any list of ids. */
  included: SelectionResult | Iterable<Id>
  /** Groups to report on (default: the selection's roots, else the classification roots). */
  groups?: Id[]
  phylogeny?: Id
  knownToScience?: Record<Id, KnownCount>
  omittedLimit?: number
}

/**
 * Coverage of a curated set, kept as three separate questions: what this dataset
 * holds, what a phylogenetic hypothesis samples, and what is known to science
 * (only from a stated source). Absence from the dataset is never reported as
 * absence from nature.
 */
export function getCoverageReport(dataset: DatasetIndex, options: CoverageOptions): GroupCoverage[] {
  const cls = dataset.classification(options.classification)
  const fromSelection = isSelectionResult(options.included)
  const included = new Set(fromSelection ? (options.included as SelectionResult).included : (options.included as Iterable<Id>))
  const groups = options.groups ?? (fromSelection ? (options.included as SelectionResult).roots.filter((r) => r.status === 'applied').map((r) => r.concept) : [...cls.roots])
  const phy = options.phylogeny !== undefined ? dataset.phylogeny(options.phylogeny) : undefined

  return groups.map((g) => {
    if (!cls.parent.has(g)) throw new RangeError(`Unknown concept ${g} in classification ${cls.id}`)
    let total = 0
    const inGroup: Id[] = []
    const byRank: Record<string, number> = {}
    const stack = [g]
    while (stack.length) {
      const x = stack.pop()!
      total++
      if (included.has(x)) {
        inGroup.push(x)
        const rank = (dataset.concept.get(x)?.rank ?? '').toLowerCase()
        byRank[rank] = (byRank[rank] ?? 0) + 1
      }
      stack.push(...cls.children.get(x)!)
    }
    const { omitted, branches } = omissions(cls, g, included, options.omittedLimit ?? 50)
    const known = options.knownToScience?.[g]
    const report: GroupCoverage = {
      concept: g,
      name: dataset.nameOf(g),
      dataset: { total, included: inGroup.length, omitted, includedByRank: byRank, omittedBranches: branches },
      knownToScience: known ? { ...known, includedAtRank: byRank[known.rank.toLowerCase()] ?? 0 } : 'not-stated',
    }
    if (phy) {
      const mapped = inGroup.filter((x) => (phy.nodesForConcept.get(x)?.length ?? 0) > 0).length
      report.hypothesis = { id: phy.id, version: phy.version, sampling: phy.phylogeny.sampling ?? 'unknown', mapped, unmapped: inGroup.length - mapped }
    }
    return report
  })
}

const isSelectionResult = (v: unknown): v is SelectionResult => typeof v === 'object' && v !== null && 'included' in v && 'roots' in v && Array.isArray((v as SelectionResult).roots)
