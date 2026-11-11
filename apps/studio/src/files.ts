import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { exists, readFile, readTextFile, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs'

import { OPEN_EXTENSIONS, kindOf } from './open'

/** Everything that touches the disk. Each file is one a person picked. */

export type PickedFile = { path: string; text: string; bytes?: Uint8Array }

export async function pickDataset(): Promise<PickedFile | null> {
  const path = await openDialog({ multiple: false, filters: [{ name: 'Checklists, archives, trees and snapshots', extensions: OPEN_EXTENSIONS }] })
  if (typeof path !== 'string') return null
  if (kindOf(path) === 'dwca') return { path, text: '', bytes: await readFile(path) }
  return { path, text: await readTextFile(path) }
}

export async function pickView(): Promise<string | null> {
  const path = await openDialog({ multiple: false, filters: [{ name: 'OneTaxonomy view', extensions: ['json'] }] })
  return typeof path === 'string' ? readTextFile(path) : null
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e))
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * Atomic: a crash while saving leaves the old file or the new one, never half of one. If the write or the rename
 * fails, the temporary file is removed and the original error is still reported. If it can't be removed either,
 * the error says so, so a leftover `.tmp` file is never a surprise.
 */
export async function writeFileSafely(path: string, text: string) {
  const temp = `${path}.tmp`
  try {
    await writeTextFile(temp, text)
    await rename(temp, path)
  } catch (error) {
    try {
      if (await exists(temp)) await remove(temp)
    } catch (cleanup) {
      throw new Error(`${sentence(describe(error))} The temporary file ${temp} couldn't be removed either (${describe(cleanup)}); you can delete it.`, { cause: error })
    }
    throw error
  }
}

export async function saveJson(defaultPath: string, text: string): Promise<string | null> {
  const path = await saveDialog({ defaultPath, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (!path) return null
  await writeFileSafely(path, text)
  return path
}
