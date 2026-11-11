// @vitest-environment jsdom
// Controls for support collapsing, comparison and rooting (docs/test-audit.md, 2026-11-11). Rendered in jsdom:
// no screen reader was run, so "spoken" here means the text is in a status region that stays mounted.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createView, indexDataset, rerootPhylogeny, sealSnapshot, type DatasetSnapshot, type Phylogeny, type TaxonomicView } from '@captiveorigins/onetaxonomy-core'
import { Explorer, rootedRecord, supportSummary } from '../src'
import checklistJson from '../../../fixtures/checklist.json'
import amniotesJson from '../../../fixtures/amniotes.json'

afterEach(cleanup)

const amniotes = amniotesJson as DatasetSnapshot
// Illustrative support values and lengths on the fixture (not science): sauria 50, archelosauria 60, lepidosauria 95,
// archosauria none. Collapsing below 70 removes two branches and finds one without a value.
const SUPPORT: Record<string, number> = { sauria: 50, archelosauria: 60, lepidosauria: 95 }
const withSupport = (p: Phylogeny): Phylogeny => ({
  ...p,
  nodes: p.nodes.map((n) => (SUPPORT[n.id] !== undefined ? { ...n, support: { value: SUPPORT[n.id]!, method: 'bootstrap (illustrative)' } } : n)),
  edges: p.edges.map((e, i) => ({ ...e, length: 1 + i / 10 })),
})
const supported: DatasetSnapshot = { ...amniotes, phylogenies: amniotes.phylogenies.map(withSupport) }
const sealed = sealSnapshot(supported)
const sealedJson = JSON.stringify(sealed)
const am = indexDataset(sealed)
const plain = indexDataset(amniotes)
const cl = indexDataset(checklistJson as DatasetSnapshot)

const treeView = (data = am, selected: string[] = []): TaxonomicView => ({ ...createView(data, { id: 'v', title: 'Amniotes', target: { kind: 'phylogeny', id: 'archelosauria' } }), selected })
const supportField = () => screen.getByRole('spinbutton', { name: 'Collapse support below' })
const supportStatus = (container: HTMLElement) => container.querySelector('.ot-support-status') as HTMLElement
const outlineItems = () => within(screen.getByRole('tree')).getAllByRole('treeitem')

