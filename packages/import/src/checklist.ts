import type { Classification, CommonName, ExternalId, Id, NameStatus, NameUsage, Placement, ScientificName, Source, TaxonConcept } from '@extantape/onetaxonomy-core'
import type { ImportResult, ImportWarning } from './adapter'

/** One row of a parent-pointer checklist (Darwin Core Taxon terms, renamed for brevity). */
export type ChecklistRow = {
  taxonID: string
  parentID?: string
  acceptedID?: string
  status?: string
  rank?: string
  name?: string
  authorship?: string
  vernacular?: CommonName[]
  externalIds?: ExternalId[]
  /** 1-based row number in the input, for warnings. */
  row?: number
}

export type ChecklistOptions = {
  /** The source record, supplied by the project owner (title, citation, license, release). */
  source: Source
  /** Prefix for generated ids (default: the source id). Ids are `<prefix>:<taxonID>`. */
  idPrefix?: string
  classification?: { id?: Id; title?: string; version?: string }
  /**
   * Source status strings → OneTaxonomy statuses, merged over the defaults
   * (case-insensitive). Unknown strings become `unknown`, with a warning.
   */
  statusMap?: Record<string, NameStatus>
  retrievedAt?: string
}

export const DEFAULT_STATUS_MAP: Readonly<Record<string, NameStatus>> = {
  accepted: 'accepted',
  valid: 'accepted',
  'provisionally accepted': 'provisional',
  provisional: 'provisional',
  doubtful: 'provisional',
  synonym: 'synonym',
  'heterotypic synonym': 'synonym',
  'homotypic synonym': 'synonym',
  'proparte synonym': 'synonym',
  'pro parte synonym': 'synonym',
  'ambiguous synonym': 'synonym',
  'objective synonym': 'synonym',
  'subjective synonym': 'synonym',
  misapplied: 'misapplied',
  'misapplied name': 'misapplied',
}

/**
 * Normalizes a parent-pointer checklist into names, concepts and one
 * classification. Accepted rows become concepts; synonym and misapplied rows
 * become usages on their accepted concept. Problems are reported and handled
 * conservatively: a row whose parent is missing becomes a root (never re-parented
 * by guesswork), a synonym whose accepted taxon is missing is dropped.
 */
