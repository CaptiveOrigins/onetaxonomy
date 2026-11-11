import {
  canonicalJson,
  hasErrors,
  indexDataset,
  SCHEMA_VERSION,
  validateDataset,
  validateView,
  verifySnapshot,
  type DatasetSnapshot,
  type TaxonomicView,
} from '@captiveorigins/onetaxonomy-core'
import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeDeleteHook, type CollectionBeforeValidateHook, type CollectionConfig, type Field, type Where } from 'payload'

import { createAccess, idOf, manageAccess, readAccess, tenantOf } from './access.js'
import type { ResolvedOptions } from './types.js'

const fail = (message: string): never => {
  throw new APIError(message, 400, undefined, true)
}

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const stamp = (v: unknown) => (v === null || v === undefined || v === '' ? '' : v instanceof Date ? v.toISOString() : String(v))

/** Payload's JSON field takes objects; a REST client may send the text. */
const asObject = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      fail(`The ${what} isn't valid JSON.`)
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`The ${what} must be a JSON object.`)
  return v as Record<string, unknown>
}

const SNAPSHOT_TRANSITIONS: Record<string, string[]> = { staged: ['published', 'withdrawn'], published: ['withdrawn'], withdrawn: [] }
const VIEW_TRANSITIONS: Record<string, string[]> = { draft: ['published', 'withdrawn'], published: ['withdrawn'], withdrawn: [] }
const SNAPSHOT_CONTENT = ['snapshot', 'snapshotId', 'version', 'checksum', 'label', 'counts']
const PUBLICATION = ['publishedBy', 'publishedAt']

/** Fills a new record's tenant from the requester when it names none (the create access refuses another tenant). */
const fillTenant = (opts: ResolvedOptions): CollectionBeforeValidateHook => async ({ data, operation, req }) => {
  if (!opts.tenant || operation !== 'create' || !data || idOf(data[opts.tenant.field]) !== undefined) return data
  const t = await tenantOf(opts, req)
  if (t.ok) data[opts.tenant.field] = t.tenant
  return data
}

/** Status moves and who published, shared by snapshots and views. Publishing needs a signed-in person, who is recorded. */
function moveStatus(data: Record<string, unknown>, originalDoc: Record<string, unknown>, transitions: Record<string, string[]>, what: string, user: { id: unknown } | null | undefined) {
  const from = String(originalDoc.status)
  const to = String(data.status ?? from)
  if (to !== from) {
    if (!transitions[from]?.includes(to)) fail(`A ${what} can't go from ${from} to ${to}.`)
    if (to === 'published') {
      if (!user) fail(`Publishing a ${what} needs a signed-in person, who is recorded.`)
      data.publishedBy = String(user!.id)
      data.publishedAt = new Date().toISOString()
      return
    }
  }
  for (const f of PUBLICATION) if (f in data && stamp(data[f]) !== stamp(originalDoc[f])) fail(`Who published a ${what}, and when, are set by publishing.`)
}

const tenantLocked = (opts: ResolvedOptions, data: Record<string, unknown>, originalDoc: Record<string, unknown>, what: string) => {
  if (opts.tenant && opts.tenant.field in data && idOf(data[opts.tenant.field]) !== idOf(originalDoc[opts.tenant.field])) fail(`A ${what} stays in the tenant it was made for.`)
}

