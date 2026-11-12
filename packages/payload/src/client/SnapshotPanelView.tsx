import type { SnapshotSummary } from '../summary.js'
import { ConfirmAction, count, Exact, Facts, Loading, Notice, OutcomeNotice, Panel, StatusLine, When, type Act, type Loadable, type Outcome } from './ui.js'

export type SnapshotStatus = SnapshotSummary['snapshot']['status']

export const SNAPSHOT_STATUS: Record<SnapshotStatus, { word: string; means: string }> = {
  staged: { word: 'Staged', means: 'Only managers see it. Check it, then publish it.' },
  published: { word: 'Published', means: 'Readers see it.' },
  withdrawn: { word: 'Withdrawn', means: 'Hidden from readers. It is kept for the views that pin it.' },
}

export type SnapshotPanelViewProps = {
  summary: Loadable<SnapshotSummary>
  /** Whether this person may publish and withdraw. The site checks again when they do. */
  canManage: boolean
  outcome: Outcome
  onSetStatus: Act<'published' | 'withdrawn'>
  onRetry?: () => void
}

/** A person as a snapshot records them: the name the site shows for them now when it gave one, then the sealed id. */
function Person({ id, name }: { id: string; name?: string }) {
  return name ? (
    <>
      {name} (<Exact>{id}</Exact>)
    </>
  ) : (
    <Exact>{id}</Exact>
  )
}

