import {
  acceptIntoSnapshot,
  applyToClassification,
  applyToPhylogeny,
  canonicalJson,
  compareHierarchies,
  indexClassification,
  indexPhylogeny,
  ProposalError,
  sealSnapshot,
  sha256Hex,
  validateDataset,
  verifySnapshot,
  type DatasetIndex,
  type DatasetSnapshot,
  type Id,
  type Proposal,
  type ProposalBase,
  type ProposalMove,
  type TreeIndex,
} from '@captiveorigins/onetaxonomy-core'
import {
  APIError,
  commitTransaction,
  initTransaction,
  killTransaction,
  type Access,
  type CollectionAfterDeleteHook,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
  type CollectionConfig,
  type Endpoint,
  type FieldAccess,
  type PayloadRequest,
  type Where,
} from 'payload'

import { all, allowed, idOf, roleOf, tenantWhere } from './access.js'
import { clamp, contentOf, get, integrityGuard, itemOf, loadSnapshot, NOT_FOUND, params, respond, routeId, SnapshotIntegrityError, type ApiResult, type SnapshotRef } from './api.js'
import { asObject, fail, fillTenant, same, tenantField, tenantLocked } from './collections.js'
import { optionsOf, panelField, type ResolvedOptions, type TenantId } from './types.js'
import { viewSourceOf } from './views-api.js'

/**
 * Private: only its author sees it. Shared: everyone in the tenant who may read sees it, and a manager can accept or
 * decline it. Accepted: it became a new staged snapshot version and can't change. Declined: its author can revise it.
 */
export type ProposalStatus = 'private' | 'shared' | 'accepted' | 'declined'

const TRANSITIONS: Record<string, string[]> = { private: ['shared'], shared: ['private'], declined: ['private'], accepted: [] }
const DECISION = ['decidedBy', 'decidedAt', 'decisionNote', 'acceptedInto']
const MAX = { title: 200, notes: 5000, moveNote: 1000, id: 300, name: 200, version: 100, decisionNote: 2000 }
const SNAPSHOT_BYTES = 15 * 1024 * 1024
const LABELS_PER_ITEM = 20
const DECIDED_BY_ACTION = 'Accepting and declining are done by a manager, with the accept and decline actions.'
const NO_SNAPSHOT = 'The proposal\'s snapshot doesn\'t exist, or you can\'t read it.'
const REOPENED = 'The staged version this proposal was accepted into was deleted, so the proposal is open again.'
const PHYLOGENY =
  'Only a proposal on a classification can be accepted into a dataset. A phylogeny is a published hypothesis: a tree rearranged by hand is a result its study never found. Import the new analysis as its own hypothesis instead.'

type Who = { role: 'manager' | 'reader'; tenant: TenantId | null; user: string }

/** A signed-in requester who may read. Proposals are never shown to anonymous visitors, even where snapshots are public. */
export async function whoIs(opts: ResolvedOptions, req: PayloadRequest): Promise<Who | null> {
  const user = req.user ? idOf(req.user.id) : undefined
  if (user === undefined) return null
  const who = await roleOf(opts, req)
  return who ? { ...who, user } : null
}

const mine = (who: Who): Where => ({ author: { equals: who.user } })

/** Read: your own, always. Others' once shared or accepted, in your tenant. Managers also see declined ones. */
const readProposals = (opts: ResolvedOptions): Access => async ({ req }) => {
  const who = await whoIs(opts, req)
  if (!who) return false
  return all(tenantWhere(opts, who.tenant), { or: [mine(who), { status: { in: who.role === 'manager' ? ['shared', 'accepted', 'declined'] : ['shared', 'accepted'] } }] })
}

const mayPropose = async (opts: ResolvedOptions, req: PayloadRequest): Promise<Who | null> => {
  const who = await whoIs(opts, req)
  return who && (await allowed(opts.access.propose, { req, tenant: who.tenant })) ? who : null
}

/** Create: signed-in people who may read and propose, in their own tenant. */
const createProposals = (opts: ResolvedOptions): Access => async ({ req, data }) => {
  const who = await mayPropose(opts, req)
  if (!who) return false
  if (!opts.tenant || !data) return true
  const given = idOf((data as Record<string, unknown>)[opts.tenant.field])
  return given === undefined || given === String(who.tenant)
}

/** Update: the author only, and never once accepted. A manager's decision goes through the accept and decline actions. */
const updateProposals = (opts: ResolvedOptions): Access => async ({ req }) => {
  const who = await mayPropose(opts, req)
  return who ? all(tenantWhere(opts, who.tenant), mine(who), { status: { not_equals: 'accepted' } }) : false
}

/** Delete: the author only, while it is private or declined. */
const deleteProposals = (opts: ResolvedOptions): Access => async ({ req }) => {
  const who = await whoIs(opts, req)
  return who ? all(tenantWhere(opts, who.tenant), mine(who), { status: { in: ['private', 'declined'] } }) : false
}

// The staged snapshot an accepted proposal made, and who decided, are for managers: readers can't see staged snapshots.
const roles = new WeakMap<PayloadRequest, Promise<Who | null>>()
const managersOnly = (opts: ResolvedOptions): FieldAccess => async ({ req }) => {
  let who = roles.get(req)
  if (!who) {
    who = whoIs(opts, req).catch(() => null)
    roles.set(req, who)
  }
  return (await who)?.role === 'manager'
}

