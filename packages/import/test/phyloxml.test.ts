import { describe, expect, it } from 'vitest'
import { comparePhylogenies, sealSnapshot, validateDataset } from '@extantape/onetaxonomy-core'
import { phyloXmlAdapter, PhyloXmlError, readPhyloXml, toSnapshot, type PhyloXmlOptions } from '../src'

const source = { id: 'src', title: 'Example trees', license: 'CC0-1.0', illustrative: true }
const o: PhyloXmlOptions = { source, id: 'px', version: '1' }
const lines = (...l: string[]) => l.join('\n')

const file = lines(
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<phyloxml xmlns="http://www.phyloxml.org">',
  '  <phylogeny rooted="true">',
  '    <name>Example &amp; test</name>',
  '    <clade>',
  '      <clade branch_length="0.05">',
  '        <confidence type="bootstrap">95</confidence>',
  '        <confidence type="posterior">0.99</confidence>',
  '        <clade><name>A</name><branch_length>0.1</branch_length></clade>',
  '        <clade branch_length="0.2">',
  '          <taxonomy><id provider="ncbi">9606</id><scientific_name>Taxon b</scientific_name><rank>species</rank></taxonomy>',
  '          <sequence><mol_seq>ACGT</mol_seq></sequence>',
  '        </clade>',
  '      </clade>',
  '      <clade><name>C</name><color><red>1</red><green>0</green><blue>0</blue></color></clade>',
  '      <!-- a comment -->',
  '      <clade><name><![CDATA[D <sample>]]></name></clade>',
  '    </clade>',
  '  </phylogeny>',
  '  <phylogeny rooted="false">',
  '    <clade><clade><name>A</name></clade><clade><name>Taxon b</name></clade><clade><clade><name>C</name></clade><clade><name>D &lt;sample&gt;</name></clade></clade></clade>',
  '  </phylogeny>',
  '</phyloxml>',
)