/** What a stored snapshot holds and where it came from, with the buttons to publish or withdraw it. */
export function SnapshotPanelView({ summary, canManage, outcome, onSetStatus, onRetry }: SnapshotPanelViewProps) {
  if (summary.state !== 'ready')
    return (
      <Panel title="Snapshot">
        <Loading of={summary} what="the snapshot’s summary" {...(onRetry ? { onRetry } : {})} />
      </Panel>
    )
  const s = summary.data
  const status = SNAPSHOT_STATUS[s.snapshot.status]
  const d = s.derivedFrom
  return (
    <Panel title="Snapshot">
      <StatusLine status={s.snapshot.status} word={status.word}>
        {status.means}
      </StatusLine>
      <Facts
        items={[
          ['Dataset', <Exact key="id">{s.snapshot.id}</Exact>],
          ['Version', <Exact key="v">{s.snapshot.version}</Exact>],
          ['Checksum', <Exact key="c">{s.snapshot.checksum}</Exact>],
          ['Sealed', <When key="w" at={s.snapshot.createdAt} />],
          ['Holds', [count(s.counts.names, 'name'), count(s.counts.concepts, 'concept'), count(s.counts.classifications, 'classification'), count(s.counts.phylogenies, 'phylogeny', 'phylogenies'), count(s.counts.sources, 'source')].join(', ')],
        ]}
      />

      {d ? (
        <div className="onetaxonomy-panel__block">
          <h4>Where it came from</h4>
          <p>
            Made from <Exact>{d.snapshot}</Exact> version <Exact>{d.version}</Exact>
            {d.selection ? (
              <>
                {' '}
                by selecting part of it (<Exact>{d.selection.id}</Exact> version <Exact>{d.selection.version}</Exact>)
              </>
            ) : null}
            {d.proposal ? ' by accepting a proposal' : ''}.
          </p>
          {d.proposal ? (
            <Facts
              items={[
                ['Proposal', d.proposal.title],
                ['Changed', `${count(d.proposal.moved, 'placement')} in classification ${d.proposal.classification.id}`],
                ['Proposed by', <Person key="a" id={d.proposal.author} {...(d.proposal.authorName ? { name: d.proposal.authorName } : {})} />],
                ['Accepted by', <Person key="b" id={d.proposal.acceptedBy} {...(d.proposal.acceptedByName ? { name: d.proposal.acceptedByName } : {})} />],
              ]}
            />
          ) : null}
          {d.proposal ? <p className="onetaxonomy-panel__hint">The ids are sealed in this snapshot. Names are looked up when this page loads and aren’t stored in it.</p> : null}
        </div>
      ) : null}

      {s.classifications.length ? (
        <div className="onetaxonomy-panel__block">
          <h4>Classifications</h4>
          <div className="onetaxonomy-scroll" tabIndex={0} role="group" aria-label="Classifications">
            <table className="onetaxonomy-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Version</th>
                  <th scope="col" className="onetaxonomy-num">
                    Placements
                  </th>
                  <th scope="col" className="onetaxonomy-num">
                    Top-level taxa
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.classifications.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{c.title}</th>
                    <td>
                      <Exact>{c.version}</Exact>
                    </td>
                    <td className="onetaxonomy-num">{c.placements.toLocaleString('en')}</td>
                    <td className="onetaxonomy-num">{c.roots.toLocaleString('en')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {s.phylogenies.length ? (
        <div className="onetaxonomy-panel__block">
          <h4>Phylogenies</h4>
          <div className="onetaxonomy-scroll" tabIndex={0} role="group" aria-label="Phylogenies">
            <table className="onetaxonomy-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Version</th>
                  <th scope="col">Rooted</th>
                  <th scope="col" className="onetaxonomy-num">
                    Nodes
                  </th>
                  <th scope="col" className="onetaxonomy-num">
                    Tips
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.phylogenies.map((y) => (
                  <tr key={y.id}>
                    <th scope="row">{y.title}</th>
                    <td>
                      <Exact>{y.version}</Exact>
                    </td>
                    <td>{y.rooted ? 'Rooted' : 'Unrooted'}</td>
                    <td className="onetaxonomy-num">{y.nodes.toLocaleString('en')}</td>
                    <td className="onetaxonomy-num">{y.tips.toLocaleString('en')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {s.sources.length ? (
        <div className="onetaxonomy-panel__block">
          <h4>Sources</h4>
          <ul className="onetaxonomy-list">
            {s.sources.map((x) => (
              <li key={x.id}>
                <strong>{x.title}</strong>
                {x.illustrative ? <> <span className="onetaxonomy-tag">Made-up example data</span></> : null}
                {x.citation ? <div>{x.citation}</div> : null}
                <div className="onetaxonomy-panel__hint">
                  {[x.license ? `License: ${x.license}` : 'No license recorded', x.externalVersion ? `version ${x.externalVersion}` : ''].filter(Boolean).join(', ')}
                  {x.retrievedAt ? (
                    <>
                      {', retrieved '}
                      <When at={x.retrievedAt} />
                    </>
                  ) : null}
                  {x.url && /^https?:\/\//i.test(x.url) ? (
                    <>
                      {', '}
                      <a href={x.url} rel="noopener noreferrer">
                        {x.url}
                      </a>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {s.truncated ? <p className="onetaxonomy-panel__hint">The lists here are cut short. The counts above are complete.</p> : null}

      <OutcomeNotice outcome={outcome} />
      {canManage && s.snapshot.status === 'staged' ? (
        <ConfirmAction
          label="Publish this snapshot"
          confirmLabel="Publish"
          question="Publish this snapshot? Readers will see it. A published snapshot can be withdrawn later, but it can’t be deleted or go back to staged."
          args={() => 'published' as const}
          onConfirm={onSetStatus}
        />
      ) : null}
      {canManage && s.snapshot.status === 'published' ? (
        <ConfirmAction
          label="Withdraw this snapshot"
          confirmLabel="Withdraw"
          danger
          question="Withdraw this snapshot? Readers will no longer see it. Published views of it stay readable and say their source was withdrawn. A withdrawn snapshot can’t be published again."
          args={() => 'withdrawn' as const}
          onConfirm={onSetStatus}
        />
      ) : null}
      {s.snapshot.status === 'withdrawn' ? <Notice>This snapshot was withdrawn. That can’t be undone: store a new version instead.</Notice> : null}
    </Panel>
  )
}