// ---------------------------------------------------------------------------------------------------------------
// Content

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= max ? v.trim() : undefined)
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const stamp = (v: unknown) => (v === null || v === undefined || v === '' ? '' : v instanceof Date ? v.toISOString() : String(isObject(v) && 'id' in v ? idOf(v) : v))

/** The parts of a proposal its author writes, rebuilt from what was sent so nothing else is stored. */
function written(raw: Record<string, unknown>, maxMoves: number): Pick<Proposal, 'title' | 'notes' | 'base' | 'moves'> {
  const title = text(raw.title, MAX.title)
  if (!title) fail(`A proposal needs a title (up to ${MAX.title} characters).`)
  const notes = blank(raw.notes) ? undefined : text(raw.notes, MAX.notes)
  if (!blank(raw.notes) && !notes) fail(`A proposal's notes are text, up to ${MAX.notes} characters.`)
  const b = raw.base
  const kind = isObject(b) ? b.kind : undefined
  const baseId = isObject(b) ? text(b.id, MAX.id) : undefined
  const baseVersion = isObject(b) ? text(b.version, MAX.version) : undefined
  if ((kind !== 'classification' && kind !== 'phylogeny') || !baseId || !baseVersion) fail('Say what the proposal is drawn over: base.kind ("classification" or "phylogeny"), base.id and base.version.')
  if (!Array.isArray(raw.moves)) fail('A proposal\'s moves must be a list (it can be empty while you work on it).')
  const list = raw.moves as unknown[]
  if (list.length > maxMoves) fail(`A proposal holds up to ${maxMoves} moves; this one has ${list.length}.`)
  const moves = list.map((m, i): ProposalMove => {
    const node = isObject(m) ? text(m.node, MAX.id) : undefined
    const end = (v: unknown) => (v === null ? null : text(v, MAX.id))
    const from = isObject(m) ? end(m.from) : undefined
    const to = isObject(m) ? end(m.to) : undefined
    if (!node || from === undefined || to === undefined) fail(`Move ${i + 1} needs node, from and to: ids, or null for the root.`)
    const note = isObject(m) && !blank(m.note) ? text(m.note, MAX.moveNote) : undefined
    if (isObject(m) && !blank(m.note) && !note) fail(`Move ${i + 1}'s note is text, up to ${MAX.moveNote} characters.`)
    return { node: node!, from: from!, to: to!, ...(note ? { note } : {}) }
  })
  return { title: title!, ...(notes ? { notes } : {}), base: { kind: kind as ProposalBase['kind'], id: baseId!, version: baseVersion! }, moves }
}

const assemble = (id: Id, author: string, created: string, w: ReturnType<typeof written>): Proposal => ({ id, title: w.title, author, created, ...(w.notes ? { notes: w.notes } : {}), base: w.base, moves: w.moves })

/** A proposal's checksum: SHA-256 of its canonical JSON. Accepting names it, so what is accepted is what was looked at. */
export const proposalChecksum = (proposal: Proposal): string => `sha256:${sha256Hex(canonicalJson(proposal))}`

/** The accepted hierarchy and the proposed one. Throws a `ProposalError` when the proposal doesn't fit the snapshot. */
function hierarchies(index: DatasetIndex, proposal: Proposal): { before: TreeIndex; after: TreeIndex } {
  const b = proposal.base
  if (b.kind === 'classification') {
    const c = index.snapshot.classifications.find((x) => x.id === b.id)
    if (!c) throw new ProposalError(`This snapshot has no classification ${b.id}`)
    return { before: index.classification(b.id), after: indexClassification(applyToClassification(c, proposal)) }
  }
  const p = index.snapshot.phylogenies.find((x) => x.id === b.id)
  if (!p) throw new ProposalError(`This snapshot has no phylogeny ${b.id}`)
  return { before: index.phylogeny(b.id), after: indexPhylogeny(applyToPhylogeny(p, proposal)) }
}

class PersonIdError extends Error {}

/**
 * What a person id may look like: 1 to 64 letters, digits, `.`, `_`, `:` and `-`, starting with a letter or digit.
 * No space and no `@`, so a full name or an email address never passes.
 */
export const PERSON_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

/**
 * The requester's id for the record, as the host gives it. It is the only thing about a person that an accepted
 * proposal seals into a snapshot, so anything that isn't a plain id stops the action. The value is never logged: a
 * refused one may be somebody's name.
 */
async function personIdFor(opts: ResolvedOptions, req: PayloadRequest): Promise<string> {
  let id: unknown
  let threw = false
  try {
    id = await opts.proposals!.personId({ req })
  } catch {
    threw = true
  }
  if (typeof id === 'string' && PERSON_ID.test(id)) return id
  req.payload.logger.error(
    threw
      ? 'OneTaxonomy proposals: proposals.personId threw, so nothing was saved.'
      : 'OneTaxonomy proposals: proposals.personId gave something that isn\'t an id (1 to 64 letters, digits, ".", "_", ":" or "-", starting with a letter or digit), so nothing was saved. Give an opaque id, never a name or an email address.',
  )
  throw new PersonIdError('This site couldn\'t give your id for the record, so nothing was saved. Ask the site\'s owner.')
}