describe('support threshold', () => {
  it('collapses on Enter, says what it did in a status region, and undoes in one step', () => {
    const { container } = render(<Explorer dataset={am} initialView={treeView()} title="Amniotes" />)
    const status = supportStatus(container)
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toBe('') // mounted before it has anything to say, so the first message is announced
    expect(outlineItems()).toHaveLength(11)
    const field = supportField()
    field.focus()
    fireEvent.change(field, { target: { value: '7' } })
    fireEvent.change(field, { target: { value: '70' } })
    expect(status.textContent).toBe('') // nothing applies while typing
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(status.textContent).toBe('2 branches below 70 collapsed; 1 has no support value.')
    expect(outlineItems()).toHaveLength(9)
    expect(within(container.querySelector('.ot-about') as HTMLElement).getByText(/2 branches with support below 70 are collapsed into polytomies for display/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(status.textContent).toBe('')
    expect((supportField() as HTMLInputElement).value).toBe('')
    expect(outlineItems()).toHaveLength(11)
  })

  it('applies when the field loses focus, and Clear (named with its visible text) removes it', () => {
    const changes: TaxonomicView[] = []
    const { container } = render(<Explorer dataset={am} initialView={treeView()} title="Amniotes" onViewChange={(v) => changes.push(v)} />)
    const clear = screen.getByRole('button', { name: 'Clear support threshold' })
    expect(clear.textContent).toContain('Clear')
    expect((clear as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(supportField(), { target: { value: '55' } })
    fireEvent.blur(supportField())
    expect(supportStatus(container).textContent).toBe('1 branch below 55 collapsed; 1 has no support value.')
    expect(changes.at(-1)?.supportCollapse).toEqual({ threshold: 55 })
    fireEvent.click(clear)
    expect(supportStatus(container).textContent).toBe('')
    expect(changes.at(-1)?.supportCollapse).toBeUndefined()
    expect((supportField() as HTMLInputElement).value).toBe('')
  })

  it('is disabled for a classification, with the reason shown and given as its description', () => {
    render(<Explorer dataset={cl} initialView={createView(cl, { id: 'v', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } })} title="Checklist" />)
    const field = supportField() as HTMLInputElement
    expect(field.disabled).toBe(true)
    const reason = document.getElementById(field.getAttribute('aria-describedby')!)
    expect(reason?.textContent).toBe('Classifications have no support values to collapse by.')
    expect(reason?.checkVisibility?.() ?? true).toBe(true)
    expect((screen.getByRole('button', { name: 'Clear support threshold' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('words the summary for one and many, and is empty when nothing is collapsed by support', () => {
    expect(supportSummary({ supportCollapse: { threshold: 70, collapsed: ['a', 'b', 'c'], withoutSupport: 2 } } as never)).toBe('3 branches below 70 collapsed; 2 have no support value.')
    expect(supportSummary({ supportCollapse: { threshold: 0.9, collapsed: ['a'], withoutSupport: 0 } } as never)).toBe('1 branch below 0.9 collapsed.')
    expect(supportSummary({} as never)).toBe('')
  })
})

describe('Compare with…', () => {
  const openPanel = () => {
    const details = screen.getByText('Compare with…').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    return details
  }

  it('is offered only when there is another phylogeny', () => {
    const one = indexDataset({ ...amniotes, phylogenies: [amniotes.phylogenies[0]!] })
    render(<Explorer dataset={one} initialView={treeView(one)} title="t" />)
    expect(screen.queryByText('Compare with…')).toBeNull()
  })

  it('shows Robinson-Foulds raw and normalized, tips in one tree only, and the clades that differ', () => {
    const changes: TaxonomicView[] = []
    render(<Explorer dataset={plain} initialView={treeView(plain)} title="Amniotes" onViewChange={(v) => changes.push(v)} />)
    const details = openPanel()
    const panel = within(details)
    expect(panel.getByRole('status').textContent).toBe('Robinson-Foulds distance 2 (normalized 0.25), rooted, on 6 shared tips.')
    expect(panel.getByText('0.250')).toBeTruthy()
    expect(panel.getByText('Clades only in Turtles with archosaurs (illustrative)').nextElementSibling!.textContent).toContain('Aves, Crocodylia, Testudines')
    expect(panel.getByText('Clades only in Turtles outside Sauria (illustrative, conflicting)').nextElementSibling!.textContent).toContain('Aves, Crocodylia, Rhynchocephalia, Squamata')
    expect(panel.getAllByText('None')).toHaveLength(2) // no tips in only one tree
    // The differing clade can be selected in the drawing from here.
    fireEvent.click(panel.getByRole('button', { name: 'Select Aves, Crocodylia, Testudines' }))
    expect(changes.at(-1)?.selected).toEqual(['archelosauria'])
  })

  it('changes mode and tree with the keyboard-operable selects and announces the new answer', () => {
    const given: Phylogeny = { ...amniotes.phylogenies[0]!, id: 'given', title: 'Given tree', nodes: amniotes.phylogenies[0]!.nodes.filter((n) => n.id !== 't-aves'), edges: amniotes.phylogenies[0]!.edges.filter((e) => e.child !== 't-aves') }
    render(<Explorer dataset={plain} initialView={treeView(plain)} title="Amniotes" compareWith={[given]} />)
    const panel = within(openPanel())
    fireEvent.change(panel.getByRole('combobox', { name: 'Roots' }), { target: { value: 'unrooted' } })
    expect(panel.getByRole('status').textContent).toMatch(/unrooted, on 6 shared tips\.$/)
    fireEvent.change(panel.getByRole('combobox', { name: 'Compare with' }), { target: { value: 'given' } })
    expect(panel.getByRole('status').textContent).toMatch(/on 5 shared tips\.$/)
    expect(panel.getByText('Tips only in Turtles with archosaurs (illustrative)').nextElementSibling!.textContent).toBe('Aves')
    expect(panel.getByText(/were left out of the distance/)).toBeTruthy()
  })

  it('says why when the trees cannot be compared', () => {
    const unmapped: Phylogeny = { ...amniotes.phylogenies[1]!, id: 'unmapped', title: 'Unmapped', nodes: amniotes.phylogenies[1]!.nodes.map(({ concepts: _, ...n }) => n) }
    render(<Explorer dataset={plain} initialView={treeView(plain)} title="Amniotes" compareWith={[unmapped]} />)
    const panel = within(openPanel())
    fireEvent.change(panel.getByRole('combobox', { name: 'Compare with' }), { target: { value: 'unmapped' } })
    expect(panel.getByRole('status').textContent).toMatch(/have no explicit concept mapping; tips are matched by concept, never by label/)
    expect(panel.queryByText(/Robinson-Foulds distance/)).toBeNull()
  })
})

describe('rooting', () => {
  it('roots on the selected tip as a new record and never changes the one shown', () => {
    const made: Phylogeny[] = []
    render(<Explorer dataset={am} initialView={treeView(am, ['t-squamata'])} title="Amniotes" onRooted={(p) => made.push(p)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Root on this tip (outgroup)' }))
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ id: 'archelosauria-outgroup', rooted: true, rooting: { method: 'outgroup', outgroup: ['t-squamata'], from: { id: 'archelosauria', version: '1' } } })
    expect(made[0]!.rooting!.note).toMatch(/^Rerooted on the outgroup Squamata/)
    expect(JSON.stringify(am.snapshot)).toBe(sealedJson)
  })

  it('roots on every tip under a selected clade', () => {
    const made: Phylogeny[] = []
    render(<Explorer dataset={am} initialView={treeView(am, ['lepidosauria'])} title="Amniotes" onRooted={(p) => made.push(p)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Root on this clade (outgroup)' }))
    expect([...made[0]!.rooting!.outgroup!].sort()).toEqual(['t-rhyncho', 't-squamata'])
  })

  it('offers no outgroup button on the root, and no rooting at all without onRooted', () => {
    const { unmount } = render(<Explorer dataset={am} initialView={treeView(am, ['amniota'])} title="Amniotes" onRooted={() => {}} />)
    expect(screen.queryByRole('button', { name: /Root on this/ })).toBeNull()
    unmount()
    render(<Explorer dataset={am} initialView={treeView(am, ['t-squamata'])} title="Amniotes" />)
    expect(screen.queryByRole('button', { name: /Root on this|Midpoint root/ })).toBeNull()
  })

  it('midpoint-roots as a new record with an unused id', () => {
    const made: Phylogeny[] = []
    const taken = { ...amniotes.phylogenies[0]!, id: 'archelosauria-midpoint' }
    render(<Explorer dataset={am} initialView={treeView()} title="Amniotes" compareWith={[taken]} onRooted={(p) => made.push(p)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Midpoint root' }))
    expect(made[0]).toMatchObject({ id: 'archelosauria-midpoint-2', rooting: { method: 'midpoint' } })
    expect(JSON.stringify(am.snapshot)).toBe(sealedJson)
  })

  it('says why in the status region when rooting is refused', () => {
    const made: Phylogeny[] = []
    const { container } = render(<Explorer dataset={plain} initialView={treeView(plain)} title="Amniotes" onRooted={(p) => made.push(p)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Midpoint root' }))
    expect(made).toEqual([])
    expect(container.querySelector('.ot-error[role="status"]')!.textContent).toMatch(/have no length; midpoint rooting would invent them/)
  })

  it('shows how a rooted record was rooted, on screen and in the About list', () => {
    const rerooted = rerootPhylogeny(supported.phylogenies[0]!, ['t-mammalia'], { id: 'rerooted', version: '2' })
    const data = indexDataset({ ...supported, phylogenies: [...supported.phylogenies, rerooted] })
    const { container } = render(<Explorer dataset={data} initialView={createView(data, { id: 'v', title: 'r', target: { kind: 'phylogeny', id: 'rerooted' } })} title="r" />)
    const note = container.querySelector('.ot-rooting[role="note"]')!
    expect(note.textContent).toMatch(/^Rooting: Rerooted on the outgroup Mammalia \(t-mammalia\) from archelosauria version 1/)
    const about = container.querySelector('.ot-about')!
    expect(within(about as HTMLElement).getByText(/^Rooting: Rerooted on the outgroup Mammalia/)).toBeTruthy()
  })

  it('rootedRecord leaves the input alone and refuses an outgroup that is the whole tree', () => {
    expect(() => rootedRecord(am, 'archelosauria', 'amniota', [])).toThrow(/whole tree/)
    expect(JSON.stringify(am.snapshot)).toBe(sealedJson)
  })
})
