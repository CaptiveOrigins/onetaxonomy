// @vitest-environment jsdom
// The admin panels as a person meets them: what each one shows for each state, which buttons it offers to whom, and
// how the in-page confirm behaves with a keyboard. These render the plain views with made-up data and no site behind
// them. No browser and no screen reader was run: they check the markup, the focus and what the buttons call.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createView, describeView, indexDataset, projectView, type DatasetSnapshot } from '@extantape/onetaxonomy-core'

import amniotes from '../../../fixtures/amniotes.json'
import type { ProposalPreview } from '../src/proposals.js'
import type { SnapshotSummary } from '../src/summary.js'
import type { ProjectionBody, ViewSource } from '../src/views-api.js'
import { reasonIn, reasonOf, request, RequestError } from '../src/client/http.js'
import { ImportPanelView, isStale, stepStates, type ImportJob, type ImportPanelViewProps } from '../src/client/ImportPanelView.js'
import { ProposalPanelView, type ProposalPanelViewProps } from '../src/client/ProposalPanelView.js'
import { SnapshotPanelView, type SnapshotPanelViewProps } from '../src/client/SnapshotPanelView.js'
import { ViewPanelView, whyNotPublishable, type SavedView, type ViewPanelViewProps } from '../src/client/ViewPanelView.js'
import { ConfirmAction, Facts, Loading, OutcomeNotice, When } from '../src/client/ui.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ready = <T,>(data: T) => ({ state: 'ready', data }) as const
const yes = async () => true
const button = (name: string | RegExp) => screen.getByRole('button', { name })
const noButton = (name: string | RegExp) => expect(screen.queryByRole('button', { name })).toBeNull()

