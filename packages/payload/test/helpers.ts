import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { sealSnapshot, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, createLocalReq, getPayload, type CollectionConfig, type Config, type Payload, type TypedUser } from 'payload'

import amniotes from '../../../fixtures/amniotes.json'
import checklist from '../../../fixtures/checklist.json'
import structures from '../../../fixtures/structures.json'

/**
 * A real Payload on an in-memory MongoDB replica set (transactions on, indexes built). No network: the binary is cached.
 * `transactions: false` runs it the way a database without transactions would.
 */
export async function startPayload(config: Omit<Config, 'db' | 'secret'>, { transactions = true }: { transactions?: boolean } = {}) {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const payload = await getPayload({
    config: await buildConfig({
      ...config,
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('onetaxonomy'), ensureIndexes: true, ...(transactions ? {} : { transactionOptions: false as const }) }),
    }),
  })
  return {
    payload,
    stop: async () => {
      await payload.destroy()
      await mongo.stop()
    },
  }
}

export const tenantsCollection: CollectionConfig = { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] }

export const usersCollection = (withTenant = false): CollectionConfig => ({
  slug: 'users',
  auth: true,
  fields: [
    { name: 'role', type: 'select', options: ['manager', 'reader', 'thrower', 'viewer'], defaultValue: 'reader' },
    ...(withTenant ? [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' } as CollectionConfig['fields'][number]] : []),
  ],
})

export const roleOf = (user: unknown) => (user as { role?: string } | null | undefined)?.role

/** Host callbacks used by the tests: managers manage, any signed-in user reads, and a "thrower" makes both throw. */
export const access = {
  manage: ({ req }: { req: { user?: unknown } }) => {
    if (roleOf(req.user) === 'thrower') throw new Error('host check failed')
    return roleOf(req.user) === 'manager'
  },
  read: ({ req }: { req: { user?: unknown } }) => {
    if (roleOf(req.user) === 'thrower') throw new Error('host check failed')
    return Boolean(req.user)
  },
}

let n = 0
export async function makeUser(payload: Payload, role: string, extra: Record<string, unknown> = {}) {
  n++
  return (await payload.create({ collection: 'users', data: { email: `user${n}@example.com`, password: 'a-long-test-password', role, ...extra } as never })) as unknown as TypedUser
}

/** Calls a collection endpoint the way the REST API would, as `user` (null = anonymous). `body` is a POST body: JSON, or text sent as it is. */
export async function callEndpoint(payload: Payload, collection: string, path: string, id: string, query: Record<string, string | number> = {}, user: TypedUser | null = null, body?: unknown) {
  const endpoint = (payload.collections[collection as never]!.config.endpoints || []).find((e) => e.path === path)
  if (!endpoint) throw new Error(`No endpoint ${collection}${path}`)
  const req = await createLocalReq({ user: (user ?? undefined) as never }, payload)
  if (user === null) req.user = null
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))
  ;(req as { url: string }).url = `http://localhost/api/${collection}${path.replace(':id', id)}?${qs}`
  req.routeParams = { id }
  ;(req as { text?: () => Promise<string> }).text = async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body))
  const res = (await endpoint.handler(req)) as Response
  return { status: res.status, body: (await res.json()) as any }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
export const sealed = {
  amniotes: () => sealSnapshot(clone(amniotes) as unknown as DatasetSnapshot) as DatasetSnapshot,
  structures: () => sealSnapshot(clone(structures) as unknown as DatasetSnapshot) as DatasetSnapshot,
  checklist: () => sealSnapshot(clone(checklist) as unknown as DatasetSnapshot) as DatasetSnapshot,
}
/** Every stored field of a snapshot document, content included. A read that names no `select` leaves the content out. */
export const WITH_CONTENT = { snapshot: true, label: true, snapshotId: true, version: true, checksum: true, counts: true, status: true, publishedBy: true, publishedAt: true } as never

/** A sealed snapshot, copied so a test can change it (which breaks its checksum). */
export const unfrozen = (s: DatasetSnapshot) => clone(s)
