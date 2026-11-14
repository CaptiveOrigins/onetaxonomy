// @vitest-environment jsdom
// Possible (not exact) tip matches and paging in TipLinker. Rendered in jsdom: no screen reader was run, so
// "announced" here means the text is in a status region that stays mounted. Every name is made up.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { indexDataset, sealSnapshot, type DatasetSnapshot, type Phylogeny } from '@extantape/onetaxonomy-core'
import { isOneEdit, linkedPhylogeny, nearNameMatches, proposeTipLinks, TipLinker, withoutSpecimenCode } from '../src'
import checklistJson from '../../../fixtures/checklist.json'

afterEach(cleanup)

const base = checklistJson as DatasetSnapshot
const star = (id: string, labels: string[]): Phylogeny => ({
  id,
  title: 'Made-up tree',
  version: '1',
  sources: ['fixture-checklist'],
  rooted: true,
  nodes: [{ id: 'r' }, ...labels.map((label, i) => ({ id: `t${i + 1}`, label }))],
  edges: labels.map((_, i) => ({ id: `e${i + 1}`, parent: 'r', child: `t${i + 1}` })),
})
const tree = star('tree', [
  'Alphus secundus', // exact
  'Alphus_primus', // underscores
  'deltus  SEXTUS', // spacing and case
  'Deltus_septimus_MZUSP1234', // specimen code
  'Epsilus octavsu', // two letters swapped
  'Gamus quartus_AB12', // a letter dropped, and a code
  'Nullus nemo', // nothing close
])
const snapshot = sealSnapshot({ ...base, phylogenies: [tree] })
const sealedText = JSON.stringify(snapshot)
const data = indexDataset(snapshot)
const choice = (tip: string) => screen.getByRole('combobox', { name: `Link to: ${tip.replace(/\s+/g, ' ')}` }) as HTMLSelectElement
const status = (container: HTMLElement) => container.querySelector('.ot-tip-links-status') as HTMLElement

describe('near names', () => {
  it('leaves off a trailing specimen code or voucher, and nothing else', () => {
    expect(withoutSpecimenCode('Chelonoidis_carbonarius_MZUSP1234')).toEqual({ name: 'Chelonoidis carbonarius', dropped: 'MZUSP1234' })
    expect(withoutSpecimenCode('Chelonoidis carbonarius MZUSP 1234')).toEqual({ name: 'Chelonoidis carbonarius', dropped: 'MZUSP 1234' })
    expect(withoutSpecimenCode('Chelonoidis carbonarius KU-12345')).toEqual({ name: 'Chelonoidis carbonarius', dropped: 'KU-12345' })
    expect(withoutSpecimenCode('Chelonoidis carbonarius')).toBeNull()
    expect(withoutSpecimenCode('Chelonoidis carbonarius AB')).toBeNull() // capitals alone aren't a code
    expect(withoutSpecimenCode('1234')).toBeNull()
    expect(withoutSpecimenCode('AB12 1234')).toBeNull() // nothing would be left
  })

  it('counts one edit: a letter added, dropped or changed, or two neighbours swapped', () => {
    expect(isOneEdit('chelonoidis', 'chelonodis')).toBe(true)
    expect(isOneEdit('chelonoidis', 'chelonoidiss')).toBe(true)
    expect(isOneEdit('chelonoidis', 'chelonoidus')).toBe(true)
    expect(isOneEdit('chelonoidis', 'chelonodiis')).toBe(true)
    expect(isOneEdit('chelonoidis', 'chelonoidis')).toBe(false)
    expect(isOneEdit('chelonoidis', 'chelonodiss')).toBe(false)
    expect(isOneEdit('abc', 'bca')).toBe(false)
  })

  it('proposes possible matches only where nothing matches exactly, by the closest rule, and never for bulk', () => {
    const m = proposeTipLinks(data, 'tree')
    expect(m.map((x) => [x.label, x.kind, x.bulk, x.possible.map((p) => `${p.concept}:${p.rule}${p.dropped ? `:${p.dropped}` : ''}`)])).toEqual([
      ['Alphus secundus', 'unique', true, []],
      ['Alphus_primus', 'none', false, ['fx:5:spelling']],
      ['deltus  SEXTUS', 'none', false, ['fx:17:spelling']],
      ['Deltus_septimus_MZUSP1234', 'none', false, ['fx:18:specimen-code:MZUSP1234']],
      ['Epsilus octavsu', 'none', false, ['fx:21:one-edit']],
      ['Gamus quartus_AB12', 'none', false, ['fx:12:one-edit:AB12']],
      ['Nullus nemo', 'none', false, []],
    ])
  })

  it('finds a synonym as a possible match and keeps its status', () => {
    expect(nearNameMatches(data, 'Betus_tertia')).toEqual([{ concept: 'fx:9', status: 'synonym', name: 'Betus tertia', rule: 'spelling' }])
  })

  it('does not match short names with one edit', () => {
    const tiny = indexDataset({ ...base, names: [{ id: 'n:bos', name: 'Bos' }, { id: 'n:ursus', name: 'Ursus' }], concepts: [{ id: 'c:bos', acceptedName: 'n:bos' }, { id: 'c:ursus', acceptedName: 'n:ursus' }], classifications: [], phylogenies: [] })
    expect(nearNameMatches(tiny, 'Bus')).toEqual([])
    expect(nearNameMatches(tiny, 'Ursos')).toEqual([{ concept: 'c:ursus', status: 'accepted', name: 'Ursus', rule: 'one-edit' }])
  })

  it('records a possible match the person chose as near, with the name and the rule', () => {
    const record = linkedPhylogeny(data, 'tree', new Map([['t4', 'fx:18'], ['t5', 'fx:21'], ['t7', 'fx:17']]), { id: 'x', version: '1' })
    const note = (id: string) => record.nodes.find((n) => n.id === id)!.annotations!.conceptLink
    expect(note('t4')).toEqual({ basis: 'near-name-confirmed', label: 'Deltus_septimus_MZUSP1234', name: 'Deltus septimus', rule: 'specimen-code', dropped: 'MZUSP1234' })
    expect(note('t5')).toEqual({ basis: 'near-name-confirmed', label: 'Epsilus octavsu', name: 'Epsilus octavus', rule: 'one-edit' })
    expect(note('t7')).toEqual({ basis: 'chosen-by-person', label: 'Nullus nemo' })
    expect(JSON.stringify(snapshot)).toBe(sealedText)
  })
})

