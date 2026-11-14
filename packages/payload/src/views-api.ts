import { describeView, projectView, type DatasetIndex, type Projection, type TaxonomicView, type ViewDisclosure } from '@extantape/onetaxonomy-core'
import type { Endpoint, PayloadRequest } from 'payload'

import { idOf } from './access.js'
import { asDownload, bad, clamp, contentOf, fileName, get, integrityGuard, NOT_FOUND, params, respond, routeId, SnapshotIntegrityError, type ApiResult, type SnapshotRef } from './api.js'
import { optionsOf, type ResolvedOptions } from './types.js'

/** The view's snapshot, with its status. `withdrawn` is true when its publisher withdrew it after the view was published. */
export type ViewSource = SnapshotRef & { status: 'staged' | 'published' | 'withdrawn'; withdrawn: boolean }
export type ViewRef = { doc: string; id: string; title: string; status: string }

type LoadedView = { view: TaxonomicView; ref: ViewRef; source: ViewSource; index: DatasetIndex }

const SOURCES = 'onetaxonomyViewSources'
const sourcesOf = (req: PayloadRequest) => ((req.context ??= {})[SOURCES] ??= new Map<string, Promise<ViewSource | null>>()) as Map<string, Promise<ViewSource | null>>

/**
 * The snapshot a view is shown over, with its status now: the same `source` the view endpoints answer with. It reads
 * only the snapshot's head (never its content) and skips the snapshot's own access rules, so call it only for a view
 * the requester was already allowed to read. Null when the snapshot is gone. Remembered for the rest of the request,
 * so a page of views over one snapshot costs one read; `forgetViewSource` drops it when the snapshot changes.
 */
export function viewSourceOf(req: PayloadRequest, opts: ResolvedOptions, snapshotDoc: string): Promise<ViewSource | null> {
  const known = sourcesOf(req)
  let source = known.get(snapshotDoc)
  if (!source) {
    type Head = { id: string | number; snapshotId?: string; version?: string; checksum?: string; status?: ViewSource['status'] }
    source = (req.payload.findByID({ collection: opts.slugs.snapshots as never, id: snapshotDoc, depth: 0, req, overrideAccess: true, disableErrors: true, select: { snapshotId: true, version: true, checksum: true, status: true } as never }) as unknown as Promise<Head | null>).then((head) => {
      if (!head?.checksum || !head.snapshotId || !head.version) return null
      const status = head.status ?? 'staged'
      return { doc: String(head.id), id: head.snapshotId, version: head.version, checksum: head.checksum, status, withdrawn: status === 'withdrawn' }
    })
    known.set(snapshotDoc, source)
    // A read that failed is not remembered.
    source.catch(() => known.delete(snapshotDoc))
  }
  return source
}

/** Drops what this request remembers about a snapshot's status. Called when the snapshot changes or is deleted. */
export const forgetViewSource = (req: PayloadRequest, snapshotDoc: string) => void (req.context?.[SOURCES] as Map<string, unknown> | undefined)?.delete(snapshotDoc)

/**
 * A view the requester may read, with its snapshot. Readers see published views; managers see every status, in their
 * tenant. The snapshot is read through the view: a published view whose snapshot was later withdrawn stays readable
 * and says so (`source.withdrawn`), rather than disappearing. Null when the view doesn't exist or can't be read.
 */
