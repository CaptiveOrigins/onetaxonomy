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
import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeDeleteHook, type CollectionBeforeOperationHook, type CollectionBeforeValidateHook, type CollectionConfig, type Field, type Where } from 'payload'

import { createAccess, idOf, manageAccess, readAccess, tenantOf } from './access.js'
import { panelField, type ResolvedOptions } from './types.js'
import { forgetViewSource, viewSourceOf } from './views-api.js'

export const fail = (message: string): never => {
  throw new APIError(message, 400, undefined, true)
}

export const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const stamp = (v: unknown) => (v === null || v === undefined || v === '' ? '' : v instanceof Date ? v.toISOString() : String(v))

/** Payload's JSON field takes objects; a REST client may send the text. */
export const asObject = (v: unknown, what: string): Record<string, unknown> => {
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
export const fillTenant = (opts: ResolvedOptions): CollectionBeforeValidateHook => async ({ data, operation, req }) => {
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

export const tenantLocked = (opts: ResolvedOptions, data: Record<string, unknown>, originalDoc: Record<string, unknown>, what: string) => {
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

/**
 * A stored snapshot can be 15 MB, so its content is read only when it is asked for by name. A read, create, update or
 * delete that names no `select` answers with every field except `snapshot`; `select: { snapshot: true }` reads it.
 * Payload's admin pages, its lists and a populated relationship name no `select`, so none of them carries the content.
 * The lock on sealed content doesn't depend on this: an update compares against the stored document, read whole.
 */
const CONTENT_OPERATIONS = new Set(['read', 'create', 'update', 'delete'])
export const contentOnRequest: CollectionBeforeOperationHook = ({ args, operation }) =>
  CONTENT_OPERATIONS.has(operation) && args && (args as { select?: unknown }).select == null ? ({ ...args, select: { snapshot: false } } as typeof args) : args

/** For what a panel already shows. */
const IN_PANEL = { readOnly: true, hidden: true }

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
    // The content is only read when the view has to be checked against it.
    const select = { snapshotId: true, version: true, checksum: true, status: true, ...(opts.tenant ? { [opts.tenant.field]: true } : {}), ...(contentChanged ? { snapshot: true } : {}) }
    const snap = (await req.payload.findByID({ collection: opts.slugs.snapshots as never, id: snapshotRef!, depth: 0, req, overrideAccess: true, disableErrors: true, select: select as never })) as Record<string, unknown> | null
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

export const tenantField = (opts: ResolvedOptions): Field[] =>
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
      ...panelField(opts, 'SnapshotPanel'),
      // The panel shows the label, id, version, checksum and counts. They are hidden, not disabled: they stay in the form
      // and can still be columns in the list.
      { name: 'label', type: 'text', admin: IN_PANEL },
      {
        name: 'snapshot',
        type: 'json',
        required: true,
        admin: {
          description: 'Paste a sealed OneTaxonomy snapshot. It is stored exactly as given, and its checksum is checked when it is stored and when it is read.',
          // Only on the new-snapshot form. A stored snapshot's page never loads the content: the panel above shows what it holds.
          // A condition also makes a required field nullable in GraphQL, so a plain query answers null for it and not an error.
          condition: (_data, _sibling, { operation }) => operation !== 'update',
        },
      },
      { name: 'snapshotId', type: 'text', index: true, admin: IN_PANEL },
      { name: 'version', type: 'text', admin: IN_PANEL },
      { name: 'checksum', type: 'text', index: true, admin: IN_PANEL },
      {
        name: 'counts',
        type: 'group',
        admin: IN_PANEL,
        fields: ['names', 'concepts', 'classifications', 'phylogenies'].map((name) => ({ name, type: 'number' }) as Field),
      },
      { name: 'status', type: 'select', required: true, defaultValue: 'staged', index: true, options: ['staged', 'published', 'withdrawn'], admin: { position: 'sidebar', description: 'Staged: only managers see it. Published: readers see it. Withdrawn: hidden from readers, kept for the views that pin it.' } },
      ...publicationFields,
      ...tenantField(opts),
    ],
    hooks: {
      beforeOperation: [contentOnRequest],
      beforeValidate: [fillTenant(opts)],
      beforeChange: [snapshotBeforeChange(opts)],
      beforeDelete: [onlyUnpublishedDeleted(slug, 'staged', 'snapshot')],
      // A view read later in the same request must see the snapshot's new status, not the one remembered before.
      afterChange: [({ doc, req }) => (forgetViewSource(req, String(doc.id)), doc)],
      afterDelete: [({ id, req }) => forgetViewSource(req, String(id))],
    },
  }
}