describe('TipLinker possible matches', () => {
  it('lists them apart, labelled not exact, links none, and Accept all takes only the exact one', () => {
    const { container } = render(<TipLinker dataset={data} phylogeny="tree" onConfirm={() => {}} />)
    const section = screen.getByRole('region', { name: 'Possible matches, not exact (5)' })
    const items = within(section).getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toMatch(/^Alphus_primus → Alphus primus .*\(not exact: same name apart from underscores, spacing or letter case\)/)
    expect(items[2]).toMatch(/^Deltus_septimus_MZUSP1234 → Deltus septimus .*\(not exact: same name with the specimen code left off: “MZUSP1234”\)/)
    expect(items[4]).toMatch(/\(not exact: one letter different, and “AB12” left off\)/)
    for (const tip of ['Alphus_primus', 'deltus  SEXTUS', 'Deltus_septimus_MZUSP1234', 'Epsilus octavsu', 'Gamus quartus_AB12']) expect(choice(tip).value).toBe('')
    const row = screen.getByRole('rowheader', { name: 'Alphus_primus' }).closest('tr')!
    expect(row.textContent).toContain('No taxon uses this name; 1 possible match listed under Possible matches')
    // In the row's list too, in its own group.
    const group = choice('Alphus_primus').querySelector('optgroup[label="Possible matches (not exact)"]')!
    expect(group.textContent).toMatch(/^Alphus primus .*\(not exact\)$/)
    fireEvent.click(screen.getByRole('button', { name: 'Accept all exact unique matches (1)' }))
    expect(status(container).textContent).toBe('Accepted 1 exact unique match.')
    expect(choice('Alphus secundus').value).toBe('fx:6')
    expect(choice('Alphus_primus').value).toBe('')
  })

  it('links one when chosen, says it is not exact, and unlinks it with the same button', () => {
    const onConfirm = vi.fn()
    const { container } = render(<TipLinker dataset={data} phylogeny="tree" version="1" onConfirm={onConfirm} />)
    const link = screen.getByRole('button', { name: 'Link Deltus_septimus_MZUSP1234 to Deltus septimus (not exact)' })
    expect(link.textContent).toBe('Link')
    expect(link.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(link)
    expect(status(container).textContent).toBe('Linked Deltus_septimus_MZUSP1234 to Deltus septimus (not exact).')
    expect(choice('Deltus_septimus_MZUSP1234').value).toBe('fx:18')
    expect(link.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Make a new tree with these links (1)' }))
    expect((onConfirm.mock.calls[0]![0] as Phylogeny).nodes.find((n) => n.id === 't4')!.annotations!.conceptLink).toMatchObject({ basis: 'near-name-confirmed' })
    fireEvent.click(link)
    expect(status(container).textContent).toBe('Deltus_septimus_MZUSP1234 left unlinked.')
    expect(choice('Deltus_septimus_MZUSP1234').value).toBe('')
  })

  it('has no Possible matches section when every name matches exactly or nothing comes close', () => {
    const exact = indexDataset({ ...base, phylogenies: [star('e', ['Alphus primus', 'Nullus nemo'])] })
    render(<TipLinker dataset={exact} phylogeny="e" onConfirm={() => {}} />)
    expect(screen.queryByRole('region', { name: /Possible matches/ })).toBeNull()
  })
})

describe('TipLinker on long trees', () => {
  const names = ['Alphus primus', 'Alphus_secundus', 'Betus tertius', 'Gammus quartus', 'Gammus quintus', 'Deltus sextus', 'Nullus nemo', 'Nullus nihil']
  const long = indexDataset({ ...base, phylogenies: [star('long', names)] })

  it('pages above the page size, says which rows are shown, and moves focus off a button that becomes disabled', () => {
    render(<TipLinker dataset={long} phylogeny="long" pageSize={3} onConfirm={() => {}} />)
    const range = () => document.querySelector('.ot-tip-links-range')!
    const rows = () => within(screen.getByRole('table')).getAllByRole('rowheader').map((h) => h.textContent)
    expect(range().getAttribute('role')).toBe('status')
    expect(range().textContent).toBe('Tips 1–3 of 8')
    expect(rows()).toEqual(names.slice(0, 3))
    const previous = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement
    expect(previous.disabled).toBe(true)
    next.focus()
    fireEvent.click(next)
    expect(range().textContent).toBe('Tips 4–6 of 8')
    fireEvent.click(next)
    expect(range().textContent).toBe('Tips 7–8 of 8')
    expect(rows()).toEqual(names.slice(6))
    expect(next.disabled).toBe(true)
    expect(document.activeElement).toBe(previous)
    fireEvent.click(previous)
    fireEvent.click(previous)
    expect(document.activeElement).toBe(next)
    // Every tip still counts, whatever page is shown.
    expect(screen.getByRole('button', { name: 'Accept all exact unique matches (5)' })).toBeTruthy()
  })

  it('narrows the list to one kind of match, with counts, and rows stay as they are linked', () => {
    render(<TipLinker dataset={long} phylogeny="long" pageSize={3} onConfirm={() => {}} />)
    const list = screen.getByRole('combobox', { name: 'List tips' }) as HTMLSelectElement
    expect([...list.options].map((o) => o.textContent)).toEqual(['All (8)', 'No exact match (3)', 'With a possible match (1)', 'Several matches (0)', 'One exact match (5)'])
    fireEvent.change(list, { target: { value: 'none' } })
    expect(within(screen.getByRole('table')).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Alphus_secundus', 'Nullus nemo', 'Nullus nihil'])
    expect(document.querySelector('.ot-tip-links-range')!.textContent).toBe('Tips 1–3 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Link Alphus_secundus to Alphus secundus (not exact)' }))
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(3)
  })

  it('shows no paging at or below the default 200 tips, and pages above it', () => {
    const many = (n: number) => indexDataset({ ...base, phylogenies: [star('m', Array.from({ length: n }, (_, i) => `Tip ${i}`))] })
    render(<TipLinker dataset={many(200)} phylogeny="m" onConfirm={() => {}} />)
    expect(screen.queryByRole('combobox', { name: 'List tips' })).toBeNull()
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(200)
    cleanup()
    render(<TipLinker dataset={many(201)} phylogeny="m" onConfirm={() => {}} />)
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(200)
    expect(document.querySelector('.ot-tip-links-range')!.textContent).toBe('Tips 1–200 of 201')
  })
})
