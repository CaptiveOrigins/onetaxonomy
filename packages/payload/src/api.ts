import {
  findMRCA,
  getCoverageReport,
  getAncestors,
  getDescendants,
  indexDataset,
  verifySnapshot,
  type DatasetIndex,
  type DatasetSnapshot,
  type GroupCoverage,
  type Id,
  type MrcaResult,
  type NameStatus,
  type PhylogenyIndex,
  type TreeIndex,
} from '@extantape/onetaxonomy-core'
import type { Endpoint, PayloadRequest } from 'payload'

import { optionsOf, type ResolvedOptions } from './types.js'

/** What every read function returns: a body, or an HTTP status with a plain-words reason. */
export type ApiResult<T> = { ok: true; body: T } | { ok: false; status: 400 | 404 | 409 | 500; error: string }

export type SnapshotRef = { doc: string; id: Id; version: string; checksum: string }

export const NOT_FOUND = { ok: false, status: 404, error: 'Not found.' } as const
export const bad = (error: string) => ({ ok: false, status: 400, error }) as const

/** Thrown when a stored snapshot no longer matches its checksum. Nothing is answered from it. */
export class SnapshotIntegrityError extends Error {}

// Snapshots are immutable, so an index built once for (document, checksum) stays right. Access is checked on every
// request before the cache is used; the cache only saves rebuilding indexes.
const CACHE_SIZE = 8
const cache = new Map<string, DatasetIndex>()

/**
 * The stored snapshot's content, checked against its checksum the first time it is read and cached after that.
 * Callers authorize first: this read skips access.
 */
export async function contentOf(req: PayloadRequest, opts: ResolvedOptions, ref: SnapshotRef): Promise<DatasetIndex> {
  const key = `${opts.slugs.snapshots}:${ref.doc}:${ref.checksum}`
  let index = cache.get(key)
  if (!index) {
    const full = (await req.payload.findByID({ collection: opts.slugs.snapshots as never, id: ref.doc, depth: 0, req, overrideAccess: true, select: { snapshot: true } as never })) as unknown as { snapshot: DatasetSnapshot }
    const s = full.snapshot
    let intact = false
    try {
      intact = verifySnapshot(s) && s.checksum === ref.checksum && s.id === ref.id && s.version === ref.version
    } catch {
      intact = false
    }
    if (!intact) throw new SnapshotIntegrityError(`Stored snapshot ${ref.id} ${ref.version} no longer matches its checksum. Nothing is answered from it.`)
    index = indexDataset(s)
    cache.set(key, index)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }
  return index
}

/**
 * Loads a snapshot the requester may read, with its indexes. Null when it doesn't exist or they may not read it: the
 * two look the same, so a caller can't learn that a hidden snapshot exists.
 */
export async function loadSnapshot(req: PayloadRequest, id: string, opts: ResolvedOptions = optionsOf(req.payload)): Promise<{ ref: SnapshotRef; index: DatasetIndex } | null> {
  type Head = { id: string | number; snapshotId?: string; version?: string; checksum?: string }
  let doc: Head | null = null
  try {
    doc = (await req.payload.findByID({ collection: opts.slugs.snapshots as never, id, depth: 0, req, overrideAccess: false, disableErrors: true, select: { snapshotId: true, version: true, checksum: true } as never })) as unknown as Head | null
  } catch {
    return null
  }
  if (!doc || !doc.checksum) return null
  const ref: SnapshotRef = { doc: String(doc.id), id: doc.snapshotId!, version: doc.version!, checksum: doc.checksum }
  // Already authorized above; this read only fetches the content.
  return { ref, index: await contentOf(req, opts, ref) }
}

export const clamp = (v: unknown, fallback: number, max: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : Math.min(fallback, max)
}

/** Turns a stored snapshot that fails its checksum into a 500 with the reason, logged; other errors propagate. */
export async function integrityGuard<T>(req: PayloadRequest, run: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof SnapshotIntegrityError) {
      req.payload.logger.error(error.message)
      return { ok: false, status: 500, error: error.message }
    }
    throw error
  }
}

