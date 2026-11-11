import type { CollectionConfig } from 'payload'

type Person = { id?: string | number; role?: string; handle?: string }

export const isCurator = (user: unknown) => (user as Person | null | undefined)?.role === 'curator'

/** Curators see and change everyone. Anyone else sees and changes only their own account. */
const selfOrCurator = ({ req }: { req: { user?: unknown } }) => {
  if (isCurator(req.user)) return true
  const id = (req.user as Person | null | undefined)?.id
  return id === undefined ? false : { id: { equals: id } }
}

/**
 * The site's accounts. Two roles: a curator manages the taxonomy and decides on proposals; a member reads and makes
 * proposals. `handle` is the public name shown beside a person's proposals, so it is not their email address. Proposals store the
 * account's id; the handle is looked up when one is shown.
 */
export const users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: { useAsTitle: 'handle' },
  access: {
    // The admin is for curators. Members use the site and the API.
    admin: ({ req }) => isCurator(req.user),
    create: ({ req }) => isCurator(req.user),
    delete: ({ req }) => isCurator(req.user),
    read: selfOrCurator,
    update: selfOrCurator,
  },
  fields: [
    {
      name: 'handle',
      type: 'text',
      required: true,
      unique: true,
      admin: { description: 'Shown beside your proposals to people who can read them. Change it and the new name shows everywhere at once. It is not stored in any snapshot.' },
    },
    {
      name: 'role',
      type: 'select',
      options: [
        { label: 'Curator', value: 'curator' },
        { label: 'Member', value: 'member' },
      ],
      defaultValue: 'member',
      required: true,
      // Only a curator hands out roles: nobody raises their own.
      access: { create: ({ req }) => isCurator(req.user), update: ({ req }) => isCurator(req.user) },
    },
  ],
  hooks: {
    beforeChange: [
      // The first account on an empty site is its curator (Payload's "create first user" screen).
      async ({ data, operation, req }) => {
        if (operation !== 'create') return data
        const { docs } = await req.payload.find({ collection: 'users', limit: 1, depth: 0, pagination: false, req })
        if (docs.length === 0) data.role = 'curator'
        return data
      },
    ],
  },
}
