import { sealSnapshot, type DatasetSnapshot, type ViewTarget } from '@captiveorigins/onetaxonomy-core'
import { parseDelimited, parseNewick, readChecklistTable, readDwca, readSnapshotJson, toSnapshot, type ChecklistColumns, type ImportResult } from '@captiveorigins/onetaxonomy-import'

/** Turning file contents into a dataset. No file access or app code here, so it can be tested alone. */

export type FileKind = 'snapshot' | 'newick' | 'table' | 'dwca'
export type Opened = { snapshot: DatasetSnapshot; notices: string[] }
export type Target = ViewTarget & { title: string }

export const OPEN_EXTENSIONS = ['json', 'nwk', 'newick', 'tree', 'tre', 'treefile', 'csv', 'tsv', 'txt', 'zip']

const baseName = (name: string) => name.split(/[\\/]/).pop() ?? name
const stem = (name: string) => baseName(name).replace(/\.[^.]+$/, '')
const slug = (name: string) => stem(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dataset'

export function kindOf(name: string): FileKind | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'json') return 'snapshot'
  if (['nwk', 'newick', 'tree', 'tre', 'treefile'].includes(ext)) return 'newick'
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'table'
  if (ext === 'zip') return 'dwca'
  return null
}

const sourceFor = (name: string, now: string) => ({ id: slug(name), title: baseName(name), retrievedAt: now, provenance: 'Opened from a local file in OneTaxonomy for Mac' })
const dataset = (result: ImportResult, name: string, now: string): Opened => ({
  snapshot: toSnapshot(result, { id: slug(name), version: now.slice(0, 10), createdAt: now }),
  notices: result.warnings.map((w) => (w.row ? `Row ${w.row}: ${w.message}` : w.message)),
})

export function openSnapshot(text: string): Opened {
  const { snapshot, diagnostics, checksum } = readSnapshotJson(text)
  const notices = diagnostics.map((d) => `${d.severity}: ${d.message}`)
  if (checksum === 'mismatch') notices.unshift('This file has changed since it was sealed: its checksum no longer matches.')
  return { snapshot, notices }
}

/** What the file doesn't say about itself, so a person must. These are never guessed. */
export function newickQuestions(text: string): { rooted: boolean; supportMethods: number } {
  const paired = /\)[^(),:;]*?(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)/.exec(text)
  return { rooted: !/^\s*\[&[RrUu]\]/.test(text), supportMethods: paired ? paired[1]!.split('/').length : 0 }
}

export type NewickAnswers = { rooted?: boolean; supportMethods?: string[] }

export function openNewick(text: string, name: string, answers: NewickAnswers, now: string): Opened {
  const source = sourceFor(name, now)
  const tree = parseNewick(text, {
    id: slug(name),
    title: stem(name),
    version: now.slice(0, 10),
    sources: [source.id],
    ...(answers.rooted === undefined ? {} : { rooted: answers.rooted }),
    ...(answers.supportMethods?.length ? { supportMethods: answers.supportMethods } : {}),
  })
  return dataset({ source, names: [], concepts: [], phylogenies: [tree], rawIds: {}, warnings: [] }, name, now)
}

export const delimiterOf = (name: string, text: string) => (name.toLowerCase().endsWith('.tsv') || (text.split('\n', 1)[0] ?? '').includes('\t') ? '\t' : ',')

export const tableHeader = (text: string, delimiter: string): string[] => parseDelimited(text.split('\n', 1)[0] ?? '', { delimiter })[0] ?? []

const ALIASES: Record<keyof Pick<ChecklistColumns, 'taxonID' | 'name' | 'parentID' | 'acceptedID' | 'status' | 'rank' | 'authorship'>, string[]> = {
  taxonID: ['taxonid', 'id', 'taxon_id'],
  name: ['scientificname', 'name', 'scientific_name'],
  parentID: ['parentnameusageid', 'parentid', 'parent', 'parent_id'],
  acceptedID: ['acceptednameusageid', 'acceptedid', 'accepted_id'],
  status: ['taxonomicstatus', 'status'],
  rank: ['taxonrank', 'rank'],
  authorship: ['scientificnameauthorship', 'authorship', 'author'],
}
export type ColumnKey = keyof typeof ALIASES
export const COLUMN_KEYS = Object.keys(ALIASES) as ColumnKey[]

/** A first guess at the mapping for a person to check. It matches header names only, and nothing is applied until they confirm. */
export function suggestColumns(header: string[]): Partial<Record<ColumnKey, string>> {
  const out: Partial<Record<ColumnKey, string>> = {}
  for (const key of COLUMN_KEYS) {
    const match = header.find((h) => ALIASES[key].includes(h.trim().toLowerCase()))
    if (match) out[key] = match
  }
  return out
}

export function openTable(text: string, name: string, columns: ChecklistColumns, delimiter: string, now: string): Opened {
  return dataset(readChecklistTable(text, { source: sourceFor(name, now), columns, delimiter }), name, now)
}

export async function openDwca(bytes: Uint8Array, name: string, now: string): Promise<Opened> {
  return dataset(await readDwca(bytes, { source: sourceFor(name, now) }), name, now)
}

export const targetsOf = (s: DatasetSnapshot): Target[] => [
  ...s.phylogenies.map((p) => ({ kind: 'phylogeny' as const, id: p.id, title: p.title })),
  ...s.classifications.map((c) => ({ kind: 'classification' as const, id: c.id, title: c.title })),
]

export const sealedJson = (s: DatasetSnapshot) => `${JSON.stringify(sealSnapshot(s), null, 2)}\n`
