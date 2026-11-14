import { SCHEMA_VERSION, type Classification, type DatasetSnapshot, type Id, type Phylogeny, type ScientificName, type Source, type TaxonConcept } from '@extantape/onetaxonomy-core'

/** Something an adapter noticed and handled conservatively (never silently). */
export type ImportWarning = {
  code:
    | 'duplicate-id'
    | 'missing-parent'
    | 'parent-is-synonym'
    | 'synonym-without-accepted'
    | 'unknown-status'
    | 'missing-name'
    | 'missing-column'
    | 'unsupported-row-type'
    | 'schema'
    | 'skipped-block'
    | 'unsupported-command'
    | 'untranslated-label'
    | 'unsupported-element'
  message: string
  /** 1-based data row (header excluded), when the input is tabular. */
  row?: number
  /** 1-based line, when the input is a text format such as NEXUS or phyloXML. */
  line?: number
  /** The record's identifier in the source. */
  externalId?: string
}

/** The normalized output of one adapter run. */
export type ImportResult = {
  source: Source
  names: ScientificName[]
  concepts: TaxonConcept[]
  classification?: Classification
  phylogenies?: Phylogeny[]
  /** Concept id → the source's own identifier. */
  rawIds: Record<Id, string>
  warnings: ImportWarning[]
}

export type AdapterDescription = {
  id: string
  title: string
  /** File formats the adapter reads, e.g. `text/csv`, `application/zip (Darwin Core Archive)`. */
  formats: string[]
}

/**
 * A source adapter turns one source's files into normalized OneTaxonomy records.
 * Adapters take the file contents (text or bytes), not paths, so they run in
 * browsers, Node, workers and desktop webviews alike. Which source to read is the
 * caller's (the project owner's) choice; an adapter never picks one.
 */
export interface SourceAdapter<Input> {
  describe(): AdapterDescription
  read(input: Input): Promise<ImportResult>
}

/** Combines adapter results into one unsealed snapshot (seal it with `sealSnapshot`). */
export function toSnapshot(results: ImportResult | ImportResult[], o: { id: Id; version: string; createdAt: string }): DatasetSnapshot {
  const list = Array.isArray(results) ? results : [results]
  return {
    schemaVersion: SCHEMA_VERSION,
    id: o.id,
    version: o.version,
    createdAt: o.createdAt,
    sources: list.map((r) => r.source),
    names: list.flatMap((r) => r.names),
    concepts: list.flatMap((r) => r.concepts),
    classifications: list.flatMap((r) => (r.classification ? [r.classification] : [])),
    phylogenies: list.flatMap((r) => r.phylogenies ?? []),
  }
}
