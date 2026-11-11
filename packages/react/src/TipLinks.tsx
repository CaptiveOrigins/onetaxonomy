'use client'

import type { DatasetIndex, Id, NameStatus, Phylogeny, PhyloNode } from '@captiveorigins/onetaxonomy-core'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

/** A concept that uses a tip's label as a name, and how the name is used for it. */
export type TipCandidate = { concept: Id; status: NameStatus }

/**
 * One tip and what its label matches. `unique` is exactly one concept, `ambiguous` several
 * (homonyms, splits), `none` none. `bulk` marks the matches "Accept all exact unique matches"
 * may take: one concept, by its accepted name or a synonym. A single misapplied, provisional
 * or unknown usage is still proposed, but only accepted one at a time.
 */
export type TipMatch = {
  node: Id
  label: string
  /** The tip's mapping before linking (usually none for an imported tree). */
  current: Id[]
  candidates: TipCandidate[]
  kind: 'unique' | 'ambiguous' | 'none'
  bulk: boolean
}

/** For each tip: link it to this concept, or `null` to leave it (or make it) unlinked. Tips not in the map keep their mapping. */
export type TipLinks = ReadonlyMap<Id, Id | null>

const BULK_STATUSES: readonly NameStatus[] = ['accepted', 'synonym']

/**
 * What each tip of a phylogeny matches by exact name (letter case aside) among the dataset's
 * concepts and their synonyms, through core's `findByName`. Nothing is linked here: this is
 * a proposal for a person to confirm.
 */
export function proposeTipLinks(dataset: DatasetIndex, phylogeny: Id): TipMatch[] {
  const p = dataset.phylogeny(phylogeny)
  return p.phylogeny.nodes
    .filter((n) => !(p.children.get(n.id)?.length))
    .map((n) => {
      const label = n.label?.trim() ?? ''
      const seen = new Set<Id>()
      const candidates: TipCandidate[] = []
      for (const hit of label ? dataset.findByName(label) : []) {
        if (seen.has(hit.concept.id)) continue
        seen.add(hit.concept.id)
        candidates.push({ concept: hit.concept.id, status: hit.status })
      }
      const kind = candidates.length === 0 ? 'none' : candidates.length === 1 ? 'unique' : 'ambiguous'
      return { node: n.id, label, current: [...(n.concepts ?? [])], candidates, kind, bulk: kind === 'unique' && BULK_STATUSES.includes(candidates[0]!.status) }
    })
}

const freeId = (base: string, taken: Set<Id>) => {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * A new phylogeny record with the confirmed links set in each tip's `concepts` (the model's
 * explicit mapping). The input record is never changed; every other field is copied. Each
 * changed tip notes in `annotations.conceptLink` that a person confirmed it and whether the
 * concept was one its label matched by name. Throws when a link names an unknown concept or node.
 */
export function linkedPhylogeny(dataset: DatasetIndex, phylogeny: Id, links: TipLinks, { id, version, title }: { id: Id; version: string; title?: string }): Phylogeny {
  const p = dataset.phylogeny(phylogeny).phylogeny
  const nodes = new Set(p.nodes.map((n) => n.id))
  for (const [node, concept] of links) {
    if (!nodes.has(node)) throw new RangeError(`Unknown node ${node} in ${p.id}`)
    if (concept !== null && !dataset.concept.has(concept)) throw new RangeError(`Unknown concept ${concept}`)
  }
  const copy = structuredClone(p)
  return {
    ...copy,
    id,
    version,
    title: title ?? `${p.title} (tips linked)`,
    nodes: copy.nodes.map((n): PhyloNode => {
      if (!links.has(n.id)) return n
      const concept = links.get(n.id)!
      const { concepts: _c, ...rest } = n
      const byName = concept !== null && n.label ? dataset.findByName(n.label).some((h) => h.concept.id === concept) : false
      const conceptLink = concept === null ? { basis: 'unlinked-by-person' } : { basis: byName ? 'exact-name-confirmed' : 'chosen-by-person', ...(n.label ? { label: n.label } : {}) }
      return { ...rest, ...(concept === null ? {} : { concepts: [concept] }), annotations: { ...n.annotations, conceptLink } }
    }),
  }
}

