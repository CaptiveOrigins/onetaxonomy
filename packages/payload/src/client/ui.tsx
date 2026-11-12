import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'

/** Data a panel fetches: still loading, failed with a reason, or here. */
export type Loadable<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T }

/** What the last action did. `link` goes to what it made. */
export type Outcome = { kind: 'success' | 'error'; message: string; link?: { href: string; label: string } } | null

/** An action a panel offers. It answers true when it worked; when it didn't, the panel is given the reason as an `Outcome`. */
export type Act<A = void> = (args: A) => Promise<boolean>

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="onetaxonomy-panel" aria-labelledby={id}>
      <h3 className="onetaxonomy-panel__title" id={id}>
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A status as a word in a pill, then what it means. The word carries it; the colour only repeats it. */
export function StatusLine({ status, word, children }: { status: string; word: string; children?: ReactNode }) {
  return (
    <p className="onetaxonomy-panel__status">
      <span className="onetaxonomy-status" data-status={status}>
        {word}
      </span>{' '}
      {children}
    </p>
  )
}

const LEAD = { error: 'Problem:', warning: 'Warning:', success: 'Done:', info: '' } as const

/** A boxed note. It starts with a word saying what kind it is, so it doesn't rely on colour. */
export function Notice({ kind = 'info', children }: { kind?: keyof typeof LEAD; children: ReactNode }) {
  return (
    <div className={`onetaxonomy-notice onetaxonomy-notice--${kind}`}>
      {LEAD[kind] ? <strong>{LEAD[kind]} </strong> : null}
      {children}
    </div>
  )
}

/**
 * What the last action did. A problem is announced at once (`role="alert"`). A success takes the keyboard focus,
 * because the button that was pressed is usually gone by then, and a screen reader reads what has focus.
 */
export function OutcomeNotice({ outcome }: { outcome: Outcome }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (outcome?.kind === 'success') ref.current?.focus()
  }, [outcome])
  if (!outcome) return null
  return (
    <div ref={ref} tabIndex={-1} role={outcome.kind === 'error' ? 'alert' : 'status'} className={`onetaxonomy-notice onetaxonomy-notice--${outcome.kind} onetaxonomy-outcome`}>
      <strong>{LEAD[outcome.kind]} </strong>
      {outcome.message}
      {outcome.link ? (
        <>
          {' '}
          <a href={outcome.link.href}>{outcome.link.label}</a>
        </>
      ) : null}
    </div>
  )
}

/** Label and value pairs. Empty values are left out. */
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
  if (!shown.length) return null
  return (
    <dl className="onetaxonomy-facts">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A date and time in the reader's own format, with the exact value for machines. Only an ISO moment
 * (`2026-11-12T00:52:05Z`) is read as one. Anything else is shown as written: a browser reads "spring 2026" as the
 * first of January, and a day alone as midnight in Greenwich, which is the day before for a reader west of it.
 */
export function When({ at }: { at: string | null | undefined }) {
  if (!at) return null
  const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at) ? new Date(at) : new Date(Number.NaN)
  if (Number.isNaN(d.getTime())) return <>{at}</>
  return <time dateTime={d.toISOString()}>{d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
}

/** An id, checksum or other exact value, shown so it can be told from prose and wraps on a narrow page. */
export const Exact = ({ children }: { children: ReactNode }) => <code className="onetaxonomy-exact">{children}</code>

export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`

export function Button({ danger, primary, ...props }: { danger?: boolean; primary?: boolean } & ComponentProps<'button'>) {
  return <button type="button" {...props} className={cx('onetaxonomy-btn', primary && 'onetaxonomy-btn--primary', danger && 'onetaxonomy-btn--danger', props.className)} />
}

/**
 * A button that asks before it acts, in the page and not in a browser dialog. Pressing it opens the question with
 * anything to fill in (`children`), a button that does it and one that cancels. The question takes the focus when it
 * opens; Escape or Cancel puts the focus back on the button. While the action runs both buttons wait. If it fails, the
 * question stays open so the person can try again or cancel.
 */
export function ConfirmAction<A = void>({
  label,
  question,
  confirmLabel,
  danger = false,
  disabledReason,
  canConfirm = true,
  args,
  onConfirm,
  children,
}: {
  label: string
  question: ReactNode
  confirmLabel: string
  danger?: boolean
  /** Why the button can't be used now. Shown beside it. */
  disabledReason?: string | null
  /** False while something that must be filled in is missing. */
  canConfirm?: boolean
  args?: () => A
  onConfirm: Act<A>
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const returnFocus = useRef(false)
  const live = useRef(true)
  const questionId = useId()
  const reasonId = useId()
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    if (open) box.current?.focus()
    else if (returnFocus.current) trigger.current?.focus()
    returnFocus.current = false
  }, [open])
  const close = () => {
    returnFocus.current = true
    setOpen(false)
  }
  const confirm = async () => {
    setWorking(true)
    let done = false
    try {
      done = await onConfirm((args ? args() : undefined) as A)
    } finally {
      if (live.current) {
        setWorking(false)
        // The outcome notice takes the focus after a success, so it isn't sent back to the button here.
        if (done) setOpen(false)
      }
    }
  }
  if (!open)
    return (
      <span className="onetaxonomy-action">
        <Button ref={trigger} primary={!danger} danger={danger} disabled={Boolean(disabledReason)} aria-describedby={disabledReason ? reasonId : undefined} onClick={() => setOpen(true)}>
          {label}
        </Button>
        {disabledReason ? (
          <span id={reasonId} className="onetaxonomy-action__reason">
            {disabledReason}
          </span>
        ) : null}
      </span>
    )
  return (
    <div
      ref={box}
      className="onetaxonomy-confirm"
      role="group"
      aria-labelledby={questionId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !working) {
          e.stopPropagation()
          close()
        }
      }}
    >
      <p id={questionId} className="onetaxonomy-confirm__question">
        {question}
      </p>
      {children}
      <div className="onetaxonomy-confirm__buttons">
        <Button primary={!danger} danger={danger} disabled={working || !canConfirm} onClick={() => void confirm()}>
          {working ? 'Working…' : confirmLabel}
        </Button>
        <Button disabled={working} onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** A labelled text box with a hint under it. */
export function TextBox({
  label,
  hint,
  value,
  onChange,
  required = false,
  maxLength,
  multiline = false,
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  maxLength?: number
  multiline?: boolean
}) {
  const id = useId()
  const hintId = useId()
  const shared = { id, value, required, maxLength, 'aria-describedby': hint ? hintId : undefined, className: 'onetaxonomy-input' }
  return (
    <div className="onetaxonomy-field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="onetaxonomy-field__required"> (needed)</span> : <span className="onetaxonomy-field__optional"> (optional)</span>}
      </label>
      {multiline ? <textarea {...shared} rows={3} onChange={(e) => onChange(e.target.value)} /> : <input {...shared} type="text" autoComplete="off" onChange={(e) => onChange(e.target.value)} />}
      {hint ? (
        <p id={hintId} className="onetaxonomy-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** While a panel's data is loading or couldn't be loaded. Null when it is ready. */
export function Loading<T>({ of, what, onRetry }: { of: Loadable<T>; what: string; onRetry?: () => void }) {
  if (of.state === 'loading')
    return (
      <p className="onetaxonomy-panel__loading" role="status">
        Loading {what}…
      </p>
    )
  if (of.state === 'error')
    return (
      <Notice kind="error">
        {capital(what)} couldn’t be loaded. {of.message}{' '}
        {onRetry ? (
          <Button onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </Notice>
    )
  return null
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
