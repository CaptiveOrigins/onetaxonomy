'use client'

import type { DatasetIndex, Id, NameStatus, Phylogeny, PhyloNode } from '@captiveorigins/onetaxonomy-core'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { nearNameMatches, type NearMatch } from './nearNames.js'

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
  /**
   * Only when nothing matches exactly: taxa whose names are close (`nearNameMatches`). Shown apart
   * as "Possible matches", labelled as not exact, and never taken by "Accept all exact unique matches".
   */
  possible: NearMatch[]
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
      return {
        node: n.id,
        label,
        current: [...(n.concepts ?? [])],
        candidates,
        kind,
        bulk: kind === 'unique' && BULK_STATUSES.includes(candidates[0]!.status),
        possible: kind === 'none' && label ? nearNameMatches(dataset, label) : [],
      }
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
 * concept was one its label matched by name, one it came close to (with the name and the rule),
 * or one the person chose. Throws when a link names an unknown concept or node.
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
      const near = concept !== null && n.label && !byName ? nearNameMatches(dataset, n.label).find((x) => x.concept === concept) : undefined
      const label = n.label ? { label: n.label } : {}
      const conceptLink =
        concept === null
          ? { basis: 'unlinked-by-person' }
          : near
            ? { basis: 'near-name-confirmed', ...label, name: near.name, rule: near.rule, ...(near.dropped ? { dropped: near.dropped } : {}) }
            : { basis: byName ? 'exact-name-confirmed' : 'chosen-by-person', ...label }
      return { ...rest, ...(concept === null ? {} : { concepts: [concept] }), annotations: { ...n.annotations, conceptLink } }
    }),
  }
}

export type TipLinkLabels = Record<
  | 'title' | 'intro' | 'noConcepts' | 'tip' | 'tips' | 'tableCaption' | 'colTip' | 'colMatch' | 'colLink'
  | 'matchesOne' | 'matchSeveral' | 'matchNone' | 'summaryOne' | 'summarySeveral' | 'summaryNone'
  | 'notLinked' | 'keep' | 'another' | 'findLabel' | 'findHint' | 'findNone' | 'findSeveral' | 'accept' | 'acceptAll' | 'acceptAllNone' | 'accepted' | 'acceptedAll'
  | 'linkedTo' | 'leftUnlinked' | 'byName' | 'otherChoices' | 'asStatus' | 'unlinkedHeading' | 'noneUnlinked' | 'sameConcept' | 'sameConceptHint'
  | 'confirm' | 'confirmNone' | 'cancel' | 'unnamedTip' | 'checkFirst'
  | 'possibleHeading' | 'possibleIntro' | 'possibleGroup' | 'possibleBelow' | 'possibleLink' | 'notExact' | 'ruleSpelling' | 'ruleCode' | 'ruleOneEdit'
  | 'listLabel' | 'listAll' | 'listNone' | 'listPossible' | 'listSeveral' | 'listOne' | 'previous' | 'next' | 'showing' | 'of',
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
  possibleHeading: 'Possible matches, not exact',
  possibleIntro: 'These tips’ names match no taxon exactly, but come close to one. Check each before linking: none is linked unless you choose it, and Accept all never takes them.',
  possibleGroup: 'Possible matches (not exact)',
  possibleBelow: 'possible match listed under Possible matches',
  possibleLink: 'Link',
  notExact: 'not exact',
  ruleSpelling: 'same name apart from underscores, spacing or letter case',
  ruleCode: 'same name with the specimen code left off:',
  ruleOneEdit: 'one letter different',
  listLabel: 'List tips',
  listAll: 'All',
  listNone: 'No exact match',
  listPossible: 'With a possible match',
  listSeveral: 'Several matches',
  listOne: 'One exact match',
  previous: 'Previous',
  next: 'Next',
  showing: 'Tips',
  of: 'of',
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
  /** Rows per page. Above this many tips the table is paged and can be narrowed to one kind of match. Default 200. */
  pageSize?: number
}

type ListFilter = 'all' | 'none' | 'possible' | 'ambiguous' | 'unique'
const LIST_FILTERS: { value: ListFilter; label: 'listAll' | 'listNone' | 'listPossible' | 'listSeveral' | 'listOne'; keep: (m: TipMatch) => boolean }[] = [
  { value: 'all', label: 'listAll', keep: () => true },
  { value: 'none', label: 'listNone', keep: (m) => m.kind === 'none' },
  { value: 'possible', label: 'listPossible', keep: (m) => m.possible.length > 0 },
  { value: 'ambiguous', label: 'listSeveral', keep: (m) => m.kind === 'ambiguous' },
  { value: 'unique', label: 'listOne', keep: (m) => m.kind === 'unique' },
]

/**
 * The step where a person confirms tip-to-taxon links. Proposals come from exact names
 * (`proposeTipLinks`) and are shown, never applied: each tip is accepted, changed to another
 * taxon, or left unlinked, and unlinked tips are listed. "Accept all exact unique matches"
 * is one explicit action that says how many it takes. Confirming hands a new record to
 * `onConfirm`. Focus moves to the title on opening; every change is said in a status region.
 */