export type TipLinkLabels = Record<
  | 'title' | 'intro' | 'noConcepts' | 'tip' | 'tips' | 'tableCaption' | 'colTip' | 'colMatch' | 'colLink'
  | 'matchesOne' | 'matchSeveral' | 'matchNone' | 'summaryOne' | 'summarySeveral' | 'summaryNone'
  | 'notLinked' | 'keep' | 'another' | 'findLabel' | 'findHint' | 'findNone' | 'findSeveral' | 'accept' | 'acceptAll' | 'acceptAllNone' | 'accepted' | 'acceptedAll'
  | 'linkedTo' | 'leftUnlinked' | 'byName' | 'otherChoices' | 'asStatus' | 'unlinkedHeading' | 'noneUnlinked' | 'sameConcept' | 'sameConceptHint'
  | 'confirm' | 'confirmNone' | 'cancel' | 'unnamedTip' | 'checkFirst',
  string
>

export const TIP_LINK_LABELS: TipLinkLabels = {
  title: 'Link tips to taxa',
  intro: 'Each tip’s name is matched exactly, letter case aside, against the taxa in this dataset and their synonyms. Nothing is linked until you accept it. The tree shown stays as it is: accepting makes a new tree.',
  noConcepts: 'This dataset has no taxa to link to, so no tip can be matched. Open a checklist or snapshot with the taxa, and bring the tree into it.',
  tip: 'tip',
  tips: 'tips',
  tableCaption: 'Tips and the taxa they are linked to',
  colTip: 'Tip',
  colMatch: 'Match by name',
  colLink: 'Link to',
  matchesOne: 'match one taxon',
  matchSeveral: 'match several',
  matchNone: 'match none',
  summaryOne: 'One taxon',
  summarySeveral: 'taxa use this name: choose one',
  summaryNone: 'No taxon uses this name',
  notLinked: 'Not linked',
  keep: 'Keep',
  another: 'Another taxon…',
  findLabel: 'Find a taxon by name for',
  findHint: 'Type an exact name and press Enter.',
  findNone: 'No taxon in this dataset is called',
  findSeveral: 'taxa are called',
  accept: 'Accept',
  acceptAll: 'Accept all exact unique matches',
  acceptAllNone: 'No exact unique matches to accept',
  accepted: 'Linked',
  acceptedAll: 'Accepted',
  linkedTo: 'to',
  leftUnlinked: 'left unlinked',
  byName: 'Matches by name',
  otherChoices: 'Other taxa',
  asStatus: 'as a',
  unlinkedHeading: 'Not linked',
  noneUnlinked: 'Every tip is linked.',
  sameConcept: 'One taxon on several tips:',
  sameConceptHint: 'Comparison refuses a tree where one taxon is on two tips.',
  confirm: 'Make a new tree with these links',
  confirmNone: 'Nothing to make: no link has changed',
  cancel: 'Cancel',
  unnamedTip: 'Unnamed tip',
  checkFirst: 'check before accepting',
}

export type TipLinkerProps = {
  dataset: DatasetIndex
  /** The phylogeny whose tips are linked. It is never changed. */
  phylogeny: Id
  /** Receives the new record (new id, the links in `concepts`) and how many tips changed. */
  onConfirm: (record: Phylogeny, changed: number) => void
  onCancel?: () => void
  /** Ids already in use elsewhere (besides the dataset's phylogenies), so the new record's id is free. */
  taken?: Iterable<Id>
  labels?: Partial<TipLinkLabels>
  /** Heading level of the title. Default 2. */
  headingLevel?: 2 | 3
  /** Version of the new record. Default today's date. */
  version?: string
}

/**
 * The step where a person confirms tip-to-taxon links. Proposals come from exact names
 * (`proposeTipLinks`) and are shown, never applied: each tip is accepted, changed to another
 * taxon, or left unlinked, and unlinked tips are listed. "Accept all exact unique matches"
 * is one explicit action that says how many it takes. Confirming hands a new record to
 * `onConfirm`. Focus moves to the title on opening; every change is said in a status region.
 */
