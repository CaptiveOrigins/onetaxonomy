// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createView, describeView, indexDataset, makeHighlight, nodeOverlays, projectView, snapshotChecksum, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import { rectangular } from '@captiveorigins/onetaxonomy-layout'
import { createLesson, sceneFromView, type LessonDeck } from '@captiveorigins/onetaxonomy-education'
import { dropOrder, dropTarget, drawnSubtree, Explorer, LessonPlayer, standaloneSvg, TreeOutline, TreeView } from '../src'
import checklistJson from '../../../fixtures/checklist.json'
import amniotesJson from '../../../fixtures/amniotes.json'

const checklist = checklistJson as DatasetSnapshot
const cl = indexDataset(checklist)
const am = indexDataset(amniotesJson as DatasetSnapshot)
const clView = () => createView(cl, { id: 'v', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } })
afterEach(cleanup)

describe('TreeView (server render)', () => {
  it('renders an accessible SVG that says what kind of diagram it is', () => {
    const p = projectView(cl, clView())
    const html = renderToStaticMarkup(<TreeView projection={p} layout={rectangular(p)} title="Illustrative checklist" />)
    expect(html).toContain('role="img"')
    expect(html).toContain('<title')
    expect(html).toMatch(/not common ancestry\. 25 of 25 shown\./)
    expect(html).toContain('data-diagram="classification"')
    expect(html.match(/class="ot-node"/g)).toHaveLength(25)
    expect(html).toContain('data-italic="">Alphus primus')
  })

  it('marks clade highlights from the view', () => {
    const v = createView(am, { id: 'v', title: 't', target: { kind: 'phylogeny', id: 'archelosauria' } })
    const h = { ...makeHighlight(am, v, { id: 'a', label: 'Archosaurs', members: ['t-crocodylia', 't-aves'] }), color: '#f00' }
    const p = projectView(am, { ...v, highlights: [h] })
    const html = renderToStaticMarkup(<TreeView projection={p} layout={rectangular(p)} highlights={[h]} title="t" />)
    expect(html.match(/ot-node-halo/g)).toHaveLength(2)
  })
})