/**
 * `source` on a view: its snapshot's id, version, checksum and status now, the same object the view endpoints answer
 * with. It isn't stored. It is worked out each time the view is read, so Payload's own REST, GraphQL and Local API
 * reads say when a published view's snapshot has been withdrawn (`source.withdrawn`), as the endpoints do. Null when
 * the snapshot is gone. The snapshot itself stays hidden from anyone who can't read it.
 */
const viewSourceField = (opts: ResolvedOptions): Field => ({
  name: 'source',
  type: 'json',
  virtual: true,
  access: { create: () => false, update: () => false },
  admin: { readOnly: true, description: 'The snapshot this view is shown over and its status now. Worked out when the view is read, not stored. "withdrawn" is true when the snapshot was withdrawn after the view was made.' },
  hooks: {
    afterRead: [
      async ({ data, req }) => {
        let snapshotDoc = idOf(data?.snapshot)
        // A read that selected `source` without `snapshot`: look the reference up on the view, which was already read as the requester.
        if (!snapshotDoc && data?.id !== undefined && data?.id !== null) {
          const own = (await req.payload.findByID({ collection: opts.slugs.views as never, id: data.id as string, depth: 0, req, overrideAccess: true, disableErrors: true, select: { snapshot: true } as never })) as { snapshot?: unknown } | null
          snapshotDoc = idOf(own?.snapshot)
        }
        return snapshotDoc ? await viewSourceOf(req, opts, snapshotDoc) : null
      },
    ],
  },
  typescriptSchema: [
    () => ({
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['doc', 'id', 'version', 'checksum', 'status', 'withdrawn'],
      properties: { doc: { type: 'string' }, id: { type: 'string' }, version: { type: 'string' }, checksum: { type: 'string' }, status: { type: 'string', enum: ['staged', 'published', 'withdrawn'] }, withdrawn: { type: 'boolean' } },
    }),
  ],
})

export function viewsCollection(opts: ResolvedOptions): CollectionConfig {
  const slug = opts.slugs.views
  return {
    slug,
    labels: { singular: 'Taxonomy view', plural: 'Taxonomy views' },
    admin: { group: opts.admin.group, useAsTitle: 'title', defaultColumns: ['title', 'snapshot', 'status', 'publishedAt'] },
    disableDuplicate: true,
    access: { read: readAccess(opts), create: createAccess(opts), update: manageAccess(opts), delete: manageAccess(opts, { status: { equals: 'draft' } }) },
    fields: [
      ...panelField(opts, 'ViewPanel'),
      { name: 'title', type: 'text', required: true },
      { name: 'snapshot', type: 'relationship', relationTo: opts.slugs.snapshots as never, required: true, index: true },
      { name: 'view', type: 'json', required: true, admin: { description: 'The OneTaxonomy view. It must pin its snapshot\'s id, version and checksum.' } },
      { name: 'viewId', type: 'text', index: true, admin: { readOnly: true } },
      viewSourceField(opts),
      { name: 'status', type: 'select', required: true, defaultValue: 'draft', index: true, options: ['draft', 'published', 'withdrawn'], admin: { position: 'sidebar' } },
      ...publicationFields,
      ...tenantField(opts),
    ],
    hooks: { beforeValidate: [fillTenant(opts)], beforeChange: [viewBeforeChange(opts)], beforeDelete: [onlyUnpublishedDeleted(slug, 'draft', 'view')] },
  }
}
