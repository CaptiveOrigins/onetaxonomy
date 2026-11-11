// @vitest-environment jsdom
// Linking a tree's tips to taxa (TipLinker). Rendered in jsdom: no screen reader was run, so "announced" here means
// the text is in a status region that stays mounted.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { comparePhylogenies, indexDataset, indexPhylogeny, sealSnapshot, validateDataset, type DatasetSnapshot, type Phylogeny } from '@captiveorigins/onetaxonomy-core'
import { linkedPhylogeny, proposeTipLinks, TipLinker } from '../src'
import checklistJson from '../../../fixtures/checklist.json'

afterEach(cleanup)

const base = checklistJson as DatasetSnapshot
// Made-up tree over the fictional checklist: one tip per case. "Gammus quintus" gets a homonym from a second
// made-up source, and "Zetus decimus" is a misapplied name for Zetus nonus.
const tree: Phylogeny = {
  id: 'tree',
  title: 'Made-up tree',
  version: '1',
  sources: ['fixture-checklist'],
  rooted: true,
  nodes: [
    { id: 'r' },
    { id: 'i', label: 'Alphidae' },
    { id: 't1', label: 'Alphus primus' },
    { id: 't2', label: 'betus TERTIA' },
    { id: 't3', label: 'Gammus quintus' },
    { id: 't4', label: 'Zetus decimus' },
    { id: 't5', label: 'Nullus nemo' },
  ],
  edges: [
    { id: 'e1', parent: 'r', child: 'i' },
    { id: 'e2', parent: 'i', child: 't1' },
    { id: 'e3', parent: 'i', child: 't2' },
    { id: 'e4', parent: 'r', child: 't3' },
    { id: 'e5', parent: 'r', child: 't4' },
    { id: 'e6', parent: 'r', child: 't5' },
  ],
}
const snapshot: DatasetSnapshot = sealSnapshot({
  ...base,
  sources: [...base.sources, { id: 'other', title: 'Another made-up checklist' }],
  names: [...base.names, { id: 'n:homonym', name: 'Gammus quintus', authorship: 'Other, 2020' }, { id: 'n:mis', name: 'Zetus decimus' }],
  concepts: [
    ...base.concepts.map((c) => (c.id === 'fx:25' ? { ...c, usages: [...(c.usages ?? []), { name: 'n:mis', status: 'misapplied' as const }] } : c)),
    { id: 'other:1', acceptedName: 'n:homonym', rank: 'species', provenance: { source: 'other' } },
  ],
  phylogenies: [tree],
})
const sealedText = JSON.stringify(snapshot)
const data = indexDataset(snapshot)

const status = (container: HTMLElement) => container.querySelector('.ot-tip-links-status') as HTMLElement
const choice = (tip: string) => screen.getByRole('combobox', { name: `Link to: ${tip}` }) as HTMLSelectElement
const unlinked = (container: HTMLElement) => [...container.querySelectorAll('.ot-tip-links-unlinked li')].map((li) => li.textContent)

describe('proposing links by exact name', () => {
  it('matches tips only (not internal nodes), letter case aside, and tells unique, ambiguous and missing matches apart', () => {
    const m = proposeTipLinks(data, 'tree')
    expect(m.map((x) => [x.node, x.kind, x.bulk, x.candidates.map((c) => `${c.concept}:${c.status}`)])).toEqual([
      ['t1', 'unique', true, ['fx:5:accepted']],
      ['t2', 'unique', true, ['fx:9:synonym']],
      ['t3', 'ambiguous', false, ['fx:13:accepted', 'other:1:accepted']],
      ['t4', 'unique', false, ['fx:25:misapplied']],
      ['t5', 'none', false, []],
    ])
  })

  it('makes a new record with the links in `concepts`, says how each was made, and changes nothing else', () => {
    const record = linkedPhylogeny(data, 'tree', new Map([['t1', 'fx:5'], ['t3', 'other:1'], ['t5', 'fx:17']]), { id: 'tree-linked', version: '2026-11-11' })
    expect(record).toMatchObject({ id: 'tree-linked', version: '2026-11-11', title: 'Made-up tree (tips linked)', rooted: true })
    const node = (id: string) => record.nodes.find((n) => n.id === id)!
    expect(node('t1')).toEqual({ id: 't1', label: 'Alphus primus', concepts: ['fx:5'], annotations: { conceptLink: { basis: 'exact-name-confirmed', label: 'Alphus primus' } } })
    expect(node('t5').annotations).toEqual({ conceptLink: { basis: 'chosen-by-person', label: 'Nullus nemo' } })
    expect(node('t2').concepts).toBeUndefined()
    expect(record.edges).toEqual(tree.edges)
    expect(JSON.stringify(snapshot)).toBe(sealedText)
    expect(validateDataset({ ...snapshot, checksum: undefined, phylogenies: [tree, record] } as DatasetSnapshot).filter((d) => d.severity === 'error')).toEqual([])
    expect(() => linkedPhylogeny(data, 'tree', new Map([['t1', 'nope']]), { id: 'x', version: '1' })).toThrow(/Unknown concept nope/)
    expect(() => linkedPhylogeny(data, 'tree', new Map([['zz', 'fx:5']]), { id: 'x', version: '1' })).toThrow(/Unknown node zz/)
  })

  it('a linked tree can be compared, where the imported one was refused', () => {
    const links = new Map([['t1', 'fx:5'], ['t2', 'fx:9'], ['t3', 'fx:13'], ['t4', 'fx:25'], ['t5', 'fx:17']])
    const a = linkedPhylogeny(data, 'tree', links, { id: 'a', version: '1' })
    expect(comparePhylogenies(indexPhylogeny(tree), indexPhylogeny(a)).status).toBe('refused')
    const result = comparePhylogenies(indexPhylogeny(a), indexPhylogeny({ ...a, id: 'b' }))
    expect(result).toMatchObject({ status: 'compared', rf: 0 })
  })
})