const snapshotBeforeChange = (opts: ResolvedOptions): CollectionBeforeChangeHook => async ({ data, originalDoc, operation, req }) => {
  if (operation === 'create') {
    if ((data.status ?? 'staged') !== 'staged') fail('A new snapshot starts as staged. Publish it as a separate step.')
    if (PUBLICATION.some((f) => stamp(data[f]))) fail('Who published a snapshot, and when, are set by publishing.')
    const s = asObject(data.snapshot, 'snapshot') as unknown as DatasetSnapshot
    if (s.schemaVersion !== SCHEMA_VERSION) fail(`This isn't a OneTaxonomy schema version ${SCHEMA_VERSION} snapshot.`)
    if (typeof s.id !== 'string' || !s.id || typeof s.version !== 'string' || !s.version) fail('A snapshot needs an id and a version.')
    if (!s.checksum) fail('This snapshot isn\'t sealed: it has no checksum. Seal it with sealSnapshot before storing it.')
    let verified = false
    try {
      verified = verifySnapshot(s)
    } catch {
      verified = false
    }
    if (!verified) fail('This snapshot doesn\'t match its checksum, so it was changed after it was sealed. It isn\'t stored.')
    const errors = validateDataset(s).filter((d) => d.severity === 'error')
    if (hasErrors(errors)) fail(`This snapshot has ${errors.length} error(s): ${errors.slice(0, 5).map((d) => d.message).join('; ')}${errors.length > 5 ? '; …' : ''}`)
    const derived: Record<string, unknown> = {
      snapshotId: s.id,
      version: s.version,
      checksum: s.checksum,
      label: `${s.id} ${s.version}`,
      counts: { names: s.names.length, concepts: s.concepts.length, classifications: s.classifications.length, phylogenies: s.phylogenies.length },
    }
    for (const f of ['snapshotId', 'version', 'checksum'] as const)
      if (stamp(data[f]) && stamp(data[f]) !== derived[f]) fail(`The ${f} given (${stamp(data[f])}) isn't the snapshot's own (${String(derived[f])}).`)
    const where: Where[] = [{ snapshotId: { equals: s.id } }, { version: { equals: s.version } }]
    if (opts.tenant) where.push({ [opts.tenant.field]: { equals: idOf(data[opts.tenant.field]) ?? null } })
    const existing = await req.payload.find({ collection: opts.slugs.snapshots as never, where: { and: where }, limit: 1, pagination: false, depth: 0, req, overrideAccess: true, select: { checksum: true } as never })
    if (existing.docs.length) {
      const prior = existing.docs[0] as unknown as { checksum?: string }
      fail(prior.checksum === s.checksum ? `Snapshot ${s.id} ${s.version} is already stored.` : `Snapshot ${s.id} ${s.version} is already stored with different content. A changed dataset needs a new version.`)
    }
    return { ...data, ...derived, snapshot: s, status: 'staged' }
  }
  for (const f of SNAPSHOT_CONTENT) if (f in data && !same(data[f], originalDoc[f])) fail('A sealed snapshot can\'t be edited. Store a new version instead.')
  tenantLocked(opts, data, originalDoc, 'snapshot')
  moveStatus(data, originalDoc, SNAPSHOT_TRANSITIONS, 'snapshot', req.user)
  return data
}

/** Only staged snapshots and draft views can be deleted: published ones may be pinned by views and pages. */
const onlyUnpublishedDeleted = (slug: string, deletable: string, what: string): CollectionBeforeDeleteHook => async ({ id, req }) => {
  const doc = (await req.payload.findByID({ collection: slug as never, id, depth: 0, req, overrideAccess: true, disableErrors: true, select: { status: true } as never })) as { status?: string } | null
  if (doc && doc.status !== deletable) fail(`A ${doc.status} ${what} can't be deleted. Withdraw it instead.`)
}

const viewBeforeChange = (opts: ResolvedOptions): CollectionBeforeChangeHook => async ({ data, originalDoc, operation, req }) => {
  const status = operation === 'create' ? 'draft' : String(originalDoc.status)
  if (operation === 'create') {
    if ((data.status ?? 'draft') !== 'draft') fail('A new view starts as a draft. Publish it as a separate step.')
    if (PUBLICATION.some((f) => stamp(data[f]))) fail('Who published a view, and when, are set by publishing.')
  } else {
    tenantLocked(opts, data, originalDoc, 'view')
    if (status !== 'draft') for (const f of ['view', 'snapshot', 'title', 'viewId']) if (f in data && !same(f === 'snapshot' ? idOf(data[f]) : data[f], f === 'snapshot' ? idOf(originalDoc[f]) : originalDoc[f])) fail(`A ${status} view can't be edited. Save a new view instead.`)
  }
  const snapshotRef = idOf(data.snapshot ?? originalDoc?.snapshot)
  const contentChanged = operation === 'create' || ['view', 'snapshot'].some((f) => f in data && !same(f === 'snapshot' ? idOf(data[f]) : data[f], f === 'snapshot' ? idOf(originalDoc[f]) : originalDoc[f]))
  const to = String(data.status ?? status)
  if (contentChanged || (to === 'published' && status !== 'published')) {
    if (!snapshotRef) fail('A view needs the snapshot it is shown over.')
    const snap = (await req.payload.findByID({ collection: opts.slugs.snapshots as never, id: snapshotRef!, depth: 0, req, overrideAccess: true, disableErrors: true })) as Record<string, unknown> | null
    if (!snap) fail('The view\'s snapshot doesn\'t exist.')
    if (opts.tenant) {
      const tenant = idOf(data[opts.tenant.field] ?? originalDoc?.[opts.tenant.field])
      if (tenant !== idOf(snap![opts.tenant.field])) fail('A view can only be shown over a snapshot in its own tenant.')
    }
    if (snap!.status === 'withdrawn') fail('This snapshot was withdrawn, so new views can\'t use it.')
    if (to === 'published' && snap!.status !== 'published') fail('Publish the snapshot before publishing a view of it.')
    if (contentChanged) {
      const view = asObject(data.view ?? originalDoc?.view, 'view') as unknown as TaxonomicView
      if (!view.snapshot || view.snapshot.id !== snap!.snapshotId || view.snapshot.version !== snap!.version || view.snapshot.checksum !== snap!.checksum)
        fail(`This view pins ${view.snapshot?.id ?? '?'} ${view.snapshot?.version ?? '?'} (checksum ${view.snapshot?.checksum ?? 'none'}), not the snapshot it's attached to. A stored view must pin its snapshot's id, version and checksum.`)
      let problems: { severity: string; message: string }[]
      try {
        problems = validateView(view, indexDataset(snap!.snapshot as DatasetSnapshot)).filter((d) => d.severity === 'error')
      } catch {
        problems = [{ severity: 'error', message: 'It isn\'t a OneTaxonomy view' }]
      }
      if (problems.length) fail(`This view can't be stored: ${problems.slice(0, 5).map((d) => d.message).join('; ')}.`)
      data.view = view
      data.viewId = view.id
    }
  }
  if (operation === 'create') return { ...data, status: 'draft' }
  moveStatus(data, originalDoc, VIEW_TRANSITIONS, 'view', req.user)
  return data
}

