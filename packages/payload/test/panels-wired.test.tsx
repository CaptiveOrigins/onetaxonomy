// @vitest-environment jsdom
// The panels wired to a site: which addresses they call and with what, what they put back into the open form, and
// what a person is told when the site refuses. Payload's admin hooks and `fetch` are stand-ins here, so this checks
// the panels' side only. The server's side of each address is checked in the other test files, and the two together
// on the example site.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createView, describeView, indexDataset, projectView, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'

import amniotes from '../../../fixtures/amniotes.json'
import type { ImportJobSummary } from '../src/imports.js'
import type { ProposalAcceptance, ProposalDecision } from '../src/proposals.js'

const admin = vi.hoisted(() => ({
  config: { serverURL: '', routes: { api: '/api', admin: '/admin' } } as { serverURL?: string; routes: { api: string; admin: string } },
  doc: { id: 'doc1' as string | number | undefined, collectionSlug: 'taxonomy-snapshots', hasSavePermission: true },
  modified: false,
  dispatchFields: vi.fn(),
}))
vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: admin.config }),
  useDocumentInfo: () => admin.doc,
  useForm: () => ({ dispatchFields: admin.dispatchFields }),
  useFormModified: () => admin.modified,
}))

import { ImportPanel, ProposalPanel, SnapshotPanel, ViewPanel } from '../src/client/wired.js'

const slugs = { snapshots: 'taxonomy-snapshots', views: 'taxonomy-views', imports: 'taxonomy-imports', proposals: 'taxonomy-proposals' }

type Call = { method: string; url: string; body: unknown; credentials: unknown }
type Answer = { status?: number; body: unknown }
let calls: Call[] = []
/** Answers by "METHOD address". The newest value set is the one given. */
let site: Record<string, Answer | (() => Answer)> = {}

beforeEach(() => {
  calls = []
  site = {}
  admin.config = { serverURL: '', routes: { api: '/api', admin: '/admin' } }
  admin.doc = { id: 'doc1', collectionSlug: 'taxonomy-snapshots', hasSavePermission: true }
  admin.modified = false
  admin.dispatchFields.mockClear()
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, credentials: init.credentials })
    const found = site[`${method} ${url}`]
    const answer = typeof found === 'function' ? found() : (found ?? { status: 404, body: { error: 'Not found.' } })
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const called = (method: string) => calls.filter((c) => c.method === method).map((c) => c.url)
const button = (name: string | RegExp) => screen.getByRole('button', { name })
/** What the panel put into the form, by field. */
const putInForm = () => Object.fromEntries(admin.dispatchFields.mock.calls.map(([a]) => [(a as { path: string }).path, a]))

const summary = (status: 'staged' | 'published' | 'withdrawn') => ({
  snapshot: { doc: 'doc1', id: 'fixture-amniotes', version: '1', checksum: 'sha256:abc', status, createdAt: '2026-11-01T00:00:00.000Z' },
  counts: { names: 8, concepts: 8, classifications: 1, phylogenies: 2, sources: 1 },
  sources: [],
  classifications: [],
  phylogenies: [],
  truncated: false,
})
const PUBLISH = '?depth=0&select[status]=true&select[publishedBy]=true&select[publishedAt]=true'