describe('phyloXML adapter', () => {
  it('reads clades, names, branch lengths, confidence and taxonomy, and lists what it skipped', async () => {
    const adapter = phyloXmlAdapter({ ...o, lengthUnit: 'substitutions-per-site' })
    expect(adapter.describe().id).toBe('phyloxml')
    const r = await adapter.read(file)
    expect(r.source).toEqual(source)
    const [first, second] = r.phylogenies!
    expect(first).toMatchObject({ id: 'px:1', title: 'Example trees: Example & test', rooted: true, lengthUnit: 'substitutions-per-site', sources: ['src'] })
    expect(second).toMatchObject({ id: 'px:2', title: 'Example trees (tree 2)', rooted: false })
    expect(first!.nodes.map((n) => n.label ?? null)).toEqual([null, null, 'C', 'D <sample>', 'A', 'Taxon b'])
    expect(first!.edges.map((e) => [e.child, e.length])).toEqual([['px:1:n1', 0.05], ['px:1:n2', undefined], ['px:1:n3', undefined], ['px:1:n4', 0.1], ['px:1:n5', 0.2]])
    expect(first!.nodes[1]).toMatchObject({ support: { value: 95, method: 'bootstrap' }, additionalSupport: [{ value: 0.99, method: 'posterior' }] })
    expect(first!.nodes[5]!.annotations).toEqual({ phyloxml: { taxonomy: { scientificName: 'Taxon b', rank: 'species', ids: [{ provider: 'ncbi', id: '9606' }] } } })
    expect(r.warnings).toEqual([
      { code: 'unsupported-element', message: '<color> is not read (1 in the file, first on line 15)', line: 15 },
      { code: 'unsupported-element', message: '<sequence> is not read (1 in the file, first on line 12)', line: 12 },
    ])
  })

  it('maps to concepts only when told to, by taxonomy id or by label', () => {
    const r = readPhyloXml(file, {
      ...o,
      mapTaxonomy: (t) => (t.ids.some((x) => x.provider === 'ncbi' && x.id === '9606') ? ['c:b'] : undefined),
      mapLabel: (l) => ({ A: ['c:a'], 'Taxon b': ['c:b'], C: ['c:c'], 'D <sample>': ['c:d'] })[l],
    })
    const [first, second] = r.phylogenies!
    expect(first!.nodes.map((n) => n.concepts?.[0] ?? null)).toEqual([null, null, 'c:c', 'c:d', 'c:a', 'c:b'])
    // Same unrooted topology ((A,b),(C,D)): Robinson-Foulds 0.
    expect(comparePhylogenies(first!, second!)).toMatchObject({ status: 'compared', mode: 'unrooted', rf: 0 })
    expect(readPhyloXml(file, o).phylogenies![0]!.nodes.some((n) => n.concepts)).toBe(false)
  })

  it('builds a valid snapshot that can be sealed', () => {
    const snap = toSnapshot(readPhyloXml(file, o), { id: 's', version: '1', createdAt: '2026-11-11T00:00:00Z' })
    expect(validateDataset(snap).filter((d) => d.severity === 'error')).toEqual([])
    expect(sealSnapshot(snap).checksum).toMatch(/^sha256:/)
  })

  it('needs rooting stated by the file or the option', () => {
    const t = '<phyloxml><phylogeny><clade><clade/><clade/></clade></phylogeny></phyloxml>'
    expect(() => readPhyloXml(t, o)).toThrow('Say whether the tree is rooted: the rooted attribute is missing and no rooted option was given (line 1, <phylogeny>)')
    expect(readPhyloXml(t, { ...o, rooted: false }).phylogenies![0]!.rooted).toBe(false)
  })

  it('reads deep nesting without running out of stack', () => {
    const n = 5000
    const t = `<phyloxml><phylogeny rooted="true">${'<clade><clade><name>x</name></clade>'.repeat(n)}${'</clade>'.repeat(n)}</phylogeny></phyloxml>`
    expect(readPhyloXml(t, o).phylogenies![0]!.nodes).toHaveLength(2 * n)
  })

  it('refuses malformed input with the line and element', () => {
    const refuse = (text: string) => {
      try {
        readPhyloXml(text, o)
      } catch (e) {
        expect(e).toBeInstanceOf(PhyloXmlError)
        return (e as Error).message
      }
      throw new Error('accepted')
    }
    const wrap = (...inner: string[]) => lines('<phyloxml>', '<phylogeny rooted="true">', ...inner, '</phylogeny>', '</phyloxml>')
    expect(refuse(wrap('<clade>', '<clade><name>A</name>', '</clade>'))).toBe('End tag </phylogeny> does not match <clade> opened on line 3 (line 6, <clade>)')
    expect(refuse(wrap('<clade><clade branch_length="x"/></clade>'))).toBe('branch_length “x” is not a number (line 3, <clade>)')
    expect(refuse(wrap('<clade><clade branch_length="1"><branch_length>2</branch_length></clade></clade>'))).toBe('branch_length is given twice with different values (1 and 2) (line 3, <clade>)')
    expect(refuse(wrap('<clade>', '  <confidence type="bootstrap">high</confidence>', '</clade>'))).toBe('confidence “high” is not a number (line 4, <confidence>)')
    expect(refuse(wrap('<clade/>', '<clade/>'))).toBe('A phylogeny has one top-level <clade>; this one has 2 (line 2, <phylogeny>)')
    expect(refuse(wrap())).toBe('This phylogeny has no <clade> (line 2, <phylogeny>)')
    expect(refuse(lines('<phyloxml>', '<phylogeny rooted="maybe"><clade/></phylogeny>', '</phyloxml>'))).toBe('rooted="maybe" must be true or false (line 2, <phylogeny>)')
    expect(refuse('<nexml/>')).toBe('The root element is <nexml>, not <phyloxml> (line 1, <nexml>)')
    expect(refuse('<phyloxml/>')).toBe('No <phylogeny> in this file (line 1, <phyloxml>)')
    expect(refuse(lines('<phyloxml>', '<phylogeny rooted="true">', '<clade><name>A & B</name></clade>'))).toBe('A bare “&” must be written &amp; (line 3, <name>)')
    expect(refuse(lines('<phyloxml>', '<phylogeny rooted="true">', '<clade><name>&nbsp;</name></clade>', '</phylogeny></phyloxml>'))).toBe('Unknown entity &nbsp; (line 3, <name>)')
    expect(refuse(lines('<phyloxml>', '<phylogeny rooted="true">', '<clade>'))).toBe('<clade> opened on line 3 is never closed (line 3, <clade>)')
    expect(refuse('<!DOCTYPE x [<!ENTITY e "boom">]><phyloxml/>')).toBe('DOCTYPE with an internal subset is not read (it can declare entities) (line 1, <document>)')
  })
})
