'use client'

import '@captiveorigins/onetaxonomy-react/styles.css'
import './panels.css'

import type { Highlight, LayoutKind } from '@captiveorigins/onetaxonomy-core'
import { useConfig, useDocumentInfo, useForm, useFormModified } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ImportJobSummary } from '../imports.js'
import type { ProposalAcceptance, ProposalDecision, ProposalPreview } from '../proposals.js'
import type { SnapshotSummary } from '../summary.js'
import type { ProjectionBody, ViewSource } from '../views-api.js'
import { reasonOf, request } from './http.js'
import { ImportPanelView, type ImportJob } from './ImportPanelView.js'
import { ProposalPanelView, type ProposalDecisionInfo } from './ProposalPanelView.js'
import { SnapshotPanelView } from './SnapshotPanelView.js'
import { ViewPanelView, type SavedView, type ViewStatus } from './ViewPanelView.js'
import type { Loadable, Outcome } from './ui.js'

/** What the plugin hands each panel from the server: plain values only. */
export type PanelProps = {
  slugs: { snapshots: string; views: string; imports: string; proposals: string }
  /** Import panel: after this long a running job may be run again. */
  staleAfterMinutes?: number
  /** Proposal panel: the longest version name and note the site takes. */
  limits?: { version: number; note: number }
}

const LAYOUTS: readonly LayoutKind[] = ['rectangular', 'radial', 'phylogram', 'time', 'sunburst']
const PREVIEW_NODES = 200
const POLL_MS = 3000

const idIn = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : v && typeof v === 'object' && 'id' in v ? idIn((v as { id: unknown }).id) : null)
const select = (fields: string[]) => fields.map((f) => `select[${encodeURIComponent(f)}]=true`).join('&')

/** Where the site's API and admin are, this document, and when Payload's own form last saved it. */
function usePlace() {
  const { config } = useConfig()
  const { id, collectionSlug, hasSavePermission, lastUpdateTime } = useDocumentInfo()
  const api = `${config.serverURL ?? ''}${config.routes.api}`
  const admin = config.routes.admin.replace(/\/$/, '')
  const doc = id !== undefined && id !== null && collectionSlug ? `${api}/${collectionSlug}/${encodeURIComponent(String(id))}` : null
  const hrefOf = (slug: string, docId: string | null | undefined) => (docId ? `${admin}/collections/${slug}/${encodeURIComponent(docId)}` : null)
  return { doc, hrefOf, mayWrite: Boolean(hasSavePermission), savedAt: lastUpdateTime }
}

/**
 * Fetches `url` as the signed-in person. `reload` fetches it again and keeps showing what is there until the new
 * answer arrives. A null `url` waits. A change in `savedAt` fetches it again too: that is Payload's own Save button,
 * which changes the document without the panel doing anything.
 */
function useLoad<T>(url: string | null, savedAt: unknown): [Loadable<T>, () => void] {
  const [state, setState] = useState<Loadable<T>>({ state: 'loading' })
  const [turn, setTurn] = useState(0)
  const shown = useRef<string | null>(null)
  useEffect(() => {
    if (!url) return
    if (shown.current !== url) setState({ state: 'loading' })
    const stop = new AbortController()
    request<T>(url, { signal: stop.signal }).then(
      (data) => {
        shown.current = url
        setState({ state: 'ready', data })
      },
      (error) => {
        if (stop.signal.aborted) return
        shown.current = null
        setState({ state: 'error', message: reasonOf(error) })
      },
    )
    return () => stop.abort()
  }, [url, turn, savedAt])
  return [state, useCallback(() => setTurn((n) => n + 1), [])]
}

/**
 * Puts values the site just saved into the open form, as its saved values. Without this, pressing Save afterwards
 * would send the form's older values back.
 */
function useSaved() {
  const { dispatchFields } = useForm()
  return useCallback(
    (values: Record<string, unknown>) => {
      for (const [path, value] of Object.entries(values)) dispatchFields({ type: 'UPDATE', path, value, initialValue: value })
    },
    [dispatchFields],
  )
}

const mapReady = <A, B>(of: Loadable<A>, f: (a: A) => B): Loadable<B> => (of.state === 'ready' ? { state: 'ready', data: f(of.data) } : of)

const PUBLICATION = ['status', 'publishedBy', 'publishedAt']
type Published = { doc?: { status?: string; publishedBy?: string | null; publishedAt?: string | null } }

/** Publishes or withdraws this document, then puts what the site answered into the form. */
function useSetStatus(doc: string | null, what: string, after: () => void): [Outcome, (status: 'published' | 'withdrawn') => Promise<boolean>] {
  const [outcome, setOutcome] = useState<Outcome>(null)
  const saved = useSaved()
  const act = async (status: 'published' | 'withdrawn') => {
    if (!doc) return false
    setOutcome(null)
    try {
      // `select` keeps the answer small: without it the whole document comes back, a snapshot's content included.
      const answer = await request<Published>(`${doc}?depth=0&${select(PUBLICATION)}`, { method: 'PATCH', body: { status } })
      saved({ status: answer.doc?.status ?? status, publishedBy: answer.doc?.publishedBy ?? null, publishedAt: answer.doc?.publishedAt ?? null })
      setOutcome({ kind: 'success', message: status === 'published' ? `This ${what} is published.` : `This ${what} is withdrawn.` })
      after()
      return true
    } catch (error) {
      setOutcome({ kind: 'error', message: `Nothing was changed. ${reasonOf(error)}` })
      return false
    }
  }
  return [outcome, act]
}