describe('on a document that isn’t saved yet', () => {
  it('shows nothing and calls nothing', () => {
    admin.doc = { id: undefined, collectionSlug: 'taxonomy-snapshots', hasSavePermission: true }
    for (const Panel of [SnapshotPanel, ViewPanel, ImportPanel, ProposalPanel]) {
      const { container } = render(<Panel slugs={slugs} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
    expect(calls).toEqual([])
  })
})

describe('snapshot panel on a site', () => {
  const at = '/api/taxonomy-snapshots/doc1'

  it('reads the summary as the signed-in person', async () => {
    site[`GET ${at}/summary`] = { body: summary('staged') }
    render(<SnapshotPanel slugs={slugs} />)
    expect(screen.getByRole('status').textContent).toBe('Loading the snapshot’s summary…')
    await screen.findByRole('button', { name: 'Publish this snapshot' })
    expect(calls).toEqual([{ method: 'GET', url: `${at}/summary`, body: undefined, credentials: 'include' }])
  })

  it('uses the site’s own address and API path, and an id that is safe in an address', async () => {
    admin.config = { serverURL: 'https://site.example', routes: { api: '/cms-api', admin: '/admin' } }
    admin.doc = { id: 'a b/c', collectionSlug: 'taxonomy-snapshots', hasSavePermission: true }
    render(<SnapshotPanel slugs={slugs} />)
    await waitFor(() => expect(called('GET')).toEqual(['https://site.example/cms-api/taxonomy-snapshots/a%20b%2Fc/summary']))
  })

  it('publishes with one small PATCH, puts the answer into the form as saved, and reads the summary again', async () => {
    site[`GET ${at}/summary`] = { body: summary('staged') }
    site[`PATCH ${at}${PUBLISH}`] = () => {
      site[`GET ${at}/summary`] = { body: summary('published') }
      return { body: { doc: { id: 'doc1', status: 'published', publishedBy: 'user9', publishedAt: '2026-11-11T12:00:00.000Z' }, message: 'Updated successfully.' } }
    }
    render(<SnapshotPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish this snapshot' }))
    expect(called('PATCH')).toEqual([])
    fireEvent.click(button('Publish'))
    await screen.findByRole('button', { name: 'Withdraw this snapshot' })
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([{ method: 'PATCH', url: `${at}${PUBLISH}`, body: { status: 'published' }, credentials: 'include' }])
    expect(putInForm()).toEqual({
      status: { type: 'UPDATE', path: 'status', value: 'published', initialValue: 'published' },
      publishedBy: { type: 'UPDATE', path: 'publishedBy', value: 'user9', initialValue: 'user9' },
      publishedAt: { type: 'UPDATE', path: 'publishedAt', value: '2026-11-11T12:00:00.000Z', initialValue: '2026-11-11T12:00:00.000Z' },
    })
    expect(screen.getByRole('status').textContent).toBe('Done: This snapshot is published.')
    expect(called('GET')).toEqual([`${at}/summary`, `${at}/summary`])
  })

  it('says nothing was changed, with the site’s reason, when the site refuses, and leaves the form alone', async () => {
    site[`GET ${at}/summary`] = { body: summary('published') }
    site[`PATCH ${at}${PUBLISH}`] = { status: 403, body: { errors: [{ message: 'You are not allowed to perform this action.' }] } }
    render(<SnapshotPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw this snapshot' }))
    fireEvent.click(button('Withdraw'))
    expect((await screen.findByRole('alert')).textContent).toBe('Problem: Nothing was changed. You are not allowed to perform this action.')
    expect(admin.dispatchFields).not.toHaveBeenCalled()
    // The question stays open, to try again or cancel.
    expect(screen.getByRole('group', { name: /Withdraw this snapshot\?/ })).toBeTruthy()
    expect(called('GET')).toEqual([`${at}/summary`])
  })

  it('offers no buttons to someone the site says may not save the document', async () => {
    admin.doc = { id: 'doc1', collectionSlug: 'taxonomy-snapshots', hasSavePermission: false }
    site[`GET ${at}/summary`] = { body: summary('staged') }
    render(<SnapshotPanel slugs={slugs} />)
    await screen.findByText('Staged')
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('shows the site’s reason when the summary can’t be read, and reads it again on Try again', async () => {
    render(<SnapshotPanel slugs={slugs} />)
    await screen.findByText(/The snapshot’s summary couldn’t be loaded\. Not found\./)
    site[`GET ${at}/summary`] = { body: summary('staged') }
    fireEvent.click(button('Try again'))
    await screen.findByRole('button', { name: 'Publish this snapshot' })
  })
})

const index = indexDataset(amniotes as unknown as DatasetSnapshot)
const source = { doc: 'snap1', id: 'fixture-amniotes', version: '1', checksum: 'sha256:abc', status: 'published', withdrawn: false }
const projection = () => {
  const view = createView(index, { id: 'v1', title: 'Traditional classes', target: { kind: 'classification', id: 'traditional' } })
  const projected = projectView(index, view, {})
  return { view: { doc: 'doc1', id: 'v1', title: view.title, status: 'draft' }, source, projection: projected, disclosure: describeView(index, view, projected) }
}

describe('view panel on a site', () => {
  const at = '/api/taxonomy-views/doc1'
  const FIELDS = '?depth=0&select[title]=true&select[status]=true&select[source]=true&select[view]=true&select[snapshot]=true'
  beforeEach(() => {
    admin.doc = { id: 'doc1', collectionSlug: 'taxonomy-views', hasSavePermission: true }
    site[`GET ${at}${FIELDS}`] = { body: { id: 'doc1', title: 'Traditional classes', status: 'draft', source, view: { layout: { kind: 'radial' }, highlights: [] } } }
    site[`GET ${at}/projection?limit=200`] = { body: projection() }
  })

  it('reads the saved view and a bounded preview, and links its snapshot in the admin', async () => {
    render(<ViewPanel slugs={slugs} />)
    await screen.findByRole('group', { name: 'Drawing of Traditional classes' })
    expect(called('GET').sort()).toEqual([`${at}/projection?limit=200`, `${at}${FIELDS}`].sort())
    expect(screen.getByRole('link', { name: 'fixture-amniotes version 1' }).getAttribute('href')).toBe('/admin/collections/taxonomy-snapshots/snap1')
  })

  it('holds Publish while the form has unsaved changes', async () => {
    admin.modified = true
    render(<ViewPanel slugs={slugs} />)
    expect(((await screen.findByRole('button', { name: 'Publish this view' })) as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('Save your changes first.')
  })

  it('publishes with one PATCH and reads both the view and its preview again', async () => {
    site[`PATCH ${at}${PUBLISH}`] = { body: { doc: { id: 'doc1', status: 'published', publishedBy: 'user9', publishedAt: '2026-11-11T12:00:00.000Z' } } }
    render(<ViewPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish this view' }))
    fireEvent.click(button('Publish'))
    expect((await screen.findByRole('status')).textContent).toBe('Done: This view is published.')
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ status: 'published' }])
    expect(putInForm().status).toMatchObject({ value: 'published', initialValue: 'published' })
    await waitFor(() => expect(called('GET').length).toBe(4))
  })

  it('draws with a layout it doesn’t know as the default, never passing the unknown word on', async () => {
    site[`GET ${at}${FIELDS}`] = { body: { id: 'doc1', title: 'Traditional classes', status: 'draft', source, view: { layout: { kind: '<script>' }, highlights: 'no' } } }
    render(<ViewPanel slugs={slugs} />)
    expect((await screen.findByRole('group', { name: 'Drawing of Traditional classes' })).querySelector('svg')).toBeTruthy()
  })
})

describe('import panel on a site', () => {
  const at = '/api/taxonomy-imports/doc1'
  const FIELDS = `?depth=0&${['status', 'phase', 'message', 'snapshot', 'checksum', 'inputSha256', 'diagnostics', 'warnings', 'warningCount', 'progress', 'attempts', 'startedAt', 'finishedAt', 'runBy'].map((f) => `select[${f}]=true`).join('&')}`
  const job = (over: Record<string, unknown> = {}) => ({ id: 'doc1', status: 'queued', attempts: 0, ...over })
  /** What the run address answers. */
  const ran = (status: ImportJobSummary['status'], message: string, snapshot: string | null = 'snap9'): ImportJobSummary => ({ doc: 'doc1', status, phase: status === 'failed' ? 'parsing' : 'finished', snapshot, checksum: snapshot && 'sha256:abc', inputSha256: 'def', message, warnings: 0, diagnostics: [] })
  /** Lets answered requests reach the page. Only the interval timer is faked in these tests. */
  const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))))
  beforeEach(() => {
    admin.doc = { id: 'doc1', collectionSlug: 'taxonomy-imports', hasSavePermission: true }
    site[`GET ${at}${FIELDS}`] = { body: job() }
  })

  it('reads only the fields a run sets, and puts them into the form as saved', async () => {
    site[`GET ${at}${FIELDS}`] = { body: job({ status: 'done', phase: 'finished', snapshot: { id: 'snap9' }, attempts: 1, runBy: 'user9' }) }
    render(<ImportPanel slugs={slugs} />)
    expect((await screen.findByRole('link', { name: 'Open the staged snapshot this job stored' })).getAttribute('href')).toBe('/admin/collections/taxonomy-snapshots/snap9')
    expect(called('GET')).toEqual([`${at}${FIELDS}`])
    const form = putInForm()
    expect(Object.keys(form).sort()).toEqual(['attempts', 'checksum', 'diagnostics', 'finishedAt', 'inputSha256', 'message', 'phase', 'progress', 'runBy', 'snapshot', 'startedAt', 'status', 'warningCount', 'warnings'])
    expect(form.status).toEqual({ type: 'UPDATE', path: 'status', value: 'done', initialValue: 'done' })
    // The relationship goes back as an id, the way the form holds it.
    expect(form.snapshot).toMatchObject({ value: 'snap9', initialValue: 'snap9' })
    expect(form.runBy).toMatchObject({ value: 'user9' })
    expect(form.message).toMatchObject({ value: null })
  })

  it('runs the job with one POST, then says what happened and links the snapshot', async () => {
    site[`POST ${at}/run`] = () => {
      site[`GET ${at}${FIELDS}`] = { body: job({ status: 'done', phase: 'finished', snapshot: 'snap9', attempts: 1 }) }
      return { body: ran('done', 'Stored a staged snapshot.') }
    }
    render(<ImportPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run this import' }))
    await screen.findByText(/The import finished and stored a staged snapshot\./)
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', url: `${at}/run`, body: undefined, credentials: 'include' }])
    expect(screen.getByRole('link', { name: 'Open the snapshot' }).getAttribute('href')).toBe('/admin/collections/taxonomy-snapshots/snap9')
    await waitFor(() => expect(putInForm().status).toMatchObject({ value: 'done' }))
  })

  it('says a file was imported before, and says why a run stopped', async () => {
    site[`POST ${at}/run`] = { body: ran('already-imported', 'Imported before.') }
    render(<ImportPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run this import' }))
    await screen.findByText(/This file with these settings was imported before\. The job points at that snapshot\./)
    cleanup()
    site[`POST ${at}/run`] = { body: ran('failed', 'The file has 2 errors.', null) }
    render(<ImportPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run this import' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Problem: The import stopped. The file has 2 errors.')
  })

  it('shows the site’s reason when the run is refused', async () => {
    site[`POST ${at}/run`] = { status: 409, body: { error: 'This job is already running.' } }
    render(<ImportPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run this import' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Problem: This job is already running.')
  })

  it('looks again every 3 seconds while the job runs, and stops as soon as it doesn’t', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    site[`GET ${at}${FIELDS}`] = { body: job({ status: 'running', phase: 'parsing', startedAt: new Date().toISOString(), attempts: 1 }) }
    render(<ImportPanel slugs={slugs} />)
    await settle()
    expect(called('GET').length).toBe(1)
    await act(async () => void vi.advanceTimersByTime(2999))
    expect(called('GET').length).toBe(1)
    await act(async () => void vi.advanceTimersByTime(1))
    await settle()
    expect(called('GET').length).toBe(2)
    site[`GET ${at}${FIELDS}`] = { body: job({ status: 'done', phase: 'finished', snapshot: 'snap9', attempts: 1 }) }
    await act(async () => void vi.advanceTimersByTime(3000))
    await settle()
    expect(called('GET').length).toBe(3)
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => void vi.advanceTimersByTime(30_000))
    await settle()
    expect(called('GET').length).toBe(3)
  })

  it('doesn’t look again on a timer for a job that isn’t running, and stops when the page is left', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { unmount } = render(<ImportPanel slugs={slugs} />)
    await settle()
    expect(vi.getTimerCount()).toBe(0)
    site[`GET ${at}${FIELDS}`] = { body: job({ status: 'running', phase: 'reading', startedAt: new Date().toISOString() }) }
    cleanup()
    const second = render(<ImportPanel slugs={slugs} />)
    await settle()
    expect(vi.getTimerCount()).toBe(1)
    second.unmount()
    expect(vi.getTimerCount()).toBe(0)
    unmount()
  })
})

describe('proposal panel on a site', () => {
  const at = '/api/taxonomy-proposals/doc1'
  const DECISION = '?depth=0&select[status]=true&select[decisionNote]=true&select[decidedAt]=true&select[decidedBy]=true&select[acceptedInto]=true'
  const preview = (status = 'shared', mayDecide = true) => ({
    proposal: { doc: 'doc1', id: 'p1', title: 'Move turtles next to birds', author: 'person-17', created: '2026-11-10T09:00:00.000Z', status, checksum: 'sha256:prop', base: { kind: 'classification', id: 'traditional', version: '1' } },
    snapshot: { doc: 'snap1', id: 'fixture-amniotes', version: '1', checksum: 'sha256:abc' },
    acceptable: true,
    counts: { moves: 1, changedGroups: 0, broken: 0, formed: 0 },
    moved: [{ node: 'c:testudines', from: 'c:reptilia', to: null }],
    changedGroups: [],
    broken: [],
    formed: [],
    labels: { 'c:testudines': 'Testudines', 'c:reptilia': 'Reptilia' },
    mayDecide,
    truncated: false,
  })
  const decided = (status: 'accepted' | 'declined'): ProposalDecision => ({ proposal: { doc: 'doc1', id: 'p1', status, checksum: 'sha256:prop2' } })
  const accepted = (): ProposalAcceptance => ({
    ...decided('accepted'),
    snapshot: { doc: 'snap2', id: 'fixture-amniotes', version: '2', checksum: 'sha256:new', status: 'staged' },
    derivedFrom: { doc: 'snap1', id: 'fixture-amniotes', version: '1', checksum: 'sha256:abc' },
  })
  beforeEach(() => {
    admin.doc = { id: 'doc1', collectionSlug: 'taxonomy-proposals', hasSavePermission: true }
    site[`GET ${at}/preview`] = { body: preview() }
    site[`GET ${at}${DECISION}`] = { body: { id: 'doc1', status: 'shared', decisionNote: null, decidedAt: null, decidedBy: null, acceptedInto: null } }
  })

  const openAccept = async (version: string, note?: string) => {
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this proposal' }))
    const box = screen.getByRole('group', { name: /Accept this proposal\?/ })
    fireEvent.change(within(box).getByLabelText(/Name of the new version/), { target: { value: version } })
    if (note !== undefined) fireEvent.change(within(box).getByLabelText(/Your note/), { target: { value: note } })
    fireEvent.click(within(box).getByRole('button', { name: 'Accept into a new version' }))
  }

  it('reads the preview and the decision, and puts the decision into the form as saved', async () => {
    render(<ProposalPanel slugs={slugs} />)
    await screen.findByRole('button', { name: 'Accept this proposal' })
    expect(called('GET').sort()).toEqual([`${at}/preview`, `${at}${DECISION}`].sort())
    await waitFor(() => expect(Object.keys(putInForm()).sort()).toEqual(['acceptedInto', 'decidedAt', 'decidedBy', 'decisionNote', 'status']))
  })

  it('leaves the manager-only fields out of the form for someone the site didn’t send them to', async () => {
    site[`GET ${at}/preview`] = { body: preview('shared', false) }
    site[`GET ${at}${DECISION}`] = { body: { id: 'doc1', status: 'shared', decisionNote: null, decidedAt: null } }
    render(<ProposalPanel slugs={slugs} />)
    await waitFor(() => expect(Object.keys(putInForm()).sort()).toEqual(['decidedAt', 'decisionNote', 'status']))
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('accepts with one POST carrying the version, the checksum it showed and the note, then links the new snapshot', async () => {
    site[`POST ${at}/accept`] = () => {
      site[`GET ${at}/preview`] = { body: preview('accepted') }
      site[`GET ${at}${DECISION}`] = { body: { id: 'doc1', status: 'accepted', decisionNote: 'Agreed.', decidedAt: '2026-11-11T12:00:00.000Z', decidedBy: 'user9', acceptedInto: { id: 'snap2' } } }
      return { body: accepted() }
    }
    render(<ProposalPanel slugs={slugs} />)
    await openAccept(' 2 ', ' Agreed. ')
    expect((await screen.findByRole('status')).textContent).toBe('Done: Accepted into the new staged version 2. Nothing is published yet: check that snapshot, then publish it. Open the new snapshot')
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', url: `${at}/accept`, body: { version: '2', checksum: 'sha256:prop', note: 'Agreed.' }, credentials: 'include' }])
    expect(screen.getByRole('link', { name: 'Open the new snapshot' }).getAttribute('href')).toBe('/admin/collections/taxonomy-snapshots/snap2')
    // Both are read again, and the decision goes into the form so a later Save can't send the old status back.
    await waitFor(() => expect(putInForm()).toMatchObject({ status: { value: 'accepted', initialValue: 'accepted' }, acceptedInto: { value: 'snap2' }, decidedBy: { value: 'user9' }, decisionNote: { value: 'Agreed.' } }))
    await screen.findByRole('link', { name: 'the snapshot version it made' })
    expect(screen.queryByRole('button', { name: 'Accept this proposal' })).toBeNull()
  })

  it('sends no note when none was written', async () => {
    site[`POST ${at}/accept`] = { body: accepted() }
    render(<ProposalPanel slugs={slugs} />)
    await openAccept('2')
    await screen.findByRole('status')
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ version: '2', checksum: 'sha256:prop' })
  })

  it('says nothing was changed when the site refuses, and shows the proposal as it is now', async () => {
    site[`POST ${at}/accept`] = () => {
      site[`GET ${at}/preview`] = { body: preview('declined') }
      return { status: 409, body: { error: 'This proposal changed since you opened it.' } }
    }
    render(<ProposalPanel slugs={slugs} />)
    await openAccept('2')
    expect((await screen.findByRole('alert')).textContent).toBe('Problem: Nothing was changed. This proposal changed since you opened it.')
    await waitFor(() => expect(document.querySelector('.onetaxonomy-status')!.textContent).toBe('Declined'))
    expect(screen.queryByRole('button', { name: 'Accept this proposal' })).toBeNull()
  })

  it('declines with one POST, with the note only when one was written', async () => {
    site[`POST ${at}/decline`] = { body: decided('declined') }
    render(<ProposalPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Decline this proposal' }))
    fireEvent.click(button('Decline'))
    expect((await screen.findByRole('status')).textContent).toBe('Done: This proposal is declined. Its author can revise it and share it again.')
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', url: `${at}/decline`, body: {}, credentials: 'include' }])
    cleanup()
    calls = []
    render(<ProposalPanel slugs={slugs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Decline this proposal' }))
    fireEvent.change(screen.getByLabelText(/Your note/), { target: { value: 'Needs a source.' } })
    fireEvent.click(button('Decline'))
    await screen.findByRole('status')
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ note: 'Needs a source.' })
  })
})

describe('what runs where', () => {
  const SRC = join(import.meta.dirname, '..', 'src')
  const read = (...path: string[]) => readFileSync(join(SRC, ...path), 'utf8')

  it('marks the panels’ entry and the wired panels as client modules', () => {
    for (const f of ['index.ts', 'wired.tsx']) expect(read('client', f), f).toMatch(/^'use client'\s*\n/)
  })

  it('keeps the browser code out of the server entry, and the server code out of the browser', () => {
    const server = readdirSync(SRC).filter((f) => /\.tsx?$/.test(f))
    // The server names the panels by path for Payload's import map. It never imports them.
    for (const f of server) expect(read(f), f).not.toMatch(/from '\.\/client\//)
    // The panels take types from the server files and nothing that would run.
    for (const f of readdirSync(join(SRC, 'client')).filter((f) => /\.tsx?$/.test(f))) {
      const fromServer = [...read('client', f).matchAll(/^import (type )?.*from '\.\.\/[^']+'/gm)]
      for (const m of fromServer) expect(m[1], `${f}: ${m[0]}`).toBe('type ')
      expect(read('client', f), f).not.toMatch(/from 'payload'|from 'node:/)
    }
  })
})
