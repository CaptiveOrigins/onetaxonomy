import type { PayloadRequest } from 'payload'

/** A tenant's ID as the host stores it (a relationship value). */
export type TenantId = string | number

/**
 * A host permission check. Only `true` allows: `false`, any other value, or a throw is a no.
 * `tenant` is the requester's tenant when tenant scope is on, otherwise null.
 */
export type AccessCallback = (args: { req: PayloadRequest; tenant: TenantId | null }) => boolean | Promise<boolean>

export type OneTaxonomyPluginOptions = {
  /** Slugs of the collections this plugin adds. Defaults `taxonomy-snapshots` and `taxonomy-views`. */
  slugs?: { snapshots?: string; views?: string }
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
  /** Upper bounds for the read API. Requests asking for more are clamped. */
  limits?: { maxResults?: number; maxDepth?: number; maxMrcaNodes?: number }
  /** Admin group the collections appear under. Default `Taxonomy`. */
  admin?: { group?: string }
}

export type ResolvedOptions = {
  slugs: { snapshots: string; views: string }
  access: { read: AccessCallback; manage: AccessCallback }
  tenant: { collection: string; field: string; resolve: NonNullable<OneTaxonomyPluginOptions['tenant']>['resolve'] } | null
  locale: { default: string | null }
  limits: { maxResults: number; maxDepth: number; maxMrcaNodes: number }
  admin: { group: string }
}

export const CUSTOM_KEY = 'onetaxonomy'

export function resolveOptions(o: OneTaxonomyPluginOptions = {}): ResolvedOptions {
  const positive = (v: number | undefined, fallback: number) => (v !== undefined && Number.isInteger(v) && v > 0 ? v : fallback)
  return {
    slugs: { snapshots: o.slugs?.snapshots ?? 'taxonomy-snapshots', views: o.slugs?.views ?? 'taxonomy-views' },
    access: { read: o.access?.read ?? (({ req }) => Boolean(req.user)), manage: o.access?.manage ?? (() => false) },
    tenant: o.tenant ? { collection: o.tenant.collection, field: o.tenant.field ?? 'tenant', resolve: o.tenant.resolve } : null,
    locale: { default: o.locale?.default ?? null },
    limits: { maxResults: positive(o.limits?.maxResults, 100), maxDepth: positive(o.limits?.maxDepth, 100), maxMrcaNodes: positive(o.limits?.maxMrcaNodes, 100) },
    admin: { group: o.admin?.group ?? 'Taxonomy' },
  }
}

/** The installed plugin's options, for host code calling the read functions directly. */
export function optionsOf(payload: { config: { custom?: Record<string, unknown> } }): ResolvedOptions {
  const o = payload.config.custom?.[CUSTOM_KEY] as ResolvedOptions | undefined
  if (!o) throw new Error('OneTaxonomy: the plugin is not installed in this Payload config.')
  return o
}