async function guarded<T>(req: PayloadRequest, id: string, run: (loaded: { ref: SnapshotRef; index: DatasetIndex }, opts: ResolvedOptions) => ApiResult<T>): Promise<ApiResult<T>> {
  const opts = optionsOf(req.payload)
  return integrityGuard(req, async () => {
    const loaded = await loadSnapshot(req, id, opts)
    return loaded ? run(loaded, opts) : NOT_FOUND
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Search

export type SearchHit = {
  concept: Id
  /** The name that matched, as written in the source. */
  name: string
  /** Scientific names: the usage's status in the concept (accepted, synonym …). Common names: `common`. */
  status: NameStatus | 'common'
  locale?: string
  authorship?: string
  /** The concept's accepted name, for display. Names are never identities: several concepts can share one. */
  acceptedName?: string
  rank?: string
  match: 'exact' | 'prefix'
}

export type SearchQuery = { q?: string; limit?: number | string; locale?: string }

type Entry = { key: string; hit: Omit<SearchHit, 'match'> }
const entries = new WeakMap<DatasetIndex, Entry[]>()

function entriesOf(index: DatasetIndex): Entry[] {
  let list = entries.get(index)
  if (list) return list
  list = []
  for (const c of index.snapshot.concepts) {
    const usages = [{ name: c.acceptedName, status: 'accepted' as NameStatus }, ...(c.usages ?? []).filter((u) => u.name !== c.acceptedName)]
    const accepted = index.nameOf(c.id)
    for (const u of usages) {
      const n = index.name.get(u.name)
      if (n) list.push({ key: n.name.toLowerCase(), hit: { concept: c.id, name: n.name, status: u.status, ...(n.authorship ? { authorship: n.authorship } : {}), ...(accepted ? { acceptedName: accepted } : {}), ...(c.rank ? { rank: c.rank } : {}) } })
    }
    for (const cn of c.commonNames ?? [])
      list.push({ key: cn.name.toLowerCase(), hit: { concept: c.id, name: cn.name, status: 'common', locale: cn.locale, ...(accepted ? { acceptedName: accepted } : {}), ...(c.rank ? { rank: c.rank } : {}) } })
  }
  entries.set(index, list)
  return list
}

const inLocale = (entryLocale: string | undefined, locale: string) => {
  const e = (entryLocale ?? '').toLowerCase()
  return e === locale || e.startsWith(`${locale}-`)
}

/**
 * Concepts whose scientific names (accepted or not), or common names in the request's locale, equal or start with
 * `q`, case aside. Exact matches come first, then prefixes, each in name order. Every concept using a name is listed:
 * homonyms and splits are never merged.
 */
export async function searchNames(req: PayloadRequest, id: string, query: SearchQuery) {
  return guarded(req, id, ({ ref, index }, opts): ApiResult<{ snapshot: SnapshotRef; query: string; locale: string | null; results: SearchHit[]; truncated: boolean }> => {
    const q = (query.q ?? '').trim().toLowerCase()
    if (!q) return bad('Give a name to search for (q).')
    if (q.length > 200) return bad('The search is longer than 200 characters.')
    const limit = clamp(query.limit, 20, opts.limits.maxResults)
    const locale = (query.locale?.trim() || opts.locale.default || '').toLowerCase() || null
    const exact: SearchHit[] = []
    const prefix: SearchHit[] = []
    for (const e of entriesOf(index)) {
      if (e.hit.status === 'common' && (!locale || !inLocale(e.hit.locale, locale))) continue
      if (e.key === q) exact.push({ ...e.hit, match: 'exact' })
      else if (e.key.startsWith(q)) prefix.push({ ...e.hit, match: 'prefix' })
    }
    const order = (a: SearchHit, b: SearchHit) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.concept < b.concept ? -1 : a.concept > b.concept ? 1 : 0)
    const all = [...exact.sort(order), ...prefix.sort(order)]
    return { ok: true, body: { snapshot: ref, query: query.q!.trim(), locale, results: all.slice(0, limit), truncated: all.length > limit } }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Hierarchies

export type HierarchyQuery = { classification?: string; phylogeny?: string; node?: string; limit?: number | string; maxDepth?: number | string }
export type HierarchyRef = { kind: 'classification' | 'phylogeny'; id: Id; version: string }
export type NodeItem = { id: Id; label: string | null; concepts?: Id[] }

export type TraversalBody =
  | { status: 'found'; snapshot: SnapshotRef; hierarchy: HierarchyRef; node: NodeItem; items: NodeItem[]; truncated: boolean }
  /** An unrooted phylogeny's edge directions are only storage: it states no ancestry (invariant I5). */
  | { status: 'indeterminate'; reason: 'unrooted'; snapshot: SnapshotRef; hierarchy: HierarchyRef; node: NodeItem }

function hierarchyOf(index: DatasetIndex, q: HierarchyQuery): ApiResult<TreeIndex> {
  if (Boolean(q.classification) === Boolean(q.phylogeny)) return bad('Name one hierarchy: classification or phylogeny.')
  try {
    return { ok: true, body: q.classification ? index.classification(q.classification) : index.phylogeny(q.phylogeny!) }
  } catch {
    return NOT_FOUND
  }
}

/** A node with the name to show for it: a concept's accepted name, or a phylogeny node's own label. Null when it has none. */
export function itemOf(index: DatasetIndex, tree: TreeIndex, id: Id): NodeItem {
  if (tree.kind === 'classification') return { id, label: index.nameOf(id) ?? null }
  const node = (tree as PhylogenyIndex).node.get(id)
  const concepts = node?.concepts ?? []
  return { id, label: node?.label ?? (concepts.length === 1 ? (index.nameOf(concepts[0]!) ?? null) : null), ...(concepts.length ? { concepts } : {}) }
}

function traverse(req: PayloadRequest, id: string, q: HierarchyQuery, direction: 'ancestors' | 'descendants') {
  return guarded(req, id, ({ ref, index }, opts): ApiResult<TraversalBody> => {
    if (!q.node) return bad('Give the node to start from (node).')
    const h = hierarchyOf(index, q)
    if (!h.ok) return h
    const tree = h.body
    if (!tree.parent.has(q.node)) return NOT_FOUND
    const hierarchy: HierarchyRef = { kind: tree.kind, id: tree.id, version: tree.version }
    const node = itemOf(index, tree, q.node)
    if (tree.kind === 'phylogeny' && !(tree as PhylogenyIndex).rooted) return { ok: true, body: { status: 'indeterminate', reason: 'unrooted', snapshot: ref, hierarchy, node } }
    const bounds = { limit: clamp(q.limit, opts.limits.maxResults, opts.limits.maxResults), maxDepth: clamp(q.maxDepth, opts.limits.maxDepth, opts.limits.maxDepth) }
    const found = direction === 'ancestors' ? getAncestors(tree, q.node, bounds) : getDescendants(tree, q.node, bounds)
    return { ok: true, body: { status: 'found', snapshot: ref, hierarchy, node, items: found.ids.map((x) => itemOf(index, tree, x)), truncated: found.truncated } }
  })
}

/** Ancestors of a node, nearest first, bounded by `limit` and `maxDepth`. */
export const ancestorsOf = (req: PayloadRequest, id: string, q: HierarchyQuery) => traverse(req, id, q, 'ancestors')
/** Descendants of a node, breadth first, bounded by `limit` and `maxDepth`. */
export const descendantsOf = (req: PayloadRequest, id: string, q: HierarchyQuery) => traverse(req, id, q, 'descendants')

// ---------------------------------------------------------------------------------------------------------------
// MRCA

export type MrcaQuery = { phylogeny?: string; nodes?: string | string[] }

/**
 * Most recent common ancestor of phylogeny nodes, as core's `findMRCA` answers it: found, indeterminate (unrooted) or
 * none (different trees of a forest). Classifications are refused: they make no claim of common ancestry (I2).
 */
export async function mrcaOf(req: PayloadRequest, id: string, q: MrcaQuery & { classification?: string }) {
  return guarded(req, id, ({ ref, index }, opts): ApiResult<{ snapshot: SnapshotRef; hierarchy: HierarchyRef; result: MrcaResult; node?: NodeItem }> => {
    if (q.classification) return bad('A classification states placements, not common ancestry. MRCA needs a rooted phylogeny.')
    if (!q.phylogeny) return bad('Name the phylogeny (phylogeny).')
    const nodes = [...new Set((Array.isArray(q.nodes) ? q.nodes : (q.nodes ?? '').split(',')).map((x) => x.trim()).filter(Boolean))]
    if (!nodes.length) return bad('Give the nodes, separated by commas (nodes).')
    if (nodes.length > opts.limits.maxMrcaNodes) return bad(`At most ${opts.limits.maxMrcaNodes} nodes at a time.`)
    const h = hierarchyOf(index, { phylogeny: q.phylogeny })
    if (!h.ok) return h
    const tree = h.body as PhylogenyIndex
    if (nodes.some((x) => !tree.parent.has(x))) return NOT_FOUND
    const result = findMRCA(tree, nodes)
    return { ok: true, body: { snapshot: ref, hierarchy: { kind: 'phylogeny', id: tree.id, version: tree.version }, result, ...(result.status === 'found' ? { node: itemOf(index, tree, result.node) } : {}) } }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Coverage

export type CoverageQuery = { classification?: string; phylogeny?: string; included?: string | string[]; groups?: string | string[]; omittedLimit?: number | string }

const list = (v: string | string[] | undefined) => [...new Set((Array.isArray(v) ? v : (v ?? '').split(',')).map((x) => x.trim()).filter(Boolean))]

export type CoverageBody = {
  snapshot: SnapshotRef
  classification: { id: Id; version: string }
  phylogeny?: { id: Id; version: string }
  /** `all`: every concept in the classification counts as included. Otherwise how many listed ids were in it. */
  included: 'all' | { listed: number; inClassification: number; notInClassification: Id[] }
  groups: GroupCoverage[]
  /** Counts of taxa known to science are never estimated; this API takes none, so each group says `not-stated`. */
  note: string
}

/**
 * Core's `getCoverageReport` over a snapshot: within each group of a classification, how many concepts are included,
 * how many are omitted and where, and (with `phylogeny`) how many the hypothesis maps. `included` lists concept ids;
 * without it every concept in the classification counts. Absence from the dataset is never reported as absence from
 * nature.
 */
export async function coverageOf(req: PayloadRequest, id: string, q: CoverageQuery) {
  return guarded(req, id, ({ ref, index }, opts): ApiResult<CoverageBody> => {
    if (!q.classification) return bad('Name the classification (classification).')
    let cls
    try {
      cls = index.classification(q.classification)
    } catch {
      return NOT_FOUND
    }
    let phy: PhylogenyIndex | undefined
    if (q.phylogeny) {
      try {
        phy = index.phylogeny(q.phylogeny)
      } catch {
        return NOT_FOUND
      }
    }
    const listed = q.included === undefined || q.included === '' ? null : list(q.included)
    if (listed && listed.length > opts.limits.maxCoverageIds) return bad(`At most ${opts.limits.maxCoverageIds} included concepts at a time.`)
    const groups = q.groups === undefined || q.groups === '' ? undefined : list(q.groups)
    if (groups && groups.length > opts.limits.maxResults) return bad(`At most ${opts.limits.maxResults} groups at a time.`)
    if (groups?.some((g) => !cls.parent.has(g))) return NOT_FOUND
    if (!groups && cls.roots.length > opts.limits.maxResults) return bad(`This classification has ${cls.roots.length} roots, more than ${opts.limits.maxResults}: name the groups (groups).`)
    const included = listed ?? cls.ids
    const report = getCoverageReport(index, { classification: cls.id, included, ...(groups ? { groups } : {}), ...(phy ? { phylogeny: phy.id } : {}), omittedLimit: clamp(q.omittedLimit, 20, opts.limits.maxResults) })
    const outside = listed ? listed.filter((x) => !cls.parent.has(x)) : []
    return {
      ok: true,
      body: {
        snapshot: ref,
        classification: { id: cls.id, version: cls.version },
        ...(phy ? { phylogeny: { id: phy.id, version: phy.version } } : {}),
        included: listed ? { listed: listed.length, inClassification: listed.length - outside.length, notInClassification: outside.slice(0, opts.limits.maxResults) } : 'all',
        groups: report,
        note: 'Coverage of this dataset only. Taxa known to science are not stated: OneTaxonomy never estimates them.',
      },
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Export

export type SnapshotExport = { filename: string; snapshot: DatasetSnapshot; ref: SnapshotRef }

/** The sealed snapshot exactly as stored, after its checksum is checked again. Same access and 404 rules as the rest. */
export async function exportSnapshot(req: PayloadRequest, id: string) {
  return guarded(req, id, ({ ref, index }): ApiResult<SnapshotExport> => ({ ok: true, body: { filename: fileName(`${ref.id}-${ref.version}`), snapshot: index.snapshot, ref } }))
}

/** A safe download file name: letters, digits, dot, dash and underscore, ending in `.json`. */
export const fileName = (stem: string) => `${stem.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 120) || 'onetaxonomy'}.json`

export const asDownload = (filename: string, value: unknown) =>
  new Response(`${JSON.stringify(value, null, 2)}\n`, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` } })

// ---------------------------------------------------------------------------------------------------------------
// Endpoints

export const respond = <T>(r: ApiResult<T>) => (r.ok ? Response.json(r.body) : Response.json({ error: r.error }, { status: r.status }))

export const params = (req: PayloadRequest) => new URL(req.url ?? '', 'http://localhost').searchParams
export const routeId = (req: PayloadRequest) => String(req.routeParams?.id ?? '')
export const get = (p: URLSearchParams, k: string) => p.get(k) ?? undefined

/** `GET /api/<snapshots>/:id/search`, `/ancestors`, `/descendants`, `/mrca`, `/coverage` and `/export`, each read as the requester. */
export function snapshotEndpoints(): Endpoint[] {
  return [
    { path: '/:id/search', method: 'get', handler: async (req) => { const p = params(req); return respond(await searchNames(req, routeId(req), { q: get(p, 'q'), limit: get(p, 'limit'), locale: get(p, 'locale') })) } },
    ...(['ancestors', 'descendants'] as const).map((d): Endpoint => ({
      path: `/:id/${d}`,
      method: 'get',
      handler: async (req) => {
        const p = params(req)
        return respond(await traverse(req, routeId(req), { classification: get(p, 'classification'), phylogeny: get(p, 'phylogeny'), node: get(p, 'node'), limit: get(p, 'limit'), maxDepth: get(p, 'maxDepth') }, d))
      },
    })),
    { path: '/:id/mrca', method: 'get', handler: async (req) => { const p = params(req); return respond(await mrcaOf(req, routeId(req), { phylogeny: get(p, 'phylogeny'), classification: get(p, 'classification'), nodes: get(p, 'nodes') })) } },
    {
      path: '/:id/coverage',
      method: 'get',
      handler: async (req) => {
        const p = params(req)
        return respond(await coverageOf(req, routeId(req), { classification: get(p, 'classification'), phylogeny: get(p, 'phylogeny'), included: get(p, 'included'), groups: get(p, 'groups'), omittedLimit: get(p, 'omittedLimit') }))
      },
    },
    {
      path: '/:id/export',
      method: 'get',
      handler: async (req) => {
        const r = await exportSnapshot(req, routeId(req))
        return r.ok ? asDownload(r.body.filename, r.body.snapshot) : respond(r)
      },
    },
  ]
}
