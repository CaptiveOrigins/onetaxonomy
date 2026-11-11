import {
  comparePhylogenies,
  midpointRoot,
  rerootPhylogeny,
  type DatasetIndex,
  type Id,
  type Phylogeny,
  type PhylogenyComparison,
  type Projection,
  type TaxonomicView,
  type ViewAction,
} from '@captiveorigins/onetaxonomy-core'
import { useEffect, useId, useMemo, useState } from 'react'

import { Icon } from './icons.js'

/** The labels the phylogeny controls use (a subset of `ExplorerLabels`). */
export type PhyloLabels = Record<
  | 'supportThreshold' | 'supportClear' | 'supportClearName' | 'supportUnavailable' | 'branch' | 'branches' | 'below' | 'collapsed' | 'hasNoSupport' | 'haveNoSupport'
  | 'compareWith' | 'compareAgainst' | 'compareMode' | 'compareAuto' | 'compareRooted' | 'compareUnrooted' | 'rfDistance' | 'rfNormalized' | 'rfUndefined' | 'comparedOn' | 'sharedTips'
  | 'tipsOnlyIn' | 'cladesOnlyIn' | 'splitsOnlyIn' | 'splitSide' | 'none' | 'selectInTree' | 'notes'
  | 'midpointRoot' | 'rootOnTip' | 'rootOnClade' | 'rooting',
  string
>

export const PHYLO_LABELS: PhyloLabels = {
  supportThreshold: 'Collapse support below',
  supportClear: 'Clear',
  supportClearName: 'Clear support threshold',
  supportUnavailable: 'Classifications have no support values to collapse by.',
  branch: 'branch',
  branches: 'branches',
  below: 'below',
  collapsed: 'collapsed',
  hasNoSupport: 'has no support value',
  haveNoSupport: 'have no support value',
  compareWith: 'Compare with…',
  compareAgainst: 'Compare with',
  compareMode: 'Roots',
  compareAuto: 'Use them when both trees are rooted',
  compareRooted: 'Compare as rooted (clades)',
  compareUnrooted: 'Ignore the roots (splits)',
  rfDistance: 'Robinson-Foulds distance',
  rfNormalized: 'Normalized',
  rfUndefined: 'not defined: neither tree has a split to compare',
  comparedOn: 'Compared',
  sharedTips: 'shared tips',
  tipsOnlyIn: 'Tips only in',
  cladesOnlyIn: 'Clades only in',
  splitsOnlyIn: 'Splits only in',
  splitSide: 'Each split is listed by one side.',
  none: 'None',
  selectInTree: 'Select',
  notes: 'Notes',
  midpointRoot: 'Midpoint root',
  rootOnTip: 'Root on this tip (outgroup)',
  rootOnClade: 'Root on this clade (outgroup)',
  rooting: 'Rooting:',
}

/**
 * What support collapsing did, in words: "3 branches below 70 collapsed; 2 have no
 * support value." Empty when the view doesn't collapse by support.
 */
export function supportSummary(projection: Projection, labels: Partial<PhyloLabels> = {}): string {
  const sc = projection.supportCollapse
  if (!sc) return ''
  const l = { ...PHYLO_LABELS, ...labels }
  const n = sc.collapsed.length
  const m = sc.withoutSupport
  const first = `${n} ${n === 1 ? l.branch : l.branches} ${l.below} ${sc.threshold} ${l.collapsed}`
  return m ? `${first}; ${m} ${m === 1 ? l.hasNoSupport : l.haveNoSupport}.` : `${first}.`
}

/**
 * A number field and a Clear button for `collapseBelowSupport`. The value applies on
 * Enter or when the field loses focus (an empty field clears it), so typing "70" is one undo step, not two.
 * For a classification the field is disabled and the reason is shown next to it.
 */