describe('TreeOutline (keyboard tree)', () => {
  it('follows the WAI-ARIA tree pattern', () => {
    const toggled: string[] = []
    const p = projectView(cl, clView())
    render(<TreeOutline projection={p} label="Outline" onToggle={(id) => toggled.push(id)} />)
    const tree = screen.getByRole('tree', { name: 'Outline' })
    const items = screen.getAllByRole('treeitem')
    expect(items).toHaveLength(25)
    expect(items.filter((i) => i.tabIndex === 0)).toHaveLength(1) // one tab stop
    const root = items[0]!
    expect(root.getAttribute('aria-expanded')).toBe('true')
    root.focus()
    fireEvent.keyDown(root, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toMatch(/^▾Alphiformes/)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(toggled).toEqual(['fx:2'])
    fireEvent.keyDown(document.activeElement!, { key: 'z' })
    expect(document.activeElement?.textContent).toMatch(/^▾Zetiformes/)
    expect(tree).toBeTruthy()
  })
})

describe('Explorer', () => {
  it('collapses, filters, undoes and redoes without touching the snapshot', () => {
    const before = snapshotChecksum(checklist)
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const count = () => screen.getAllByRole('treeitem').length
    expect(count()).toBe(25)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(count()).toBe(4) // the root stays open: the class and its three orders
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(count()).toBe(25)
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(count()).toBe(4)
    // Layouts the data can't support are offered but disabled, with the reason.
    const time = screen.getByRole('option', { name: 'time' }) as HTMLOptionElement
    expect(time.disabled).toBe(true)
    expect(time.title).toMatch(/no branch lengths or ages/)
    expect(snapshotChecksum(checklist)).toBe(before)
  })

  it('reorders with Alt+arrows (keyboard alternative to dragging) and shows details', () => {
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const delta = screen.getAllByRole('treeitem').find((i) => i.textContent?.startsWith('▾Deltiformes'))!
    delta.focus()
    fireEvent.keyDown(delta, { key: 'ArrowUp', altKey: true })
    const orders = screen.getAllByRole('treeitem').filter((i) => i.getAttribute('aria-level') === '2').map((i) => i.querySelector('.ot-outline-label')!.textContent)
    expect(orders).toEqual(['Deltiformes', 'Alphiformes', 'Zetiformes'])
    fireEvent.keyDown(screen.getAllByRole('treeitem').find((i) => i.textContent?.startsWith('Zetus nonus'))!, { key: ' ' })
    expect(screen.getByRole('region', { name: 'Details' }).textContent).toContain('Zetus nonus')
  })
})

describe('click-and-drag rearranging', () => {
  const p = () => projectView(cl, clView())

  it('moves a node among its siblings by where it is dropped (rectangular)', () => {
    const proj = p()
    const l = rectangular(proj, { leafGap: 10 })
    const y = (id: string) => l.nodes.find((n) => n.id === id)!.y
    // Drag Zetiformes (last order) above Alphiformes (first).
    const order = dropOrder(proj, l, 'fx:22', { dx: 0, dy: y('fx:2') - y('fx:22') - 1 }, ['fx:2', 'fx:14', 'fx:22'])
    expect(order).toEqual(['fx:22', 'fx:2', 'fx:14'])
    // A small nudge that doesn't pass a sibling changes nothing.
    expect(dropOrder(proj, l, 'fx:22', { dx: 0, dy: -2 }, ['fx:2', 'fx:14', 'fx:22'])).toBeNull()
    // Roots can't be dragged (no parent to reorder within).
    expect(dropOrder(proj, l, 'fx:1', { dx: 0, dy: 50 }, [])).toBeNull()
  })

  it('keeps hidden siblings in place relative to their neighbours', () => {
    const v = { ...clView(), hidden: ['fx:14'] }
    const proj = projectView(cl, v)
    const l = rectangular(proj, { leafGap: 10 })
    const y = (id: string) => l.nodes.find((n) => n.id === id)!.y
    expect(dropOrder(proj, l, 'fx:22', { dx: 0, dy: y('fx:2') - y('fx:22') - 1 }, ['fx:2', 'fx:14', 'fx:22'])).toEqual(['fx:22', 'fx:2', 'fx:14'])
  })

  it('moves a whole drawn subtree while dragging', () => {
    expect([...drawnSubtree(p(), 'fx:15')].sort()).toEqual(['fx:15', 'fx:16', 'fx:17', 'fx:18'])
  })
})

describe('brand controls', () => {
  it('pairs toolbar text with icons and offers canvas tools', () => {
    render(<Explorer dataset={cl} initialView={clView()} title="Checklist" />)
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo.querySelector('svg.ot-icon')).toBeTruthy()
    for (const name of ['Zoom in', 'Zoom out', 'Fit to view', 'Download', 'Print']) expect(screen.getByRole('button', { name })).toBeTruthy()
    const svg = () => document.querySelector('.ot-canvas svg.ot-root')!.getAttribute('viewBox')
    const before = svg()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(svg()).not.toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }))
    expect(svg()).toBe(before)
  })
})