/** On a snapshot's edit page: what it holds and where it came from, and the buttons to publish or withdraw it. */
export function SnapshotPanel(_props: PanelProps) {
  const { doc, mayWrite, savedAt } = usePlace()
  const [summary, reload] = useLoad<SnapshotSummary>(doc ? `${doc}/summary` : null, savedAt)
  const [outcome, setStatus] = useSetStatus(doc, 'snapshot', reload)
  if (!doc) return null
  return <SnapshotPanelView summary={summary} canManage={mayWrite} outcome={outcome} onSetStatus={setStatus} onRetry={reload} />
}

type ViewDoc = { title?: string; status?: ViewStatus; source?: ViewSource | null; view?: { layout?: { kind?: unknown }; highlights?: unknown } | null }
const VIEW_FIELDS = ['title', 'status', 'source', 'view', 'snapshot']

const savedView = (d: ViewDoc): SavedView => {
  const kind = d.view?.layout?.kind
  return {
    title: d.title ?? '',
    status: d.status ?? 'draft',
    source: d.source ?? null,
    layout: LAYOUTS.includes(kind as LayoutKind) ? (kind as LayoutKind) : null,
    highlights: Array.isArray(d.view?.highlights) ? (d.view.highlights as Highlight[]) : [],
  }
}

/** On a view's edit page: its status, its snapshot, a small drawing of the saved view, and the buttons to publish or withdraw it. */
export function ViewPanel({ slugs }: PanelProps) {
  const { doc, hrefOf, mayWrite, savedAt } = usePlace()
  const unsaved = useFormModified()
  const [view, reloadView] = useLoad<ViewDoc>(doc ? `${doc}?depth=0&${select(VIEW_FIELDS)}` : null, savedAt)
  const [preview, reloadPreview] = useLoad<ProjectionBody>(doc ? `${doc}/projection?limit=${PREVIEW_NODES}` : null, savedAt)
  const reload = () => {
    reloadView()
    reloadPreview()
  }
  const [outcome, setStatus] = useSetStatus(doc, 'view', reload)
  if (!doc) return null
  const saved = mapReady(view, savedView)
  return (
    <ViewPanelView
      view={saved}
      preview={preview}
      canManage={mayWrite}
      unsaved={unsaved}
      snapshotHref={saved.state === 'ready' ? hrefOf(slugs.snapshots, saved.data.source?.doc) : null}
      outcome={outcome}
      onSetStatus={setStatus}
      onRetry={reload}
    />
  )
}

/** The fields a run sets. They go back into the form after a run, so a later Save doesn't send the old ones. */
const JOB_FIELDS = ['status', 'phase', 'message', 'snapshot', 'checksum', 'inputSha256', 'diagnostics', 'warnings', 'warningCount', 'progress', 'attempts', 'startedAt', 'finishedAt', 'runBy']
type JobDoc = Record<string, unknown>

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

const jobOf = (d: JobDoc): ImportJob => ({
  status: (text(d.status) ?? 'queued') as ImportJob['status'],
  phase: text(d.phase) as ImportJob['phase'],
  message: text(d.message),
  snapshot: idIn(d.snapshot),
  checksum: text(d.checksum),
  inputSha256: text(d.inputSha256),
  diagnostics: list(d.diagnostics),
  warnings: list(d.warnings),
  warningCount: typeof d.warningCount === 'number' ? d.warningCount : list(d.warnings).length,
  progress: list(d.progress),
  attempts: typeof d.attempts === 'number' ? d.attempts : 0,
  startedAt: text(d.startedAt),
  finishedAt: text(d.finishedAt),
})