export function SupportControl({ view, dispatch, labels }: { view: TaxonomicView; dispatch: (a: ViewAction) => void; labels: PhyloLabels }) {
  const current = view.supportCollapse?.threshold
  const [draft, setDraft] = useState(current === undefined ? '' : String(current))
  // Undo, redo and a loaded view change the threshold from outside: show it.
  useEffect(() => setDraft(current === undefined ? '' : String(current)), [current])
  const reason = useId()
  const available = view.target.kind === 'phylogeny'
  const commit = () => {
    const text = draft.trim()
    if (text === '') {
      if (current !== undefined) dispatch({ type: 'collapseBelowSupport', threshold: null })
      return
    }
    const value = Number(text)
    // An unreadable value goes to the reducer, which refuses it with a reason in the status region.
    if (value !== current) dispatch({ type: 'collapseBelowSupport', threshold: Number.isFinite(value) ? value : Number.NaN })
  }
  return (
    <div className="ot-support-form" role="group" aria-label={labels.supportThreshold}>
      <label className="ot-select">
        <Icon name="support" />
        <span>{labels.supportThreshold}</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={draft}
          disabled={!available}
          aria-describedby={available ? undefined : reason}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            commit()
          }}
        />
      </label>
      <button
        type="button"
        aria-label={labels.supportClearName}
        disabled={!available || current === undefined}
        onClick={() => {
          setDraft('')
          dispatch({ type: 'collapseBelowSupport', threshold: null })
        }}
      >
        <Icon name="close" />
        {labels.supportClear}
      </button>
      {!available && (
        <span id={reason} className="ot-notice">
          {labels.supportUnavailable}
        </span>
      )}
    </div>
  )
}

/** All tips under a node in the stored tree (folds and filters don't matter here). */
export function tipsUnder(dataset: DatasetIndex, phylogeny: Id, node: Id): Id[] {
  const p = dataset.phylogeny(phylogeny)
  const out: Id[] = []
  const stack = [node]
  while (stack.length) {
    const id = stack.pop()!
    const kids = p.children.get(id) ?? []
    if (!kids.length) out.push(id)
    else stack.push(...kids)
  }
  return out
}

