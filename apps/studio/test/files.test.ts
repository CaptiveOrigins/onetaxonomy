import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn(async () => '/made-up/view.json') }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(async (path: string) => { calls.push(`write ${path}`) }),
  rename: vi.fn(async (from: string, to: string) => { calls.push(`rename ${from} -> ${to}`) }),
}))

const { saveJson } = await import('../src/files')

describe('saving', () => {
  beforeEach(() => { calls.length = 0 })
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
  it('reports a failed rename instead of claiming the save worked', async () => {
    const fs = await import('@tauri-apps/plugin-fs')
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('permission denied'))
    await expect(saveJson('view.json', '{}')).rejects.toThrow(/permission denied/)
    expect(calls).toEqual(['write /made-up/view.json.tmp'])
  })
})
