import {
  canonicalJson,
  sealSnapshot,
  sha256Bytes,
  validateDataset,
  verifySnapshot,
  type DatasetSnapshot,
  type Id,
  type Source,
} from '@captiveorigins/onetaxonomy-core'
import {
  dwcaAdapter,
  csvAdapter,
  nexusAdapter,
  parseNewick,
  phyloXmlAdapter,
  readSnapshotJson,
  toSnapshot,
  type ImportResult,
  type ImportWarning,
} from '@captiveorigins/onetaxonomy-import'
import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook, type CollectionConfig, type Endpoint, type Field, type PayloadRequest, type Where } from 'payload'

import { createAccess, idOf, manageAccess, tenantOf } from './access.js'
import { respond, routeId, type ApiResult } from './api.js'
import { optionsOf, type ResolvedOptions } from './types.js'

export const IMPORT_FORMATS = ['csv', 'dwca', 'onetaxonomy-json', 'newick', 'nexus', 'phyloxml'] as const
export type ImportFormat = (typeof IMPORT_FORMATS)[number]
export type ImportStatus = 'queued' | 'running' | 'done' | 'already-imported' | 'failed'
export type ImportPhase = 'reading' | 'parsing' | 'sealing' | 'storing' | 'finished'

/**
 * What a job reads its file with. All plain JSON, so it can be stored and shown. `options` go to the adapter as they
 * are (columns, delimiter, idPrefix, classification, statusMap for checklists; id, version, title, rooted, lengthUnit,
 * sampling, support settings for trees). `labels` maps tree labels to concept ids explicitly; nothing is matched by
 * guesswork.
 */
export type ImportSettings = {
  /** The snapshot to make. Not used for OneTaxonomy JSON, which names its own. `createdAt` is required so a re-run gives the same checksum. */
  snapshot?: { id: Id; version: string; createdAt: string }
  /** The source record: title, citation, license and release, as the project owner states them. Not used for OneTaxonomy JSON. */
  source?: Source
  options?: Record<string, unknown>
  labels?: Record<string, Id[]>
}

/** A problem that stopped a job, or a warning from validation. `line` and `position` point into the file when known. */
export type ImportDiagnostic = { severity: 'error' | 'warning'; code: string; message: string; line?: number; position?: number; path?: string }

/** What running a job answers: the job's state after the run. */
export type ImportJobSummary = {
  doc: string
  status: ImportStatus
  phase: ImportPhase | null
  /** The staged snapshot this job made or found. */
  snapshot: string | null
  checksum: string | null
  inputSha256: string | null
  message: string
  warnings: number
  diagnostics: ImportDiagnostic[]
}

const MAX_KEPT = 200
const fail = (message: string): never => {
  throw new APIError(message, 400, undefined, true)
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Every problem with a job's settings, in plain words. Empty when they can be used. */
export function checkImportSettings(format: unknown, raw: unknown): string[] {
  const problems: string[] = []
  if (!IMPORT_FORMATS.includes(format as ImportFormat)) return [`Choose a format: ${IMPORT_FORMATS.join(', ')}.`]
  let settings = raw
  if (typeof settings === 'string') {
    try {
      settings = JSON.parse(settings)
    } catch {
      return ['The settings aren\'t valid JSON.']
    }
  }
  if (settings === undefined || settings === null) settings = {}
  if (!isObject(settings)) return ['The settings must be a JSON object.']
  const s = settings as ImportSettings
  if (format !== 'onetaxonomy-json') {
    if (!isObject(s.snapshot) || !nonEmpty(s.snapshot.id) || !nonEmpty(s.snapshot.version)) problems.push('Give the snapshot to make: settings.snapshot.id and settings.snapshot.version.')
    if (!isObject(s.snapshot) || !nonEmpty(s.snapshot.createdAt) || Number.isNaN(Date.parse(s.snapshot.createdAt)))
      problems.push('Give settings.snapshot.createdAt as a date (ISO 8601). It is part of the checksum, so a re-run with the same settings makes the same snapshot.')
    if (!isObject(s.source) || !nonEmpty(s.source.id) || !nonEmpty(s.source.title)) problems.push('Give the source record: settings.source.id and settings.source.title (with its citation and license if it has them).')
  }
  if (s.options !== undefined && !isObject(s.options)) problems.push('settings.options must be a JSON object.')
  if (isObject(s.options)) for (const k of ['source', 'mapLabel', 'mapTaxonomy', 'inflate', 'sources']) if (k in s.options) problems.push(`settings.options.${k} is set by the plugin, not by the job.`)
  if ((format === 'newick' || format === 'nexus' || format === 'phyloxml') && (!isObject(s.options) || !nonEmpty(s.options.id) || !nonEmpty(s.options.version)))
    problems.push('A tree file needs the phylogeny id and version: settings.options.id and settings.options.version.')
  if (s.labels !== undefined && (!isObject(s.labels) || Object.values(s.labels).some((v) => !Array.isArray(v) || v.some((x) => !nonEmpty(x)))))
    problems.push('settings.labels maps each label to a list of concept ids, e.g. { "Alpha one": ["c:alpha-one"] }.')
  if (s.labels !== undefined && (format === 'csv' || format === 'dwca' || format === 'onetaxonomy-json')) problems.push('settings.labels is only for tree files (Newick, NEXUS, phyloXML).')
  return problems
}

const settingsOf = (raw: unknown): ImportSettings => (typeof raw === 'string' ? (JSON.parse(raw) as ImportSettings) : ((raw ?? {}) as ImportSettings))

class ImportFailure extends Error {
  constructor(readonly diagnostics: ImportDiagnostic[]) {
    super(diagnostics[0]?.message ?? 'The import failed.')
  }
}

const decode = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ImportFailure([{ severity: 'error', code: 'encoding', message: 'The file isn\'t UTF-8 text.' }])
  }
}