describe('M5: overlays, inspector, exports', () => {
  const traitData = (): DatasetSnapshot => ({
    ...(JSON.parse(JSON.stringify(amniotesJson)) as DatasetSnapshot),
    traits: [{ id: 'repro', title: 'Reproduction', source: 'fixture', states: [{ id: 'egg', label: 'Lays eggs', color: '#eeb684' }, { id: 'live', label: 'Live birth' }], values: [{ concept: 'c:testudines', state: 'egg' }, { concept: 'c:mammalia', state: 'live' }] }],
    profiles: [{ concept: 'c:testudines', summary: 'Turtles and tortoises.', citations: ['Example 2026'] }],
  })

  it('draws support values, weak edges, fossil ages and observed trait states', () => {
    const d = indexDataset(traitData())
    const v = { ...createView(d, { id: 'v', title: 't', target: { kind: 'classification', id: 'traditional' } }), overlays: { trait: 'repro' } }
    const p = projectView(d, v)
    const html = renderToStaticMarkup(<TreeView projection={p} layout={rectangular(p)} title="t" overlays={nodeOverlays(d, v, p)} />)
    expect(html.match(/class="ot-trait"/g)).toHaveLength(2)
    expect(html).toContain('data-trait="egg"')
    expect(html).toContain('fill:#eeb684')
  })

  it('colors by a trait, inspects with citations, and explains itself', () => {
    const d = indexDataset(traitData())
    const { container } = render(<Explorer dataset={d} initialView={createView(d, { id: 'v', title: 'Amniotes', target: { kind: 'classification', id: 'traditional' } })} title="Amniotes" />)
    fireEvent.change(screen.getByRole('combobox', { name: /Color by/ }), { target: { value: 'repro' } })
    expect(container.querySelectorAll('.ot-trait')).toHaveLength(2)
    expect(screen.getByRole('list', { name: 'Reproduction' }).textContent).toContain('No stated value')
    const turtle = container.querySelector('.ot-node[data-id="c:testudines"]')!
    fireEvent.pointerDown(turtle, { clientX: 5, clientY: 5 })
    fireEvent.pointerUp(turtle, { clientX: 5, clientY: 5 })
    const inspector = screen.getByRole('region', { name: 'Details' })
    expect(inspector.textContent).toContain('Turtles and tortoises.')
    expect(inspector.textContent).toContain('Reproduction: Lays eggs')
    expect(inspector.textContent).toContain('Example 2026')
    expect(inspector.textContent).toMatch(/illustrative data/)
    const about = container.querySelector('.ot-about')!.textContent!
    expect(about).toMatch(/not common ancestry/)
    expect(about).toMatch(/nothing is inferred/)
  })

  it('offers SVG, PNG and view downloads; the SVG carries the disclosure', () => {
    const d = indexDataset(traitData())
    const { container } = render(<Explorer dataset={d} initialView={createView(d, { id: 'v', title: 'Amniotes', target: { kind: 'classification', id: 'traditional' } })} title="Amniotes" />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Drawing (SVG)', 'Image (PNG)', 'View file (JSON)'])
    const v = createView(d, { id: 'v', title: 'Amniotes', target: { kind: 'classification', id: 'traditional' } })
    const text = standaloneSvg(container.querySelector('svg.ot-root') as SVGSVGElement, describeView(d, v, projectView(d, v)))
    expect(text).toContain('class="ot-disclosure"')
    expect(text).toMatch(/Classification: .*not common ancestry/)
    expect(text).toMatch(/Sources:/)
    expect(text).toContain('fill="#ffffff"')
  })
})

describe('clade selector', () => {
  it('checks a multiple selection, explains it, and keeps it as a clade or a group', () => {
    const { container } = render(<Explorer dataset={am} initialView={createView(am, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } })} title="A" />)
    const pick = (id: string, shiftKey = false) => {
      const el = container.querySelector(`.ot-node[data-id="${id}"]`)!
      fireEvent.pointerDown(el, { clientX: 1, clientY: 1, shiftKey })
      fireEvent.pointerUp(el, { clientX: 1, clientY: 1 })
    }
    pick('t-crocodylia')
    pick('t-aves', true)
    const panel = screen.getByRole('region', { name: 'Details' })
    expect(panel.textContent).toMatch(/Selected \(2\)/)
    expect(within(panel).getByRole('status').textContent).toMatch(/A clade in/)
    fireEvent.click(screen.getByRole('button', { name: /Highlight \(Clade\)/ }))
    expect(container.querySelector('.ot-legend')!.textContent).toMatch(/Clade/)

    pick('t-squamata', true) // squamates + crocs + birds: not a clade (turtles left out)
    expect(within(panel).getByRole('status').textContent).toMatch(/Not a clade/)
    expect(screen.getByRole('button', { name: /Highlight \(Group\)/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    expect(container.querySelector('.ot-legend .ot-highlights')).toBeNull()
  })
})

describe('lesson player (M5)', () => {
  const deck = () => {
    const d = createLesson(am, { id: 'l', title: 'Reptiles?' })
    const s = sceneFromView(createView(am, { id: 'v', title: 'A', target: { kind: 'phylogeny', id: 'archelosauria' } }), { id: 's1', title: 'Amniotes' })
    s.view = { ...s.view, collapsed: ['archelosauria'] }
    s.steps = [{ id: 'st1', caption: 'Open it', actions: [{ type: 'expand', node: 'archelosauria' }], camera: { focus: 'archelosauria', zoom: 2 } }]
    s.annotations = [{ id: 'a1', text: 'Birds are archosaurs.', target: { kind: 'node', node: 't-aves' }, from: 'st1' }]
    d.scenes.push(s)
    return d
  }

  it('presents step by step: reveals, camera, numbered annotations', () => {
    const { container } = render(<LessonPlayer dataset={am} deck={deck()} />)
    expect(container.querySelector('.ot-node[data-id="t-aves"]')).toBeNull() // folded at the start
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Open it')).toBeTruthy()
    expect(container.querySelector('.ot-node[data-id="t-aves"] .ot-badge')!.textContent).toBe('1')
    expect(screen.getByText('Birds are archosaurs.')).toBeTruthy()
    const vb = container.querySelector('svg.ot-root')!.getAttribute('viewBox')!.split(' ').map(Number)
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }))
    const full = container.querySelector('svg.ot-root')!.getAttribute('viewBox')!.split(' ').map(Number)
    expect(vb[2]!).toBeLessThan(full[2]!) // the camera zooms in on the node
  })

  it('switches to explore and lets an author add a scene and a note in studio', () => {
    let edited: LessonDeck | null = null
    render(<LessonPlayer dataset={am} deck={deck()} onChange={(d) => (edited = d)} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Explore' }))
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Studio' }))
    fireEvent.change(screen.getByLabelText('Scene title'), { target: { value: 'Second' } })
    fireEvent.click(screen.getByRole('button', { name: /Add scene from this view/ }))
    expect(edited!.scenes.map((s) => s.title)).toEqual(['Amniotes', 'Second'])
  })
})