const tenantField = (opts: ResolvedOptions): Field[] =>
  opts.tenant ? [{ name: opts.tenant.field, type: 'relationship', relationTo: opts.tenant.collection as never, required: true, index: true, admin: { position: 'sidebar', description: 'Set when the record is made. It can\'t change.' } } as Field] : []

const publicationFields: Field[] = [
  { name: 'publishedBy', type: 'text', admin: { readOnly: true, position: 'sidebar', description: 'The signed-in user who published this. Set by publishing.' } },
  { name: 'publishedAt', type: 'date', admin: { readOnly: true, position: 'sidebar' } },
]

export function snapshotsCollection(opts: ResolvedOptions): CollectionConfig {
  const slug = opts.slugs.snapshots
  return {
    slug,
    labels: { singular: 'Taxonomy snapshot', plural: 'Taxonomy snapshots' },
    admin: { group: opts.admin.group, useAsTitle: 'label', defaultColumns: ['label', 'status', 'counts', 'publishedAt'] },
    disableDuplicate: true,
    access: { read: readAccess(opts), create: createAccess(opts), update: manageAccess(opts), delete: manageAccess(opts, { status: { equals: 'staged' } }) },
    indexes: [{ fields: [...(opts.tenant ? [opts.tenant.field] : []), 'snapshotId', 'version'], unique: true }],
    fields: [
      { name: 'label', type: 'text', admin: { readOnly: true, description: 'The snapshot\'s id and version. Set from the snapshot.' } },
      { name: 'snapshot', type: 'json', required: true, admin: { description: 'The sealed OneTaxonomy snapshot, stored exactly as given. Its checksum is checked when it is stored and when it is read.' } },
      { name: 'snapshotId', type: 'text', index: true, admin: { readOnly: true } },
      { name: 'version', type: 'text', admin: { readOnly: true } },
      { name: 'checksum', type: 'text', index: true, admin: { readOnly: true } },
      {
        name: 'counts',
        type: 'group',
        admin: { readOnly: true },
        fields: ['names', 'concepts', 'classifications', 'phylogenies'].map((name) => ({ name, type: 'number' }) as Field),
      },
      { name: 'status', type: 'select', required: true, defaultValue: 'staged', index: true, options: ['staged', 'published', 'withdrawn'], admin: { position: 'sidebar', description: 'Staged: only managers see it. Published: readers see it. Withdrawn: hidden from readers, kept for the views that pin it.' } },
      ...publicationFields,
      ...tenantField(opts),
    ],
    hooks: { beforeValidate: [fillTenant(opts)], beforeChange: [snapshotBeforeChange(opts)], beforeDelete: [onlyUnpublishedDeleted(slug, 'staged', 'snapshot')] },
  }
}

export function viewsCollection(opts: ResolvedOptions): CollectionConfig {
  const slug = opts.slugs.views
  return {
    slug,
    labels: { singular: 'Taxonomy view', plural: 'Taxonomy views' },
    admin: { group: opts.admin.group, useAsTitle: 'title', defaultColumns: ['title', 'snapshot', 'status', 'publishedAt'] },
    disableDuplicate: true,
    access: { read: readAccess(opts), create: createAccess(opts), update: manageAccess(opts), delete: manageAccess(opts, { status: { equals: 'draft' } }) },
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'snapshot', type: 'relationship', relationTo: opts.slugs.snapshots as never, required: true, index: true },
      { name: 'view', type: 'json', required: true, admin: { description: 'The OneTaxonomy view. It must pin its snapshot\'s id, version and checksum.' } },
      { name: 'viewId', type: 'text', index: true, admin: { readOnly: true } },
      { name: 'status', type: 'select', required: true, defaultValue: 'draft', index: true, options: ['draft', 'published', 'withdrawn'], admin: { position: 'sidebar' } },
      ...publicationFields,
      ...tenantField(opts),
    ],
    hooks: { beforeValidate: [fillTenant(opts)], beforeChange: [viewBeforeChange(opts)], beforeDelete: [onlyUnpublishedDeleted(slug, 'draft', 'view')] },
  }
}