async function loadView(req: PayloadRequest, id: string, opts: ResolvedOptions): Promise<LoadedView | null> {
  type ViewDoc = { id: string | number; title?: string; status?: string; view?: TaxonomicView; snapshot?: unknown }
  let doc: ViewDoc | null = null
  try {
    doc = (await req.payload.findByID({ collection: opts.slugs.views as never, id, depth: 0, req, overrideAccess: false, disableErrors: true, select: { title: true, status: true, view: true, snapshot: true } as never })) as unknown as ViewDoc | null
  } catch {
    return null
  }
  const snapshotDoc = idOf(doc?.snapshot)
  if (!doc || !doc.view || !snapshotDoc) return null
  // Authorized through the view above (same tenant, by the view's own rules); this reads the snapshot's head.
  const source = await viewSourceOf(req, opts, snapshotDoc)
  if (!source) throw new SnapshotIntegrityError(`The snapshot behind view ${doc.view.id} is missing. Nothing is answered from it.`)
  const pin = doc.view.snapshot
  if (!pin || pin.id !== source.id || pin.version !== source.version || pin.checksum !== source.checksum)
    throw new SnapshotIntegrityError(`View ${doc.view.id} no longer pins the snapshot it is stored with. Nothing is answered from it.`)
  const ref: SnapshotRef = { doc: source.doc, id: source.id, version: source.version, checksum: source.checksum }
  const index = await contentOf(req, opts, ref)
  return { view: doc.view, ref: { doc: String(doc.id), id: doc.view.id, title: doc.title ?? doc.view.title, status: doc.status ?? 'draft' }, source, index }
}

const withdrawnNotice = (s: ViewSource) =>
  `Source withdrawn: snapshot ${s.id} ${s.version} was withdrawn by its publisher after this view was published. The view is kept readable so links to it don't break, but its data may no longer be endorsed.`

async function viewGuarded<T>(req: PayloadRequest, id: string, run: (loaded: LoadedView, opts: ResolvedOptions) => ApiResult<T>): Promise<ApiResult<T>> {
  const opts = optionsOf(req.payload)
  return integrityGuard(req, async () => {
    const loaded = await loadView(req, id, opts)
    return loaded ? run(loaded, opts) : NOT_FOUND
  })
}

export type ProjectionBody = { view: ViewRef; source: ViewSource; projection: Projection; disclosure: ViewDisclosure }

/**
 * Core's `projectView` for a stored view: the nodes to draw, in order, with counts of everything not drawn, and
 * `describeView`'s disclosure (what kind of hierarchy, what is hidden, the pinned snapshot and its sources). The node
 * count is capped at `limits.maxNodes` and says so (`projection.truncated`).
 */
export async function projectedView(req: PayloadRequest, id: string, q: { limit?: number | string } = {}) {
  return viewGuarded(req, id, ({ view, ref, source, index }, opts): ApiResult<ProjectionBody> => {
    let projection: Projection
    try {
      projection = projectView(index, view, { limit: clamp(q.limit, opts.limits.maxNodes, opts.limits.maxNodes) })
    } catch (error) {
      return bad(`This view can't be projected: ${(error as Error).message}`)
    }
    const disclosure = describeView(index, view, projection, source.withdrawn ? { notice: withdrawnNotice(source) } : {})
    return { ok: true, body: { view: ref, source, projection, disclosure } }
  })
}

/** What `GET /api/<views>/:id/export` downloads. `view` is the plain view file, as `parseView` reads it. */
export type ViewExport = {
  format: 'onetaxonomy-view-export'
  formatVersion: 1
  view: TaxonomicView
  source: ViewSource
  disclosure: { title: string; lines: string[] }
}

/** A stored view as JSON, with the snapshot it pins and its disclosure. Same access and 404 rules as the projection. */
export async function exportView(req: PayloadRequest, id: string) {
  return viewGuarded(req, id, ({ view, source, index }, opts): ApiResult<{ filename: string; file: ViewExport }> => {
    const projection = projectView(index, view, { limit: opts.limits.maxNodes })
    const d = describeView(index, view, projection, source.withdrawn ? { notice: withdrawnNotice(source) } : {})
    return { ok: true, body: { filename: fileName(`${view.id}`), file: { format: 'onetaxonomy-view-export', formatVersion: 1, view, source, disclosure: { title: d.title, lines: d.lines } } } }
  })
}

/** `GET /api/<views>/:id/projection` and `/export`, each read as the requester. */
export function viewEndpoints(): Endpoint[] {
  return [
    { path: '/:id/projection', method: 'get', handler: async (req) => respond(await projectedView(req, routeId(req), { limit: get(params(req), 'limit') })) },
    {
      path: '/:id/export',
      method: 'get',
      handler: async (req) => {
        const r = await exportView(req, routeId(req))
        return r.ok ? asDownload(r.body.filename, r.body.file) : respond(r)
      },
    },
  ]
}
