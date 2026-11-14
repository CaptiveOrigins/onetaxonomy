import type { ImportWarning } from '@extantape/onetaxonomy-import'

import type { ImportDiagnostic, ImportPhase, ImportStatus } from '../imports.js'
import { Button, count, Exact, Facts, Loading, Notice, OutcomeNotice, Panel, StatusLine, When, type Act, type Loadable, type Outcome } from './ui.js'

/** An import job as its document reads. */
export type ImportJob = {
  status: ImportStatus
  phase: ImportPhase | null
  message: string | null
  /** The document id of the staged snapshot it stored or found. */
  snapshot: string | null
  checksum: string | null
  inputSha256: string | null
  diagnostics: ImportDiagnostic[]
  warnings: ImportWarning[]
  warningCount: number
  progress: { at: string; message: string }[]
  attempts: number
  startedAt: string | null
  finishedAt: string | null
}

export const IMPORT_STATUS: Record<ImportStatus, { word: string; means: string }> = {
  queued: { word: 'Queued', means: 'It hasn’t run yet.' },
  running: { word: 'Running', means: 'This page checks on it every few seconds.' },
  done: { word: 'Done', means: 'It stored a staged snapshot. Check that snapshot, then publish it.' },
  'already-imported': { word: 'Already imported', means: 'This file with these settings was imported before, so the job points at that snapshot.' },
  failed: { word: 'Failed', means: 'It stopped before a snapshot was stored. The reason is below.' },
}

const STEPS: { phase: ImportPhase; label: string }[] = [
  { phase: 'reading', label: 'Read the file' },
  { phase: 'parsing', label: 'Parse it' },
  { phase: 'sealing', label: 'Seal the snapshot' },
  { phase: 'storing', label: 'Store it' },
]

export type StepState = 'done' | 'current' | 'stopped' | 'todo'
const STEP_WORD: Record<StepState, string> = { done: 'done', current: 'in progress', stopped: 'stopped here', todo: 'not yet' }

/** Where each step stands, from the job's status and the phase it last reached. */
export function stepStates(job: Pick<ImportJob, 'status' | 'phase'>): StepState[] {
  if (job.status === 'done' || job.status === 'already-imported') return STEPS.map(() => 'done')
  const at = STEPS.findIndex((s) => s.phase === job.phase)
  if (job.status === 'queued' || at < 0) return STEPS.map(() => (job.phase === 'finished' && job.status !== 'queued' ? 'done' : 'todo'))
  return STEPS.map((_, i) => (i < at ? 'done' : i === at ? (job.status === 'failed' ? 'stopped' : 'current') : 'todo'))
}

/** True when a job has been marked running for longer than the site allows, so it was probably interrupted. */
export const isStale = (job: Pick<ImportJob, 'status' | 'startedAt'>, now: number, staleAfterMinutes: number): boolean =>
  job.status === 'running' && Boolean(job.startedAt) && now - Date.parse(job.startedAt!) >= staleAfterMinutes * 60_000

const where = (d: { line?: number; position?: number; path?: string; row?: number; externalId?: string }) =>
  [d.path ? d.path : '', d.row !== undefined ? `row ${d.row}` : '', d.line !== undefined ? `line ${d.line}` : '', d.position !== undefined ? `position ${d.position}` : '', d.externalId ? `id ${d.externalId}` : ''].filter(Boolean).join(', ')

export type ImportPanelViewProps = {
  job: Loadable<ImportJob>
  /** Whether this person may run the job. The site checks again when they do. */
  canRun: boolean
  /** True while a run started from this page hasn't answered yet. */
  starting: boolean
  staleAfterMinutes: number
  /** The time now, in milliseconds, to tell an interrupted job from a working one. */
  now: number
  /** Where the job's snapshot is in the admin, when it has one. */
  snapshotHref: string | null
  outcome: Outcome
  onRun: Act
  onRetry?: () => void
}

