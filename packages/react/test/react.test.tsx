// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createView, indexDataset, makeHighlight, projectView, snapshotChecksum, type DatasetSnapshot } from '@captiveorigins/onetaxonomy-core'
import { rectangular } from '@captiveorigins/onetaxonomy-layout'
import { Explorer, TreeOutline, TreeView } from '../src'
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