const freeId = (base: string, taken: Set<Id>) => {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * A new, rooted record from the target phylogeny: on the tips under `node` as the
 * outgroup, or at the midpoint when `node` is null. The input record is never changed
 * (core returns a new one); the new id is one no other record uses. Throws the core's
 * `RootingError` with its reason when the rooting isn't possible.
 */
export function rootedRecord(dataset: DatasetIndex, phylogeny: Id, node: Id | null, taken: Iterable<Id>, today = new Date().toISOString().slice(0, 10)): Phylogeny {
  const p = dataset.phylogeny(phylogeny).phylogeny
  const ids = new Set(taken)
  for (const x of dataset.snapshot.phylogenies) ids.add(x.id)
  if (node === null) return midpointRoot(p, { id: freeId(`${p.id}-midpoint`, ids), version: today })
  return rerootPhylogeny(p, tipsUnder(dataset, phylogeny, node), { id: freeId(`${p.id}-outgroup`, ids), version: today })
}

/**
 * "Compare with…": the target phylogeny against another one loaded with it or given
 * to the explorer. Robinson-Foulds raw and normalized, tips in only one tree, and the
 * clades (rooted) or splits (unrooted) that differ. A refusal is shown with its reason.
 * The comparison runs only while the panel is open.
 */
export function ComparePanel({
  dataset,
  view,
  others,
  dispatch,
  labels,
}: {
  dataset: DatasetIndex
  view: TaxonomicView
  others: Phylogeny[]
  dispatch: (a: ViewAction) => void
  labels: PhyloLabels
}) {
  const [open, setOpen] = useState(false)
  const [against, setAgainst] = useState(others[0]?.id ?? '')
  const [mode, setMode] = useState<'auto' | 'rooted' | 'unrooted'>('auto')
  const other = others.find((p) => p.id === against) ?? others[0]
  const self = dataset.phylogeny(view.target.id)
  const result = useMemo(() => (open && other ? comparePhylogenies(self, other, { mode }) : null), [open, self, other, mode])
  const name = (c: Id) => dataset.nameOf(c) ?? c
  const list = (ids: Id[]) => (ids.length ? ids.map(name).join(', ') : labels.none)
  const titleA = self.phylogeny.title
  const titleB = other?.title ?? ''
  const summary = !result
    ? ''
    : result.status === 'refused'
      ? result.message
      : `${labels.rfDistance} ${result.rf}${result.normalized === null ? '' : ` (${labels.rfNormalized.toLowerCase()} ${result.normalized.toFixed(2)})`}, ${result.mode}, on ${result.shared.length} ${labels.sharedTips}.`
  return (
    <details className="ot-compare-trees" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <Icon name="layout" />
        {labels.compareWith}
      </summary>
      <div className="ot-inspector-actions">
        <label className="ot-select">
          <span>{labels.compareAgainst}</span>
          <select value={other?.id ?? ''} onChange={(e) => setAgainst(e.target.value)}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="ot-select">
          <span>{labels.compareMode}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="auto">{labels.compareAuto}</option>
            <option value="rooted">{labels.compareRooted}</option>
            <option value="unrooted">{labels.compareUnrooted}</option>
          </select>
        </label>
      </div>
      {/* One short sentence, always mounted, so a new answer is announced without reading the lists. */}
      <p className="ot-compare-summary" role="status">
        {summary}
      </p>
      {result?.status === 'compared' && <CompareResult result={result} titleA={titleA} titleB={titleB} name={name} list={list} labels={labels} onSelect={(node) => dispatch({ type: 'select', nodes: [node] })} />}
    </details>
  )
}

function CompareResult({ result, titleA, titleB, name, list, labels, onSelect }: { result: PhylogenyComparison; titleA: string; titleB: string; name: (c: Id) => string; list: (ids: Id[]) => string; labels: PhyloLabels; onSelect: (node: Id) => void }) {
  const only = result.mode === 'rooted' ? labels.cladesOnlyIn : labels.splitsOnlyIn
  return (
    <div className="ot-compare-result">
      <dl>
        <dt>{labels.rfDistance}</dt>
        <dd>
          {result.rf} ({result.splits.a} + {result.splits.b})
        </dd>
        <dt>{labels.rfNormalized}</dt>
        <dd>{result.normalized === null ? labels.rfUndefined : result.normalized.toFixed(3)}</dd>
        <dt>{labels.comparedOn}</dt>
        <dd>
          {result.mode}, {result.shared.length} {labels.sharedTips}
        </dd>
        <dt>
          {labels.tipsOnlyIn} {titleA}
        </dt>
        <dd>{list(result.onlyInA)}</dd>
        <dt>
          {labels.tipsOnlyIn} {titleB}
        </dt>
        <dd>{list(result.onlyInB)}</dd>
      </dl>
      {result.mode === 'unrooted' && (result.inAOnly.length > 0 || result.inBOnly.length > 0) && <p className="ot-notice">{labels.splitSide}</p>}
      <h4>
        {only} {titleA}
      </h4>
      {result.inAOnly.length ? (
        <ul>
          {result.inAOnly.map((s) => {
            const names = s.concepts.map(name).join(', ')
            return (
              <li key={s.node}>
                {names}{' '}
                <button type="button" aria-label={`${labels.selectInTree} ${names}`} onClick={() => onSelect(s.node)}>
                  {labels.selectInTree}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p>{labels.none}</p>
      )}
      <h4>
        {only} {titleB}
      </h4>
      {result.inBOnly.length ? (
        <ul>
          {result.inBOnly.map((s) => (
            <li key={s.node}>{s.concepts.map(name).join(', ')}</li>
          ))}
        </ul>
      ) : (
        <p>{labels.none}</p>
      )}
      {result.notes.length > 0 && (
        <>
          <h4>{labels.notes}</h4>
          <ul>
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
