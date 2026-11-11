// @vitest-environment jsdom
// Accessibility audit, 2026-11-11 (docs/test-audit.md): keyboard paths, status regions, contrast of the default
// themes, words instead of color alone, and titled SVG exports. No screen reader was run; these check the markup.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createView, describeView, indexDataset, projectView, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import { createLesson, sceneFromView } from '@captiveorigins/onetaxonomy-education'
import { Explorer, LessonPlayer, standaloneSvg, TreeOutline } from '../src'
import checklistJson from '../../../fixtures/checklist.json'
import amniotesJson from '../../../fixtures/amniotes.json'

const cl = indexDataset(checklistJson as DatasetSnapshot)
const am = indexDataset(amniotesJson as DatasetSnapshot)
const clView = () => createView(cl, { id: 'v', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** WCAG 2.2 relative luminance and contrast ratio. */
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

const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8')
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)')
const vars = (text: string) => Object.fromEntries([...text.matchAll(/(--ot-[a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]))
const themes = { light: vars(css.slice(0, darkAt)), dark: vars(css.slice(darkAt, css.indexOf('\n}\n', darkAt))) }

describe('contrast of the default themes (WCAG 1.4.3, 1.4.11)', () => {
  for (const [name, v] of Object.entries(themes)) {
    it(`${name}: text 4.5:1, lines and field borders 3:1`, () => {
      const text = ['--ot-text', '--ot-muted', '--ot-selected-text', '--ot-warning', '--ot-error']
      for (const fg of text) for (const bg of ['--ot-surface', '--ot-panel']) expect(contrast(v[fg]!, v[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      for (const fg of ['--ot-edge', '--ot-ink', '--ot-field-border']) for (const bg of ['--ot-surface', '--ot-panel']) expect(contrast(v[fg]!, v[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3)
      expect(contrast(v['--ot-focus']!, v['--ot-surface']!), 'focus ring on surface').toBeGreaterThanOrEqual(3)
      // Lesson markers: their digits sit on the selection color.
      const badge = /\.ot-badge text \{ fill: (#[0-9a-f]{6})/.exec(css)![1]!
      expect(contrast(badge, v['--ot-selected']!)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('uses no undefined color variable, and remove buttons are at least 24 px (WCAG 2.5.8)', () => {
    const defined = new Set([...css.matchAll(/(--ot-[a-z-]+):/g)].map((m) => m[1]))
    for (const [, used] of css.matchAll(/var\((--ot-[a-z-]+)/g)) expect(defined.has(used), used).toBe(true)
    expect(css).toMatch(/\.ot-explorer \.ot-remove \{ height: 24px; width: 24px;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.ot-node:not\(\[data-dragging\]\) \{ transition/)
  })
})

describe('tree outline keys (WCAG 2.1.1)', () => {
  it('does what the README and the hint say: Home, End, Right, Left, Enter, Space, Shift+Space, *', () => {
    const selected: [string, boolean][] = []
    const toggled: string[] = []
    const v = { ...clView(), collapsed: ['fx:2', 'fx:14', 'fx:22'] }
    render(<TreeOutline projection={projectView(cl, v)} label="Outline" onToggle={(id) => toggled.push(id)} onSelect={(id, o) => selected.push([id, Boolean(o?.additive)])} />)
    const tree = screen.getByRole('tree', { name: 'Outline' })
    expect(tree.getAttribute('aria-multiselectable')).toBe('true')
    const label = () => document.activeElement!.querySelector('.ot-outline-label')!.textContent
    const key = (k: string, extra: object = {}) => fireEvent.keyDown(document.activeElement!, { key: k, ...extra })
    screen.getAllByRole('treeitem')[0]!.focus()
    key('End')
    expect(label()).toBe('Zetiformes')
    key('Home')
    expect(label()).toBe('Exemplaria')
    key('ArrowRight') // open branch: Right goes to its first child
    expect(label()).toBe('Alphiformes')
    key('ArrowRight') // closed branch: Right opens it
    expect(toggled).toEqual(['fx:2'])
    key('Enter') // Enter on a branch opens or closes it
    expect(toggled).toEqual(['fx:2', 'fx:2'])
    key('ArrowLeft') // closed child: Left goes to the parent
    expect(label()).toBe('Exemplaria')
    key('ArrowDown')
    key(' ')
    key(' ', { shiftKey: true })
    expect(selected).toEqual([['fx:2', false], ['fx:2', true]])
    key('*') // opens every closed sibling
    expect(toggled.slice(2)).toEqual(['fx:2', 'fx:14', 'fx:22'])
  })

  it('says "extinct" for the † mark, which screen readers read as "dagger"', () => {
    const p = projectView(cl, clView())
    render(<TreeOutline projection={{ ...p, nodes: p.nodes.map((n) => (n.id === 'fx:3' ? { ...n, status: 'extinct' as const } : n)) }} label="Outline" />)
    const item = screen.getAllByRole('treeitem').find((i) => i.querySelector('.ot-outline-label')!.textContent!.startsWith('Alphidae'))!
    const mark = [...item.querySelectorAll('.ot-outline-label > span')]
    expect(mark[0]!.getAttribute('aria-hidden')).toBe('true')
    expect(mark[0]!.textContent).toBe(' †')
    expect(mark[1]!.textContent).toBe(' (extinct)')
  })
})

describe('explorer keyboard and status (WCAG 2.1.1, 2.4.7, 4.1.3)', () => {
  it('documents and handles the drawing keys: arrows pan, + and − zoom, 0 fits, Escape clears', () => {
    const { container } = render(<Explorer dataset={cl} initialView={{ ...clView(), selected: ['fx:3'] }} title="Checklist" />)
    const canvas = screen.getByRole('group', { name: /arrow keys pan, \+ and − zoom, 0 fits, Escape clears the selection/ })
    expect(canvas.tabIndex).toBe(0)
    const box = () => container.querySelector('svg.ot-root')!.getAttribute('viewBox')
    const fit = box()
    fireEvent.keyDown(canvas, { key: '+' })
    const zoomed = box()
    expect(zoomed).not.toBe(fit)
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect(box()).not.toBe(zoomed)
    fireEvent.keyDown(canvas, { key: '-' })
    fireEvent.keyDown(canvas, { key: '0' })
    expect(box()).toBe(fit)
    expect(screen.getByRole('region', { name: 'Details' }).textContent).toMatch(/^Alphidae/)
    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(screen.getByRole('region', { name: 'Details' }).textContent).toMatch(/In the outline: Up and Down move/)
  })

  it('the download menu takes focus, moves with arrows, and Escape returns focus to its button', () => {
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const button = screen.getByRole('button', { name: 'Download' })
    fireEvent.click(button)
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1]!, { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2]!, { key: 'ArrowDown' }) // wraps
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0]!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('a failed export is said in a status region that was already there', async () => {
    const { container } = render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const region = container.querySelector('.ot-error')!
    expect(region.getAttribute('role')).toBe('status')
    expect(region.textContent).toBe('')
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: () => { throw new Error('No room on the disk.') } }))
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Image (PNG)' }))
    await waitFor(() => expect(region.textContent).toBe('Could not export the drawing: No room on the disk.'))
    expect(container.querySelector('.ot-error')).toBe(region)
  })

  it('the clade answer lives in a status region that stays mounted', () => {
    const { container } = render(<Explorer dataset={am} initialView={{ ...createView(am, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } }), selected: ['t-crocodylia', 't-aves'] }} title="A" />)
    const panel = screen.getByRole('region', { name: 'Details' })
    const region = within(panel).getByRole('status')
    expect(region.textContent).toMatch(/A clade in/)
    const squamata = container.querySelector('.ot-node[data-id="t-squamata"]')!
    fireEvent.pointerDown(squamata, { clientX: 1, clientY: 1, shiftKey: true })
    fireEvent.pointerUp(squamata, { clientX: 1, clientY: 1 })
    expect(within(panel).getByRole('status')).toBe(region)
    expect(region.textContent).toMatch(/Not a clade/)
  })
})

describe('exports and lessons', () => {
  it('an exported SVG keeps its title and description, so it says what it shows on its own (WCAG 1.1.1)', () => {
    const v = clView()
    const { container } = render(<Explorer dataset={cl} initialView={v} title="Illustrative checklist" />)
    const text = standaloneSvg(container.querySelector('svg.ot-root') as SVGSVGElement, describeView(cl, v, projectView(cl, v)))
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    expect(text.match(/xmlns=/g)).toHaveLength(1) // the attribute twice made the file invalid XML
    const svg = doc.documentElement
    expect(svg.tagName).toBe('svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect([...svg.children].slice(0, 2).map((c) => c.tagName)).toEqual(['title', 'desc'])
    const title = doc.getElementById(svg.getAttribute('aria-labelledby')!)
    const desc = doc.getElementById(svg.getAttribute('aria-describedby')!)
    expect(title?.tagName).toBe('title')
    expect(title?.textContent).toBe('Illustrative checklist')
    expect(desc?.tagName).toBe('desc')
    expect(desc?.textContent).toMatch(/not common ancestry\. 25 of 25 shown\./)
  })

  it('lesson modes are one tab stop with arrow keys, and a caution says so in words', () => {
    const deck = createLesson(am, { id: 'l', title: 'Reptiles?' })
    const s = sceneFromView(createView(am, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } }), { id: 's1', title: 'Amniotes' })
    s.annotations = [{ id: 'a1', text: 'Not every reptile-looking animal is close kin.', target: { kind: 'node', node: 't-aves' }, tone: 'caution' }]
    deck.scenes.push(s)
    render(<LessonPlayer dataset={am} deck={deck} />)
    expect(screen.getByText('Caution:').closest('li')!.textContent).toBe('Caution: Not every reptile-looking animal is close kin.')
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1])
    radios[0]!.focus()
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Explore' }).getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Explore' }))
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([-1, 0])
  })
})