export function TipLinker({ dataset, phylogeny, onConfirm, onCancel, taken = [], labels: custom, headingLevel = 2, version, pageSize = 200 }: TipLinkerProps) {
  const labels = { ...TIP_LINK_LABELS, ...custom }
  const record = dataset.phylogeny(phylogeny).phylogeny
  const matches = useMemo(() => proposeTipLinks(dataset, phylogeny), [dataset, phylogeny])
  const [links, setLinks] = useState<Map<Id, Id | null>>(() => new Map())
  // Concepts found with "Another taxon…", per tip, offered in its list.
  const [found, setFound] = useState<Map<Id, Id[]>>(() => new Map())
  const [finding, setFinding] = useState<Id | null>(null)
  const [said, setSaid] = useState('')
  // Long trees: which kind of match to list, and which page. Filters are by match kind, which linking doesn't change, so rows don't vanish as they are linked.
  const [filter, setFilter] = useState<ListFilter>('all')
  const [page, setPage] = useState(0)
  const previousButton = useRef<HTMLButtonElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
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
  const conceptText = (c: Id, m?: TipMatch, near?: NearMatch) => {
    const concept = dataset.concept.get(c)
    const authorship = concept ? dataset.name.get(concept.acceptedName)?.authorship : undefined
    const status = near ? near.status : m?.candidates.find((x) => x.concept === c)?.status
    const parts = [
      `${nameOf(c)}${authorship ? ` ${authorship}` : ''}`,
      concept?.rank,
      status && status !== 'accepted' ? `${near ? near.name : m!.label} ${labels.asStatus} ${status}` : undefined,
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
    const near = c !== null && m.possible.some((x) => x.concept === c) ? ` (${labels.notExact})` : ''
    setSaid(c === null ? `${tipName(m)} ${labels.leftUnlinked}.` : `${labels.accepted} ${tipName(m)} ${labels.linkedTo} ${nameOf(c)}${near}.`)
  }
  const why = (x: NearMatch) =>
    x.rule === 'spelling' ? labels.ruleSpelling : x.rule === 'specimen-code' ? `${labels.ruleCode} “${x.dropped}”` : `${labels.ruleOneEdit}${x.dropped ? `, and “${x.dropped}” left off` : ''}`
  const possibles = matches.filter((m) => m.possible.length > 0)
  const paged = matches.length > pageSize
  const listed = paged ? matches.filter(LIST_FILTERS.find((f) => f.value === filter)!.keep) : matches
  const pages = Math.max(1, Math.ceil(listed.length / pageSize))
  const at = Math.min(page, pages - 1)
  const rows = paged ? listed.slice(at * pageSize, (at + 1) * pageSize) : matches
  const turn = (to: number) => {
    setPage(to)
    // A button that becomes disabled would drop focus: hand it to the other one.
    if (to === 0) nextButton.current?.focus()
    else if (to === pages - 1) previousButton.current?.focus()
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
      {paged && (
        <div className="ot-tip-links-pager">
          <label>
            {labels.listLabel}{' '}
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as ListFilter)
                setPage(0)
              }}
            >
              {LIST_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {labels[f.label]} ({matches.filter(f.keep).length})
                </option>
              ))}
            </select>
          </label>
          <button ref={previousButton} type="button" disabled={at === 0} onClick={() => turn(at - 1)}>
            {labels.previous}
          </button>
          <button ref={nextButton} type="button" disabled={at >= pages - 1} onClick={() => turn(at + 1)}>
            {labels.next}
          </button>
          {/* Said when the page or the filter changes. */}
          <p className="ot-tip-links-range" role="status">
            {listed.length ? `${labels.showing} ${at * pageSize + 1}–${Math.min((at + 1) * pageSize, listed.length)} ${labels.of} ${listed.length}` : `${labels.showing}: 0`}
          </p>
        </div>
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
          {rows.map((m) => {
            const link = linkOf(m)
            const proposed = m.kind === 'unique' ? m.candidates[0]! : undefined
            const extra = (found.get(m.node) ?? []).filter((c) => !m.candidates.some((x) => x.concept === c))
            const near = (c: Id) => m.possible.some((x) => x.concept === c)
            const others = [...new Set([...extra, ...m.current.filter((c) => !m.candidates.some((x) => x.concept === c)), ...(link && !m.candidates.some((x) => x.concept === link) ? [link] : [])])].filter((c) => !near(c))
            return (
              <tr key={m.node} data-match={m.kind} data-linked={link ? '' : undefined}>
                <th scope="row">{tipName(m)}</th>
                <td>
                  {m.kind === 'none'
                    ? `${labels.summaryNone}${m.possible.length ? `; ${m.possible.length} ${labels.possibleBelow}` : ''}`
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
                      {m.possible.length > 0 && (
                        <optgroup label={labels.possibleGroup}>
                          {m.possible.map((x) => (
                            <option key={x.concept} value={x.concept}>
                              {conceptText(x.concept, m, x)} ({labels.notExact})
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
      {possibles.length > 0 && (
        <section className="ot-tip-links-possible" aria-labelledby={`${listId}-possible`}>
          <Sub id={`${listId}-possible`} className="ot-tip-links-subtitle">
            {labels.possibleHeading} ({possibles.length})
          </Sub>
          <p className="ot-hint">{labels.possibleIntro}</p>
          <ul>
            {possibles.flatMap((m) =>
              m.possible.map((x) => {
                const linked = linkOf(m) === x.concept
                return (
                  <li key={`${m.node} ${x.concept}`} data-rule={x.rule}>
                    <span>
                      <strong>{tipName(m)}</strong> → {conceptText(x.concept, m, x)} ({labels.notExact}: {why(x)}){linked ? `. ${labels.accepted}.` : ''}
                    </span>{' '}
                    <button type="button" aria-pressed={linked} aria-label={`${labels.possibleLink} ${tipName(m)} ${labels.linkedTo} ${nameOf(x.concept)} (${labels.notExact})`} onClick={() => set(m, linked ? null : x.concept)}>
                      {labels.possibleLink}
                    </button>
                  </li>
                )
              }),
            )}
          </ul>
        </section>
      )}
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