describe('Proposed mode', () => {
  const amView = () => createView(am, { id: 'v', title: 'Amniotes', target: { kind: 'classification', id: 'traditional' } })
  const start = (selected: string[] = []) => {
    render(<Explorer dataset={am} initialView={{ ...amView(), selected }} title="Amniotes" />)
    fireEvent.click(screen.getByRole('button', { name: 'Propose changes' }))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'A. Keeper' } })
    fireEvent.change(screen.getByLabelText('Name of this proposal'), { target: { value: 'Birds are reptiles' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start proposing' }))
  }

  it('needs a name, and says whose it is', () => {
    start()
    expect(screen.getByRole('note').textContent).toBe('Proposed by A. Keeper: Birds are reptiles')
    expect(screen.getByText('No moves yet.')).toBeTruthy()
  })

  it('moves a taxon with the keyboard path, marks it, explains it, reverts it, and leaves the data alone', () => {
    const before = snapshotChecksum(amniotesJson as DatasetSnapshot)
    start(['c:aves'])
    fireEvent.change(screen.getByLabelText('Move under'), { target: { value: 'c:reptilia' } })
    expect(document.querySelector('.ot-node[data-id="c:aves"]')!.hasAttribute('data-moved')).toBe(true)
    expect(screen.getByRole('button', { name: 'Revert' })).toBeTruthy()
    expect(screen.getByText('Compare with the accepted arrangement')).toBeTruthy()
    expect(document.querySelector('.ot-print-disclosure')!.textContent).toMatch(/PROPOSED by A\. Keeper/)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(document.querySelector('.ot-node[data-id="c:aves"]')!.hasAttribute('data-moved')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Leave Proposed mode' }))
    expect(screen.queryByRole('note')).toBeNull()
    expect(snapshotChecksum(amniotesJson as DatasetSnapshot)).toBe(before)
  })

  it('a drop lands on a nearby node, not on what is moving and not between siblings', () => {
    const proj = projectView(am, amView())
    const l = rectangular(proj, { leafGap: 24 })
    const at = (id: string) => l.nodes.find((n) => n.id === id)!
    const moving = drawnSubtree(proj, 'c:aves')
    const onto = { dx: at('c:reptilia').x - at('c:aves').x, dy: at('c:reptilia').y - at('c:aves').y }
    expect(dropTarget(l, 'c:aves', moving, onto)).toBe('c:reptilia')
    expect(dropTarget(l, 'c:aves', moving, { dx: 0, dy: 0 })).toBeNull()
    expect(dropTarget(l, 'c:reptilia', drawnSubtree(proj, 'c:reptilia'), { dx: at('c:squamata').x - at('c:reptilia').x, dy: at('c:squamata').y - at('c:reptilia').y })).toBeNull()
  })
})
