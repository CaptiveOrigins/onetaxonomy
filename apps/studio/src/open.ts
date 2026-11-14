import { sealSnapshot, type DatasetSnapshot, type Phylogeny, type ViewTarget } from '@extantape/onetaxonomy-core'
import { parseDelimited, parseNewick, readChecklistTable, readDwca, readNexus, readPhyloXml, readSnapshotJson, toSnapshot, type ChecklistColumns, type ImportResult } from '@extantape/onetaxonomy-import'

/** Turning file contents into a dataset. No file access or app code here, so it can be tested alone. */

export type FileKind = 'snapshot' | 'newick' | 'nexus' | 'phyloxml' | 'table' | 'dwca' | 'bundle'
/** The tree formats, which ask the same questions when the file doesn't say (rooting, support methods). */
export type TreeKind = Extract<FileKind, 'newick' | 'nexus' | 'phyloxml'>
/** `seal` is a short, plain notice about the snapshot's checksum, shown where it can't be missed. Only snapshots have one. */
export type Opened = { snapshot: DatasetSnapshot; notices: string[]; seal?: string }

export const UNSEALED_NOTICE = "This snapshot isn't sealed, so changes to it since it was made can't be detected."
export const MISMATCH_NOTICE = 'This file has changed since it was sealed: its checksum no longer matches.'
export type Target = ViewTarget & { title: string }

export const OPEN_EXTENSIONS = ['json', 'nwk', 'newick', 'tree', 'tre', 'treefile', 'nex', 'nexus', 'nxs', 'xml', 'phyloxml', 'csv', 'tsv', 'txt', 'zip', 'onetaxonomy']

const baseName = (name: string) => name.split(/[\\/]/).pop() ?? name
const stem = (name: string) => baseName(name).replace(/\.[^.]+$/, '')
const slug = (name: string) => stem(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dataset'

/** Whether text is a NEXUS file: `#NEXUS` first, after any bracketed comments. */
export const isNexus = (text: string) => /^\s*(\[[^\]]*\]\s*)*#nexus\b/i.test(text)

/**
 * The kind of file, from its extension. `.tre`, `.tree` and `.treefile` are used for both
 * Newick and NEXUS, so with the text at hand a file that starts with `#NEXUS` is NEXUS.
 */
export function kindOf(name: string, text?: string): FileKind | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'json') return 'snapshot'
  if (['nex', 'nexus', 'nxs'].includes(ext)) return 'nexus'
  if (['xml', 'phyloxml'].includes(ext)) return 'phyloxml'
  if (['nwk', 'newick', 'tree', 'tre', 'treefile'].includes(ext)) return text !== undefined && isNexus(text) ? 'nexus' : 'newick'
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'table'
  if (ext === 'zip') return 'dwca'
  if (ext === 'onetaxonomy') return 'bundle'
  return null
}

const sourceFor = (name: string, now: string) => ({ id: slug(name), title: baseName(name), retrievedAt: now, provenance: 'Opened from a local file in OneTaxonomy for Mac' })
const dataset = (result: ImportResult, name: string, now: string): Opened => ({
  snapshot: toSnapshot(result, { id: slug(name), version: now.slice(0, 10), createdAt: now }),
  notices: result.warnings.map((w) => (w.row ? `Row ${w.row}: ${w.message}` : w.line ? `Line ${w.line}: ${w.message}` : w.message)),
})

export function openSnapshot(text: string): Opened {
  const { snapshot, diagnostics, checksum } = readSnapshotJson(text)
  const notices = diagnostics.map((d) => `${d.severity}: ${d.message}`)
  if (checksum === 'mismatch') notices.unshift(MISMATCH_NOTICE)
  // A sealed file whose checksum line was deleted reads as unsealed, so an unsealed snapshot is never opened silently.
  const seal = checksum === 'mismatch' ? MISMATCH_NOTICE : checksum === 'unsealed' ? UNSEALED_NOTICE : undefined
  return seal ? { snapshot, notices, seal } : { snapshot, notices }
}

/** What the file doesn't say about itself, so a person must. These are never guessed. */
export function newickQuestions(text: string): { rooted: boolean; supportMethods: number } {
  const paired = /\)[^(),:;]*?(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)/.exec(text)
  return { rooted: !/^\s*\[&[RrUu]\]/.test(text), supportMethods: paired ? paired[1]!.split('/').length : 0 }
}