describe('TipLinker', () => {
  it('moves focus to its title, proposes without accepting anything, and lists every tip as unlinked', () => {
    const { container } = render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Link tips to taxa: Made-up tree' }))
    expect(screen.getByText('5 tips: 3 match one taxon, 1 match several, 1 match none.')).toBeTruthy()
    expect(status(container).getAttribute('role')).toBe('status')
    expect(status(container).textContent).toBe('')
    for (const tip of ['Alphus primus', 'betus TERTIA', 'Gammus quintus', 'Zetus decimus', 'Nullus nemo']) expect(choice(tip).value).toBe('')
    expect(unlinked(container)).toEqual(['Alphus primus', 'betus TERTIA', 'Gammus quintus', 'Zetus decimus', 'Nullus nemo'])
    const make = screen.getByRole('button', { name: 'Nothing to make: no link has changed' }) as HTMLButtonElement
    expect(make.disabled).toBe(true)
    // The table has a caption and column and row headers for screen readers.
    const table = screen.getByRole('table', { name: 'Tips and the taxa they are linked to' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Tip', 'Match by name', 'Link to'])
    expect(within(table).getByRole('rowheader', { name: 'Nullus nemo' })).toBeTruthy()
  })

  it('shows how each tip matched: a synonym says so, a misapplied name asks for a check, ambiguity offers every taxon', () => {
    render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    const row = (tip: string) => screen.getByRole('rowheader', { name: tip }).closest('tr')!
    expect(row('betus TERTIA').textContent).toContain('One taxon: Betus tertius (Fixture, 2025) · species · betus TERTIA as a synonym')
    expect(row('Zetus decimus').textContent).toContain('as a misapplied')
    expect(row('Zetus decimus').textContent).toContain('(check before accepting)')
    expect(row('Gammus quintus').textContent).toContain('2 taxa use this name: choose one')
    const options = [...within(choice('Gammus quintus')).getAllByRole('option')].map((o) => o.textContent)
    expect(options).toEqual(['Not linked', expect.stringMatching(/^Gammus quintus Fixture, 2026 · species · OneTaxonomy illustrative checklist .* · fx:13$/), 'Gammus quintus Other, 2020 · species · Another made-up checklist · other:1', 'Another taxon…'])
    expect(row('Nullus nemo').textContent).toContain('No taxon uses this name')
  })

  it('accepts all exact unique matches in one action that says how many, and leaves the rest', () => {
    const { container } = render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    const bulk = screen.getByRole('button', { name: 'Accept all exact unique matches (2)' })
    fireEvent.click(bulk)
    expect(status(container).textContent).toBe('Accepted 2 exact unique matches.')
    expect(choice('Alphus primus').value).toBe('fx:5')
    expect(choice('betus TERTIA').value).toBe('fx:9')
    // The misapplied match and the ambiguous one are not taken.
    expect(choice('Zetus decimus').value).toBe('')
    expect(choice('Gammus quintus').value).toBe('')
    expect(unlinked(container)).toEqual(['Gammus quintus', 'Zetus decimus', 'Nullus nemo'])
    expect((screen.getByRole('button', { name: 'No exact unique matches to accept' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('never re-links a tip the person left unlinked when accepting all', () => {
    const { container } = render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    fireEvent.change(choice('Alphus primus'), { target: { value: '' } })
    expect(status(container).textContent).toBe('Alphus primus left unlinked.')
    fireEvent.click(screen.getByRole('button', { name: 'Accept all exact unique matches (1)' }))
    expect(choice('Alphus primus').value).toBe('')
  })

  it('accepts one proposal, chooses among homonyms and changes a link, announcing each', () => {
    const { container } = render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept Zetus nonus for Zetus decimus' }))
    expect(status(container).textContent).toBe('Linked Zetus decimus to Zetus nonus.')
    expect(choice('Zetus decimus').value).toBe('fx:25')
    expect(screen.queryByRole('button', { name: 'Accept Zetus nonus for Zetus decimus' })).toBeNull()
    fireEvent.change(choice('Gammus quintus'), { target: { value: 'other:1' } })
    expect(status(container).textContent).toBe('Linked Gammus quintus to Gammus quintus.')
    expect(screen.getByRole('button', { name: 'Make a new tree with these links (2)' })).toBeTruthy()
  })

  it('finds another taxon by exact name from the keyboard: Enter links it, a missing name is said, Escape closes', () => {
    const { container } = render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    fireEvent.change(choice('Nullus nemo'), { target: { value: '\u0000another' } })
    const find = screen.getByRole('combobox', { name: 'Find a taxon by name for Nullus nemo' }) as HTMLInputElement
    expect(document.activeElement).toBe(find)
    expect(find.getAttribute('list')).toBe(container.querySelector('datalist')!.id)
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(status(container).textContent).toBe('') // an empty field does nothing
    find.value = 'Nemo nobody'
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(status(container).textContent).toBe('No taxon in this dataset is called “Nemo nobody”.')
    expect(choice('Nullus nemo').value).toBe('')
    find.value = 'deltus sextus'
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(status(container).textContent).toBe('Linked Nullus nemo to Deltus sextus.')
    expect(choice('Nullus nemo').value).toBe('fx:17')
    expect(screen.queryByRole('combobox', { name: /Find a taxon/ })).toBeNull()
    fireEvent.change(choice('Alphus primus'), { target: { value: '\u0000another' } })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Find a taxon by name for Alphus primus' }), { key: 'Escape' })
    expect(screen.queryByRole('combobox', { name: /Find a taxon/ })).toBeNull()
  })

  it('offers every taxon a found name is ambiguous between, without choosing', () => {
    const { container } = render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    fireEvent.change(choice('Nullus nemo'), { target: { value: '\u0000another' } })
    const find = screen.getByRole('combobox', { name: 'Find a taxon by name for Nullus nemo' }) as HTMLInputElement
    find.value = 'Gammus quintus'
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(status(container).textContent).toBe('2 taxa are called “Gammus quintus”: choose one in the list for Nullus nemo.')
    expect(choice('Nullus nemo').value).toBe('')
    expect(within(choice('Nullus nemo')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(['', 'fx:13', 'other:1', '\u0000another'])
  })

  it('warns when one taxon is on two tips, since comparison would refuse the tree', () => {
    render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    fireEvent.change(choice('Alphus primus'), { target: { value: 'fx:5' } })
    expect(screen.queryByRole('note')).toBeNull()
    fireEvent.change(choice('Nullus nemo'), { target: { value: '\u0000another' } })
    const find = screen.getByRole('combobox', { name: 'Find a taxon by name for Nullus nemo' }) as HTMLInputElement
    find.value = 'Alphus primus'
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(screen.getByRole('note').textContent).toBe('One taxon on several tips: Alphus primus (Alphus primus, Nullus nemo)Comparison refuses a tree where one taxon is on two tips.')
  })

  it('hands a new record to onConfirm with only the changed tips, a free id, and the open snapshot untouched', () => {
    const onConfirm = vi.fn()
    render(<TipLinker dataset={data} phylogeny="tree" taken={['tree-linked']} version="2026-11-11" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept all exact unique matches (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make a new tree with these links (2)' }))
    const [record, changed] = onConfirm.mock.calls[0]! as [Phylogeny, number]
    expect(changed).toBe(2)
    expect(record.id).toBe('tree-linked-2')
    expect(record.version).toBe('2026-11-11')
    expect(record.nodes.filter((n) => n.concepts).map((n) => [n.id, n.concepts])).toEqual([['t1', ['fx:5']], ['t2', ['fx:9']]])
    expect(JSON.stringify(snapshot)).toBe(sealedText)
  })

  it('cancels without making anything', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<TipLinker dataset={data} phylogeny="tree" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps an existing link unless changed, and says so when the dataset has no taxa at all', () => {
    const mapped = indexDataset({ ...snapshot, checksum: undefined, phylogenies: [{ ...tree, nodes: tree.nodes.map((n) => (n.id === 't1' ? { ...n, concepts: ['fx:6'] } : n)) }] } as DatasetSnapshot)
    render(<TipLinker dataset={mapped} phylogeny="tree" onConfirm={() => {}} />)
    expect(choice('Alphus primus').value).toBe('fx:6')
    // Accept all skips a tip that already has a link.
    expect(screen.getByRole('button', { name: 'Accept all exact unique matches (1)' })).toBeTruthy()
    cleanup()
    const empty = indexDataset({ ...snapshot, checksum: undefined, names: [], concepts: [], classifications: [], phylogenies: [tree] } as DatasetSnapshot)
    render(<TipLinker dataset={empty} phylogeny="tree" headingLevel={3} labels={{ noConcepts: 'Nothing to link to here.' }} onConfirm={() => {}} />)
    expect(screen.getByRole('heading', { level: 3, name: /Link tips to taxa/ })).toBeTruthy()
    expect(screen.getByText('Nothing to link to here.')).toBeTruthy()
    expect(screen.getByText('5 tips: 0 match one taxon, 0 match several, 5 match none.')).toBeTruthy()
  })
})
