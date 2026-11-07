import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { load } from '@tauri-apps/plugin-store'
import { check } from '@tauri-apps/plugin-updater'

/** No signing key yet, so releases have no update file. Turn this on with the key. */
export const IN_APP_UPDATES = false

/** App settings (stored on this Mac). Appearance: follow the system, or always light/dark. */
export type Appearance = 'auto' | 'light' | 'dark'
export type Settings = { autoUpdate: boolean; appearance: Appearance }

const store = () => load('settings.json', { autoSave: true, defaults: { autoUpdate: true, appearance: 'auto' } })

export async function loadSettings(): Promise<Settings> {
  const s = await store()
  return { autoUpdate: (await s.get<boolean>('autoUpdate')) ?? true, appearance: (await s.get<Appearance>('appearance')) ?? 'auto' }
}

export async function saveSettings(settings: Settings) {
  const s = await store()
  await s.set('autoUpdate', settings.autoUpdate)
  await s.set('appearance', settings.appearance)
}

/**
 * Look for a newer signed release on GitHub; ask before installing, then
 * restart. Returns a message for the status bar (null when there is nothing to
 * say on an automatic check).
 */
export async function checkForUpdates(manual: boolean): Promise<string | null> {
  try {
    const update = await check()
    if (!update) return manual ? 'You have the latest version.' : null
    // The web view ignores window.confirm on macOS: ask with a native dialog.
    if (!(await ask(`OneTaxonomy ${update.version} is available. Install it now? The app restarts afterwards.`, { title: 'Update available', okLabel: 'Install', cancelLabel: 'Later' })))
      return `Update ${update.version} is available.`
    await update.downloadAndInstall()
    await relaunch()
    return null
  } catch (e) {
    return manual ? `Could not check for updates: ${(e as Error).message} Check your connection and try again.` : null
  }
}
