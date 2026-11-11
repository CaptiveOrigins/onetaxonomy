import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mocked Tauri file system: this checks the order of file calls, not the real disk.
const calls: string[] = []
const onDisk = new Set<string>()
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn(async () => '/made-up/view.json') }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  exists: vi.fn(async (path: string) => onDisk.has(path)),
  writeTextFile: vi.fn(async (path: string) => { calls.push(`write ${path}`); onDisk.add(path) }),
  rename: vi.fn(async (from: string, to: string) => { calls.push(`rename ${from} -> ${to}`); onDisk.delete(from); onDisk.add(to) }),
  remove: vi.fn(async (path: string) => { calls.push(`remove ${path}`); onDisk.delete(path) }),
}))

const { OPENED_FILE_REFUSAL, TREE_EXTENSIONS, pickTree, saveJson } = await import('../src/files')

describe('saving', () => {
  beforeEach(() => { calls.length = 0; onDisk.clear() })
  it('writes a temporary file and renames it over the chosen one, so a crash never leaves half a file', async () => {
    expect(await saveJson('view.json', '{}')).toBe('/made-up/view.json')
    expect(calls).toEqual(['write /made-up/view.json.tmp', 'rename /made-up/view.json.tmp -> /made-up/view.json'])
  })
  it('leaves the old file alone when writing fails', async () => {
    const fs = await import('@tauri-apps/plugin-fs')
    vi.mocked(fs.writeTextFile).mockRejectedValueOnce(new Error('disk full'))
    await expect(saveJson('view.json', '{}')).rejects.toThrow(/disk full/)
    expect(calls).toEqual([])
  })
  it('writes nothing when the person cancels the save dialog', async () => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    vi.mocked(dialog.save).mockResolvedValueOnce(null)
    expect(await saveJson('view.json', '{}')).toBeNull()
    expect(calls).toEqual([])
  })
  it('reports a failed rename instead of claiming the save worked, and removes the temporary file', async () => {
    const fs = await import('@tauri-apps/plugin-fs')
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('permission denied'))
    await expect(saveJson('view.json', '{}')).rejects.toThrow(/^permission denied$/)
    expect(calls).toEqual(['write /made-up/view.json.tmp', 'remove /made-up/view.json.tmp'])
    expect(onDisk.has('/made-up/view.json.tmp')).toBe(false)
  })
  it("still reports the original error when the temporary file can't be removed, and says it was left", async () => {
    const fs = await import('@tauri-apps/plugin-fs')
    // Tauri reports errors as plain strings.
    vi.mocked(fs.rename).mockRejectedValueOnce('permission denied')
    vi.mocked(fs.remove).mockRejectedValueOnce(new Error('read-only volume'))
    const error = await saveJson('view.json', '{}').then(() => null, (e: unknown) => e as Error)
    expect(error?.message).toBe("permission denied. The temporary file /made-up/view.json.tmp couldn't be removed either (read-only volume); you can delete it.")
    expect(error?.cause).toBe('permission denied')
  })
  it('refuses to write over the file that was opened, before writing anything, whatever the case of its name', async () => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    vi.mocked(dialog.save).mockResolvedValueOnce('/made-up/Trees.json').mockResolvedValueOnce('/made-up/trees-rooted.json')
    await expect(saveJson('trees-rooted.json', '{}', { never: '/made-up/trees.json' })).rejects.toThrow(OPENED_FILE_REFUSAL)
    expect(calls).toEqual([])
    expect(await saveJson('trees-rooted.json', '{}', { never: '/made-up/trees.json' })).toBe('/made-up/trees-rooted.json')
    expect(calls).toEqual(['write /made-up/trees-rooted.json.tmp', 'rename /made-up/trees-rooted.json.tmp -> /made-up/trees-rooted.json'])
  })
  it('refuses every file the dataset came from, trees added to it included', async () => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    vi.mocked(dialog.save).mockResolvedValueOnce('/made-up/Added.NWK').mockResolvedValueOnce('/made-up/checklist.json')
    const never = ['/made-up/checklist.json', '/made-up/added.nwk']
    await expect(saveJson('x.json', '{}', { never })).rejects.toThrow(OPENED_FILE_REFUSAL)
    await expect(saveJson('x.json', '{}', { never })).rejects.toThrow(OPENED_FILE_REFUSAL)
    expect(calls).toEqual([])
  })
})

describe('adding a tree', () => {
  it('offers only tree files in the dialog', async () => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    const fs = await import('@tauri-apps/plugin-fs')
    vi.mocked(dialog.open).mockResolvedValueOnce('/made-up/t.nwk')
    vi.mocked(fs.readTextFile).mockResolvedValueOnce('(a,b);')
    expect(await pickTree()).toEqual({ path: '/made-up/t.nwk', text: '(a,b);' })
    expect(TREE_EXTENSIONS).toEqual(['nwk', 'newick', 'tree', 'tre', 'treefile', 'nex', 'nexus', 'nxs', 'xml', 'phyloxml'])
    expect(vi.mocked(dialog.open).mock.calls.at(-1)![0]!.filters![0]!.extensions).toEqual(TREE_EXTENSIONS)
  })
})