export function normalizeChecklist(rows: ChecklistRow[], o: ChecklistOptions): ImportResult {
  const prefix = o.idPrefix ?? o.source.id
  const sourceId = o.source.id
  const statusMap = { ...DEFAULT_STATUS_MAP, ...Object.fromEntries(Object.entries(o.statusMap ?? {}).map(([k, v]) => [k.toLowerCase(), v])) }
  const warnings: ImportWarning[] = []
  const warn = (w: ImportWarning) => warnings.push(w)

  const byId = new Map<string, ChecklistRow>()
  for (const r of rows) {
    if (!r.taxonID) {
      warn({ code: 'missing-name', message: 'Row without a taxon identifier skipped', ...(r.row ? { row: r.row } : {}) })
      continue
    }
    if (byId.has(r.taxonID)) {
      warn({ code: 'duplicate-id', message: `Taxon ${r.taxonID} appears more than once; the first row is kept`, externalId: r.taxonID, ...(r.row ? { row: r.row } : {}) })
      continue
    }
    if (!r.name?.trim()) {
      warn({ code: 'missing-name', message: `Taxon ${r.taxonID} has no scientific name; skipped`, externalId: r.taxonID, ...(r.row ? { row: r.row } : {}) })
      continue
    }
    byId.set(r.taxonID, r)
  }

  const statusOf = (r: ChecklistRow): NameStatus => {
    const raw = r.status?.trim().toLowerCase()
    if (!raw) return isUsage(r) ? 'synonym' : 'accepted'
    const s = statusMap[raw]
    if (!s) {
      warn({ code: 'unknown-status', message: `Status “${r.status}” of ${r.taxonID} is not mapped; recorded as unknown`, externalId: r.taxonID, ...(r.row ? { row: r.row } : {}) })
      return 'unknown'
    }
    return s
  }
  const isUsage = (r: ChecklistRow) => Boolean(r.acceptedID) && r.acceptedID !== r.taxonID
  const cid = (x: string) => `${prefix}:${x}`
  const nid = (x: string) => `${prefix}:name:${x}`

  const names: ScientificName[] = []
  const concepts = new Map<string, TaxonConcept>()
  const rawIds: Record<Id, string> = {}
  for (const r of byId.values()) {
    names.push({ id: nid(r.taxonID), name: r.name!.trim(), ...(r.authorship?.trim() ? { authorship: r.authorship.trim() } : {}), externalIds: [{ source: sourceId, id: r.taxonID }] })
    if (isUsage(r)) continue
    const status = statusOf(r)
    const c: TaxonConcept = {
      id: cid(r.taxonID),
      acceptedName: nid(r.taxonID),
      ...(status !== 'accepted' ? { usages: [{ name: nid(r.taxonID), status, source: sourceId }] } : {}),
      ...(r.rank?.trim() ? { rank: r.rank.trim().toLowerCase() } : {}),
      externalIds: [{ source: sourceId, id: r.taxonID }, ...(r.externalIds ?? [])],
      ...(r.vernacular?.length ? { commonNames: r.vernacular } : {}),
      provenance: { source: sourceId, externalId: r.taxonID, ...(o.retrievedAt ? { retrievedAt: o.retrievedAt } : {}) },
    }
    concepts.set(r.taxonID, c)
    rawIds[c.id] = r.taxonID
  }

  // Synonyms and misapplied names become usages of their accepted concept.
  for (const r of byId.values()) {
    if (!isUsage(r)) continue
    let target = r.acceptedID!
    // A synonym of a synonym: follow the chain (bounded) to the accepted taxon.
    for (let hops = 0; !concepts.has(target) && byId.get(target)?.acceptedID && hops < 10; hops++) target = byId.get(target)!.acceptedID!
    const c = concepts.get(target)
    if (!c) {
      warn({ code: 'synonym-without-accepted', message: `${r.taxonID} (${r.name}) points to accepted taxon ${r.acceptedID}, which isn't in the file; skipped`, externalId: r.taxonID, ...(r.row ? { row: r.row } : {}) })
      continue
    }
    const status = statusOf(r)
    const usage: NameUsage = { name: nid(r.taxonID), status: status === 'accepted' ? 'synonym' : status, source: sourceId }
    c.usages = [...(c.usages ?? []), usage]
  }

  const placements: Placement[] = []
  for (const [taxonID, c] of concepts) {
    const r = byId.get(taxonID)!
    let parent: string | null = r.parentID?.trim() || null
    if (parent !== null && !concepts.has(parent)) {
      const viaSynonym = byId.get(parent)?.acceptedID
      if (viaSynonym && concepts.has(viaSynonym)) {
        warn({ code: 'parent-is-synonym', message: `Parent ${parent} of ${taxonID} is a synonym; placed under its accepted taxon ${viaSynonym}`, externalId: taxonID, ...(r.row ? { row: r.row } : {}) })
        parent = viaSynonym
      } else {
        warn({ code: 'missing-parent', message: `Parent ${parent} of ${taxonID} (${r.name}) isn't in the file; kept as a root`, externalId: taxonID, ...(r.row ? { row: r.row } : {}) })
        parent = null
      }
    }
    placements.push({ concept: c.id, parent: parent === null ? null : cid(parent) })
  }

  const classification: Classification = {
    id: o.classification?.id ?? `${prefix}:classification`,
    title: o.classification?.title ?? o.source.title,
    version: o.classification?.version ?? o.source.externalVersion ?? 'unversioned',
    sources: [sourceId],
    placements,
  }
  return { source: o.source, names, concepts: [...concepts.values()], classification, rawIds, warnings }
}
