import type { Id, Source } from '@extantape/onetaxonomy-core'
import type { Endpoint, PayloadRequest } from 'payload'

import { clamp, contentOf, get, integrityGuard, NOT_FOUND, params, respond, routeId, type ApiResult, type SnapshotRef } from './api.js'
import { displayNameFor } from './proposals.js'
import { optionsOf } from './types.js'

export type SnapshotStatus = 'staged' | 'published' | 'withdrawn'

/** A source record as a summary lists it: who the data is from and on what terms. `provenance` notes are left to the export. */
export type SourceSummary = Pick<Source, 'id' | 'title' | 'citation' | 'url' | 'license' | 'retrievedAt' | 'externalVersion' | 'illustrative'>

/**
 * What a stored snapshot holds, small enough to show on a page: never its names, concepts or trees themselves. Lists
 * hold at most `limit` entries each; `counts` has the full numbers.
 */
export type SnapshotSummary = {
  snapshot: SnapshotRef & { status: SnapshotStatus; createdAt: string }
  counts: { names: number; concepts: number; classifications: number; phylogenies: number; sources: number }
  sources: SourceSummary[]
  classifications: { id: Id; title: string; version: string; placements: number; roots: number }[]
  phylogenies: { id: Id; title: string; version: string; rooted: boolean; nodes: number; tips: number }[]
  /** The snapshot this one was made from, when it records one. */
  derivedFrom?: {
    snapshot: Id
    version: string
    checksum?: string
    /** Set when it was made by selecting part of a larger snapshot. */
    selection?: { id: Id; version: string }
    /**
     * The accepted proposal it was made from. `author` and `acceptedBy` are the ids sealed in the snapshot.
     * `authorName` and `acceptedByName` are the names the host shows this requester for them now
     * (`proposals.displayName`): looked up for signed-in requesters only, never stored, and left out when there is none.
     */
    proposal?: { id: Id; title: string; author: string; authorName?: string; acceptedBy: string; acceptedByName?: string; classification: { id: Id; version: string }; moved: number }
  }
  /** True when a list was cut to `limit`. */
  truncated: boolean
}

/**
 * A summary of a snapshot the requester may read: its status, counts, sources, hierarchies and where it came from.
 * Same access and 404 rules as the rest of the read API, and the stored snapshot's checksum is checked first.
 */
export async function summarizeSnapshot(req: PayloadRequest, id: string, query: { limit?: number | string } = {}): Promise<ApiResult<SnapshotSummary>> {
  const opts = optionsOf(req.payload)
  return integrityGuard(req, async () => {
    type Head = { id: string | number; snapshotId?: string; version?: string; checksum?: string; status?: SnapshotStatus }
    let head: Head | null = null
    try {
      head = (await req.payload.findByID({ collection: opts.slugs.snapshots as never, id, depth: 0, req, overrideAccess: false, disableErrors: true, select: { snapshotId: true, version: true, checksum: true, status: true } as never })) as unknown as Head | null
    } catch {
      return NOT_FOUND
    }
    if (!head?.checksum || !head.snapshotId || !head.version) return NOT_FOUND
    const ref: SnapshotRef = { doc: String(head.id), id: head.snapshotId, version: head.version, checksum: head.checksum }
    // Authorized by the read above; this fetches the content and checks it against its checksum.
    const index = await contentOf(req, opts, ref)
    const s = index.snapshot
    const limit = clamp(query.limit, 20, opts.limits.maxResults)
    let truncated = false
    const cut = <T>(list: T[]): T[] => {
      if (list.length > limit) truncated = true
      return list.slice(0, limit)
    }
    const d = s.derivedFrom
    const p = d?.proposal
    // Names are for signed-in people only, like everything else about who proposed what.
    const authorName = p && req.user ? await displayNameFor(opts, req, p.author) : undefined
    const acceptedByName = p && req.user ? await displayNameFor(opts, req, p.acceptedBy) : undefined
    return {
      ok: true,
      body: {
        snapshot: { ...ref, status: head.status ?? 'staged', createdAt: s.createdAt },
        counts: { names: s.names.length, concepts: s.concepts.length, classifications: s.classifications.length, phylogenies: s.phylogenies.length, sources: s.sources.length },
        sources: cut(s.sources).map((x) => ({
          id: x.id,
          title: x.title,
          ...(x.citation ? { citation: x.citation } : {}),
          ...(x.url ? { url: x.url } : {}),
          ...(x.license ? { license: x.license } : {}),
          ...(x.retrievedAt ? { retrievedAt: x.retrievedAt } : {}),
          ...(x.externalVersion ? { externalVersion: x.externalVersion } : {}),
          ...(x.illustrative ? { illustrative: true } : {}),
        })),
        classifications: cut(s.classifications).map((c) => ({ id: c.id, title: c.title, version: c.version, placements: c.placements.length, roots: index.classification(c.id).roots.length })),
        phylogenies: cut(s.phylogenies).map((y) => ({ id: y.id, title: y.title, version: y.version, rooted: y.rooted, nodes: y.nodes.length, tips: index.phylogeny(y.id).tips.length })),
        ...(d
          ? {
              derivedFrom: {
                snapshot: d.snapshot,
                version: d.version,
                ...(d.checksum ? { checksum: d.checksum } : {}),
                ...(d.selection ? { selection: d.selection } : {}),
                ...(p
                  ? { proposal: { id: p.id, title: p.title, author: p.author, ...(authorName ? { authorName } : {}), acceptedBy: p.acceptedBy, ...(acceptedByName ? { acceptedByName } : {}), classification: p.classification, moved: p.moved.length } }
                  : {}),
              },
            }
          : {}),
        truncated,
      },
    }
  })
}

/** `GET /api/<snapshots>/:id/summary`, read as the requester. */
export function summaryEndpoints(): Endpoint[] {
  return [{ path: '/:id/summary', method: 'get', handler: async (req) => respond(await summarizeSnapshot(req, routeId(req), { limit: get(params(req), 'limit') })) }]
}
