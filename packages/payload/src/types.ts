import type { PayloadRequest } from 'payload'

/** A tenant's ID as the host stores it (a relationship value). */
export type TenantId = string | number

/**
 * A host permission check. Only `true` allows: `false`, any other value, or a throw is a no.
 * `tenant` is the requester's tenant when tenant scope is on, otherwise null.
 */
export type AccessCallback = (args: { req: PayloadRequest; tenant: TenantId | null }) => boolean | Promise<boolean>

export type OneTaxonomyPluginOptions = {
  /** Slugs of the collections this plugin adds. Defaults `taxonomy-snapshots`, `taxonomy-views` and `taxonomy-imports`. */
  slugs?: { snapshots?: string; views?: string; imports?: string }
  access?: {
    /** Who may read published snapshots and views, and use the read API. Default: signed-in users. */
    read?: AccessCallback
    /**
     * Who may add snapshots and views, publish and withdraw them, and see staged and withdrawn ones.
     * Default: nobody, so only trusted server code using the Local API with `overrideAccess` can.
     */
    manage?: AccessCallback
  }
  /**
   * Keeps each tenant's snapshots and views apart. The plugin adds a required relationship to `collection` on both
   * collections; a record's tenant is set when it is made and can't change. Every read and write is limited to the
   * requester's tenant, as `resolve` gives it.
   */
  tenant?: {
    /** The host's tenants collection. */
    collection: string
    /** Field name on the plugin's collections. Default `tenant`. */
    field?: string
    /** The requester's tenant. Null, undefined, anything but a string or number, or a throw means no access at all. */
    resolve: (args: { req: PayloadRequest }) => TenantId | null | undefined | Promise<TenantId | null | undefined>
  }
  /** Locale used to search common names when a request doesn't name one (`?locale=`). Without either, only scientific names are searched. */
  locale?: { default?: string }
  /**
   * Upper bounds for the read API. Requests asking for more are clamped. `maxNodes` bounds a projected view
   * (default 5,000 nodes); `maxCoverageIds` bounds the concepts a coverage request may list (default 1,000).
   */
  limits?: { maxResults?: number; maxDepth?: number; maxMrcaNodes?: number; maxNodes?: number; maxCoverageIds?: number }
  /**
   * Import jobs (`taxonomy-imports`): turn a source file into a staged, sealed snapshot with a OneTaxonomy adapter.
   * Off unless given. Only managers see or run them. The plugin fetches nothing by itself: a job reads a file from
   * `uploads`, or a URL through the host's own `fetch`.
   */
  imports?: ImportOptions
  /** Admin group the collections appear under. Default `Taxonomy`. */
  admin?: { group?: string }
}

/** Where import jobs get their input. Give `uploads`, `fetch` or both. */
export type ImportOptions = {
  /**
   * The host's upload collection. A job names one of its documents, read as the person running the job (so the
   * host's upload access applies). `read` gets the document and returns its bytes; the default reads
   * `<staticDir>/<filename>` from the collection's local storage.
   */
  uploads?: { collection: string; read?: (args: { req: PayloadRequest; doc: Record<string, unknown> }) => Uint8Array | Promise<Uint8Array> }
  /**
   * Lets a job read a URL. Only URLs this function accepts are read: it should refuse (throw) anything the host
   * doesn't allow. Without it, jobs can't name a URL.
   */
  fetch?: (args: { url: string; req: PayloadRequest }) => Uint8Array | string | Promise<Uint8Array | string>
  /** Largest input read, in bytes. Default 15 MB, under MongoDB's 16 MB document limit. */
  maxBytes?: number
  /**
   * Run a job as soon as it is made, in the same request, as the person who made it. Default true. Turn it off to run
   * jobs yourself (`POST /api/<imports>/:id/run`, `runImport`, or your own queue).
   */
  runOnCreate?: boolean
  /** A job still marked running after this many minutes is taken to have been interrupted, and may be run again. Default 15. */
  staleAfterMinutes?: number
}

export type ResolvedOptions = {
  slugs: { snapshots: string; views: string; imports: string }
  access: { read: AccessCallback; manage: AccessCallback }
  tenant: { collection: string; field: string; resolve: NonNullable<OneTaxonomyPluginOptions['tenant']>['resolve'] } | null
  locale: { default: string | null }
  limits: { maxResults: number; maxDepth: number; maxMrcaNodes: number; maxNodes: number; maxCoverageIds: number }
  admin: { group: string }
  imports: { uploads: ImportOptions['uploads'] | null; fetch: ImportOptions['fetch'] | null; maxBytes: number; staleAfterMs: number; runOnCreate: boolean } | null
}

export const CUSTOM_KEY = 'onetaxonomy'

export function resolveOptions(o: OneTaxonomyPluginOptions = {}): ResolvedOptions {
  const positive = (v: number | undefined, fallback: number) => (v !== undefined && Number.isInteger(v) && v > 0 ? v : fallback)
  return {
    slugs: { snapshots: o.slugs?.snapshots ?? 'taxonomy-snapshots', views: o.slugs?.views ?? 'taxonomy-views', imports: o.slugs?.imports ?? 'taxonomy-imports' },
    access: { read: o.access?.read ?? (({ req }) => Boolean(req.user)), manage: o.access?.manage ?? (() => false) },
    tenant: o.tenant ? { collection: o.tenant.collection, field: o.tenant.field ?? 'tenant', resolve: o.tenant.resolve } : null,
    locale: { default: o.locale?.default ?? null },
    limits: {
      maxResults: positive(o.limits?.maxResults, 100),
      maxDepth: positive(o.limits?.maxDepth, 100),
      maxMrcaNodes: positive(o.limits?.maxMrcaNodes, 100),
      maxNodes: positive(o.limits?.maxNodes, 5000),
      maxCoverageIds: positive(o.limits?.maxCoverageIds, 1000),
    },
    admin: { group: o.admin?.group ?? 'Taxonomy' },
    imports: o.imports
      ? {
          uploads: o.imports.uploads ?? null,
          fetch: o.imports.fetch ?? null,
          maxBytes: positive(o.imports.maxBytes, 15 * 1024 * 1024),
          staleAfterMs: positive(o.imports.staleAfterMinutes, 15) * 60_000,
          runOnCreate: o.imports.runOnCreate !== false,
        }
      : null,
  }
}

/** The installed plugin's options, for host code calling the read functions directly. */
export function optionsOf(payload: { config: { custom?: Record<string, unknown> } }): ResolvedOptions {
  const o = payload.config.custom?.[CUSTOM_KEY] as ResolvedOptions | undefined
  if (!o) throw new Error('OneTaxonomy: the plugin is not installed in this Payload config.')
  return o
}