/** How an import job is going: its steps, what it said, what it found wrong, the snapshot it made, and a button to run it. */
export function ImportPanelView({ job, canRun, starting, staleAfterMinutes, now, snapshotHref, outcome, onRun, onRetry }: ImportPanelViewProps) {
  if (job.state !== 'ready')
    return (
      <Panel title="Import">
        <Loading of={job} what="the import job" {...(onRetry ? { onRetry } : {})} />
      </Panel>
    )
  const j = job.data
  const status = IMPORT_STATUS[j.status]
  const stale = isStale(j, now, staleAfterMinutes)
  const states = stepStates(j)
  const errors = j.diagnostics.filter((d) => d.severity === 'error')
  const others = j.diagnostics.filter((d) => d.severity !== 'error')
  const runLabel = j.status === 'queued' ? 'Run this import' : 'Run it again'
  const mayRun = canRun && (j.status === 'queued' || j.status === 'failed' || stale)
  return (
    <Panel title="Import">
      {/* Polite live region: a screen reader hears the status and message when they change, not on every check. */}
      <div className="onetaxonomy-panel__live" role="status">
        <StatusLine status={j.status} word={status.word}>
          {status.means}
        </StatusLine>
        {j.message ? <p className="onetaxonomy-panel__message">{j.message}</p> : null}
      </div>

      <ol className="onetaxonomy-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.phase} data-state={states[i]} {...(states[i] === 'current' ? { 'aria-current': 'step' as const } : {})}>
            <span className="onetaxonomy-steps__label">{s.label}</span> <span className="onetaxonomy-steps__state">{STEP_WORD[states[i]!]}</span>
          </li>
        ))}
      </ol>

      {stale ? (
        <Notice kind="warning">
          This job has been marked as running for more than {count(staleAfterMinutes, 'minute')}, so the run was probably interrupted. You can run it again: it starts from the file, and the same file and settings give the same snapshot.
        </Notice>
      ) : null}

      {snapshotHref ? (
        <p>
          <a href={snapshotHref}>Open the staged snapshot this job {j.status === 'already-imported' ? 'found' : 'stored'}</a>
        </p>
      ) : null}

      {errors.length ? (
        <div className="onetaxonomy-panel__block">
          <h4>What stopped it</h4>
          <ul className="onetaxonomy-list">
            {errors.map((d, i) => (
              <li key={i}>
                {d.message}
                {where(d) ? <span className="onetaxonomy-panel__hint"> ({where(d)})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {others.length ? (
        <details className="onetaxonomy-details">
          <summary>{count(others.length, 'validation warning')}</summary>
          <ul className="onetaxonomy-list">
            {others.map((d, i) => (
              <li key={i}>
                {d.message}
                {where(d) ? <span className="onetaxonomy-panel__hint"> ({where(d)})</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {j.warningCount > 0 ? (
        <details className="onetaxonomy-details">
          <summary>{count(j.warningCount, 'thing')} the importer noticed and handled with care</summary>
          {j.warnings.length < j.warningCount ? <p className="onetaxonomy-panel__hint">The first {j.warnings.length.toLocaleString('en')} are kept.</p> : null}
          <ul className="onetaxonomy-list">
            {j.warnings.map((w, i) => (
              <li key={i}>
                {w.message}
                {where(w) ? <span className="onetaxonomy-panel__hint"> ({where(w)})</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {j.progress.length ? (
        <details className="onetaxonomy-details" open={j.status === 'running' || j.status === 'failed'}>
          <summary>Progress log</summary>
          <ol className="onetaxonomy-list onetaxonomy-log">
            {j.progress.map((p, i) => (
              <li key={i}>
                <When at={p.at} /> {p.message}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <Facts
        items={[
          ['Runs started', j.attempts ? j.attempts.toLocaleString('en') : null],
          ['Last started', j.startedAt ? <When key="s" at={j.startedAt} /> : null],
          ['Finished', j.finishedAt ? <When key="f" at={j.finishedAt} /> : null],
          ['File SHA-256', j.inputSha256 ? <Exact key="i">{j.inputSha256}</Exact> : null],
          ['Snapshot checksum', j.checksum ? <Exact key="c">{j.checksum}</Exact> : null],
        ]}
      />

      <OutcomeNotice outcome={outcome} />
      {mayRun ? (
        <p className="onetaxonomy-action">
          <Button primary disabled={starting} onClick={() => void onRun()}>
            {starting ? 'Running…' : runLabel}
          </Button>
          {starting ? <span className="onetaxonomy-action__reason">Keep this page open. A large file can take a while.</span> : null}
        </p>
      ) : null}
    </Panel>
  )
}
