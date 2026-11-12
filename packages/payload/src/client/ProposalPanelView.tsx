import { useState } from 'react'

import type { ProposalPreview, ProposalStatus } from '../proposals.js'
import { ConfirmAction, count, Exact, Facts, Loading, Notice, OutcomeNotice, Panel, StatusLine, TextBox, When, type Act, type Loadable, type Outcome } from './ui.js'

export const PROPOSAL_STATUS: Record<ProposalStatus, { word: string; means: string }> = {
  private: { word: 'Private', means: 'Only its author sees it.' },
  shared: { word: 'Shared', means: 'Readers see it, and a manager can accept or decline it.' },
  accepted: { word: 'Accepted', means: 'It became a new staged snapshot version.' },
  declined: { word: 'Declined', means: 'Its author can revise it and share it again.' },
}

/** What a manager decided, as far as this person may see it. */
export type ProposalDecisionInfo = { note?: string | null; at?: string | null; snapshotHref?: string | null }

export type ProposalPanelViewProps = {
  preview: Loadable<ProposalPreview>
  decision: ProposalDecisionInfo
  /** Where the proposal's snapshot is in the admin. */
  snapshotHref: string | null
  /** Longest version name and note the site takes. */
  limits: { version: number; note: number }
  outcome: Outcome
  onAccept: Act<{ version: string; note: string; checksum: string }>
  onDecline: Act<{ note: string }>
  onRetry?: () => void
}

