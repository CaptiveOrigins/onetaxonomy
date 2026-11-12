import type { Highlight, LayoutKind } from '@captiveorigins/onetaxonomy-core'
import { layoutFor, TreeOutline, TreeView, treeViewBox } from '@captiveorigins/onetaxonomy-react'

import type { ProjectionBody, ViewSource } from '../views-api.js'
import { SNAPSHOT_STATUS } from './SnapshotPanelView.js'
import { ConfirmAction, Exact, Loading, Notice, OutcomeNotice, Panel, StatusLine, type Act, type Loadable, type Outcome } from './ui.js'

export type ViewStatus = 'draft' | 'published' | 'withdrawn'

/** The saved view, as the panel needs it. `layout` and `highlights` are null when the stored view has none it can read. */
export type SavedView = { title: string; status: ViewStatus; source: ViewSource | null; layout: LayoutKind | null; highlights: Highlight[] }

export const VIEW_STATUS: Record<ViewStatus, { word: string; means: string }> = {
  draft: { word: 'Draft', means: 'Only managers see it. Check it, then publish it.' },
  published: { word: 'Published', means: 'Readers see it.' },
  withdrawn: { word: 'Withdrawn', means: 'Hidden from readers.' },
}

export type ViewPanelViewProps = {
  view: Loadable<SavedView>
  /** The saved view drawn over its snapshot, cut to a preview's size. */
  preview: Loadable<ProjectionBody>
  canManage: boolean
  /** True while the form has changes that aren't saved: publishing would publish the saved view, not what is on the page. */
  unsaved: boolean
  /** Where this view's snapshot is in the admin, when it has one. */
  snapshotHref: string | null
  outcome: Outcome
  onSetStatus: Act<'published' | 'withdrawn'>
  onRetry?: () => void
}

/** Why a draft can't be published now, or null when it can. The site checks the same things when it is asked to. */
export function whyNotPublishable(view: SavedView, unsaved: boolean): string | null {
  if (unsaved) return 'Save your changes first.'
  if (!view.source) return 'Its snapshot no longer exists.'
  if (view.source.status === 'withdrawn') return 'Its snapshot was withdrawn, so this view can’t be published.'
  if (view.source.status !== 'published') return 'Publish its snapshot first.'
  return null
}

/** A saved view's status, the snapshot it is shown over, a small drawing of it, and the buttons to publish or withdraw it. */
export function ViewPanelView({ view, preview, canManage, unsaved, snapshotHref, outcome, onSetStatus, onRetry }: ViewPanelViewProps) {
  if (view.state !== 'ready')
    return (
      <Panel title="View">
        <Loading of={view} what="the view" {...(onRetry ? { onRetry } : {})} />
      </Panel>
    )
  const v = view.data
  const status = VIEW_STATUS[v.status]
  const source = v.source
  const sourceName = source ? (
    <>
      <Exact>{source.id}</Exact> version <Exact>{source.version}</Exact>
    </>
  ) : null
  return (
    <Panel title="View">
      <StatusLine status={v.status} word={status.word}>
        {status.means}
      </StatusLine>
      {source ? (
        <p>
          Shown over the snapshot {snapshotHref ? <a href={snapshotHref}>{sourceName}</a> : sourceName}, which is {SNAPSHOT_STATUS[source.status].word.toLowerCase()}.
        </p>
      ) : (
        <Notice kind="warning">This view’s snapshot no longer exists, or you may not see it. The view can’t be drawn or published.</Notice>
      )}
      {source?.withdrawn && v.status === 'published' ? <Notice kind="warning">Its snapshot was withdrawn after this view was published. Readers still see the view, with a notice saying so.</Notice> : null}

      {source ? (
        <div className="onetaxonomy-panel__block">
          <h4>Preview of the saved view</h4>
          {preview.state !== 'ready' ? <Loading of={preview} what="the preview" /> : <Preview body={preview.data} view={v} />}
        </div>
      ) : null}

      <OutcomeNotice outcome={outcome} />
      {canManage && v.status === 'draft' ? (
        <ConfirmAction
          label="Publish this view"
          confirmLabel="Publish"
          disabledReason={whyNotPublishable(v, unsaved)}
          question="Publish this view? Readers will see it. A published view can’t be edited: to change it, save a new view."
          args={() => 'published' as const}
          onConfirm={onSetStatus}
        />
      ) : null}
      {canManage && v.status === 'published' ? (
        <ConfirmAction
          label="Withdraw this view"
          confirmLabel="Withdraw"
          danger
          question="Withdraw this view? Readers will no longer see it. A withdrawn view can’t be published again."
          args={() => 'withdrawn' as const}
          onConfirm={onSetStatus}
        />
      ) : null}
    </Panel>
  )
}

function Preview({ body, view }: { body: ProjectionBody; view: SavedView }) {
  const { projection, disclosure } = body
  if (!projection.nodes.length) return <p>This view draws nothing: every node is hidden or filtered out.</p>
  const layout = layoutFor(projection, view.layout ?? 'rectangular')
  return (
    <>
      {/* The drawing can be wider than the page, so its box scrolls and takes the keyboard focus to do it. A small tree
          is drawn at its own size, one layout unit to a pixel, and not blown up to the width of the box. */}
      <div className="onetaxonomy-figure" role="group" aria-label={`Drawing of ${view.title}`} tabIndex={0} style={{ ['--otp-widest' as string]: `${Math.round(treeViewBox(layout).width)}px` }}>
        <TreeView projection={projection} layout={layout} highlights={view.highlights} title={view.title} renderer="svg" />
      </div>
      {projection.truncated ? (
        <p className="onetaxonomy-panel__hint">This preview stops at {projection.nodes.length.toLocaleString('en')} nodes. The view itself has more.</p>
      ) : null}
      <details className="onetaxonomy-details">
        <summary>The same tree as an outline</summary>
        <TreeOutline projection={projection} label={view.title} />
      </details>
      {disclosure.lines.length ? (
        <details className="onetaxonomy-details" open>
          <summary>What readers are told about it</summary>
          <ul className="onetaxonomy-list">
            {disclosure.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  )
}