const personIdInHook = async (opts: ResolvedOptions, req: PayloadRequest): Promise<string> => {
  try {
    return await personIdFor(opts, req)
  } catch (error) {
    throw new APIError((error as Error).message, 500, undefined, true)
  }
}

// One lookup per person per request, however many proposals of theirs a list holds.
const shownNames = new WeakMap<PayloadRequest, Map<string, Promise<string | undefined>>>()

/**
 * The name to show the requester for a person id, from the host's `proposals.displayName`, asked now and never
 * stored. Undefined when the host has no name to show, has no lookup, or the lookup fails: the id is shown alone.
 */
export function displayNameFor(opts: ResolvedOptions, req: PayloadRequest, personId: unknown): Promise<string | undefined> {
  const lookup = opts.proposals?.displayName
  if (!lookup || typeof personId !== 'string' || personId === '') return Promise.resolve(undefined)
  let names = shownNames.get(req)
  if (!names) shownNames.set(req, (names = new Map()))
  let name = names.get(personId)
  if (!name) {
    name = (async () => text(await lookup({ req, personId }), MAX.name))().catch(() => undefined)
    names.set(personId, name)
  }
  return name
}

/**
 * The snapshot a proposal is drawn over, read as the requester, so a proposal can't be used to find out whether a
 * hidden snapshot exists. Null when it doesn't exist, can't be read, or is in another tenant.
 */
async function snapshotFor(req: PayloadRequest, opts: ResolvedOptions, snapshotDoc: string, tenant: string | undefined): Promise<{ ref: SnapshotRef; index: DatasetIndex; status: string } | null> {
  type Head = { id: string | number; snapshotId?: string; version?: string; checksum?: string; status?: string; [tenant: string]: unknown }
  let head: Head | null = null
  try {
    head = (await req.payload.findByID({ collection: opts.slugs.snapshots as never, id: snapshotDoc, depth: 0, req, overrideAccess: false, disableErrors: true })) as unknown as Head | null
  } catch {
    return null
  }
  if (!head?.checksum || !head.snapshotId || !head.version) return null
  if (opts.tenant && idOf(head[opts.tenant.field]) !== tenant) return null
  const ref: SnapshotRef = { doc: String(head.id), id: head.snapshotId, version: head.version, checksum: head.checksum }
  try {
    return { ref, index: await contentOf(req, opts, ref), status: head.status ?? 'staged' }
  } catch (error) {
    if (error instanceof SnapshotIntegrityError) throw new APIError(error.message, 500, undefined, true)
    throw error
  }
}

const mustFit = (index: DatasetIndex, proposal: Proposal) => {
  try {
    hierarchies(index, proposal)
  } catch (error) {
    if (error instanceof ProposalError) fail(`This proposal can't be saved: ${error.message}.`)
    throw error
  }
}

const newId = (): Id => `p-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`

const proposalBeforeChange = (opts: ResolvedOptions): CollectionBeforeChangeHook => async ({ data, originalDoc, operation, req }) => {
  const po = opts.proposals!
  const field = opts.tenant?.field
  const derived = (p: Proposal) => ({ proposal: p, title: p.title, proposalId: p.id, checksum: proposalChecksum(p) })

  if (operation === 'create') {
    const user = req.user ? idOf(req.user.id) : undefined
    if (user === undefined) fail('A proposal needs a signed-in person, who is its author.')
    if ((data.status ?? 'private') !== 'private') fail('A new proposal starts private. Share it as a separate step.')
    for (const f of DECISION) if (!blank(data[f])) fail(DECIDED_BY_ACTION)
    const w = written(asObject(data.proposal, 'proposal'), po.maxMoves)
    const snapshotDoc = idOf(data.snapshot)
    if (!snapshotDoc) fail('A proposal needs the snapshot it is drawn over.')
    const tenant = field ? idOf(data[field]) : undefined
    const over = await snapshotFor(req, opts, snapshotDoc!, tenant)
    if (!over) fail(NO_SNAPSHOT)
    if (over!.status === 'withdrawn') fail('This snapshot was withdrawn, so new proposals can\'t use it.')
    const kept: Where[] = [{ author: { equals: user } }, { status: { not_equals: 'accepted' } }]
    if (field) kept.push({ [field]: { equals: tenant ?? null } })
    const { totalDocs } = await req.payload.count({ collection: opts.slugs.proposals as never, where: { and: kept }, req, overrideAccess: true })
    if (totalDocs >= po.maxPerUser) fail(`You have ${totalDocs} proposals, the most this site keeps for one person. Delete one you no longer need first.`)
    const proposal = assemble(newId(), await personIdInHook(opts, req), new Date().toISOString(), w)
    mustFit(over!.index, proposal)
    return { ...data, ...derived(proposal), author: user, status: 'private', decidedBy: null, decidedAt: null, decisionNote: null, acceptedInto: null }
  }

  const from = String(originalDoc.status)
  const to = String(data.status ?? from)
  const original = originalDoc.proposal as Proposal
  tenantLocked(opts, data, originalDoc, 'proposal')
  if ('snapshot' in data && idOf(data.snapshot) !== idOf(originalDoc.snapshot)) fail('A proposal stays on the snapshot it was drawn over. Make a new proposal for another snapshot.')
  if ('author' in data && stamp(data.author) !== stamp(originalDoc.author)) fail('A proposal\'s author can\'t change.')
  for (const f of DECISION) if (f in data && stamp(data[f]) !== stamp(originalDoc[f])) fail(DECIDED_BY_ACTION)
  if (to !== from && (to === 'accepted' || to === 'declined')) fail(DECIDED_BY_ACTION)

  const next = 'proposal' in data ? assemble(original.id, original.author, original.created, written(asObject(data.proposal, 'proposal'), po.maxMoves)) : original
  const changed = !same(next, original)
  if (from === 'accepted' && (changed || to !== from)) fail('An accepted proposal is part of a snapshot version\'s record and can\'t change.')
  if (to !== from && !TRANSITIONS[from]?.includes(to)) fail(`A proposal can't go from ${from} to ${to}.`)
  if (changed && !(from === 'private' || (from === 'declined' && to === 'private')))
    fail(from === 'shared' ? 'A shared proposal can\'t be edited. Stop sharing it first: set it back to private.' : 'A declined proposal can\'t be edited as it is. Set it back to private to revise it.')

  const sharing = to === 'shared' && from !== 'shared'
  if (changed || sharing) {
    const snapshotDoc = idOf(originalDoc.snapshot)
    if (changed) {
      const over = snapshotDoc ? await snapshotFor(req, opts, snapshotDoc, field ? idOf(originalDoc[field]) : undefined) : null
      if (!over) fail(NO_SNAPSHOT)
      if (over!.status === 'withdrawn') fail('This snapshot was withdrawn, so proposals on it can\'t be edited.')
      mustFit(over!.index, next)
    }
    if (sharing) {
      if (!next.moves.length) fail('This proposal moves nothing yet, so there is nothing to share.')
      const head = snapshotDoc ? await viewSourceOf(req, opts, snapshotDoc) : null
      if (head?.status !== 'published') fail('A proposal can be shared while its snapshot is published. This one isn\'t: it may be staged still, or withdrawn.')
    }
  }
  return { ...data, ...derived(next) }
}

