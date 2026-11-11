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

/** Thrown before anything is written when the chosen file is the one that was opened. */
export const OPENED_FILE_REFUSAL = "That is the file you opened, and OneTaxonomy never writes over it."

/**
 * Asks where to save, then saves safely. `never` is the path of the file that was opened:
 * choosing it is refused before anything is written, so an open file is never replaced.
 */
export async function saveJson(defaultPath: string, text: string, { never }: { never?: string } = {}): Promise<string | null> {
  const path = await saveDialog({ defaultPath, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (!path) return null
  // macOS volumes usually ignore case, so the comparison does too: a false refusal is safer than an overwrite.
  if (never && path.toLowerCase() === never.toLowerCase()) throw new Error(OPENED_FILE_REFUSAL)
  await writeFileSafely(path, text)
  return path
}
