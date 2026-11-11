import type { Access, PayloadRequest, Where } from 'payload'

import type { AccessCallback, ResolvedOptions, TenantId } from './types.js'

/** Runs a host callback. Only `true` is a yes; anything else, or a throw, is a no. */
export async function allowed(callback: AccessCallback, args: { req: PayloadRequest; tenant: TenantId | null }): Promise<boolean> {
  try {
    return (await callback(args)) === true
  } catch {
    return false
  }
}

/** The requester's tenant. `ok: false` when tenant scope is on and no usable tenant came back (including a throw). */
export async function tenantOf(opts: ResolvedOptions, req: PayloadRequest): Promise<{ ok: true; tenant: TenantId | null } | { ok: false }> {
  if (!opts.tenant) return { ok: true, tenant: null }
  try {
    const t = await opts.tenant.resolve({ req })
    return (typeof t === 'string' && t !== '') || (typeof t === 'number' && Number.isFinite(t)) ? { ok: true, tenant: t } : { ok: false }
  } catch {
    return { ok: false }
  }
}

/** What the requester may do: manage (everything in their tenant), read (published records in their tenant), or nothing. */
export async function roleOf(opts: ResolvedOptions, req: PayloadRequest): Promise<{ role: 'manager' | 'reader'; tenant: TenantId | null } | null> {
  const t = await tenantOf(opts, req)
  if (!t.ok) return null
  if (await allowed(opts.access.manage, { req, tenant: t.tenant })) return { role: 'manager', tenant: t.tenant }
  if (await allowed(opts.access.read, { req, tenant: t.tenant })) return { role: 'reader', tenant: t.tenant }
  return null
}

/** A relationship value as a comparable string (populated documents by their ID). */
export const idOf = (v: unknown): string | undefined => (v && typeof v === 'object' ? idOf((v as { id?: unknown }).id) : v === null || v === undefined || v === '' ? undefined : String(v))

const all = (...wheres: (Where | null)[]): Where | true => {
  const w = wheres.filter((x): x is Where => x !== null)
  return w.length === 0 ? true : w.length === 1 ? w[0]! : { and: w }
}

const tenantWhere = (opts: ResolvedOptions, tenant: TenantId | null): Where | null => (opts.tenant ? { [opts.tenant.field]: { equals: tenant } } : null)

/** Read: managers see every status in their tenant; readers only published records in their tenant. */
export const readAccess = (opts: ResolvedOptions): Access => async ({ req }) => {
  const who = await roleOf(opts, req)
  if (!who) return false
  return who.role === 'manager' ? all(tenantWhere(opts, who.tenant)) : all(tenantWhere(opts, who.tenant), { status: { equals: 'published' } })
}

/** Update and delete: managers, in their own tenant, optionally narrowed further (delete: staged or draft only). */
export const manageAccess = (opts: ResolvedOptions, narrow: Where | null = null): Access => async ({ req }) => {
  const t = await tenantOf(opts, req)
  if (!t.ok || !(await allowed(opts.access.manage, { req, tenant: t.tenant }))) return false
  return all(tenantWhere(opts, t.tenant), narrow)
}

/**
 * Create: managers. A record naming another tenant is refused; one naming none gets the requester's tenant
 * (`fillTenant`). Payload asks without data to decide whether to show the Create button.
 */
export const createAccess = (opts: ResolvedOptions): Access => async ({ req, data }) => {
  const t = await tenantOf(opts, req)
  if (!t.ok || !(await allowed(opts.access.manage, { req, tenant: t.tenant }))) return false
  if (!opts.tenant || !data) return true
  const given = idOf((data as Record<string, unknown>)[opts.tenant.field])
  return given === undefined || given === String(t.tenant)
}