describe('asking before acting', () => {
  const setup = (onConfirm: () => Promise<boolean>, extra: { disabledReason?: string; canConfirm?: boolean } = {}) =>
    render(<ConfirmAction label="Publish this" confirmLabel="Publish" question="Publish it?" onConfirm={onConfirm} {...extra} />)

  it('does nothing until the person confirms in the page', () => {
    const act = vi.fn(yes)
    setup(act)
    fireEvent.click(button('Publish this'))
    expect(act).not.toHaveBeenCalled()
    const box = screen.getByRole('group', { name: 'Publish it?' })
    expect(document.activeElement).toBe(box)
    expect(within(box).getByRole('button', { name: 'Publish' })).toBeTruthy()
    expect(within(box).getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('closes on Escape and on Cancel, and puts the focus back on the button', () => {
    const act = vi.fn(yes)
    setup(act)
    fireEvent.click(button('Publish this'))
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' })
    expect(screen.queryByRole('group')).toBeNull()
    expect(document.activeElement).toBe(button('Publish this'))

    fireEvent.click(button('Publish this'))
    fireEvent.click(button('Cancel'))
    expect(document.activeElement).toBe(button('Publish this'))
    expect(act).not.toHaveBeenCalled()
  })

  it('makes both buttons wait while it works, and ignores Escape meanwhile', async () => {
    let finish!: (worked: boolean) => void
    const act = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    setup(act)
    fireEvent.click(button('Publish this'))
    fireEvent.click(button('Publish'))
    expect(act).toHaveBeenCalledTimes(1)
    expect((button('Working…') as HTMLButtonElement).disabled).toBe(true)
    expect((button('Cancel') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' })
    expect(screen.getByRole('group')).toBeTruthy()
    finish(true)
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull())
  })

  it('stays open when the action fails, so it can be tried again or cancelled', async () => {
    const act = vi.fn(async () => false)
    setup(act)
    fireEvent.click(button('Publish this'))
    fireEvent.click(button('Publish'))
    await waitFor(() => expect((button('Publish') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('group', { name: 'Publish it?' })).toBeTruthy()
    fireEvent.click(button('Publish'))
    await waitFor(() => expect(act).toHaveBeenCalledTimes(2))
  })

  it('stays open and usable when the action throws', async () => {
    const act = vi.fn(async () => {
      throw new Error('no')
    })
    setup(act)
    fireEvent.click(button('Publish this'))
    // The rejection is the caller's to report; the confirm only has to stop waiting.
    const unhandled = vi.fn()
    process.once('unhandledRejection', unhandled)
    fireEvent.click(button('Publish'))
    await waitFor(() => expect((button('Publish') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('group')).toBeTruthy()
    process.off('unhandledRejection', unhandled)
  })

  it('says why a button can’t be used, tied to the button for a screen reader', () => {
    setup(vi.fn(yes), { disabledReason: 'Save your changes first.' })
    const b = button('Publish this') as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(document.getElementById(b.getAttribute('aria-describedby')!)!.textContent).toBe('Save your changes first.')
  })

  it('holds the confirming button until what must be filled in is there', () => {
    setup(vi.fn(yes), { canConfirm: false })
    fireEvent.click(button('Publish this'))
    expect((button('Publish') as HTMLButtonElement).disabled).toBe(true)
    expect((button('Cancel') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('small pieces', () => {
  it('announces a problem at once, and moves the focus to a success', () => {
    const { rerender } = render(<OutcomeNotice outcome={{ kind: 'error', message: 'Nothing was changed.' }} />)
    expect(screen.getByRole('alert').textContent).toBe('Problem: Nothing was changed.')
    rerender(<OutcomeNotice outcome={{ kind: 'success', message: 'It is published.', link: { href: '/admin/x', label: 'Open it' } }} />)
    const done = screen.getByRole('status')
    expect(done.textContent).toBe('Done: It is published. Open it')
    expect(document.activeElement).toBe(done)
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe('/admin/x')
    rerender(<OutcomeNotice outcome={null} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says what is loading, and offers to try again when it couldn’t be loaded', () => {
    const retry = vi.fn()
    const { rerender } = render(<Loading of={{ state: 'loading' }} what="the snapshot’s summary" onRetry={retry} />)
    expect(screen.getByRole('status').textContent).toBe('Loading the snapshot’s summary…')
    rerender(<Loading of={{ state: 'error', message: 'This wasn’t found, or you may not see it.' }} what="the snapshot’s summary" onRetry={retry} />)
    expect(document.body.textContent).toContain('Problem: The snapshot’s summary couldn’t be loaded. This wasn’t found, or you may not see it.')
    fireEvent.click(button('Try again'))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('leaves out facts with nothing to say, and shows text that isn’t a date as it is', () => {
    render(
      <>
        <Facts items={[['Shown', 'yes'], ['Empty', ''], ['Missing', null], ['Zero', 0]]} />
        <When at="2026-11-11T12:00:00.000Z" />
        <When at="not a date" />
      </>,
    )
    expect([...document.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Shown', 'Zero'])
    expect(document.querySelector('time')!.getAttribute('datetime')).toBe('2026-11-11T12:00:00.000Z')
    expect(document.body.textContent).toContain('not a date')
  })
})

describe('requests to the site', () => {
  const answer = (status: number, body?: unknown) => new Response(body === undefined ? 'not json' : JSON.stringify(body), { status })

  it('reads the reason from the plugin’s and from Payload’s error answers', () => {
    expect(reasonIn({ error: 'Not found.' })).toBe('Not found.')
    expect(reasonIn({ errors: [{ message: 'The following field is invalid: status' }, { message: 'And another.' }, {}] })).toBe('The following field is invalid: status And another.')
    expect(reasonIn({ message: 'Plain.' })).toBe('Plain.')
    for (const nothing of [null, 'text', {}, { error: '' }, { errors: [] }, { errors: [{}] }]) expect(reasonIn(nothing)).toBeNull()
    expect(reasonOf(new Error('Why.'))).toBe('Why.')
    expect(reasonOf('thrown text')).toBe('Something went wrong, and nothing more is known.')
  })

  it('sends the signed-in person’s cookie and a JSON body, and answers the JSON', async () => {
    const fetched = vi.fn(async (_url: string, _init: RequestInit) => answer(200, { ok: 1 }))
    vi.stubGlobal('fetch', fetched)
    expect(await request('/api/x/1', { method: 'PATCH', body: { status: 'published' } })).toEqual({ ok: 1 })
    const [url, init] = fetched.mock.calls[0]!
    expect(url).toBe('/api/x/1')
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'include', body: '{"status":"published"}' })
    expect(init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' })

    await request('/api/x/1')
    const [, plain] = fetched.mock.calls[1]!
    expect(plain.method).toBe('GET')
    expect(plain.body).toBeUndefined()
    expect(plain.headers).toEqual({ Accept: 'application/json' })
  })

  it('throws the site’s own reason for anything but success, and plain words when it gave none', async () => {
    const cases: [Response, string, number][] = [
      [answer(409, { error: 'Someone else decided this.' }), 'Someone else decided this.', 409],
      [answer(403, { errors: [{ message: 'You are not allowed to perform this action.' }] }), 'You are not allowed to perform this action.', 403],
      [answer(401), 'Sign in again to do this.', 401],
      [answer(403), "You aren't allowed to do this.", 403],
      [answer(404, {}), "This wasn't found, or you may not see it.", 404],
      [answer(500), 'The request failed (500).', 500],
    ]
    for (const [res, message, status] of cases) {
      vi.stubGlobal('fetch', async () => res)
      const error = await request('/api/x').then(
        () => null,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(RequestError)
      expect([(error as RequestError).message, (error as RequestError).status]).toEqual([message, status])
    }
  })

  it('says the site couldn’t be reached when it couldn’t, and lets a cancelled request stay cancelled', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(request('/api/x')).rejects.toMatchObject({ name: 'RequestError', status: 0, message: "The site couldn't be reached. Check your connection and try again." })
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('Aborted', 'AbortError')
    })
    await expect(request('/api/x')).rejects.toMatchObject({ name: 'AbortError' })
  })
})

const summary = (over: Partial<SnapshotSummary> = {}, status: SnapshotSummary['snapshot']['status'] = 'staged'): SnapshotSummary => ({
  snapshot: { doc: 'doc1', id: 'fixture-amniotes', version: '1', checksum: 'sha256:abc', status, createdAt: '2026-11-01T00:00:00.000Z' },
  counts: { names: 8, concepts: 8, classifications: 1, phylogenies: 2, sources: 1 },
  sources: [{ id: 'fixture', title: 'Example source', citation: 'Made up for tests.', license: 'CC0-1.0', url: 'https://example.org/data', illustrative: true }],
  classifications: [{ id: 'traditional', title: 'Traditional classes', version: '1', placements: 7, roots: 1 }],
  phylogenies: [{ id: 'archelosauria', title: 'Turtles with archosaurs', version: '1', rooted: true, nodes: 11, tips: 6 }],
  truncated: false,
  ...over,
})

describe('snapshot panel', () => {
  const show = (props: Partial<SnapshotPanelViewProps> = {}) => render(<SnapshotPanelView summary={ready(summary())} canManage outcome={null} onSetStatus={yes} {...props} />)

  it('says the status in words and what the snapshot holds', () => {
    show()
    const panel = screen.getByRole('region', { name: 'Snapshot' })
    expect(panel.querySelector('.onetaxonomy-status')!.textContent).toBe('Staged')
    expect(panel.textContent).toContain('Only managers see it. Check it, then publish it.')
    expect(panel.textContent).toContain('8 names, 8 concepts, 1 classification, 2 phylogenies, 1 source')
    expect(within(screen.getByRole('group', { name: 'Classifications' })).getByRole('rowheader', { name: 'Traditional classes' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Phylogenies' })).getByRole('row', { name: /Turtles with archosaurs 1 Rooted 11 6/ })).toBeTruthy()
    expect(panel.textContent).toContain('Made-up example data')
    expect(panel.textContent).toContain('License: CC0-1.0')
  })

  it('offers a manager only the next step for each status', () => {
    show()
    expect(button('Publish this snapshot')).toBeTruthy()
    noButton('Withdraw this snapshot')
    cleanup()
    show({ summary: ready(summary({}, 'published')) })
    expect(button('Withdraw this snapshot')).toBeTruthy()
    noButton('Publish this snapshot')
    cleanup()
    show({ summary: ready(summary({}, 'withdrawn')) })
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(document.body.textContent).toContain('This snapshot was withdrawn. That can’t be undone: store a new version instead.')
  })

  it('offers no buttons to someone who may not manage', () => {
    for (const status of ['staged', 'published'] as const) {
      show({ summary: ready(summary({}, status)), canManage: false })
      expect(screen.queryAllByRole('button')).toEqual([])
      cleanup()
    }
  })

  it('publishes and withdraws only after the confirm, and says what each can’t undo', async () => {
    const set = vi.fn(yes)
    show({ onSetStatus: set })
    fireEvent.click(button('Publish this snapshot'))
    expect(screen.getByRole('group', { name: /Publish this snapshot\?/ }).textContent).toContain('it can’t be deleted or go back to staged')
    expect(set).not.toHaveBeenCalled()
    fireEvent.click(button('Publish'))
    await waitFor(() => expect(set).toHaveBeenCalledWith('published'))
    cleanup()
    show({ summary: ready(summary({}, 'published')), onSetStatus: set })
    fireEvent.click(button('Withdraw this snapshot'))
    expect(screen.getByRole('group', { name: /Withdraw this snapshot\?/ }).textContent).toContain('A withdrawn snapshot can’t be published again.')
    fireEvent.click(button('Withdraw'))
    await waitFor(() => expect(set).toHaveBeenLastCalledWith('withdrawn'))
  })

  it('shows an accepted proposal’s people by sealed id, with a name only when the site gave one', () => {
    const proposal = { id: 'p1', title: 'Move turtles', author: 'person-17', authorName: 'Ada Example', acceptedBy: 'person-2', classification: { id: 'traditional', version: '1' }, moved: 1 }
    show({ summary: ready(summary({ derivedFrom: { snapshot: 'fixture-amniotes', version: '1', proposal } })) })
    const text = document.body.textContent!
    expect(text).toContain('Made from fixture-amniotes version 1 by accepting a proposal.')
    expect(text).toContain('Proposed byAda Example (person-17)')
    expect(text).toContain('Accepted byperson-2')
    expect(text).toContain('The ids are sealed in this snapshot. Names are looked up when this page loads and aren’t stored in it.')
  })

  it('links a source only when its address is a web address', () => {
    const source = summary().sources[0]!
    show({ summary: ready(summary({ sources: [source, { ...source, id: 'b', title: 'Odd source', url: 'javascript:alert(1)' }] })) })
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['https://example.org/data'])
  })

  it('shows when a source was retrieved: a moment in the reader\'s format, a bare day as written', () => {
    const source = summary().sources[0]!
    show({ summary: ready(summary({ sources: [{ ...source, retrievedAt: '2026-11-12T00:52:05.878Z' }, { ...source, id: 'b', title: 'Day only', retrievedAt: '2026-11-01' }, { ...source, id: 'c', title: 'Not a date', retrievedAt: 'spring 2026' }] })) })
    const [moment, day, odd] = [...document.querySelectorAll('.onetaxonomy-list li')].map((li) => li as HTMLElement)
    expect(moment!.querySelector('time')!.getAttribute('datetime')).toBe('2026-11-12T00:52:05.878Z')
    expect(moment!.textContent).not.toContain('T00:52')
    expect(day!.textContent).toContain('License: CC0-1.0, retrieved 2026-11-01')
    expect(day!.querySelector('time')).toBeNull()
    expect(odd!.textContent).toContain('retrieved spring 2026')
  })

  it('says when its lists are cut short', () => {
    show({ summary: ready(summary({ truncated: true })) })
    expect(document.body.textContent).toContain('The lists here are cut short. The counts above are complete.')
  })

  it('shows loading and failure in place of the summary', () => {
    const retry = vi.fn()
    show({ summary: { state: 'error', message: 'Its checksum doesn’t match.' }, onRetry: retry })
    expect(screen.getByRole('region', { name: 'Snapshot' }).textContent).toContain('Its checksum doesn’t match.')
    noButton('Publish this snapshot')
    fireEvent.click(button('Try again'))
    expect(retry).toHaveBeenCalled()
  })
})

const index = indexDataset(amniotes as unknown as DatasetSnapshot)
const sourceOf = (status: ViewSource['status']): ViewSource => ({ doc: 'snap1', id: 'fixture-amniotes', version: '1', checksum: 'sha256:abc', status, withdrawn: status === 'withdrawn' })
const projectionOf = (limit?: number): ProjectionBody => {
  const view = createView(index, { id: 'v1', title: 'Traditional classes', target: { kind: 'classification', id: 'traditional' } })
  const projection = projectView(index, view, limit ? { limit } : {})
  return { view: { doc: 'view1', id: 'v1', title: view.title, status: 'draft' }, source: sourceOf('published'), projection, disclosure: describeView(index, view, projection) }
}
const saved = (over: Partial<SavedView> = {}): SavedView => ({ title: 'Traditional classes', status: 'draft', source: sourceOf('published'), layout: 'rectangular', highlights: [], ...over })

describe('view panel', () => {
  const show = (props: Partial<ViewPanelViewProps> = {}) =>
    render(<ViewPanelView view={ready(saved())} preview={ready(projectionOf())} canManage unsaved={false} snapshotHref="/admin/collections/taxonomy-snapshots/snap1" outcome={null} onSetStatus={yes} {...props} />)

  it('says why a draft can’t be published, in the order a person would fix it', () => {
    expect(whyNotPublishable(saved(), false)).toBeNull()
    expect(whyNotPublishable(saved(), true)).toBe('Save your changes first.')
    expect(whyNotPublishable(saved({ source: null }), false)).toBe('Its snapshot no longer exists.')
    expect(whyNotPublishable(saved({ source: sourceOf('staged') }), false)).toBe('Publish its snapshot first.')
    expect(whyNotPublishable(saved({ source: sourceOf('withdrawn') }), false)).toBe('Its snapshot was withdrawn, so this view can’t be published.')
    expect(whyNotPublishable(saved({ source: sourceOf('staged') }), true)).toBe('Save your changes first.')
  })

  it('draws the saved view, with the same tree as an outline and what readers are told', () => {
    show()
    const figure = screen.getByRole('group', { name: 'Drawing of Traditional classes' })
    expect(figure.getAttribute('tabindex')).toBe('0')
    expect(figure.querySelector('svg')).toBeTruthy()
    // A small tree is drawn at its own size: the box carries the drawing's width, in pixels, for the stylesheet's cap.
    const widest = /^(\d+)px$/.exec(figure.style.getPropertyValue('--otp-widest'))
    expect(Number(widest?.[1])).toBe(Math.round(Number(figure.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2])))
    expect(screen.getByText('The same tree as an outline')).toBeTruthy()
    expect(screen.getByText('What readers are told about it')).toBeTruthy()
    expect(document.querySelectorAll('.onetaxonomy-details li').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'fixture-amniotes version 1' }).getAttribute('href')).toBe('/admin/collections/taxonomy-snapshots/snap1')
    expect(document.body.textContent).toContain('which is published.')
  })

  it('says when the preview stops short of the whole view', () => {
    const cut = projectionOf(3)
    expect(cut.projection.truncated).toBe(true)
    show({ preview: ready(cut) })
    expect(document.body.textContent).toContain(`This preview stops at ${cut.projection.nodes.length} nodes. The view itself has more.`)
  })

  it('holds Publish with the reason beside it until the view can be published', () => {
    show({ unsaved: true })
    expect((button('Publish this view') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('Save your changes first.')
    cleanup()
    show({ view: ready(saved({ source: sourceOf('staged') })) })
    expect((button('Publish this view') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('Publish its snapshot first.')
    cleanup()
    show()
    expect((button('Publish this view') as HTMLButtonElement).disabled).toBe(false)
  })

  it('publishes and withdraws only after the confirm', async () => {
    const set = vi.fn(yes)
    show({ onSetStatus: set })
    fireEvent.click(button('Publish this view'))
    expect(screen.getByRole('group', { name: /Publish this view\?/ }).textContent).toContain('A published view can’t be edited')
    fireEvent.click(button('Publish'))
    await waitFor(() => expect(set).toHaveBeenCalledWith('published'))
    cleanup()
    show({ view: ready(saved({ status: 'published' })), onSetStatus: set })
    noButton('Publish this view')
    fireEvent.click(button('Withdraw this view'))
    fireEvent.click(button('Withdraw'))
    await waitFor(() => expect(set).toHaveBeenLastCalledWith('withdrawn'))
  })

  it('offers no buttons to someone who may not manage, or once it is withdrawn', () => {
    show({ canManage: false })
    expect(screen.queryAllByRole('button')).toEqual([])
    cleanup()
    show({ view: ready(saved({ status: 'withdrawn' })) })
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(document.querySelector('.onetaxonomy-status')!.textContent).toBe('Withdrawn')
  })

  it('warns when the snapshot is gone, and draws nothing', () => {
    show({ view: ready(saved({ source: null })), snapshotHref: null })
    expect(document.body.textContent).toContain('Warning: This view’s snapshot no longer exists, or you may not see it.')
    expect(screen.queryByRole('group', { name: /Drawing of/ })).toBeNull()
    expect((button('Publish this view') as HTMLButtonElement).disabled).toBe(true)
  })

  it('warns when a published view’s snapshot was withdrawn after it', () => {
    show({ view: ready(saved({ status: 'published', source: sourceOf('withdrawn') })) })
    expect(document.body.textContent).toContain('Warning: Its snapshot was withdrawn after this view was published. Readers still see the view, with a notice saying so.')
  })

  it('keeps the status and buttons when only the preview fails', () => {
    show({ preview: { state: 'error', message: 'This view can’t be projected.' } })
    expect(document.body.textContent).toContain('The preview couldn’t be loaded. This view can’t be projected.')
    expect(button('Publish this view')).toBeTruthy()
  })
})

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  status: 'queued',
  phase: null,
  message: null,
  snapshot: null,
  checksum: null,
  inputSha256: null,
  diagnostics: [],
  warnings: [],
  warningCount: 0,
  progress: [],
  attempts: 0,
  startedAt: null,
  finishedAt: null,
  ...over,
})
const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString()

describe('import panel', () => {
  const show = (j: Partial<ImportJob> = {}, props: Partial<ImportPanelViewProps> = {}) =>
    render(<ImportPanelView job={ready(job(j))} canRun starting={false} staleAfterMinutes={15} now={NOW} snapshotHref={null} outcome={null} onRun={yes} {...props} />)

  it('places each step from the status and the phase last reached', () => {
    expect(stepStates({ status: 'queued', phase: null })).toEqual(['todo', 'todo', 'todo', 'todo'])
    expect(stepStates({ status: 'running', phase: 'reading' })).toEqual(['current', 'todo', 'todo', 'todo'])
    expect(stepStates({ status: 'running', phase: 'sealing' })).toEqual(['done', 'done', 'current', 'todo'])
    expect(stepStates({ status: 'failed', phase: 'parsing' })).toEqual(['done', 'stopped', 'todo', 'todo'])
    expect(stepStates({ status: 'failed', phase: null })).toEqual(['todo', 'todo', 'todo', 'todo'])
    expect(stepStates({ status: 'done', phase: 'finished' })).toEqual(['done', 'done', 'done', 'done'])
    expect(stepStates({ status: 'already-imported', phase: 'finished' })).toEqual(['done', 'done', 'done', 'done'])
    // A queued job that ran before keeps its old phase until it runs again: nothing is shown as done.
    expect(stepStates({ status: 'queued', phase: 'storing' })).toEqual(['todo', 'todo', 'todo', 'todo'])
  })

  it('calls a job interrupted only when it has been running past the limit', () => {
    expect(isStale({ status: 'running', startedAt: minutesAgo(14) }, NOW, 15)).toBe(false)
    expect(isStale({ status: 'running', startedAt: minutesAgo(15) }, NOW, 15)).toBe(true)
    expect(isStale({ status: 'failed', startedAt: minutesAgo(60) }, NOW, 15)).toBe(false)
    expect(isStale({ status: 'running', startedAt: null }, NOW, 15)).toBe(false)
    expect(isStale({ status: 'running', startedAt: 'not a date' }, NOW, 15)).toBe(false)
  })

  it('offers to run a queued job, and says each step in words', () => {
    const run = vi.fn(yes)
    show({}, { onRun: run })
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Read the file not yet', 'Parse it not yet', 'Seal the snapshot not yet', 'Store it not yet'])
    fireEvent.click(button('Run this import'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('shows a running job in a live region with its current step, and doesn’t offer to run it twice', () => {
    show({ status: 'running', phase: 'parsing', message: 'Parsing 1,204 rows', startedAt: minutesAgo(1), attempts: 1, progress: [{ at: minutesAgo(1), message: 'Read 14 kB' }] })
    const live = screen.getAllByRole('status')[0]!
    expect(live.textContent).toContain('Running')
    expect(live.textContent).toContain('Parsing 1,204 rows')
    const current = document.querySelector('[aria-current="step"]')!
    expect(current.textContent).toBe('Parse it in progress')
    expect(screen.queryAllByRole('button')).toEqual([])
    expect((screen.getByText('Progress log').closest('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('says a long-running job was probably interrupted, and offers to run it again', () => {
    show({ status: 'running', phase: 'parsing', startedAt: minutesAgo(16) })
    expect(document.body.textContent).toContain('Warning: This job has been marked as running for more than 15 minutes, so the run was probably interrupted.')
    expect(button('Run it again')).toBeTruthy()
  })

  it('shows what stopped a failed job, where, and offers to run it again', () => {
    show({
      status: 'failed',
      phase: 'parsing',
      message: 'The file has 2 errors.',
      diagnostics: [
        { severity: 'error', code: 'bad-row', message: 'A row has no name.', line: 4 },
        { severity: 'warning', code: 'odd', message: 'A rank is unusual.', path: 'taxa.csv' },
      ],
    })
    const stopped = screen.getByText('What stopped it').parentElement!
    expect(stopped.textContent).toContain('A row has no name. (line 4)')
    expect(stopped.textContent).not.toContain('A rank is unusual.')
    expect(screen.getByText('1 validation warning').closest('details')!.textContent).toContain('A rank is unusual. (taxa.csv)')
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')[1]!.textContent).toBe('Parse it stopped here')
    expect(button('Run it again')).toBeTruthy()
  })

  it('links the snapshot a finished job stored or found, and offers nothing more to run', () => {
    show({ status: 'done', phase: 'finished', snapshot: 'snap9', checksum: 'sha256:abc', inputSha256: 'def', attempts: 2 }, { snapshotHref: '/admin/collections/taxonomy-snapshots/snap9' })
    expect(screen.getByRole('link', { name: 'Open the staged snapshot this job stored' }).getAttribute('href')).toBe('/admin/collections/taxonomy-snapshots/snap9')
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(document.body.textContent).toContain('Runs started2')
    cleanup()
    show({ status: 'already-imported', phase: 'finished', snapshot: 'snap9' }, { snapshotHref: '/admin/collections/taxonomy-snapshots/snap9' })
    expect(screen.getByRole('link', { name: 'Open the staged snapshot this job found' })).toBeTruthy()
  })

  it('says how many things the importer noticed when only the first are kept', () => {
    show({ status: 'done', phase: 'finished', warningCount: 450, warnings: [{ code: 'missing-parent', message: 'A parent is missing.', row: 7 } as ImportJob['warnings'][number]] })
    const noticed = screen.getByText('450 things the importer noticed and handled with care').closest('details')!
    expect(noticed.textContent).toContain('The first 1 are kept.')
    expect(noticed.textContent).toContain('A parent is missing. (row 7)')
  })

  it('offers nothing to run to someone who may not, and makes the button wait while a run starts', () => {
    show({}, { canRun: false })
    expect(screen.queryAllByRole('button')).toEqual([])
    cleanup()
    show({}, { starting: true })
    expect((button('Running…') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('Keep this page open. A large file can take a while.')
  })
})

const preview = (over: Partial<ProposalPreview> = {}, proposal: Partial<ProposalPreview['proposal']> = {}): ProposalPreview => ({
  proposal: { doc: 'prop1', id: 'p1', title: 'Move turtles next to birds', author: 'person-17', created: '2026-11-10T09:00:00.000Z', status: 'shared', checksum: 'sha256:prop', base: { kind: 'classification', id: 'traditional', version: '1' }, ...proposal } as ProposalPreview['proposal'],
  snapshot: { doc: 'snap1', id: 'fixture-amniotes', version: '1', checksum: 'sha256:abc' },
  acceptable: true,
  counts: { moves: 1, changedGroups: 2, broken: 0, formed: 0 },
  moved: [{ node: 'c:testudines', from: 'c:reptilia', to: null, note: 'See the 2012 analysis.' }],
  changedGroups: [
    { node: 'c:reptilia', gained: [], lost: ['c:testudines'] },
    { node: 'c:unnamed', gained: ['c:testudines'], lost: [] },
  ],
  broken: [],
  formed: [],
  labels: { 'c:testudines': 'Testudines', 'c:reptilia': 'Reptilia' },
  mayDecide: true,
  truncated: false,
  ...over,
})

describe('proposal panel', () => {
  const show = (props: Partial<ProposalPanelViewProps> = {}) =>
    render(<ProposalPanelView preview={ready(preview())} decision={{}} snapshotHref="/admin/collections/taxonomy-snapshots/snap1" limits={{ version: 100, note: 2000 }} outcome={null} onAccept={yes} onDecline={yes} {...props} />)

  it('says what would change in names, with the id beside each, and the id alone where there is no name', () => {
    show()
    const moved = screen.getByText('Taxa with a new parent').closest('details')!
    expect(moved.textContent).toContain('Testudines c:testudines moves from Reptilia c:reptilia to the top level.')
    expect(moved.textContent).toContain('Author’s note: See the 2012 analysis.')
    const groups = screen.getByText('Groups that gain or lose members').closest('details')!
    expect(groups.textContent).toContain('Loses: Testudines c:testudines')
    expect(groups.textContent).toContain('c:unnamedGains: Testudines c:testudines')
    expect(document.body.textContent).toContain('1 taxon moved, 2 groups changed, 0 groups gone, 0 new groups.')
  })

  it('shows the author by id, with a name only when the site gave one', () => {
    show()
    expect(document.body.textContent).toContain('Proposed byperson-17')
    cleanup()
    show({ preview: ready(preview({}, { authorName: 'Ada Example' })) })
    expect(document.body.textContent).toContain('Proposed byAda Example (person-17)')
  })

  it('offers accept and decline only to a manager, and only while the proposal is shared', () => {
    show()
    expect(button('Accept this proposal')).toBeTruthy()
    expect(button('Decline this proposal')).toBeTruthy()
    cleanup()
    show({ preview: ready(preview({ mayDecide: false })) })
    expect(screen.queryAllByRole('button')).toEqual([])
    for (const status of ['private', 'accepted', 'declined'] as const) {
      cleanup()
      show({ preview: ready(preview({}, { status })) })
      expect(screen.queryAllByRole('button'), status).toEqual([])
    }
  })

  it('holds Accept with the reason when the proposal can’t be accepted as it stands', () => {
    show({ preview: ready(preview({ acceptable: false, notAcceptable: 'Its snapshot isn’t published.' })) })
    expect((button('Accept this proposal') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('Warning: It can’t be accepted as it stands. Its snapshot isn’t published.')
    expect((button('Decline this proposal') as HTMLButtonElement).disabled).toBe(false)
  })

  it('warns what is sealed before accepting, needs a version name, and sends the checksum it showed', async () => {
    const accept = vi.fn(yes)
    show({ onAccept: accept })
    fireEvent.click(button('Accept this proposal'))
    const box = screen.getByRole('group', { name: /Accept this proposal\?/ })
    expect(box.textContent).toContain('Nothing is published')
    expect(box.textContent).toContain(
      'Warning: These are sealed into the new version and can’t be taken out later: the proposal’s title, its notes and move notes, your note, the date, and the ids of its author and of you. Check that none of it holds personal details.',
    )
    const confirm = within(box).getByRole('button', { name: 'Accept into a new version' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    const version = within(box).getByLabelText(/Name of the new version/) as HTMLInputElement
    expect(version.required).toBe(true)
    expect(version.maxLength).toBe(100)
    fireEvent.change(version, { target: { value: '   ' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(version, { target: { value: ' 2 ' } })
    fireEvent.change(within(box).getByLabelText(/Your note/), { target: { value: ' Agreed. ' } })
    expect(confirm.disabled).toBe(false)
    expect(accept).not.toHaveBeenCalled()
    fireEvent.click(confirm)
    await waitFor(() => expect(accept).toHaveBeenCalledWith({ version: '2', note: 'Agreed.', checksum: 'sha256:prop' }))
  })

  it('tells a declining manager the author sees the note, and sends it', async () => {
    const decline = vi.fn(yes)
    show({ onDecline: decline })
    fireEvent.click(button('Decline this proposal'))
    const box = screen.getByRole('group', { name: /Decline this proposal\?/ })
    expect(box.textContent).toContain('Its author sees that it was declined, with your note.')
    expect(box.textContent).toContain('Why you declined it. The author sees it.')
    fireEvent.change(within(box).getByLabelText(/Your note/), { target: { value: 'Needs a source.' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(decline).toHaveBeenCalledWith({ note: 'Needs a source.' }))
  })

  it('shows what was decided, and links the version an accepted proposal made', () => {
    show({ preview: ready(preview({}, { status: 'accepted' })), decision: { note: 'Agreed.', at: '2026-11-11T10:00:00.000Z', snapshotHref: '/admin/collections/taxonomy-snapshots/snap2' } })
    expect(document.querySelector('.onetaxonomy-status')!.textContent).toBe('Accepted')
    expect(document.body.textContent).toContain('Manager’s noteAgreed.')
    // It has happened, so the heading says so. An open proposal's says "would".
    expect(screen.getByRole('heading', { name: 'What it changed' })).toBeTruthy()
    cleanup()
    show({ preview: ready(preview({}, { status: 'shared' })) })
    expect(screen.getByRole('heading', { name: 'What it would change' })).toBeTruthy()
    cleanup()
    show({ preview: ready(preview({}, { status: 'accepted' })), decision: { note: 'Agreed.', at: '2026-11-11T10:00:00.000Z', snapshotHref: '/admin/collections/taxonomy-snapshots/snap2' } })
    expect(screen.getByRole('link', { name: 'the snapshot version it made' }).getAttribute('href')).toBe('/admin/collections/taxonomy-snapshots/snap2')
  })

  it('keeps what the last action did in view while the preview loads again', () => {
    show({ preview: { state: 'loading' }, outcome: { kind: 'error', message: 'Nothing was changed. Someone else decided it.' } })
    expect(screen.getByRole('alert').textContent).toContain('Nothing was changed. Someone else decided it.')
  })
})
