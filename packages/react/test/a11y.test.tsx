// @vitest-environment jsdom
// Accessibility audit, 2026-11-11 (docs/test-audit.md): keyboard paths, status regions, contrast of the default
// themes, words instead of color alone, and titled SVG exports. No screen reader was run; these check the markup.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createView, describeView, indexDataset, makeHighlight, projectView, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import { createLesson, sceneFromView } from '@captiveorigins/onetaxonomy-education'
import { Explorer, Legend, LessonPlayer, MARK_SHAPES, shapePath, standaloneSvg, TreeOutline } from '../src'
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

// Gaps closed after the audit (K481, 2026-11-11): single-pointer alternatives, the toolbar pattern, visible reasons,
// target size and shapes alongside color.
describe('without dragging (WCAG 2.5.7)', () => {
  const order = () => screen.getAllByRole('treeitem').map((i) => i.querySelector('.ot-outline-label')!.textContent)
  it('Move up and Move down in the inspector reorder siblings, and are disabled at the ends', () => {
    const changes: string[][] = []
    const v = { ...clView(), collapsed: ['fx:14', 'fx:22', 'fx:10', 'fx:8'], selected: ['fx:5'] }
    render(<Explorer dataset={cl} initialView={v} title="Checklist" onViewChange={(x) => changes.push(x.order['fx:4'] ?? [])} />)
    const up = screen.getByRole('button', { name: 'Move up' }) as HTMLButtonElement
    const down = screen.getByRole('button', { name: 'Move down' }) as HTMLButtonElement
    expect(up.disabled).toBe(true) // Alphus primus is first under Alphus
    expect(down.disabled).toBe(false)
    const before = order()
    expect(before.indexOf('Alphus primus')).toBeLessThan(before.indexOf('Alphus secundus'))
    fireEvent.click(down)
    expect(changes.at(-1)).toEqual(['fx:6', 'fx:5'])
    expect(order().indexOf('Alphus primus')).toBeGreaterThan(order().indexOf('Alphus secundus'))
    expect((screen.getByRole('button', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }))
    expect(changes.at(-1)).toEqual(['fx:5', 'fx:6'])
    // One undo step per press, like Alt+Up and Alt+Down.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(order().indexOf('Alphus primus')).toBeGreaterThan(order().indexOf('Alphus secundus'))
  })

  it('has no move buttons for a root or an only child', () => {
    render(<Explorer dataset={cl} initialView={{ ...clView(), selected: ['fx:1'] }} title="Checklist" />)
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull()
    cleanup()
    render(<Explorer dataset={cl} initialView={{ ...clView(), selected: ['fx:7'] }} title="Checklist" />) // the only subspecies
    expect(screen.queryByRole('button', { name: 'Move down' })).toBeNull()
  })

  it('pan buttons move the view a tenth of its size each way, and Fit brings it back', () => {
    const { container } = render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const box = () => container.querySelector('svg.ot-root')!.getAttribute('viewBox')!.split(' ').map(Number) as [number, number, number, number]
    const [x, y, w, h] = box()
    fireEvent.click(screen.getByRole('button', { name: 'Pan right' }))
    expect(box()[0]).toBeCloseTo(x + w / 10)
    fireEvent.click(screen.getByRole('button', { name: 'Pan down' }))
    expect(box()[1]).toBeCloseTo(y + h / 10)
    fireEvent.click(screen.getByRole('button', { name: 'Pan left' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pan up' }))
    expect(box()[0]).toBeCloseTo(x)
    expect(box()[1]).toBeCloseTo(y)
    fireEvent.click(screen.getByRole('button', { name: 'Pan left' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }))
    expect(box()).toEqual([x, y, w, h])
    // Each icon-only button has a visible tooltip with its name.
    for (const name of ['Pan left', 'Pan right', 'Pan up', 'Pan down']) expect(screen.getByRole('button', { name }).getAttribute('data-tip')).toBe(name)
  })
})

describe('toolbars (WAI-ARIA toolbar pattern)', () => {
  const stops = (bar: HTMLElement) => [...bar.querySelectorAll<HTMLElement>('button, select, input')].filter((el) => el.tabIndex === 0 && !(el as HTMLButtonElement).disabled)
  it('is one Tab stop; Left and Right move and wrap, Home and End jump, disabled controls are skipped', () => {
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const bar = screen.getByRole('toolbar', { name: 'Checklist' })
    expect(stops(bar).map((el) => el.textContent)).toEqual(['Propose changes']) // Undo and Redo are disabled
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k })
    stops(bar)[0]!.focus()
    key('ArrowRight')
    expect(document.activeElement!.textContent).toBe('Expand all')
    key('ArrowLeft')
    key('ArrowLeft') // wraps to the last enabled control
    const last = document.activeElement as HTMLElement
    key('Home')
    expect(document.activeElement!.textContent).toBe('Propose changes')
    key('End')
    expect(document.activeElement).toBe(last)
    // The control last used keeps the Tab stop.
    expect(stops(bar)).toEqual([last])
    // Selects are stops in the row too.
    within(bar).getByRole('combobox', { name: /Layout/ }).focus()
    key('ArrowRight')
    expect(document.activeElement).toBe(within(bar).getByRole('combobox', { name: /Show/ }))
  })

  it('gives the Tab stop to the first enabled control when the remembered one becomes disabled', () => {
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const bar = screen.getByRole('toolbar', { name: 'Checklist' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Collapse all' }))
    const undo = within(bar).getByRole('button', { name: 'Undo' })
    undo.focus()
    expect(stops(bar)).toEqual([undo])
    fireEvent.click(undo)
    expect((undo as HTMLButtonElement).disabled).toBe(true)
    expect(stops(bar).map((el) => el.textContent)).toEqual(['Redo'])
  })

  it('leaves the arrows to the number field, so typing a threshold still works', () => {
    render(<Explorer dataset={am} initialView={createView(am, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } })} title="A" />)
    const field = screen.getByRole('spinbutton', { name: 'Collapse support below' })
    field.focus()
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    fireEvent.keyDown(field, { key: 'Home' })
    expect(document.activeElement).toBe(field)
  })

  it('the drawing controls are a toolbar too', () => {
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const bar = screen.getByRole('toolbar', { name: 'Drawing controls' })
    const zoomIn = within(bar).getByRole('button', { name: 'Zoom in' })
    expect(stops(bar)).toEqual([zoomIn])
    zoomIn.focus()
    fireEvent.keyDown(zoomIn, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(within(bar).getByRole('button', { name: 'Zoom out' }))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(within(bar).getByRole('button', { name: 'Print' }))
  })
})

describe('reasons and targets', () => {
  it('says in visible text why a layout is unavailable, and the layout select points at it', () => {
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const select = screen.getByRole('combobox', { name: /Layout/ })
    const reason = document.getElementById(select.getAttribute('aria-describedby')!)!
    expect(reason.textContent).toBe('Not available here: phylogram and time: A classification has no branch lengths or ages: use rectangular, radial or sunburst.')
    expect(reason.checkVisibility?.() ?? true).toBe(true)
    expect(reason.closest('[role="toolbar"]')).toBeNull()
    cleanup()
    // Amniotes has no branch lengths and isn't dated: two reasons, one sentence each.
    render(<Explorer dataset={am} initialView={createView(am, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } })} title="A" />)
    expect(document.querySelector('.ot-layout-reasons')!.textContent).toBe('Not available here: phylogram: This hypothesis has no branch lengths with a stated unit: a phylogram would invent them. time: This hypothesis is not time-calibrated: a time scale would invent dates.')
  })

  it('fold arrows in the outline are 24 px targets (WCAG 2.5.8)', () => {
    expect(css).toMatch(/\.ot-outline-twisty \{ display: inline-flex; align-items: center; justify-content: center; width: 24px; min-height: 24px;/)
  })
})

describe('not by color alone in the drawing (WCAG 1.4.1)', () => {
  const traitSnapshot = (): DatasetSnapshot => ({
    ...(JSON.parse(JSON.stringify(amniotesJson)) as DatasetSnapshot),
    // Two made-up states in nearly the same color, so only the shape tells them apart.
    traits: [{ id: 'repro', title: 'Reproduction', source: 'fixture', states: [{ id: 'egg', label: 'Lays eggs', color: '#cc3333' }, { id: 'live', label: 'Live birth', color: '#cc3334' }], values: [{ concept: 'c:testudines', state: 'egg' }, { concept: 'c:mammalia', state: 'live' }] }],
  })

  it('every shape is a closed path', () => {
    for (const shape of MARK_SHAPES) expect(shapePath(shape, 5)).toMatch(/^M.*Z$/)
    expect(new Set(MARK_SHAPES.map((s) => shapePath(s, 5))).size).toBe(MARK_SHAPES.length)
  })

  it('draws each highlight in its own shape, and the legend shows the same shape beside its name', () => {
    const v = createView(am, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } })
    const a = { ...makeHighlight(am, v, { id: 'a', label: 'Archosaurs', members: ['t-crocodylia', 't-aves'] }), color: '#cf8137' }
    const b = { ...makeHighlight(am, v, { id: 'b', label: 'Turtles', members: ['t-testudines'] }), color: '#cf8138' }
    const { container } = render(<Explorer dataset={am} initialView={{ ...v, highlights: [a, b] }} title="A" />)
    const halo = (id: string) => container.querySelector(`.ot-node[data-id="${id}"] .ot-node-halo`)!.getAttribute('data-shape')
    expect([halo('t-crocodylia'), halo('t-aves'), halo('t-testudines')]).toEqual(['circle', 'circle', 'square'])
    const legend = container.querySelector('.ot-legend')!
    const entry = (name: string) => [...legend.querySelectorAll('li')].find((li) => li.textContent!.startsWith(name))!.querySelector('svg')!
    expect(entry('Archosaurs').getAttribute('data-shape')).toBe('circle')
    expect(entry('Turtles').getAttribute('data-shape')).toBe('square')
    expect(entry('Turtles').getAttribute('aria-hidden')).toBe('true')
  })

  it('draws each trait state in its own shape, matching the legend; mixed stays a dashed outline', () => {
    const d = indexDataset(traitSnapshot())
    const v = { ...createView(d, { id: 'v', title: 'A', target: { kind: 'classification', id: 'traditional' } }), overlays: { trait: 'repro' } }
    const { container } = render(<Explorer dataset={d} initialView={v} title="A" />)
    const mark = (id: string) => container.querySelector(`.ot-node[data-id="${id}"] .ot-trait`)!.getAttribute('data-shape')
    expect(mark('c:testudines')).toBe('circle')
    expect(mark('c:mammalia')).toBe('square')
    const list = screen.getByRole('list', { name: 'Reproduction' })
    const shapeOf = (state: string) => list.querySelector(`li[data-trait="${state}"] svg`)!.getAttribute('data-shape')
    expect([shapeOf('egg'), shapeOf('live'), shapeOf('mixed'), shapeOf('none')]).toEqual(['circle', 'square', 'circle', 'circle'])
    expect(list.querySelector('li[data-trait="mixed"] svg')!.getAttribute('data-trait')).toBe('mixed')
    expect(css).toMatch(/\.ot-swatch-shape\[data-trait='mixed'\] path \{ fill: none; stroke: var\(--ot-muted\); stroke-dasharray: 2 2; \}/)
  })

  it('the Legend on its own numbers shapes by the highlights it is given', () => {
    const v = createView(am, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } })
    const hs = ['a', 'b', 'c'].map((id, i) => ({ ...makeHighlight(am, v, { id, label: id.toUpperCase(), members: ['t-aves'] }), color: `#00000${i}` }))
    const { container } = render(<Legend layout={{ notice: '' } as never} highlights={hs} />)
    expect([...container.querySelectorAll('svg')].map((s) => s.getAttribute('data-shape'))).toEqual(['circle', 'square', 'diamond'])
  })
})