/** On an import job's edit page: how it is going, what it found, the snapshot it made, and a button to run it. */
export function ImportPanel({ slugs, staleAfterMinutes = 15 }: PanelProps) {
  const { doc, hrefOf, mayWrite, savedAt } = usePlace()
  const [raw, reload] = useLoad<JobDoc>(doc ? `${doc}?depth=0&${select(JOB_FIELDS)}` : null, savedAt)
  const [starting, setStarting] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [now, setNow] = useState(() => Date.now())
  const saved = useSaved()
  const job = mapReady(raw, jobOf)
  const status = job.state === 'ready' ? job.data.status : null

  // While it runs, look again every few seconds. The timer stops as soon as it isn't running.
  const watching = starting || status === 'running'
  useEffect(() => {
    if (!watching) return
    const timer = setInterval(reload, POLL_MS)
    return () => clearInterval(timer)
  }, [watching, reload])

  useEffect(() => {
    setNow(Date.now())
    if (raw.state !== 'ready') return
    saved(Object.fromEntries(JOB_FIELDS.map((f) => [f, f === 'snapshot' ? idIn(raw.data[f]) : (raw.data[f] ?? null)])))
  }, [raw, saved])

  if (!doc) return null
  const run = async () => {
    setOutcome(null)
    setStarting(true)
    try {
      const answer = await request<ImportJobSummary>(`${doc}/run`, { method: 'POST' })
      const link = hrefOf(slugs.snapshots, answer.snapshot)
      if (answer.status === 'failed') setOutcome({ kind: 'error', message: `The import stopped. ${answer.message}` })
      else
        setOutcome({
          kind: 'success',
          message: answer.status === 'already-imported' ? 'This file with these settings was imported before. The job points at that snapshot.' : 'The import finished and stored a staged snapshot.',
          ...(link ? { link: { href: link, label: 'Open the snapshot' } } : {}),
        })
      return true
    } catch (error) {
      setOutcome({ kind: 'error', message: reasonOf(error) })
      return false
    } finally {
      setStarting(false)
      reload()
    }
  }
  return (
    <ImportPanelView
      job={job}
      canRun={mayWrite}
      starting={starting}
      staleAfterMinutes={staleAfterMinutes}
      now={now}
      snapshotHref={job.state === 'ready' ? hrefOf(slugs.snapshots, job.data.snapshot) : null}
      outcome={outcome}
      onRun={run}
      onRetry={reload}
    />
  )
}

/** The decision fields a person may read. `decidedBy` and `acceptedInto` come back for managers only. */
const DECISION_FIELDS = ['status', 'decisionNote', 'decidedAt', 'decidedBy', 'acceptedInto']
type DecisionDoc = { status?: string; decisionNote?: string | null; decidedAt?: string | null; decidedBy?: string | null; acceptedInto?: unknown }

/** On a proposal's edit page: what it would change, in names, and for a manager the buttons to accept or decline it. */
export function ProposalPanel({ slugs, limits = { version: 100, note: 2000 } }: PanelProps) {
  const { doc, hrefOf, savedAt } = usePlace()
  const [preview, reloadPreview] = useLoad<ProposalPreview>(doc ? `${doc}/preview` : null, savedAt)
  const [decided, reloadDecided] = useLoad<DecisionDoc>(doc ? `${doc}?depth=0&${select(DECISION_FIELDS)}` : null, savedAt)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const saved = useSaved()

  // A decision changes fields the form holds too. Put them back as saved values whenever they are read.
  useEffect(() => {
    if (decided.state !== 'ready') return
    const d = decided.data
    saved({ ...(d.status ? { status: d.status } : {}), decisionNote: d.decisionNote ?? null, decidedAt: d.decidedAt ?? null, ...('decidedBy' in d ? { decidedBy: d.decidedBy ?? null } : {}), ...('acceptedInto' in d ? { acceptedInto: idIn(d.acceptedInto) } : {}) })
  }, [decided, saved])

  if (!doc) return null
  const reload = () => {
    reloadPreview()
    reloadDecided()
  }
  const decide = async <T extends ProposalDecision>(path: 'accept' | 'decline', body: Record<string, unknown>, done: (answer: T) => NonNullable<Outcome>) => {
    setOutcome(null)
    try {
      setOutcome(done(await request<T>(`${doc}/${path}`, { method: 'POST', body })))
      reload()
      return true
    } catch (error) {
      setOutcome({ kind: 'error', message: `Nothing was changed. ${reasonOf(error)}` })
      // Someone else may have decided it, or the proposal changed: show it as it is now.
      reload()
      return false
    }
  }
  const d = decided.state === 'ready' ? decided.data : {}
  const decision: ProposalDecisionInfo = { note: d.decisionNote ?? null, at: d.decidedAt ?? null, snapshotHref: hrefOf(slugs.snapshots, idIn(d.acceptedInto)) }
  return (
    <ProposalPanelView
      preview={preview}
      decision={decision}
      snapshotHref={preview.state === 'ready' ? hrefOf(slugs.snapshots, preview.data.snapshot.doc) : null}
      limits={limits}
      outcome={outcome}
      onAccept={({ version, note, checksum }) =>
        decide<ProposalAcceptance>('accept', { version, checksum, ...(note ? { note } : {}) }, (answer) => {
          const link = hrefOf(slugs.snapshots, answer.snapshot.doc)
          return { kind: 'success', message: `Accepted into the new staged version ${answer.snapshot.version}. Nothing is published yet: check that snapshot, then publish it.`, ...(link ? { link: { href: link, label: 'Open the new snapshot' } } : {}) }
        })
      }
      onDecline={({ note }) => decide<ProposalDecision>('decline', note ? { note } : {}, () => ({ kind: 'success', message: 'This proposal is declined. Its author can revise it and share it again.' }))}
      onRetry={reload}
    />
  )
}
