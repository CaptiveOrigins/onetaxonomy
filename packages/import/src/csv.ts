import type { ImportResult, SourceAdapter } from './adapter'
import { normalizeChecklist, type ChecklistOptions, type ChecklistRow } from './checklist'
import { parseDelimited } from './delimited'

/** Which header names hold which values. Only `taxonID` and `name` are required. */
export type ChecklistColumns = {
  taxonID: string
  name: string
  parentID?: string
  acceptedID?: string
  status?: string
  rank?: string
  authorship?: string
  /** Common-name columns with their language (BCP 47 or ISO 639). */
  vernacular?: { column: string; locale: string }[]
  /** Columns holding identifiers in other namespaces, e.g. `{ column: 'col_id', source: 'col' }`. */
  externalIds?: { column: string; source: string }[]
}

/** Darwin Core Taxon terms as column names. */
export const DARWIN_CORE_COLUMNS: ChecklistColumns = {
  taxonID: 'taxonID',
  name: 'scientificName',
  parentID: 'parentNameUsageID',
  acceptedID: 'acceptedNameUsageID',
  status: 'taxonomicStatus',
  rank: 'taxonRank',
  authorship: 'scientificNameAuthorship',
}

export type CsvAdapterOptions = ChecklistOptions & {
  /** Default: Darwin Core term names. */
  columns?: ChecklistColumns
  /** Default `,`; use `\t` for TSV. */
  delimiter?: string
  quote?: string | null
}

/** Reads a parent-pointer checklist from CSV/TSV text with a configurable column mapping. */
export function csvAdapter(options: CsvAdapterOptions): SourceAdapter<string> {
  return {
    describe: () => ({ id: 'csv-checklist', title: 'Delimited checklist (CSV/TSV, configurable columns)', formats: ['text/csv', 'text/tab-separated-values'] }),
    read: async (text) => readChecklistTable(text, options),
  }
}

export function readChecklistTable(text: string, o: CsvAdapterOptions): ImportResult {
  const cols = o.columns ?? DARWIN_CORE_COLUMNS
  const table = parseDelimited(text, { delimiter: o.delimiter ?? ',', quote: o.quote === undefined ? '"' : o.quote })
  const [header = [], ...data] = table
  const at = new Map(header.map((h, i) => [h.trim(), i]))
  const missing = [cols.taxonID, cols.name].filter((c) => !at.has(c))
  if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')} (header: ${header.join(', ')})`)
  const optional = [cols.parentID, cols.acceptedID, cols.status, cols.rank, cols.authorship, ...(cols.vernacular ?? []).map((v) => v.column), ...(cols.externalIds ?? []).map((x) => x.column)]
  const absent = optional.filter((c): c is string => c !== undefined && !at.has(c))
  const get = (row: string[], col: string | undefined) => (col !== undefined && at.has(col) ? (row[at.get(col)!] ?? '').trim() : '')

  const rows: ChecklistRow[] = data.map((r, i) => {
    const vernacular = (cols.vernacular ?? []).flatMap((v) => {
      const name = get(r, v.column)
      return name ? [{ name, locale: v.locale, source: o.source.id }] : []
    })
    const externalIds = (cols.externalIds ?? []).flatMap((x) => {
      const id = get(r, x.column)
      return id ? [{ source: x.source, id }] : []
    })
    return {
      row: i + 1,
      taxonID: get(r, cols.taxonID),
      name: get(r, cols.name),
      parentID: get(r, cols.parentID),
      acceptedID: get(r, cols.acceptedID),
      status: get(r, cols.status),
      rank: get(r, cols.rank),
      authorship: get(r, cols.authorship),
      ...(vernacular.length ? { vernacular } : {}),
      ...(externalIds.length ? { externalIds } : {}),
    }
  })
  const result = normalizeChecklist(rows, o)
  for (const c of absent) result.warnings.unshift({ code: 'missing-column', message: `Mapped column “${c}” is not in the file; its values are treated as empty` })
  return result
}