export function TipLinker({ dataset, phylogeny, onConfirm, onCancel, taken = [], labels: custom, headingLevel = 2, version }: TipLinkerProps) {
  const labels = { ...TIP_LINK_LABELS, ...custom }
  const record = dataset.phylogeny(phylogeny).phylogeny
  const matches = useMemo(() => proposeTipLinks(dataset, phylogeny), [dataset, phylogeny])
  const [links, setLinks] = useState<Map<Id, Id | null>>(() => new Map())
  // Concepts found with "Another taxon…", per tip, offered in its list.
  const [found, setFound] = useState<Map<Id, Id[]>>(() => new Map())
  const [finding, setFinding] = useState<Id | null>(null)
  const [said, setSaid] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const listId = useId()
  const H = headingLevel === 3 ? 'h3' : 'h2'
  const Sub = headingLevel === 3 ? 'h4' : 'h3'

  useEffect(() => heading.current?.focus(), [])
  useEffect(() => {
    if (finding) findInput.current?.focus()
  }, [finding])

  const nameOf = (c: Id) => dataset.nameOf(c) ?? c
  const tipName = (m: TipMatch) => m.label || labels.unnamedTip
  const sourceTitle = (c: Id) => {
    const s = dataset.concept.get(c)?.provenance?.source
    return s ? (dataset.snapshot.sources.find((x) => x.id === s)?.title ?? s) : undefined
  }
  // Enough to tell homonyms apart: name, authorship, rank, how the tip's name is used, source and id.
  const conceptText = (c: Id, m?: TipMatch) => {
    const concept = dataset.concept.get(c)
    const authorship = concept ? dataset.name.get(concept.acceptedName)?.authorship : undefined
    const status = m?.candidates.find((x) => x.concept === c)?.status
    const parts = [
      `${nameOf(c)}${authorship ? ` ${authorship}` : ''}`,
      concept?.rank,
      status && status !== 'accepted' ? `${m!.label} ${labels.asStatus} ${status}` : undefined,
      sourceTitle(c),
      c,
    ]
    return parts.filter(Boolean).join(' · ')
  }
  const linkOf = (m: TipMatch): Id | null => (links.has(m.node) ? links.get(m.node)! : (m.current[0] ?? null))
  const changed = [...links].filter(([node, c]) => {
    const m = matches.find((x) => x.node === node)!
    return c === null ? m.current.length > 0 : !(m.current.length === 1 && m.current[0] === c)
  })
  // Never over a decision already made here, or over a tip that was linked before.
  const bulk = matches.filter((m) => m.bulk && !links.has(m.node) && m.current.length === 0)
  const counts = {
    one: matches.filter((m) => m.kind === 'unique').length,
    several: matches.filter((m) => m.kind === 'ambiguous').length,
    none: matches.filter((m) => m.kind === 'none').length,
  }
  const unlinked = matches.filter((m) => linkOf(m) === null)
  const shared = useMemo(() => {
    const by = new Map<Id, string[]>()
    for (const m of matches) {
      const c = links.has(m.node) ? links.get(m.node)! : (m.current[0] ?? null)
      if (c) by.set(c, [...(by.get(c) ?? []), m.label || m.node])
    }
    return [...by].filter(([, tips]) => tips.length > 1)
  }, [matches, links])

  const set = (m: TipMatch, c: Id | null) => {
    setLinks((prev) => new Map(prev).set(m.node, c))
    setSaid(c === null ? `${tipName(m)} ${labels.leftUnlinked}.` : `${labels.accepted} ${tipName(m)} ${labels.linkedTo} ${nameOf(c)}.`)
  }
  const acceptAll = () => {
    if (!bulk.length) return
    setLinks((prev) => {
      const next = new Map(prev)
      for (const m of bulk) next.set(m.node, m.candidates[0]!.concept)
      return next
    })
    setSaid(`${labels.acceptedAll} ${bulk.length} ${bulk.length === 1 ? 'exact unique match' : 'exact unique matches'}.`)
  }
  const find = (m: TipMatch, text: string) => {
    if (!text.trim()) return
    const hits = [...new Set(dataset.findByName(text).map((h) => h.concept.id))]
    if (!hits.length) {
      setSaid(`${labels.findNone} “${text.trim()}”.`)
      return
    }
    setFound((prev) => new Map(prev).set(m.node, hits))
    setFinding(null)
    if (hits.length === 1) set(m, hits[0]!)
    else setSaid(`${hits.length} ${labels.findSeveral} “${text.trim()}”: choose one in the list for ${tipName(m)}.`)
  }
  const confirm = () => {
    if (!changed.length) return
    const ids = new Set(taken)
    for (const p of dataset.snapshot.phylogenies) ids.add(p.id)
    const next = linkedPhylogeny(dataset, phylogeny, new Map(changed), { id: freeId(`${record.id}-linked`, ids), version: version ?? new Date().toISOString().slice(0, 10) })
    onConfirm(next, changed.length)
  }

  const plural = (n: number) => `${n} ${n === 1 ? labels.tip : labels.tips}`
  const summary = `${plural(matches.length)}: ${counts.one} ${labels.matchesOne}, ${counts.several} ${labels.matchSeveral}, ${counts.none} ${labels.matchNone}.`
  const names = useMemo(() => [...new Set(dataset.snapshot.names.map((n) => n.name))].sort(), [dataset])

  return (
    <section className="ot-tip-links" aria-labelledby={`${listId}-title`}>
      <H id={`${listId}-title`} ref={heading} tabIndex={-1} className="ot-tip-links-title">
        {labels.title}: {record.title}
      </H>
      <p className="ot-hint">{labels.intro}</p>
      {dataset.snapshot.concepts.length === 0 && <p className="ot-notice ot-tip-links-empty">{labels.noConcepts}</p>}
      <p>{summary}</p>
      {/* Always mounted, so each decision is announced as it is made. */}
      <p className="ot-tip-links-status" role="status">
        {said}
      </p>
      <div className="ot-inspector-actions">
        <button type="button" disabled={!bulk.length} onClick={acceptAll}>
          {bulk.length ? `${labels.acceptAll} (${bulk.length})` : labels.acceptAllNone}
        </button>
      </div>
      {finding && (
        <datalist id={`${listId}-names`}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      )}
      <table className="ot-tip-links-table">
        <caption className="ot-sr-only">{labels.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.colTip}</th>
            <th scope="col">{labels.colMatch}</th>
            <th scope="col">{labels.colLink}</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const link = linkOf(m)
            const proposed = m.kind === 'unique' ? m.candidates[0]! : undefined
            const extra = (found.get(m.node) ?? []).filter((c) => !m.candidates.some((x) => x.concept === c))
            const others = [...new Set([...extra, ...m.current.filter((c) => !m.candidates.some((x) => x.concept === c)), ...(link && !m.candidates.some((x) => x.concept === link) ? [link] : [])])]
            return (
              <tr key={m.node} data-match={m.kind} data-linked={link ? '' : undefined}>
                <th scope="row">{tipName(m)}</th>
                <td>
                  {m.kind === 'none'
                    ? labels.summaryNone
                    : m.kind === 'unique'
                      ? `${labels.summaryOne}: ${conceptText(proposed!.concept, m)}${m.bulk ? '' : ` (${labels.checkFirst})`}`
                      : `${m.candidates.length} ${labels.summarySeveral}`}
                </td>
                <td>
                  <div className="ot-tip-links-choice">
                    <select
                      aria-label={`${labels.colLink}: ${tipName(m)}`}
                      value={link ?? ''}
                      onChange={(e) => {
                        if (e.target.value === '\u0000another') setFinding(m.node)
                        else set(m, e.target.value || null)
                      }}
                    >
                      <option value="">{labels.notLinked}</option>
                      {m.candidates.length > 0 && (
                        <optgroup label={labels.byName}>
                          {m.candidates.map((c) => (
                            <option key={c.concept} value={c.concept}>
                              {conceptText(c.concept, m)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {others.length > 0 && (
                        <optgroup label={labels.otherChoices}>
                          {others.map((c) => (
                            <option key={c} value={c}>
                              {conceptText(c)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <option value={'\u0000another'}>{labels.another}</option>
                    </select>
                    {proposed && link !== proposed.concept && (
                      <button type="button" aria-label={`${labels.accept} ${nameOf(proposed.concept)} for ${tipName(m)}`} onClick={() => set(m, proposed.concept)}>
                        {labels.accept}
                      </button>
                    )}
                  </div>
                  {finding === m.node && (
                    <div className="ot-tip-links-find">
                      <label htmlFor={`${listId}-find`}>
                        {labels.findLabel} {tipName(m)}
                      </label>
                      <input
                        id={`${listId}-find`}
                        ref={findInput}
                        list={`${listId}-names`}
                        aria-describedby={`${listId}-find-hint`}
                        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            find(m, e.currentTarget.value)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setFinding(null)
                          }
                        }}
                      />
                      <span id={`${listId}-find-hint`} className="ot-notice">
                        {labels.findHint}
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {shared.length > 0 && (
        <div className="ot-tip-links-shared" role="note">
          <p>
            <strong>{labels.sameConcept}</strong> {shared.map(([c, tips]) => `${nameOf(c)} (${tips.join(', ')})`).join('; ')}
          </p>
          <p className="ot-notice">{labels.sameConceptHint}</p>
        </div>
      )}
      <Sub className="ot-tip-links-subtitle">
        {labels.unlinkedHeading} ({unlinked.length})
      </Sub>
      {unlinked.length ? (
        <ul className="ot-tip-links-unlinked">
          {unlinked.map((m) => (
            <li key={m.node}>{tipName(m)}</li>
          ))}
        </ul>
      ) : (
        <p>{labels.noneUnlinked}</p>
      )}
      <div className="ot-inspector-actions">
        <button type="button" disabled={!changed.length} onClick={confirm}>
          {changed.length ? `${labels.confirm} (${changed.length})` : labels.confirmNone}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {labels.cancel}
          </button>
        )}
      </div>
    </section>
  )
}