/** Runs the format's adapter. Malformed input throws an `ImportFailure` naming the line or position when the reader gives one. */
async function readInput(format: ImportFormat, bytes: Uint8Array, s: ImportSettings): Promise<{ snapshot: DatasetSnapshot; warnings: ImportWarning[] }> {
  const options = (s.options ?? {}) as Record<string, unknown>
  const labels = s.labels
  const mapLabel = labels ? (label: string) => (Object.hasOwn(labels, label) ? [...labels[label]!] : undefined) : undefined
  const build = (result: ImportResult) => ({ snapshot: toSnapshot(result, s.snapshot!), warnings: result.warnings })
  try {
    switch (format) {
      case 'onetaxonomy-json': {
        const read = readSnapshotJson(decode(bytes))
        if (read.checksum === 'mismatch') throw new ImportFailure([{ severity: 'error', code: 'checksum', message: 'This snapshot doesn\'t match its checksum, so it was changed after it was sealed. It isn\'t imported.' }])
        return { snapshot: read.snapshot, warnings: [] }
      }
      case 'csv':
        return build(await csvAdapter({ ...(options as object), source: s.source! } as never).read(decode(bytes)))
      case 'dwca':
        return build(await dwcaAdapter({ ...(options as object), source: s.source! } as never).read(bytes))
      case 'nexus':
        return build(await nexusAdapter({ ...(options as object), source: s.source!, ...(mapLabel ? { mapLabel } : {}) } as never).read(decode(bytes)))
      case 'phyloxml':
        return build(await phyloXmlAdapter({ ...(options as object), source: s.source!, ...(mapLabel ? { mapLabel } : {}) } as never).read(decode(bytes)))
      case 'newick': {
        const phylogeny = parseNewick(decode(bytes), { title: s.source!.title, ...(options as object), sources: [s.source!.id], ...(mapLabel ? { mapLabel } : {}) } as never)
        return build({ source: s.source!, names: [], concepts: [], phylogenies: [phylogeny], rawIds: {}, warnings: [] })
      }
    }
  } catch (error) {
    if (error instanceof ImportFailure) throw error
    const e = error as Error & { line?: unknown; position?: unknown }
    throw new ImportFailure([
      {
        severity: 'error',
        code: 'malformed',
        message: `The file can't be read as ${format}: ${e.message}`,
        ...(typeof e.line === 'number' ? { line: e.line } : {}),
        ...(typeof e.position === 'number' ? { position: e.position + 1 } : {}),
      },
    ])
  }
}

