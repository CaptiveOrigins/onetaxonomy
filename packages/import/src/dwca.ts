import type { CommonName } from '@extantape/onetaxonomy-core'
import type { ImportResult, ImportWarning, SourceAdapter } from './adapter'
import { normalizeChecklist, type ChecklistOptions, type ChecklistRow } from './checklist'
import { parseDelimited } from './delimited'
import { decodeUtf8, readZip, type Inflate } from './zip'

const TAXON = 'http://rs.tdwg.org/dwc/terms/Taxon'
const VERNACULAR = 'http://rs.gbif.org/terms/1.0/VernacularName'

/** A Darwin Core Archive: the ZIP bytes, or its files already extracted (path → text). */
export type DwcaInput = Uint8Array | { files: Record<string, string> }

export type DwcaAdapterOptions = ChecklistOptions & { inflate?: Inflate }

type Table = {
  rowType: string
  location: string
  delimiter: string
  quote: string | null
  ignoreHeaderLines: number
  /** Index of the record id (core `id`, extension `coreid`). */
  idIndex: number | null
  fields: { term: string; index: number | null; default?: string }[]
}

/**
 * Reads the Taxon core of a Darwin Core Archive (`taxonID`, `parentNameUsageID`,
 * `acceptedNameUsageID`, `taxonomicStatus`, `taxonRank`, `scientificName`,
 * `scientificNameAuthorship`) and its Vernacular Names extension, as described by
 * `meta.xml`. Without `meta.xml`, the single data file's header row names the terms.
 */
export function dwcaAdapter(options: DwcaAdapterOptions): SourceAdapter<DwcaInput> {
  return {
    describe: () => ({ id: 'dwca', title: 'Darwin Core Archive (Taxon core, Vernacular Names extension)', formats: ['application/zip'] }),
    read: (input) => readDwca(input, options),
  }
}

export async function readDwca(input: DwcaInput, o: DwcaAdapterOptions): Promise<ImportResult> {
  const files = new Map<string, string>()
  if (input instanceof Uint8Array) for (const [k, v] of await readZip(input, o.inflate)) files.set(k, decodeUtf8(v))
  else for (const [k, v] of Object.entries(input.files)) files.set(k, v)
  // Archives are sometimes zipped with a top-level folder: resolve names by their basename too.
  const file = (name: string) => files.get(name) ?? [...files].find(([k]) => k.split('/').pop() === name)?.[1]

  const warnings: ImportWarning[] = []
  const meta = file('meta.xml')
  const tables = meta ? parseMeta(meta) : guessTable(files)
  const core = tables.find((t) => t.rowType === TAXON)
  if (!core) throw new Error(`No Taxon core in this archive (row types: ${tables.map((t) => t.rowType).join(', ') || 'none'})`)
  for (const t of tables) if (t !== core && t.rowType !== VERNACULAR) warnings.push({ code: 'unsupported-row-type', message: `Extension ${t.rowType} (${t.location}) is not read` })

  const read = (t: Table) => {
    const text = file(t.location)
    if (text === undefined) throw new Error(`Archive file ${t.location} is missing`)
    const rows = parseDelimited(text, { delimiter: t.delimiter, quote: t.quote }).slice(t.ignoreHeaderLines)
    return rows.map((r) => {
      const rec: Record<string, string> = {}
      for (const f of t.fields) rec[shortTerm(f.term)] = (f.index !== null ? r[f.index] : undefined)?.trim() || f.default || ''
      return { id: t.idIndex !== null ? (r[t.idIndex] ?? '').trim() : '', rec }
    })
  }

  const vernacular = new Map<string, CommonName[]>()
  const vt = tables.find((t) => t.rowType === VERNACULAR)
  if (vt) {
    for (const { id, rec } of read(vt)) {
      if (!id || !rec.vernacularName) continue
      vernacular.set(id, [...(vernacular.get(id) ?? []), { name: rec.vernacularName, locale: rec.language || 'und', source: o.source.id }])
    }
  }

  const rows: ChecklistRow[] = read(core).map(({ id, rec }, i) => {
    const taxonID = rec.taxonID || id
    const names = vernacular.get(id || taxonID)
    return {
      row: i + 1,
      taxonID,
      name: rec.scientificName ?? '',
      parentID: rec.parentNameUsageID ?? '',
      acceptedID: rec.acceptedNameUsageID ?? '',
      status: rec.taxonomicStatus ?? '',
      rank: rec.taxonRank ?? '',
      authorship: rec.scientificNameAuthorship ?? '',
      ...(names ? { vernacular: names } : {}),
    }
  })
  const result = normalizeChecklist(rows, o)
  result.warnings.unshift(...warnings)
  return result
}

const shortTerm = (term: string) => term.replace(/\/+$/, '').split(/[/#]/).pop()!

const unescapeXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&')

const unescapeDelimiter = (s: string) => s.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r')

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag)
  return m ? unescapeXml(m[2] ?? m[3] ?? '') : undefined
}

/** Parses the parts of meta.xml this adapter needs (no DOM: runs anywhere). */
export function parseMeta(xml: string): Table[] {
  const tables: Table[] = []
  const re = /<(core|extension)\b([^>]*)>([\s\S]*?)<\/\1>/g
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [, kind, attrs = '', body = ''] = m
    const enclosed = attr(attrs, 'fieldsEnclosedBy')
    const idTag = new RegExp(`<${kind === 'core' ? 'id' : 'coreid'}\\b([^>]*)/?>`).exec(body)
    const idIndex = idTag ? attr(idTag[1]!, 'index') : undefined
    tables.push({
      rowType: attr(attrs, 'rowType') ?? '',
      location: unescapeXml(/<location>\s*([\s\S]*?)\s*<\/location>/.exec(body)?.[1] ?? ''),
      delimiter: unescapeDelimiter(attr(attrs, 'fieldsTerminatedBy') ?? ','),
      quote: enclosed ? enclosed : null,
      ignoreHeaderLines: Number(attr(attrs, 'ignoreHeaderLines') ?? 0),
      idIndex: idIndex !== undefined ? Number(idIndex) : null,
      fields: [...body.matchAll(/<field\b([^>]*)\/?>/g)].map((f) => {
        const index = attr(f[1]!, 'index')
        const def = attr(f[1]!, 'default')
        return { term: attr(f[1]!, 'term') ?? '', index: index !== undefined ? Number(index) : null, ...(def !== undefined ? { default: def } : {}) }
      }),
    })
  }
  return tables
}

/** An archive without meta.xml: one data file whose header row names the terms. */
function guessTable(files: Map<string, string>): Table[] {
  const data = [...files.keys()].filter((k) => /\.(txt|csv|tsv|tab)$/i.test(k))
  if (data.length !== 1) throw new Error(`No meta.xml, and ${data.length} data files: can't tell which is the Taxon core`)
  const location = data[0]!
  const delimiter = /\.csv$/i.test(location) ? ',' : '\t'
  const [header = []] = parseDelimited(files.get(location)!, { delimiter })
  const taxonIndex = header.findIndex((h) => shortTerm(h.trim()) === 'taxonID')
  return [
    {
      rowType: TAXON,
      location,
      delimiter,
      quote: delimiter === ',' ? '"' : null,
      ignoreHeaderLines: 1,
      idIndex: taxonIndex >= 0 ? taxonIndex : null,
      fields: header.map((h, index) => ({ term: h.trim(), index })),
    },
  ]
}
