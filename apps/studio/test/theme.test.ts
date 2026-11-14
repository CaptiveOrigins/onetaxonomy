// Accessibility audit, 2026-11-11: the studio's colors and headings. Contrast is computed from the stylesheets;
// nothing here was looked at in the built app or with a screen reader.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Read as text: Vitest hands CSS imports to tests as empty strings, `?raw` included.
const appCss = readFileSync(join(__dirname, '../src/app.css'), 'utf8')
const libraryCss = readFileSync(join(__dirname, '../../../packages/react/src/styles.css'), 'utf8')

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
const vars = (text: string, prefix: string) => Object.fromEntries([...text.matchAll(new RegExp(`(${prefix}[a-z-]+):\\s*(#[0-9a-f]{6}|var\\([^)]*\\))`, 'g'))].map((m) => [m[1]!, m[2]!]))
const block = (text: string, start: string) => {
  const at = text.indexOf(start)
  expect(at, start).toBeGreaterThanOrEqual(0)
  return text.slice(at, text.indexOf('}', at))
}

describe('studio colors', () => {
  const light = vars(block(appCss, ':root {'), '--')
  const dark = vars(block(appCss, ":root[data-appearance='dark'] {"), '--')

  it('meets WCAG AA in light and dark: text 4.5:1, focus ring and field borders 3:1 on the page', () => {
    for (const v of [light, dark]) {
      for (const fg of ['--text', '--muted']) for (const bg of ['--bg', '--panel', '--field']) expect(contrast(v[fg]!, v[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      for (const bg of ['--bg', '--field']) expect(contrast(v['--field-border']!, v[bg]!), `field border on ${bg}`).toBeGreaterThanOrEqual(3)
      for (const bg of ['--bg', '--panel', '--field']) expect(contrast(v['--focus']!, v[bg]!), `focus ring on ${bg}`).toBeGreaterThanOrEqual(3)
      for (const bg of ['--bg', '--panel']) expect(contrast(v['--error']!, v[bg]!), `errors on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('draws focus rings in the darker orange in light, the lighter orange in dark, and keeps the brand orange as the accent (owner decision, 2026-11-11)', () => {
    expect(light['--focus']).toBe('#a65f20')
    expect(dark['--focus']).toBe('#e7a066')
    expect(light['--accent']).toBe('#cf8137')
    expect(vars(block(appCss, ':root:not('), '--')['--focus']).toBe('#e7a066')
    const rings = [...appCss.matchAll(/:focus-visible \{ outline: 2px solid ([^;]+);/g)].map((m) => m[1])
    expect(rings.length).toBeGreaterThan(0)
    for (const ring of rings) expect(ring).toBe('var(--focus)')
  })

  it('the shell colors match the OneOrigin tokens built into oneorigin.css, in light and both dark blocks', () => {
    // oneorigin.css is written from brand/oneorigin/tokens.json by `node scripts/oneorigin.mjs build`; CI's `check` keeps it current.
    const tokenCss = readFileSync(join(__dirname, '../src/oneorigin.css'), 'utf8')
    const shell: Record<string, string> = { '--bg': '--ot-background', '--panel': '--ot-panel', '--text': '--ot-text', '--muted': '--ot-muted', '--border': '--ot-border', '--accent': '--ot-accent', '--focus': '--ot-focus', '--error': '--ot-error' }
    for (const start of [':root {', ':root:not(', ":root[data-appearance='dark'] {"]) {
      const app = vars(block(appCss, start), '--')
      const built = vars(block(tokenCss, start), '--ot-')
      for (const [name, token] of Object.entries(shell)) expect(app[name], `${start} ${name} = ${token}`).toBe(built[token])
    }
  })

  it('a chosen appearance sets the explorer colors too, with the library values', () => {
    // Without this, Light on a dark system drew the explorer's light text (#eef1f6) on a white page: 1.13:1.
    const libLight = vars(block(libraryCss, '.ot-tip-links {'), '--ot-')
    const libDark = vars(block(libraryCss, '@media (prefers-color-scheme: dark)'), '--ot-')
    expect(vars(block(appCss, ":root[data-appearance='light'] :is("), '--ot-')).toEqual(libLight)
    expect(vars(block(appCss, ":root[data-appearance='dark'] :is("), '--ot-')).toEqual(libDark)
    expect(Object.keys(libLight).length).toBeGreaterThan(10)
  })
})

describe('studio structure', () => {
  it('has a banner with a level-one heading, a main region and a status region', async () => {
    const { App } = await import('../src/App')
    const html = renderToStaticMarkup(createElement(App))
    expect(html).toMatch(/^<header class="app-header"><h1 class="app-title">OneTaxonomy<\/h1>/)
    expect(html).toContain('<div class="app-status" role="status">')
    expect(html).toContain('<p class="app-error" role="alert"></p>')
    expect(html).toContain('<main class="app-main"><section class="app-panel"><h2>Open a dataset</h2>')
  })
})
