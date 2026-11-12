import type { CollectionConfig } from 'payload'

import { isCurator } from './users'

const curatorOnly = ({ req }: { req: { user?: unknown } }) => isCurator(req.user)

/**
 * The files import jobs read: checklists and tree files a curator uploads. Curators only, to read as well as to add,
 * so nobody else can fetch a source file by its address. An import job reads its file as the person running it, so
 * these rules decide that too.
 *
 * No list of allowed file types: tree files have no dependable one. Payload refuses HTML, scripts and programs on its
 * own, and serves what it keeps with a content security policy.
 */
export const sources = (staticDir: string): CollectionConfig => ({
  slug: 'sources',
  labels: { singular: 'Source file', plural: 'Source files' },
  admin: { group: 'Taxonomy', description: 'Files for import jobs to read. Upload one here, then name it in a new taxonomy import.' },
  access: { read: curatorOnly, create: curatorOnly, update: curatorOnly, delete: curatorOnly },
  upload: { staticDir },
  fields: [],
})