/** Shared proposals are unshared first; accepted ones are kept, because a snapshot version names them. */
const onlyOpenDeleted = (opts: ResolvedOptions): CollectionBeforeDeleteHook => async ({ id, req }) => {
  const doc = (await req.payload.findByID({ collection: opts.slugs.proposals as never, id, depth: 0, req, overrideAccess: true, disableErrors: true, select: { status: true } as never })) as { status?: string } | null
  if (doc?.status === 'accepted') fail('An accepted proposal is part of a snapshot version\'s record, so it is kept.')
  if (doc?.status === 'shared') fail('Stop sharing this proposal before deleting it: set it back to private.')
}

/**
 * For the snapshots collection: when a staged snapshot made by accepting a proposal is deleted, the proposal goes back
 * to shared, with a note saying why. It would otherwise say "accepted" about a version that no longer exists.
 */
export const reopenProposals = (opts: ResolvedOptions): CollectionAfterDeleteHook => async ({ id, req }) => {
  const slug = opts.slugs.proposals
  const found = await req.payload.find({ collection: slug as never, where: { and: [{ acceptedInto: { equals: id } }, { status: { equals: 'accepted' } }] }, limit: 100, pagination: false, depth: 0, req, overrideAccess: true, select: { status: true } as never })
  for (const p of found.docs as unknown as { id: string | number }[])
    await req.payload.db.updateOne({
      collection: slug as never,
      where: { and: [{ id: { equals: p.id } }, { status: { equals: 'accepted' } }] },
      data: { status: 'shared', acceptedInto: null, decidedBy: req.user ? String(req.user.id) : null, decidedAt: new Date().toISOString(), decisionNote: REOPENED } as never,
      req,
      returning: false,
    })
}

const ro = (description?: string) => ({ readOnly: true, ...(description ? { description } : {}) })