/** Reads `<staticDir>/<filename>` from an upload collection's local storage. */
async function readLocalUpload(req: PayloadRequest, collection: string, doc: Record<string, unknown>): Promise<Uint8Array> {
  const staticDir = (req.payload.collections[collection as never]?.config.upload as { staticDir?: string } | undefined)?.staticDir
  if (!staticDir || !nonEmpty(doc.filename)) throw new Error('This upload collection has no local file to read. Give imports.uploads.read for other storage.')
  const [{ readFile }, path] = await Promise.all([import('node:fs/promises'), import('node:path')])
  return new Uint8Array(await readFile(path.resolve(staticDir, path.basename(doc.filename))))
}

type JobDoc = {
  id: string | number
  format: ImportFormat
  file?: unknown
  url?: string | null
  settings?: unknown
  status?: ImportStatus
  phase?: ImportPhase | null
  startedAt?: string | null
  attempts?: number | null
  checksum?: string | null
  inputSha256?: string | null
  snapshot?: unknown
  progress?: { at: string; message: string }[] | null
  diagnostics?: ImportDiagnostic[] | null
  warnings?: ImportWarning[] | null
  warningCount?: number | null
  message?: string | null
  [tenant: string]: unknown
}

/** Tokens of runs in progress. A job's results can be written only with one of these in the request context. */
const RUNNER = 'onetaxonomyImportRun'
const activeRuns = new Set<object>()

const summaryOf = (doc: JobDoc): ImportJobSummary => ({
  doc: String(doc.id),
  status: doc.status ?? 'queued',
  phase: doc.phase ?? null,
  snapshot: idOf(doc.snapshot) ?? null,
  checksum: doc.checksum ?? null,
  inputSha256: doc.inputSha256 ?? null,
  message: doc.message ?? '',
  warnings: doc.warningCount ?? 0,
  diagnostics: doc.diagnostics ?? [],
})

/**
 * Runs an import job as the requester, who must be able to manage it (404 otherwise, as for anything unreadable).
 * Reads the file, runs the adapter, seals the result with core's `sealSnapshot` and checks the checksum, validates it,
 * and stores it as one new staged snapshot. Nothing is stored unless every step passed, and a snapshot is a single
 * document, so a run that stops part-way leaves no partial snapshot. Running a finished job again changes nothing;
 * the same file with the same settings, in a new job, finds the snapshot already stored and says so. A job left
 * running by a process that stopped can be run again after `imports.staleAfterMinutes`.
 *
 * A run starts by claiming the job: one conditional update that only succeeds if nobody has claimed it since this run
 * read it (the `attempts` counter is unchanged). When several runs start together, one claims it and the others get a
 * 409 and change nothing. On MongoDB the claim is a single `findOneAndUpdate`, so it is atomic; it hasn't been
 * checked on Payload's SQL adapters. The claim guards the start only: a run that is still working after
 * `imports.staleAfterMinutes` can be taken over, and it will still write its own progress when it wakes. The unique
 * index on a snapshot's id and version means the two can't both store one.
 *
 * `overrideAccess` is for trusted server code: it skips the access checks on the job and on the uploaded file.
 */
