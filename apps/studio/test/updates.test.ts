import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Mocked Tauri: this checks what the settings panel offers, not the real app.
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), readTextFile: vi.fn(), rename: vi.fn(), writeTextFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))

import { SettingsPanel } from '../src/App'
import { IN_APP_UPDATES } from '../src/updates'

describe('updates', () => {
  it('offers no update check while releases are unsigned', () => {
    expect(IN_APP_UPDATES).toBe(false)
    const html = renderToString(createElement(SettingsPanel, { settings: { autoUpdate: true, appearance: 'auto' }, onChange: () => {}, onCheck: () => {}, onClose: () => {} }))
    expect(html).toContain('Appearance')
    expect(html).not.toMatch(/Check now|Check for updates/)
  })
})
