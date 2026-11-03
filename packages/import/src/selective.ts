import {
  applySelection,
  extractSubset,
  getCoverageReport,
  indexDataset,
  validateDataset,
  type ApplySelectionOptions,
  type CuratedSelection,
  type DatasetSnapshot,
  type Diagnostic,
  type GroupCoverage,
  type Id,
  type KnownCount,
  type SelectionResult,
} from '@captiveorigins/onetaxonomy-core'

export type SelectiveImportOptions = ApplySelectionOptions & {
  /** Identity of the new snapshot. */
  id: Id
  version: string
  createdAt: string
  knownToScience?: Record<Id, KnownCount>
  phylogenies?: 'none' | 'keep'
}

export type SelectiveImport = {
  /** The new, unsealed snapshot: chosen concepts plus their ancestor paths only. */
  snapshot: DatasetSnapshot
  selection: SelectionResult
  /** What was taken and what was left out under each root. */
  coverage: GroupCoverage[]
  /** Validation of the new snapshot (it must be usable on its own). */
  diagnostics: Diagnostic[]
}

/**
 * Preview and perform a curated selective import in one step: apply the selection,
 * extract the subset with provenance (`derivedFrom`), report coverage of the
 * omitted branches, and validate the result. Several roots in one selection import
 * several clades as one batch. Nothing outside the selection is copied.
 */
export function selectiveImport(source: DatasetSnapshot, selection: CuratedSelection, o: SelectiveImportOptions): SelectiveImport {
  const dataset = indexDataset(source)
  const result = applySelection(dataset, selection, o)
  if (result.diagnostics.some((d) => d.severity === 'error')) {
    throw new Error(`Selection ${selection.id} can't be applied: ${result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ')}`)
  }
  const snapshot = extractSubset(source, {
    id: o.id,
    version: o.version,
    createdAt: o.createdAt,
    classification: selection.classification,
    include: result,
    ...(o.phylogenies ? { phylogenies: o.phylogenies } : {}),
  })
  const coverage = getCoverageReport(dataset, { classification: selection.classification, included: result, ...(o.knownToScience ? { knownToScience: o.knownToScience } : {}) })
  return { snapshot, selection: result, coverage, diagnostics: validateDataset(snapshot) }
}
