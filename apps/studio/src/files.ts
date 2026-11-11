import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { exists, readFile, readTextFile, remove, rename, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { OPEN_EXTENSIONS, kindOf } from './open'

/** Everything that touches the disk. Each file is one a person picked. */

export type PickedFile = { path: string; text: string; bytes?: Uint8Array }

export async function pickDataset(): Promise<PickedFile | null> {
  const path = await openDialog({ multiple: false, filters: [{ name: 'Checklists, archives, trees, snapshots and bundles', extensions: OPEN_EXTENSIONS }] })
  if (typeof path !== 'string') return null
  const kind = kindOf(path)
  if (kind === 'dwca' || kind === 'bundle') return { path, text: '', bytes: await readFile(path) }
  return { path, text: await readTextFile(path) }
}

export const TREE_EXTENSIONS = OPEN_EXTENSIONS.filter((e) => ['newick', 'nexus', 'phyloxml'].includes(kindOf(`x.${e}`) ?? ''))

/** A tree file to add to the open dataset. */
export async function pickTree(): Promise<PickedFile | null> {
  const path = await openDialog({ multiple: false, filters: [{ name: 'Newick, NEXUS and phyloXML trees', extensions: TREE_EXTENSIONS }] })
  if (typeof path !== 'string') return null
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
export async function writeFileSafely(path: string, contents: string | Uint8Array) {
  const temp = `${path}.tmp`
  try {
    if (typeof contents === 'string') await writeTextFile(temp, contents)
    else await writeFile(temp, contents)
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
 * Asks where to save, then saves safely. `never` is the path of the file that was opened (or
 * several: trees added to it count too): choosing one is refused before anything is written,
 * so an open file is never replaced.
 */
export const saveJson = (defaultPath: string, text: string, options: { never?: string | string[] } = {}) => saveAs(defaultPath, text, { name: 'JSON', extensions: ['json'] }, options)

/** The same, for a `.onetaxonomy` bundle's bytes. */
export const saveBundle = (defaultPath: string, bytes: Uint8Array, options: { never?: string | string[] } = {}) =>
  saveAs(defaultPath, bytes, { name: 'OneTaxonomy bundle', extensions: ['onetaxonomy'] }, options)

async function saveAs(defaultPath: string, contents: string | Uint8Array, filter: { name: string; extensions: string[] }, { never }: { never?: string | string[] }): Promise<string | null> {
  const path = await saveDialog({ defaultPath, filters: [filter] })
  if (!path) return null
  // macOS volumes usually ignore case, so the comparison does too: a false refusal is safer than an overwrite.
  if ([never ?? []].flat().some((p) => p && path.toLowerCase() === p.toLowerCase())) throw new Error(OPENED_FILE_REFUSAL)
  await writeFileSafely(path, contents)
  return path
}