export async function runImport(req: PayloadRequest, id: string, { overrideAccess = false }: { overrideAccess?: boolean } = {}): Promise<ApiResult<ImportJobSummary>> {
  const opts = optionsOf(req.payload)
  const io = opts.imports
  if (!io) return { ok: false, status: 404, error: 'Not found.' }
  const slug = opts.slugs.imports
  let job: JobDoc | null = null
  try {
    job = (await req.payload.findByID({ collection: slug as never, id, depth: 0, req, overrideAccess, disableErrors: true })) as unknown as JobDoc | null
  } catch {
    job = null
  }
  if (!job) return { ok: false, status: 404, error: 'Not found.' }
  if (job.status === 'done' || job.status === 'already-imported') return { ok: true, body: summaryOf(job) }
  const now = Date.now()
  if (job.status === 'running' && job.startedAt && now - Date.parse(job.startedAt) < io.staleAfterMs)
    return { ok: false, status: 409, error: `This job has been running since ${job.startedAt}. Run it again after ${Math.round(io.staleAfterMs / 60_000)} minutes if it seems stuck.` }

  const progress = [...(job.progress ?? [])].slice(-(MAX_KEPT - 10))
  const resumedFrom = job.status === 'running' ? job.phase : null
  const priorChecksum = job.checksum ?? null

  // Claim the job. Every run that starts adds one to `attempts`, so "attempts is still what I read" means nobody
  // else has started it since. The check and the write are one database operation.
  const prior = job.attempts ?? 0
  const attempt = prior + 1
  const startedAt = new Date(now).toISOString()
  progress.push({ at: startedAt, message: resumedFrom ? `Attempt ${attempt}: the last run stopped while ${resumedFrom}; starting again from the file.` : `Attempt ${attempt}: reading the file.` })
  const claim = { status: 'running' as const, phase: 'reading' as const, startedAt, finishedAt: null, attempts: attempt, message: '', diagnostics: [], runBy: req.user ? String(req.user.id) : null, progress }
  const unclaimed: Where = prior === 0 ? { or: [{ attempts: { equals: 0 } }, { attempts: { exists: false } }] } : { attempts: { equals: prior } }
  const taken = { ok: false, status: 409, error: 'Another run started this job a moment ago, so this one didn\'t start. Look at the job to see how it went.' } as const
  try {
    const claimed = await req.payload.db.updateOne({ collection: slug as never, where: { and: [{ id: { equals: job.id } }, unclaimed] }, data: claim as never, req, returning: true, select: { attempts: true } as never })
    if (!claimed) return taken
  } catch (error) {
    // Inside a transaction, MongoDB refuses the second writer with a write conflict instead of matching nothing.
    const e = error as { code?: unknown; codeName?: unknown }
    if (e.code === 112 || e.codeName === 'WriteConflict') return taken
    req.payload.logger.error(`OneTaxonomy import ${String(job.id)}: couldn't claim the job: ${(error as Error).stack ?? String(error)}`)
    return { ok: false, status: 500, error: 'The job couldn\'t be started, so nothing was run. The site\'s log has the reason.' }
  }
  job = { ...job, ...claim }

  const token = {}
  activeRuns.add(token)
  const write = async (data: Record<string, unknown>, message?: string) => {
    if (message) progress.push({ at: new Date().toISOString(), message })
    job = (await req.payload.update({ collection: slug as never, id: job!.id, data: { ...data, progress } as never, depth: 0, req, overrideAccess: true, context: { [RUNNER]: token } })) as unknown as JobDoc
  }
  const finish = async (status: ImportStatus, message: string, extra: Record<string, unknown> = {}) =>
    write({ status, phase: status === 'failed' ? job!.phase : 'finished', finishedAt: new Date().toISOString(), message, ...extra }, message)

  try {
    const settings = settingsOf(job.settings)
    const problems = checkImportSettings(job.format, settings)
    if (problems.length) throw new ImportFailure(problems.map((message) => ({ severity: 'error', code: 'settings', message })))

    // Read
    let bytes: Uint8Array
    const fileRef = idOf(job.file)
    try {
      if (fileRef) {
        if (!io.uploads) throw new Error('This site doesn\'t take uploaded files for imports.')
        const doc = (await req.payload.findByID({ collection: io.uploads.collection as never, id: fileRef, depth: 0, req, overrideAccess, disableErrors: true })) as Record<string, unknown> | null
        if (!doc) throw new Error('The uploaded file doesn\'t exist, or you can\'t read it.')
        if (typeof doc.filesize === 'number' && doc.filesize > io.maxBytes) throw new Error(`The file is ${doc.filesize} bytes, more than the ${io.maxBytes} this site reads.`)
        bytes = await (io.uploads.read ? io.uploads.read({ req, doc }) : readLocalUpload(req, io.uploads.collection, doc))
      } else if (nonEmpty(job.url)) {
        if (!io.fetch) throw new Error('This site doesn\'t read URLs for imports.')
        const got = await io.fetch({ url: job.url, req })
        bytes = typeof got === 'string' ? new TextEncoder().encode(got) : got
      } else throw new Error('The job names no file and no URL.')
    } catch (error) {
      throw new ImportFailure([{ severity: 'error', code: 'input', message: `The file couldn't be read: ${(error as Error).message}` }])
    }
    if (!(bytes instanceof Uint8Array)) throw new ImportFailure([{ severity: 'error', code: 'input', message: 'The file couldn\'t be read: the reader gave no bytes.' }])
    if (bytes.length > io.maxBytes) throw new ImportFailure([{ severity: 'error', code: 'too-large', message: `The file is ${bytes.length} bytes, more than the ${io.maxBytes} this site reads.` }])
    const inputSha256 = `sha256:${sha256Bytes(bytes)}`
    await write({ phase: 'parsing', inputSha256 }, `Read ${bytes.length} bytes (${inputSha256.slice(0, 19)}…). Reading it as ${job.format}.`)

    // Parse
    const { snapshot: unsealed, warnings } = await readInput(job.format, bytes, settings)
    const kept = warnings.slice(0, MAX_KEPT)
    await write({ phase: 'sealing', warnings: kept, warningCount: warnings.length }, `${unsealed.concepts.length} concepts, ${unsealed.names.length} names, ${unsealed.classifications.length} classifications and ${unsealed.phylogenies.length} phylogenies read, with ${warnings.length} warning(s).`)

    // Seal, verify, validate
    const sealed = (unsealed.checksum ? unsealed : sealSnapshot(unsealed)) as DatasetSnapshot
    let verified = false
    try {
      verified = verifySnapshot(sealed)
    } catch {
      verified = false
    }
    if (!verified) throw new ImportFailure([{ severity: 'error', code: 'checksum', message: 'The sealed snapshot doesn\'t match its checksum. Nothing is stored.' }])
    const found = validateDataset(sealed)
    const diagnostics: ImportDiagnostic[] = found.slice(0, MAX_KEPT).map((d) => ({ severity: d.severity === 'error' ? 'error' : 'warning', code: d.code, message: d.message, path: d.path }))
    if (found.some((d) => d.severity === 'error')) throw new ImportFailure(diagnostics.filter((d) => d.severity === 'error').concat(diagnostics.filter((d) => d.severity !== 'error')))
    const size = new TextEncoder().encode(canonicalJson(sealed)).length
    if (size > io.maxBytes) throw new ImportFailure([{ severity: 'error', code: 'too-large', message: `The snapshot is ${size} bytes, more than the ${io.maxBytes} that can be stored. Very large snapshots aren't supported yet.` }])

    // Already stored? The same id, version and checksum in this tenant is the same snapshot.
    const tenantField = opts.tenant?.field
    const tenant = tenantField ? idOf(job[tenantField]) : undefined
    const where: Where[] = [{ snapshotId: { equals: sealed.id } }, { version: { equals: sealed.version } }]
    if (tenantField) where.push({ [tenantField]: { equals: tenant ?? null } })
    const existing = (await req.payload.find({ collection: opts.slugs.snapshots as never, where: { and: where }, limit: 1, pagination: false, depth: 0, req, overrideAccess: true, select: { checksum: true } as never })).docs[0] as unknown as
      | { id: string | number; checksum?: string }
      | undefined
    if (existing) {
      if (existing.checksum !== sealed.checksum)
        throw new ImportFailure([{ severity: 'error', code: 'version-taken', message: `Snapshot ${sealed.id} ${sealed.version} is already stored with different content. A changed dataset needs a new version (settings.snapshot.version).` }])
      const ours = resumedFrom === 'storing' && priorChecksum === sealed.checksum
      await finish(ours ? 'done' : 'already-imported', ours ? `Stored as staged snapshot ${sealed.id} ${sealed.version} by this job's earlier attempt; nothing new was stored.` : `Already imported: snapshot ${sealed.id} ${sealed.version} with this checksum is stored. Nothing new was stored.`, {
        snapshot: existing.id,
        checksum: sealed.checksum,
        diagnostics,
      })
      return { ok: true, body: summaryOf(job) }
    }

    // Store: one document, so it is stored whole or not at all.
    await write({ phase: 'storing', checksum: sealed.checksum, diagnostics }, `Sealed (${sealed.checksum!.slice(0, 19)}…) and checked. Storing it as a staged snapshot.`)
    const stored = (await req.payload.create({ collection: opts.slugs.snapshots as never, data: { snapshot: sealed, ...(tenantField ? { [tenantField]: tenant ?? null } : {}) } as never, depth: 0, req, overrideAccess: true })) as unknown as { id: string | number }
    await finish('done', `Stored as staged snapshot ${sealed.id} ${sealed.version}. Publish it when it has been checked.`, { snapshot: stored.id })
    return { ok: true, body: summaryOf(job) }
  } catch (error) {
    const diagnostics = error instanceof ImportFailure ? error.diagnostics : [{ severity: 'error' as const, code: 'unexpected', message: `The import stopped: ${(error as Error).message}` }]
    if (!(error instanceof ImportFailure)) req.payload.logger.error(`OneTaxonomy import ${String(job?.id)}: ${(error as Error).stack ?? String(error)}`)
    try {
      await finish('failed', diagnostics[0]!.message, { diagnostics: diagnostics.slice(0, MAX_KEPT) })
    } catch (writeError) {
      req.payload.logger.error(`OneTaxonomy import ${String(job?.id)}: couldn't record the failure: ${(writeError as Error).message}`)
    }
    return job ? { ok: true, body: summaryOf(job) } : { ok: false, status: 500, error: diagnostics[0]!.message }
  } finally {
    activeRuns.delete(token)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Collection

const INPUT = ['format', 'file', 'url', 'settings']
const RESULTS = ['status', 'phase', 'startedAt', 'finishedAt', 'attempts', 'runBy', 'inputSha256', 'checksum', 'snapshot', 'progress', 'warnings', 'warningCount', 'diagnostics', 'message']
const norm = (v: unknown) => canonicalJson(isObject(v) && 'id' in v ? idOf(v) : v instanceof Date ? v.toISOString() : (v ?? null))

const importBeforeChange = (opts: ResolvedOptions): CollectionBeforeChangeHook => async ({ data, originalDoc, operation, context }) => {
  const io = opts.imports!
  const running = activeRuns.has(context?.[RUNNER] as object)
  if (operation === 'create') {
    const given = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
    for (const f of RESULTS) if (f !== 'status' && given(data[f])) fail(`${f} is set by running the job.`)
    if ((data.status ?? 'queued') !== 'queued') fail('A new import job starts as queued.')
    const problems = checkImportSettings(data.format, data.settings)
    if (problems.length) fail(problems.join(' '))
    const file = idOf(data.file)
    const url = nonEmpty(data.url) ? data.url.trim() : undefined
    if (Boolean(file) === Boolean(url)) fail(io.uploads && io.fetch ? 'Give the job one input: an uploaded file or a URL.' : io.uploads ? 'Give the job an uploaded file.' : 'Give the job a URL.')
    if (file && !io.uploads) fail('This site doesn\'t take uploaded files for imports.')
    if (url && !io.fetch) fail('This site doesn\'t read URLs for imports.')
    return { ...data, settings: settingsOf(data.settings), ...(url ? { url } : {}), status: 'queued', progress: [], diagnostics: [], warnings: [], warningCount: 0, attempts: 0 }
  }
  if (running) return data
  for (const f of [...INPUT, ...RESULTS]) if (f in data && norm(data[f]) !== norm(originalDoc?.[f])) fail(`An import job's ${INPUT.includes(f) ? 'input and settings are set when it is made' : 'results are set by running it'}. Make a new job instead.`)
  if (opts.tenant && opts.tenant.field in data && idOf(data[opts.tenant.field]) !== idOf(originalDoc?.[opts.tenant.field])) fail('An import job stays in the tenant it was made for.')
  return data
}

const runOnCreate = (opts: ResolvedOptions): CollectionAfterChangeHook => async ({ doc, operation, req, context }) => {
  if (operation !== 'create' || !opts.imports!.runOnCreate || context?.onetaxonomyNoRun) return doc
  // As the person who made it. Server code without a user runs it with runImport(req, id, { overrideAccess: true }).
  const r = await runImport(req, String(doc.id))
  if (!r.ok) return doc
  return (await req.payload.findByID({ collection: opts.slugs.imports as never, id: doc.id, depth: 0, req, overrideAccess: true })) ?? doc
}

/** Fills a new job's tenant from the requester when it names none (the create access refuses another tenant). */
const fillTenant = (opts: ResolvedOptions) => async ({ data, operation, req }: { data?: Record<string, unknown>; operation: string; req: PayloadRequest }) => {
  if (!opts.tenant || operation !== 'create' || !data || idOf(data[opts.tenant.field]) !== undefined) return data
  const t = await tenantOf(opts, req)
  if (t.ok) data[opts.tenant.field] = t.tenant
  return data
}

const ro = (description?: string) => ({ readOnly: true, ...(description ? { description } : {}) })

/** `taxonomy-imports`: import jobs. Managers only, in their own tenant. */
export function importsCollection(opts: ResolvedOptions): CollectionConfig {
  const io = opts.imports!
  const slug = opts.slugs.imports
  const managerOnly = manageAccess(opts)
  return {
    slug,
    labels: { singular: 'Taxonomy import', plural: 'Taxonomy imports' },
    admin: { group: opts.admin.group, useAsTitle: 'title', defaultColumns: ['title', 'format', 'status', 'snapshot', 'finishedAt'] },
    disableDuplicate: true,
    access: { read: managerOnly, create: createAccess(opts), update: managerOnly, delete: managerOnly },
    fields: [
      { name: 'title', type: 'text', admin: { description: 'A name for this import, for your own list.' } },
      { name: 'format', type: 'select', required: true, options: IMPORT_FORMATS.map((v) => ({ value: v, label: { csv: 'CSV/TSV checklist', dwca: 'Darwin Core Archive', 'onetaxonomy-json': 'OneTaxonomy JSON snapshot', newick: 'Newick tree', nexus: 'NEXUS trees', phyloxml: 'phyloXML trees' }[v] })) },
      ...(io.uploads ? [{ name: 'file', type: 'upload', relationTo: io.uploads.collection as never, admin: { description: 'The source file. It is read as the person running the job.' } } as Field] : []),
      ...(io.fetch ? [{ name: 'url', type: 'text', admin: { description: 'A URL this site allows. Only URLs the site\'s own check accepts are read.' } } as Field] : []),
      {
        name: 'settings',
        type: 'json',
        required: true,
        admin: { description: 'snapshot { id, version, createdAt }, source { id, title, citation, license }, adapter options, and labels for tree files. Same file and settings, same snapshot.' },
      },
      { name: 'status', type: 'select', required: true, defaultValue: 'queued', index: true, options: ['queued', 'running', 'done', 'already-imported', 'failed'], admin: { position: 'sidebar', ...ro() } },
      { name: 'phase', type: 'select', options: ['reading', 'parsing', 'sealing', 'storing', 'finished'], admin: { position: 'sidebar', ...ro() } },
      { name: 'message', type: 'text', admin: ro('What the last run did, or why it stopped.') },
      { name: 'snapshot', type: 'relationship', relationTo: opts.slugs.snapshots as never, admin: { position: 'sidebar', ...ro('The staged snapshot this job stored or found.') } },
      { name: 'checksum', type: 'text', index: true, admin: ro() },
      { name: 'inputSha256', type: 'text', admin: ro('SHA-256 of the file as read.') },
      { name: 'diagnostics', type: 'json', admin: ro('Errors that stopped the job, and validation warnings.') },
      { name: 'warnings', type: 'json', admin: ro('What the adapter noticed and handled conservatively (the first 200).') },
      { name: 'warningCount', type: 'number', admin: ro() },
      { name: 'progress', type: 'json', admin: ro() },
      { name: 'attempts', type: 'number', admin: { position: 'sidebar', ...ro() } },
      { name: 'startedAt', type: 'date', admin: { position: 'sidebar', ...ro() } },
      { name: 'finishedAt', type: 'date', admin: { position: 'sidebar', ...ro() } },
      { name: 'runBy', type: 'text', admin: { position: 'sidebar', ...ro('The signed-in user who last ran it.') } },
      ...(opts.tenant
        ? [{ name: opts.tenant.field, type: 'relationship', relationTo: opts.tenant.collection as never, required: true, index: true, admin: { position: 'sidebar', description: 'Set when the job is made. It can\'t change.' } } as Field]
        : []),
    ],
    hooks: { beforeValidate: [fillTenant(opts) as never], beforeChange: [importBeforeChange(opts)], afterChange: [runOnCreate(opts)] },
    endpoints: importEndpoints(),
  }
}

/** `POST /api/<imports>/:id/run`: runs (or resumes) a job as the requester. */
export function importEndpoints(): Endpoint[] {
  return [{ path: '/:id/run', method: 'post', handler: async (req) => respond(await runImport(req, routeId(req))) }]
}