/** What a proposal would change, in names, and for a manager the buttons to accept or decline it. */
export function ProposalPanelView({ preview, decision, snapshotHref, limits, outcome, onAccept, onDecline, onRetry }: ProposalPanelViewProps) {
  const [version, setVersion] = useState('')
  const [acceptNote, setAcceptNote] = useState('')
  const [declineNote, setDeclineNote] = useState('')
  if (preview.state !== 'ready')
    return (
      <Panel title="Proposal">
        <Loading of={preview} what="the proposal’s preview" {...(onRetry ? { onRetry } : {})} />
        <OutcomeNotice outcome={outcome} />
      </Panel>
    )
  const p = preview.data
  const status = PROPOSAL_STATUS[p.proposal.status]
  const name = (id: string | null) =>
    id === null ? (
      'the top level'
    ) : p.labels[id] ? (
      <>
        {p.labels[id]} <Exact>{id}</Exact>
      </>
    ) : (
      <Exact>{id}</Exact>
    )
  const names = (ids: string[]) =>
    ids.map((id, i) => (
      <span key={id}>
        {i ? ', ' : ''}
        {name(id)}
      </span>
    ))
  const snapshotName = (
    <>
      <Exact>{p.snapshot.id}</Exact> version <Exact>{p.snapshot.version}</Exact>
    </>
  )
  const open = p.proposal.status === 'shared'
  return (
    <Panel title="Proposal">
      <StatusLine status={p.proposal.status} word={status.word}>
        {status.means}
      </StatusLine>
      <Facts
        items={[
          ['Title', p.proposal.title],
          [
            'Proposed by',
            p.proposal.authorName ? (
              <span key="a">
                {p.proposal.authorName} (<Exact>{p.proposal.author}</Exact>)
              </span>
            ) : (
              <Exact key="a">{p.proposal.author}</Exact>
            ),
          ],
          ['Made', <When key="w" at={p.proposal.created} />],
          ['Drawn over', snapshotHref ? <a href={snapshotHref}>{snapshotName}</a> : snapshotName],
          [
            p.proposal.base.kind === 'classification' ? 'Classification' : 'Phylogeny',
            <span key="b">
              <Exact>{p.proposal.base.id}</Exact> version <Exact>{p.proposal.base.version}</Exact>
            </span>,
          ],
          ['Checksum', <Exact key="c">{p.proposal.checksum}</Exact>],
          ['Decided', decision.at ? <When key="d" at={decision.at} /> : null],
          ['Manager’s note', decision.note || null],
          ['Accepted into', decision.snapshotHref ? <a href={decision.snapshotHref}>the snapshot version it made</a> : null],
        ]}
      />

      <div className="onetaxonomy-panel__block">
        <h4>{p.proposal.status === 'accepted' ? 'What it changed' : 'What it would change'}</h4>
        <p>
          {count(p.counts.moves, 'taxon moved', 'taxa moved')}, {count(p.counts.changedGroups, 'group changed', 'groups changed')}, {count(p.counts.broken, 'group gone', 'groups gone')},{' '}
          {count(p.counts.formed, 'new group')}.
        </p>
        {p.moved.length ? (
          <details className="onetaxonomy-details" open>
            <summary>Taxa with a new parent</summary>
            <ul className="onetaxonomy-list">
              {p.moved.map((m) => (
                <li key={m.node}>
                  {name(m.node)} moves from {name(m.from)} to {name(m.to)}.{m.note ? <div className="onetaxonomy-panel__hint">Author’s note: {m.note}</div> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {p.changedGroups.length ? (
          <details className="onetaxonomy-details">
            <summary>Groups that gain or lose members</summary>
            <ul className="onetaxonomy-list">
              {p.changedGroups.map((g) => (
                <li key={g.node}>
                  {name(g.node)}
                  {g.gained.length ? <div>Gains: {names(g.gained)}</div> : null}
                  {g.lost.length ? <div>Loses: {names(g.lost)}</div> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {(['broken', 'formed'] as const).map((kind) =>
          p[kind].length ? (
            <details className="onetaxonomy-details" key={kind}>
              <summary>{kind === 'broken' ? 'Groups the snapshot has and the proposal doesn’t' : 'Groups the proposal has and the snapshot doesn’t'}</summary>
              <ul className="onetaxonomy-list">
                {p[kind].map((g) => (
                  <li key={g.node}>
                    {name(g.node)}
                    {g.tips.length ? <div>Holds: {names(g.tips)}</div> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null,
        )}
        {p.truncated ? <p className="onetaxonomy-panel__hint">Long lists are cut short here. The counts are complete.</p> : null}
      </div>

      {open && !p.acceptable && p.notAcceptable ? <Notice kind="warning">It can’t be accepted as it stands. {p.notAcceptable}</Notice> : null}
      <OutcomeNotice outcome={outcome} />
      {p.mayDecide && open ? (
        <div className="onetaxonomy-actions">
          <ConfirmAction
            label="Accept this proposal"
            confirmLabel="Accept into a new version"
            disabledReason={p.acceptable ? null : (p.notAcceptable ?? 'It can’t be accepted as it stands.')}
            canConfirm={Boolean(version.trim())}
            question={
              <>
                Accept this proposal? It makes a new <strong>staged</strong> snapshot version with these changes. Nothing is published, and the snapshot it was drawn over stays as it is.
              </>
            }
            args={() => ({ version: version.trim(), note: acceptNote.trim(), checksum: p.proposal.checksum })}
            onConfirm={onAccept}
          >
            <Notice kind="warning">
              These are sealed into the new version and can’t be taken out later: the proposal’s title, its notes and move notes, your note, the date, and the ids of its author and of you. Check that none of it holds personal details.
            </Notice>
            <TextBox label="Name of the new version" hint={`For example the date, or the next number after ${p.snapshot.version}. It must differ from ${p.snapshot.version}.`} value={version} onChange={setVersion} required maxLength={limits.version} />
            <TextBox label="Your note" hint="Why you accepted it. It is sealed into the new version." value={acceptNote} onChange={setAcceptNote} maxLength={limits.note} multiline />
          </ConfirmAction>
          <ConfirmAction
            label="Decline this proposal"
            confirmLabel="Decline"
            danger
            question="Decline this proposal? Its author sees that it was declined, with your note. They can revise it and share it again."
            args={() => ({ note: declineNote.trim() })}
            onConfirm={onDecline}
          >
            <TextBox label="Your note" hint="Why you declined it. The author sees it." value={declineNote} onChange={setDeclineNote} maxLength={limits.note} multiline />
          </ConfirmAction>
        </div>
      ) : null}
    </Panel>
  )
}
