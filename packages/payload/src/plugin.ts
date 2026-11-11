import type { Config, Plugin } from 'payload'

import { snapshotEndpoints } from './api.js'
import { snapshotsCollection, viewsCollection } from './collections.js'
import { importsCollection } from './imports.js'
import { viewEndpoints } from './views-api.js'
import { CUSTOM_KEY, resolveOptions, type OneTaxonomyPluginOptions } from './types.js'

/**
 * OneTaxonomy for Payload. Adds a collection of sealed snapshots (checksum checked when stored and when read) and a
 * collection of views pinned to them, with staged and published states, a bounded read API on both, and (with
 * `imports`) import jobs that turn a source file into a staged sealed snapshot.
 * Access goes through the host's callbacks and fails closed. The plugin holds no taxonomic data of its own.
 */
export const oneTaxonomy =
  (options: OneTaxonomyPluginOptions = {}): Plugin =>
  (config: Config): Config => {
    const opts = resolveOptions(options)
    const taken = new Set((config.collections ?? []).map((c) => c.slug))
    for (const slug of [opts.slugs.snapshots, opts.slugs.views, ...(opts.imports ? [opts.slugs.imports] : [])]) if (taken.has(slug)) throw new Error(`OneTaxonomy: a collection "${slug}" already exists. Choose other slugs.`)
    if (opts.tenant && !taken.has(opts.tenant.collection)) throw new Error(`OneTaxonomy: the tenants collection "${opts.tenant.collection}" isn't in this config.`)
    if (opts.imports?.uploads) {
      const uploads = (config.collections ?? []).find((c) => c.slug === opts.imports!.uploads!.collection)
      if (!uploads?.upload) throw new Error(`OneTaxonomy: imports.uploads names "${opts.imports.uploads.collection}", which isn't an upload collection in this config.`)
    }
    const snapshots = snapshotsCollection(opts)
    return {
      ...config,
      collections: [
        ...(config.collections ?? []),
        { ...snapshots, endpoints: snapshotEndpoints() },
        { ...viewsCollection(opts), endpoints: viewEndpoints() },
        ...(opts.imports ? [importsCollection(opts)] : []),
      ],
      custom: { ...config.custom, [CUSTOM_KEY]: opts },
    }
  }