/** NEXUS: a `TREE` without [&R] or [&U] leaves rooting unsaid (`UTREE` is unrooted). Other comments, such as BEAST's, are ignored. */
export function nexusQuestions(text: string): { rooted: boolean; supportMethods: number } {
  const plain = text.replace(/\[(?!&[RrUu]\])[^\]]*\]/g, '')
  let rooted = false
  for (const m of plain.matchAll(/(?:^|[;\s])(u?tree)\s[^=;]*=\s*(\[&[RrUu]\])?/gi)) if (m[1]!.toLowerCase() === 'tree' && !m[2]) rooted = true
  return { rooted, supportMethods: newickQuestions(plain).supportMethods }
}

/** phyloXML: the schema requires `rooted` on each <phylogeny>; ask only when one leaves it out. */
export const phyloXmlQuestions = (text: string) => ({ rooted: /<phylogeny\b(?![^>]*\brooted\s*=)[^>]*>/.test(text), supportMethods: 0 })

export const treeQuestions = (kind: TreeKind, text: string) => (kind === 'nexus' ? nexusQuestions(text) : kind === 'phyloxml' ? phyloXmlQuestions(text) : newickQuestions(text))

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

const treeOptions = (name: string, answers: NewickAnswers, now: string) => ({
  source: sourceFor(name, now),
  id: slug(name),
  title: stem(name),
  version: now.slice(0, 10),
  ...(answers.rooted === undefined ? {} : { rooted: answers.rooted }),
})

/** Every tree in a NEXUS file's TREES blocks; skipped blocks and untranslated tips become notes. */
export function openNexus(text: string, name: string, answers: NewickAnswers, now: string): Opened {
  const o = treeOptions(name, answers, now)
  return dataset(readNexus(text, { ...o, ...(answers.supportMethods?.length ? { supportMethods: answers.supportMethods } : {}) }), name, now)
}

/** Every phylogeny in a phyloXML file; elements it doesn't read become notes. No tips are mapped to taxa. */
export function openPhyloXml(text: string, name: string, answers: NewickAnswers, now: string): Opened {
  return dataset(readPhyloXml(text, treeOptions(name, answers, now)), name, now)
}

export const openTree = (kind: TreeKind, text: string, name: string, answers: NewickAnswers, now: string): Opened =>
  kind === 'nexus' ? openNexus(text, name, answers, now) : kind === 'phyloxml' ? openPhyloXml(text, name, answers, now) : openNewick(text, name, answers, now)

/**
 * The open dataset with one more phylogeny (a rerooted or midpoint-rooted copy): a new
 * snapshot object, unsealed, that says what it was made from. The open one is not
 * touched, and its file is never written to (see `saveJson`'s `never`).
 */
export function withPhylogeny(s: DatasetSnapshot, record: Phylogeny, now: string): DatasetSnapshot {
  if (s.phylogenies.some((p) => p.id === record.id)) throw new Error(`This dataset already has a tree with the id ${record.id}`)
  const { checksum, ...rest } = s
  return {
    ...rest,
    version: `${s.version}+${record.id}`,
    createdAt: now,
    derivedFrom: { snapshot: s.id, version: s.version, ...(checksum ? { checksum } : {}) },
    phylogenies: [...s.phylogenies, record],
  }
}

const freeId = (base: string, taken: Set<string>) => {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * The open dataset with the trees from another file added (a tree opened with Add tree…, so
 * its tips can be linked to this dataset's taxa). A new, unsealed snapshot that says what it
 * was made from; the open one is not touched. A source or tree id already in use gets a
 * suffix ("-2"), and the trees' source references follow it. Names, concepts and
 * classifications are never merged: a file that brings any is refused.
 */
export function withTrees(s: DatasetSnapshot, added: DatasetSnapshot, now: string): DatasetSnapshot {
  if (added.concepts.length || added.names.length || added.classifications.length) throw new Error('That file holds taxa or a classification as well as trees; open it on its own instead')
  if (!added.phylogenies.length) throw new Error('That file holds no tree')
  const sourceIds = new Set(s.sources.map((x) => x.id))
  const renamed = new Map<string, string>()
  const sources = added.sources.map((x) => {
    const id = freeId(x.id, sourceIds)
    sourceIds.add(id)
    renamed.set(x.id, id)
    return { ...x, id }
  })
  const treeIds = new Set(s.phylogenies.map((p) => p.id))
  const phylogenies = added.phylogenies.map((p) => {
    const id = freeId(p.id, treeIds)
    treeIds.add(id)
    return { ...p, id, sources: p.sources.map((x) => renamed.get(x) ?? x) }
  })
  const { checksum, ...rest } = s
  return {
    ...rest,
    version: `${s.version}+${phylogenies.map((p) => p.id).join('+')}`,
    createdAt: now,
    derivedFrom: { snapshot: s.id, version: s.version, ...(checksum ? { checksum } : {}) },
    sources: [...s.sources, ...sources],
    phylogenies: [...s.phylogenies, ...phylogenies],
  }
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
