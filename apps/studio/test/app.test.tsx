// @vitest-environment jsdom
// The Mac app's window in jsdom with Tauri mocked: dialogs, the file system and settings are fakes, so this checks
// what the app asks for and writes, not the real disk, the built app or VoiceOver.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifySnapshot, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'

const written = new Map<string, string>()
const calls: string[] = []
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  exists: vi.fn(async (path: string) => written.has(path)),
  writeTextFile: vi.fn(async (path: string, text: string) => {
    calls.push(`write ${path}`)
    written.set(path, text)
  }),
  rename: vi.fn(async (from: string, to: string) => {
    calls.push(`rename ${from} -> ${to}`)
    written.set(to, written.get(from)!)
    written.delete(from)
  }),
  remove: vi.fn(async (path: string) => {
    calls.push(`remove ${path}`)
    written.delete(path)
  }),
}))
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {} })) }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))

const dialog = await import('@tauri-apps/plugin-dialog')
const fs = await import('@tauri-apps/plugin-fs')
const { App } = await import('../src/App')
const { NEXUS } = await import('./fixtures')

const status = () => document.querySelector('.app-status') as HTMLElement

async function openFile(path: string, text: string) {
  vi.mocked(dialog.open).mockResolvedValueOnce(path)
  vi.mocked(fs.readTextFile).mockResolvedValueOnce(text)
  fireEvent.click(screen.getAllByRole('button', { name: 'Open…' })[0]!)
}

beforeEach(() => {
  written.clear()
  calls.length = 0
})
afterEach(cleanup)

describe('the Mac app with the new tree formats and controls', () => {
  it('opens a NEXUS file through the open dialog, with skipped parts in the notes list', async () => {
    render(<App />)
    await openFile('/made-up/two.nex', NEXUS)
    await waitFor(() => expect(status().textContent).toMatch(/^Opened two\.nex\./))
    expect(within(status()).getByText('Line 2: TAXA block is not read')).toBeTruthy()
    const show = within(document.querySelector('.app-header') as HTMLElement).getByRole('combobox', { name: 'Show' }) as HTMLSelectElement
    expect([...show.options].map((o) => o.textContent)).toEqual(['Tree: two: one', 'Tree: two: two'])
    expect(vi.mocked(dialog.open).mock.calls[0]![0]!.filters![0]!.extensions).toEqual(expect.arrayContaining(['nex', 'nexus', 'tre', 'xml', 'phyloxml']))
  })

  it('asks whether a NEXUS tree is rooted when the file does not say, instead of guessing', async () => {
    render(<App />)
    await openFile('/made-up/unsaid.tre', '#NEXUS\nbegin trees; tree t = ((a,b),c); end;')
    const question = await screen.findByRole('combobox', { name: /Are the trees in this file that don’t say rooted\?/ })
    fireEvent.change(question, { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open tree' }))
    await waitFor(() => expect(status().textContent).toMatch(/^Opened unsaid\.tre\./))
  })

  it('roots on a tip as a new tree that is shown with its note, and saves it only to a new file', async () => {
    render(<App />)
    await openFile('/made-up/two.nex', NEXUS)
    await waitFor(() => expect(status().textContent).toMatch(/^Opened/))
    fireEvent.click(within(screen.getByRole('tree')).getByText('Alpha'))
    fireEvent.click(screen.getByRole('button', { name: 'Root on this tip (outgroup)' }))
    expect(status().textContent).toMatch(/^Made a new tree, “two: one \(rerooted on Alpha\)”, and showed it\. two\.nex is unchanged/)
    const show = within(document.querySelector('.app-header') as HTMLElement).getByRole('combobox', { name: 'Show' }) as HTMLSelectElement
    expect(show.value).toBe('phylogeny:two:1-outgroup')
    expect(show.options).toHaveLength(3)
    expect(document.querySelector('.ot-rooting')!.textContent).toMatch(/^Rooting: Rerooted on the outgroup Alpha \(.+\) from two:1 version/)

    // The open file is refused as a save target, before anything is written.
    vi.mocked(dialog.save).mockResolvedValueOnce('/made-up/two.nex')
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot…' }))
    await waitFor(() => expect(status().textContent).toMatch(/^Could not save: That is the file you opened, and OneTaxonomy never writes over it\. Nothing was changed\./))
    expect(calls).toEqual([])

    vi.mocked(dialog.save).mockResolvedValueOnce('/made-up/two-rooted.snapshot.json')
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot…' }))
    await waitFor(() => expect(status().textContent).toMatch(/^Saved snapshot to two-rooted\.snapshot\.json\./))
    expect(vi.mocked(dialog.save).mock.calls.at(-1)![0]!.defaultPath).toBe('two-rooted.snapshot.json')
    expect(calls).toEqual(['write /made-up/two-rooted.snapshot.json.tmp', 'rename /made-up/two-rooted.snapshot.json.tmp -> /made-up/two-rooted.snapshot.json'])
    const saved = JSON.parse(written.get('/made-up/two-rooted.snapshot.json')!) as DatasetSnapshot
    expect(saved.phylogenies.map((p) => p.id)).toEqual(['two:1', 'two:2', 'two:1-outgroup'])
    expect(verifySnapshot(saved)).toBe(true)
  })

  it('compares two trees from one file, and says why when their tips are not mapped to taxa', async () => {
    render(<App />)
    await openFile('/made-up/two.nex', NEXUS)
    await waitFor(() => expect(status().textContent).toMatch(/^Opened/))
    const details = screen.getByText('Compare with…').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(within(details).getByRole('status').textContent).toMatch(/no explicit concept mapping; tips are matched by concept, never by label/)
  })
})
