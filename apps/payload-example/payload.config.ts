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
  // Payload's default avatar asks gravatar.com for a picture by a hash of the signed-in address. This example asks nobody.
  admin: { user: users.slug, avatar: 'default', importMap: { baseDir: dirname } },
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
        // `personId` is left at its default, the account's id: that is all a proposal stores and all an accepted one
        // seals. The handle is looked up here each time a proposal is shown. A member can't read other accounts, so
        // this read is trusted and asks for the handle alone, never the email address.
        displayName: async ({ req, personId }) => {
          const person = await req.payload.findByID({ collection: 'users', id: personId, depth: 0, select: { handle: true }, overrideAccess: true, disableErrors: true, req })
          return (person as { handle?: string } | null)?.handle
        },
      },
    }),
  ],
  telemetry: false,
  typescript: { autoGenerate: false },
  onInit: seed,
})
