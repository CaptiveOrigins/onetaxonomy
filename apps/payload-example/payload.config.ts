import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { oneTaxonomy } from '@captiveorigins/payload-plugin-onetaxonomy'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'

import { seed } from './src/seed'
import { isCurator, users } from './src/users'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const serverURL = process.env.EXAMPLE_URL || 'http://localhost:3000'

export default buildConfig({
  serverURL,
  // Sign-in cookies count only on requests from this site's own pages. `serverURL` is on the list already; the
  // second entry is the same server by its address.
  csrf: [serverURL.replace('//localhost', '//127.0.0.1')],
  secret: process.env.PAYLOAD_SECRET || '',
  admin: { user: users.slug, importMap: { baseDir: dirname } },
  collections: [users],
  // `ensureIndexes` builds the indexes before the first request, so the seed's first writes don't race them on an empty database.
  db: mongooseAdapter({ url: process.env.DATABASE_URI || '', ensureIndexes: true }),
  plugins: [
    oneTaxonomy({
      access: {
        // Published snapshots and views are public here. Anything staged or withdrawn is for curators.
        read: () => true,
        manage: ({ req }) => isCurator(req.user),
        // `propose` is left at its default: any signed-in person.
      },
      locale: { default: 'en' },
      proposals: {
        // The public handle, never the email address: an accepted proposal keeps this name for good.
        nameOf: ({ req }) => String((req.user as { handle?: unknown } | null)?.handle ?? ''),
      },
    }),
  ],
  telemetry: false,
  typescript: { autoGenerate: false },
  onInit: seed,
})