/** `taxonomy-proposals`: people's own proposals, private until shared, accepted or declined by a manager. */
export function proposalsCollection(opts: ResolvedOptions): CollectionConfig {
  const manager = managersOnly(opts)
  return {
    slug: opts.slugs.proposals,
    labels: { singular: 'Taxonomy proposal', plural: 'Taxonomy proposals' },
    admin: { group: opts.admin.group, useAsTitle: 'title', defaultColumns: ['title', 'status', 'snapshot', 'updatedAt'] },
    disableDuplicate: true,
    access: { read: readProposals(opts), create: createProposals(opts), update: updateProposals(opts), delete: deleteProposals(opts) },
    fields: [
      ...panelField(opts, 'ProposalPanel', { limits: { version: MAX.version, note: MAX.decisionNote } }),
      { name: 'title', type: 'text', admin: ro('The proposal\'s title. Set from the proposal.') },
      { name: 'snapshot', type: 'relationship', relationTo: opts.slugs.snapshots as never, required: true, index: true, admin: { description: 'The snapshot this proposal is drawn over. It can\'t change.' } },
      {
        name: 'proposal',
        type: 'json',
        required: true,
        admin: {
          description:
            'title, notes, base { kind, id, version } and moves [{ node, from, to, note }]. Its id, its author (an id, not a name) and its date are set when it is made. It can be edited while it is private. If it is accepted, its title and notes become part of that snapshot version for good, so leave personal details out of them.',
        },
      },
      {
        name: 'status',
        type: 'select',
        required: true,
        defaultValue: 'private',
        index: true,
        options: ['private', 'shared', 'accepted', 'declined'],
        admin: { position: 'sidebar', description: 'Private: only you see it. Shared: readers see it and a manager can accept or decline it. Accepted and declined are set by a manager\'s decision.' },
      },
      { name: 'proposalId', type: 'text', index: true, admin: ro() },
      { name: 'checksum', type: 'text', admin: ro('SHA-256 of the proposal. Accepting names it, so what is accepted is what was looked at.') },
      { name: 'author', type: 'text', index: true, admin: { position: 'sidebar', ...ro('The signed-in user who made it.') } },
      {
        name: 'authorName',
        type: 'text',
        virtual: true,
        admin: { position: 'sidebar', ...ro('The author\'s name as this site shows it now. Looked up each time and never stored.') },
        hooks: { afterRead: [async ({ siblingData, req }) => (await displayNameFor(opts, req, (siblingData?.proposal as Proposal | undefined)?.author)) ?? null] },
      },
      { name: 'decisionNote', type: 'textarea', admin: ro('What the manager said when deciding.') },
      { name: 'decidedAt', type: 'date', admin: { position: 'sidebar', ...ro() } },
      { name: 'decidedBy', type: 'text', access: { read: manager }, admin: { position: 'sidebar', ...ro('The signed-in user who accepted or declined it.') } },
      { name: 'acceptedInto', type: 'relationship', relationTo: opts.slugs.snapshots as never, access: { read: manager }, admin: { position: 'sidebar', ...ro('The staged snapshot version made by accepting it.') } },
      ...tenantField(opts),
    ],
    hooks: { beforeValidate: [fillTenant(opts)], beforeChange: [proposalBeforeChange(opts)], beforeDelete: [onlyOpenDeleted(opts)] },
    endpoints: proposalEndpoints(),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Preview, accept, decline

type ProposalDoc = { id: string | number; proposal: Proposal; status: ProposalStatus; checksum: string; snapshot?: unknown; author?: string; [tenant: string]: unknown }

export type ProposalRef = {
  doc: string
  id: Id
  title: string
  /** The author's person id, as sealed if the proposal is accepted. */
  author: string
  /** The author's name as the host shows it to this requester now (`proposals.displayName`). Left out when there is none. */
  authorName?: string
  created: string
  status: ProposalStatus
  checksum: string
  base: ProposalBase
}

export type ProposalPreview = {
  proposal: ProposalRef
  snapshot: SnapshotRef
  /** Whether a manager could accept it as it stands. `notAcceptable` says why not. */
  acceptable: boolean
  notAcceptable?: string
  /** How many of each there are in full; the lists below hold at most `limit` each. */
  counts: { moves: number; changedGroups: number; broken: number; formed: number }
  /** Taxa with a new parent. */
  moved: { node: Id; from: Id | null; to: Id | null; note?: string }[]
  /** Groups that keep their node but gain or lose members. */
  changedGroups: { node: Id; gained: Id[]; lost: Id[] }[]
  /** Groups the accepted hierarchy has and the proposed one doesn't, and the other way round. */
  broken: { node: Id; tips: Id[] }[]
  formed: { node: Id; tips: Id[] }[]
  /**
   * The name to show for ids in the lists above: a concept's accepted name, or a phylogeny node's label. An id with
   * no name isn't here, and a very long preview names only the first ids: show the id alone for the rest.
   */
  labels: Record<Id, string>
  /** Whether this requester is a manager here, so may accept or decline. The actions check it again. */
  mayDecide: boolean
  /** True when a list was cut to `limit`. */
  truncated: boolean
}

export type ProposalDecision = { proposal: { doc: string; id: Id; status: ProposalStatus; checksum: string } }
export type ProposalAcceptance = ProposalDecision & {
  /** The new staged snapshot version. Publish it when it has been checked. */
  snapshot: SnapshotRef & { status: 'staged' }
  /** The published snapshot it was made from, which is unchanged. */
  derivedFrom: SnapshotRef
}

const conflict = (error: string) => ({ ok: false, status: 409, error }) as const
const TAKEN = conflict('Someone else decided or changed this proposal a moment ago, so nothing was done. Look at it again.')
const refOf = (doc: ProposalDoc): ProposalRef => ({ doc: String(doc.id), id: doc.proposal.id, title: doc.proposal.title, author: doc.proposal.author, created: doc.proposal.created, status: doc.status, checksum: doc.checksum, base: doc.proposal.base })

/** A proposal the requester may read: null when it doesn't exist or they may not, which look the same. */
async function readable(req: PayloadRequest, opts: ResolvedOptions, id: string): Promise<ProposalDoc | null> {
  try {
    const doc = (await req.payload.findByID({ collection: opts.slugs.proposals as never, id, depth: 0, req, overrideAccess: false, disableErrors: true })) as unknown as ProposalDoc | null
    return doc?.proposal && doc.checksum ? doc : null
  } catch {
    return null
  }
}

/**
 * What a proposal would change, for anyone who may read it: the taxa moved, the groups that change, break and form,
 * each list bounded by `limit`, with the proposal's checksum and whether a manager could accept it. The snapshot is
 * read as the requester too: when they can't read it any more (it was withdrawn, say), there is no preview.
 */
export async function previewProposal(req: PayloadRequest, id: string, query: { limit?: number | string } = {}): Promise<ApiResult<ProposalPreview>> {
  const opts = optionsOf(req.payload)
  if (!opts.proposals) return NOT_FOUND
  return integrityGuard(req, async () => {
    const doc = await readable(req, opts, id)
    const snapshotDoc = idOf(doc?.snapshot)
    if (!doc || !snapshotDoc) return NOT_FOUND
    const loaded = await loadSnapshot(req, snapshotDoc, opts)
    if (!loaded) return conflict('This proposal\'s snapshot isn\'t available to you now (it may have been withdrawn or removed), so there is nothing to compare it with.')
    let h: ReturnType<typeof hierarchies>
    try {
      h = hierarchies(loaded.index, doc.proposal)
    } catch (error) {
      if (error instanceof ProposalError) return conflict(`This proposal no longer fits its snapshot: ${error.message}.`)
      throw error
    }
    const c = compareHierarchies(h.before, h.after)
    const limit = clamp(query.limit, opts.limits.maxResults, opts.limits.maxResults)
    let truncated = false
    const cut = <T>(list: T[]): T[] => {
      if (list.length > limit) truncated = true
      return list.slice(0, limit)
    }
    const notes = new Map(doc.proposal.moves.map((m) => [m.node, m.note]))
    const moved = cut(c.moved).map((m) => ({ ...m, ...(notes.get(m.node) ? { note: notes.get(m.node)! } : {}) }))
    const changedGroups = cut(c.changedGroups).map((g) => ({ node: g.node, gained: cut(g.gained), lost: cut(g.lost) }))
    const broken = cut(c.broken).map((g) => ({ node: g.node, tips: cut(g.tips) }))
    const formed = cut(c.formed).map((g) => ({ node: g.node, tips: cut(g.tips) }))
    // Names for the ids listed, so a person reads names and not ids. Bounded like the lists.
    const labels = new Map<Id, string>()
    const most = limit * LABELS_PER_ITEM
    const name = (id: Id | null) => {
      if (id === null || labels.has(id) || labels.size >= most) return
      const label = itemOf(loaded.index, h.before, id).label
      if (label) labels.set(id, label)
    }
    for (const m of moved) for (const id of [m.node, m.from, m.to]) name(id)
    for (const g of [...broken, ...formed]) name(g.node)
    for (const g of changedGroups) name(g.node)
    for (const g of changedGroups) for (const id of [...g.gained, ...g.lost]) name(id)
    for (const g of [...broken, ...formed]) for (const id of g.tips) name(id)
    const mayDecide = (await whoIs(opts, req))?.role === 'manager'
    const head = await viewSourceOf(req, opts, snapshotDoc)
    const authorName = await displayNameFor(opts, req, doc.proposal.author)
    const why =
      doc.status === 'accepted'
        ? 'It was already accepted.'
        : doc.status === 'declined'
          ? 'It was declined. Its author can revise it and share it again.'
          : doc.status !== 'shared'
            ? 'It isn\'t shared yet.'
            : doc.proposal.base.kind !== 'classification'
              ? PHYLOGENY
              : !doc.proposal.moves.length
                ? 'It moves nothing.'
                : head?.status !== 'published'
                  ? 'Its snapshot isn\'t published.'
                  : undefined
    return {
      ok: true,
      body: {
        proposal: { ...refOf(doc), ...(authorName ? { authorName } : {}) },
        snapshot: loaded.ref,
        acceptable: why === undefined,
        ...(why ? { notAcceptable: why } : {}),
        counts: { moves: c.moved.length, changedGroups: c.changedGroups.length, broken: c.broken.length, formed: c.formed.length },
        moved,
        changedGroups,
        broken,
        formed,
        labels: Object.fromEntries(labels),
        mayDecide,
        truncated,
      },
    }
  })
}

/** The proposal, for a manager deciding on it. Null for anyone else, and for proposals a manager can't see. */
async function forDecision(req: PayloadRequest, opts: ResolvedOptions, id: string): Promise<{ who: Who; doc: ProposalDoc } | null> {
  const who = await whoIs(opts, req)
  if (!who || who.role !== 'manager') return null
  const doc = await readable(req, opts, id)
  return doc ? { who, doc } : null
}

const writeConflict = (error: unknown) => {
  const e = error as { code?: unknown; codeName?: unknown }
  return e.code === 112 || e.codeName === 'WriteConflict'
}

/**
 * Accepts a shared proposal on a classification, as a manager in its tenant (404 for anyone else). It makes a **new
 * staged snapshot version** with core's `acceptIntoSnapshot`, seals and checks it, and marks the proposal accepted.
 * The published snapshot it was made from is not changed, and readers see nothing new until a manager publishes the
 * new version. The proposer's and the manager's person ids, as `proposals.personId` gives them, are sealed into the
 * new version's source record. Their names are not: `proposals.displayName` gives those when a proposal is shown.
 *
 * `body.version` names the new version. `body.checksum` is the proposal's checksum as the manager last saw it (the
 * preview gives it): if the proposal has changed since, nothing is accepted. `createdAt` (default now) and `note`
 * are optional.
 *
 * Refused with 409: a proposal that isn't shared, one that changed, a snapshot that isn't published (staged,
 * withdrawn or gone), a version already stored, every proposal on a phylogeny, and anything core refuses. The new
 * snapshot and the proposal's new status are written together: in one transaction where the database has them, and
 * otherwise the snapshot is removed again if the proposal couldn't be marked. Two managers accepting at once store
 * one version; the other gets a 409.
 */
export async function acceptProposal(req: PayloadRequest, id: string, body: unknown): Promise<ApiResult<ProposalAcceptance>> {
  const opts = optionsOf(req.payload)
  if (!opts.proposals) return NOT_FOUND
  return integrityGuard(req, async () => {
    const found = await forDecision(req, opts, id)
    if (!found) return NOT_FOUND
    const { who, doc } = found
    const b = isObject(body) ? body : {}
    const version = text(b.version, MAX.version)
    if (!version) return { ok: false, status: 400, error: `Name the new snapshot version: { "version": "…" }, up to ${MAX.version} characters.` }
    if (typeof b.checksum !== 'string' || !b.checksum) return { ok: false, status: 400, error: 'Give the proposal\'s checksum as you last saw it ({ "checksum": "sha256:…" }, from its preview), so what you accept is what you looked at.' }
    if (!blank(b.createdAt) && (typeof b.createdAt !== 'string' || Number.isNaN(Date.parse(b.createdAt)))) return { ok: false, status: 400, error: 'createdAt must be a date (ISO 8601).' }
    const createdAt = new Date(blank(b.createdAt) ? Date.now() : Date.parse(b.createdAt as string)).toISOString()
    const note = blank(b.note) ? undefined : text(b.note, MAX.decisionNote)
    if (!blank(b.note) && !note) return { ok: false, status: 400, error: `The note is text, up to ${MAX.decisionNote} characters.` }

    if (doc.status === 'accepted') return conflict('This proposal was already accepted.')
    if (doc.status === 'declined') return conflict('This proposal was declined. Its author can revise it and share it again.')
    if (doc.status !== 'shared') return conflict('Only a shared proposal can be accepted. Share it first.')
    if (b.checksum !== doc.checksum) return conflict('This proposal changed since you looked at it. Look at it again before accepting.')
    const snapshotDoc = idOf(doc.snapshot)
    const head = snapshotDoc ? await viewSourceOf(req, opts, snapshotDoc) : null
    if (!head) return conflict('This proposal\'s snapshot no longer exists, so nothing can be made from it.')
    if (head.status !== 'published') return conflict(head.withdrawn ? 'This proposal\'s snapshot was withdrawn, so nothing can be made from it.' : 'Publish this proposal\'s snapshot before accepting a proposal on it.')
    if (version === head.version) return { ok: false, status: 400, error: `Version ${version} is the snapshot's own. An accepted proposal makes a new version.` }
    if (doc.proposal.base.kind !== 'classification') return conflict(PHYLOGENY)
    const base: SnapshotRef = { doc: head.doc, id: head.id, version: head.version, checksum: head.checksum }
    const index = await contentOf(req, opts, base)

    let acceptedBy: string
    try {
      acceptedBy = await personIdFor(opts, req)
    } catch (error) {
      return { ok: false, status: 500, error: (error as Error).message }
    }
    let sealed: DatasetSnapshot
    try {
      sealed = sealSnapshot(acceptIntoSnapshot(index.snapshot, doc.proposal, { version, createdAt, acceptedBy, ...(note ? { note } : {}) })) as DatasetSnapshot
    } catch (error) {
      if (error instanceof ProposalError) return conflict(`This proposal can't be accepted: ${error.message}.`)
      throw error
    }
    let verified = false
    try {
      verified = verifySnapshot(sealed)
    } catch {
      verified = false
    }
    if (!verified) return { ok: false, status: 500, error: 'The new snapshot doesn\'t match its checksum. Nothing is stored.' }
    const errors = validateDataset(sealed).filter((d) => d.severity === 'error')
    if (errors.length) return conflict(`Accepting this proposal would make a snapshot with ${errors.length} error(s), so nothing is stored: ${errors.slice(0, 5).map((d) => d.message).join('; ')}${errors.length > 5 ? '; …' : ''}`)
    const size = new TextEncoder().encode(canonicalJson(sealed)).length
    const most = opts.imports?.maxBytes ?? SNAPSHOT_BYTES
    if (size > most) return conflict(`The new snapshot would be ${size} bytes, more than the ${most} that can be stored.`)

    // The snapshot and the proposal's status go together. The proposal is claimed with one conditional update, which
    // only succeeds while it is still shared and unchanged.
    const field = opts.tenant?.field
    const started = await initTransaction(req)
    let stored: { id: string | number } | null = null
    const undo = async () => {
      // On a database without transactions Payload leaves a promise of null here, which is truthy: await it.
      if (await req.transactionID) return killTransaction(req)
      if (!stored) return
      try {
        await req.payload.delete({ collection: opts.slugs.snapshots as never, id: stored.id, depth: 0, req, overrideAccess: true })
      } catch (error) {
        req.payload.logger.error(`OneTaxonomy proposal ${String(doc.id)}: the snapshot stored for it (${String(stored.id)}) couldn't be removed again: ${(error as Error).message}`)
      }
    }
    try {
      stored = (await req.payload.create({ collection: opts.slugs.snapshots as never, data: { snapshot: sealed, ...(field ? { [field]: idOf(doc[field]) ?? null } : {}) } as never, depth: 0, req, overrideAccess: true })) as unknown as { id: string | number }
      const claimed = await req.payload.db.updateOne({
        collection: opts.slugs.proposals as never,
        where: { and: [{ id: { equals: doc.id } }, { status: { equals: 'shared' } }, { checksum: { equals: doc.checksum } }] },
        data: { status: 'accepted', decidedBy: who.user, decidedAt: createdAt, decisionNote: note ?? null, acceptedInto: stored.id } as never,
        req,
        returning: true,
        select: { status: true } as never,
      })
      if (!claimed) {
        await undo()
        return TAKEN
      }
      if (started) await commitTransaction(req)
    } catch (error) {
      await undo()
      if (writeConflict(error)) return TAKEN
      if (error instanceof APIError && error.status === 400) return conflict(error.name === 'ValidationError' ? `Snapshot ${sealed.id} ${version} is already stored. Choose another version.` : error.message)
      req.payload.logger.error(`OneTaxonomy proposal ${String(doc.id)}: couldn't accept it: ${(error as Error).stack ?? String(error)}`)
      return { ok: false, status: 500, error: 'The proposal couldn\'t be accepted, and nothing was stored. The site\'s log has the reason.' }
    }
    return {
      ok: true,
      body: {
        proposal: { doc: String(doc.id), id: doc.proposal.id, status: 'accepted', checksum: doc.checksum },
        snapshot: { doc: String(stored.id), id: sealed.id, version: sealed.version, checksum: sealed.checksum!, status: 'staged' },
        derivedFrom: base,
      },
    }
  })
}

/**
 * Declines a shared proposal, as a manager in its tenant (404 for anyone else), with an optional note for its author.
 * Nothing else changes. The author can set it back to private, revise it and share it again.
 */
export async function declineProposal(req: PayloadRequest, id: string, body: unknown): Promise<ApiResult<ProposalDecision>> {
  const opts = optionsOf(req.payload)
  if (!opts.proposals) return NOT_FOUND
  const found = await forDecision(req, opts, id)
  if (!found) return NOT_FOUND
  const { who, doc } = found
  const b = isObject(body) ? body : {}
  const note = blank(b.note) ? undefined : text(b.note, MAX.decisionNote)
  if (!blank(b.note) && !note) return { ok: false, status: 400, error: `The note is text, up to ${MAX.decisionNote} characters.` }
  if (doc.status === 'accepted') return conflict('This proposal was already accepted.')
  if (doc.status === 'declined') return conflict('This proposal was already declined.')
  if (doc.status !== 'shared') return conflict('Only a shared proposal can be declined.')
  try {
    const claimed = await req.payload.db.updateOne({
      collection: opts.slugs.proposals as never,
      where: { and: [{ id: { equals: doc.id } }, { status: { equals: 'shared' } }] },
      data: { status: 'declined', decidedBy: who.user, decidedAt: new Date().toISOString(), decisionNote: note ?? null, acceptedInto: null } as never,
      req,
      returning: true,
      select: { status: true } as never,
    })
    if (!claimed) return TAKEN
  } catch (error) {
    if (writeConflict(error)) return TAKEN
    req.payload.logger.error(`OneTaxonomy proposal ${String(doc.id)}: couldn't decline it: ${(error as Error).stack ?? String(error)}`)
    return { ok: false, status: 500, error: 'The proposal couldn\'t be declined, and nothing was changed. The site\'s log has the reason.' }
  }
  return { ok: true, body: { proposal: { doc: String(doc.id), id: doc.proposal.id, status: 'declined', checksum: doc.checksum } } }
}

/** A POST body as JSON. An empty body is `{}`; text that isn't JSON is `undefined`. */
async function bodyOf(req: PayloadRequest): Promise<unknown> {
  try {
    const raw = typeof req.text === 'function' ? await req.text() : ''
    return raw.trim() === '' ? {} : (JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

const NOT_JSON = { ok: false, status: 400, error: 'The request body isn\'t valid JSON.' } as const

/** `GET /api/<proposals>/:id/preview`, `POST /:id/accept` and `POST /:id/decline`, each as the requester. */
export function proposalEndpoints(): Endpoint[] {
  return [
    { path: '/:id/preview', method: 'get', handler: async (req) => respond(await previewProposal(req, routeId(req), { limit: get(params(req), 'limit') })) },
    {
      path: '/:id/accept',
      method: 'post',
      handler: async (req) => {
        const body = await bodyOf(req)
        return respond(body === undefined ? NOT_JSON : await acceptProposal(req, routeId(req), body))
      },
    },
    {
      path: '/:id/decline',
      method: 'post',
      handler: async (req) => {
        const body = await bodyOf(req)
        return respond(body === undefined ? NOT_JSON : await declineProposal(req, routeId(req), body))
      },
    },
  ]
}
