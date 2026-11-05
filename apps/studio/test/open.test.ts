import { indexDataset, createView, projectView, validateDataset } from '@captiveorigins/onetaxonomy-core'
import { Explorer } from '@captiveorigins/onetaxonomy-react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { delimiterOf, kindOf, newickQuestions, openNewick, openSnapshot, openTable, sealedJson, suggestColumns, tableHeader, targetsOf } from '../src/open'

const NOW = '2026-11-04T00:00:00.000Z'

describe('opening files', () => {
  it('recognizes each kind by extension', () => {
    expect(['a.json', 'a.nwk', 'a.treefile', 'a.CSV', 'a.zip', 'a.pdf'].map(kindOf)).toEqual(['snapshot', 'newick', 'newick', 'table', 'dwca', null])
  })

  it('asks about rooting unless the file says, and notices paired support', () => {
    expect(newickQuestions('((a,b)90,c);')).toEqual({ rooted: true, supportMethods: 0 })
    expect(newickQuestions('[&R] ((a,b)90,c);').rooted).toBe(false)
    expect(newickQuestions('((a:1,b:1)95.1/95:1,c:1);')).toEqual({ rooted: true, supportMethods: 2 })
  })

  it('opens a Newick tree that a person can view, with no taxa mapped by guesswork', () => {
    const { snapshot } = openNewick('((a:1,b:1)95.1/95:1,c:1);', '/x/My Tree.treefile', { rooted: true, supportMethods: ['SH-aLRT', 'UFBoot'] }, NOW)
    expect(snapshot.concepts).toEqual([])
    const [target] = targetsOf(snapshot)
    expect(target).toMatchObject({ kind: 'phylogeny', id: 'my-tree', title: 'My Tree' })
    const index = indexDataset(snapshot)
    const projection = projectView(index, createView(index, { id: 'v', title: 't', target: { kind: target!.kind, id: target!.id } }))
    expect(projection.nodes.filter((n) => n.label === 'a')).toHaveLength(1)
    expect(snapshot.phylogenies[0]!.nodes.find((n) => n.support)?.support?.method).toBe('SH-aLRT')
  })

  it('refuses a tree when rooting is unknown instead of assuming', () => {
    expect(() => openNewick('((a,b),c);', 'x.nwk', {}, NOW)).toThrow(/rooted/)
  })

  it('suggests columns from names, then opens a checklist and keeps warnings', () => {
    const text = 'ID,Name,Parent,Status\n1,Testudines,,accepted\n2,Chelonoidis,1,accepted\n3,Mystery,99,accepted\n'
    const delimiter = delimiterOf('x.csv', text)
    const columns = suggestColumns(tableHeader(text, delimiter))
    expect(columns).toEqual({ taxonID: 'ID', name: 'Name', parentID: 'Parent', status: 'Status' })
    const { snapshot, notices } = openTable(text, 'x.csv', columns as { taxonID: string; name: string }, delimiter, NOW)
    expect(snapshot.classifications).toHaveLength(1)
    expect(notices.some((n) => /99/.test(n))).toBe(true)
  })

  it('reads tab-separated tables', () => {
    expect(delimiterOf('x.tsv', 'a,b')).toBe('\t')
    expect(delimiterOf('x.txt', 'a\tb\n')).toBe('\t')
    expect(tableHeader('a\tb\n1\t2', '\t')).toEqual(['a', 'b'])
  })

  it('round-trips a sealed snapshot and flags one edited afterward', () => {
    const { snapshot } = openNewick('[&R] (a,b);', 'x.nwk', {}, NOW)
    const sealed = sealedJson(snapshot)
    expect(openSnapshot(sealed).notices).toEqual(validateDataset(snapshot).map((d) => `${d.severity}: ${d.message}`))
    const edited = JSON.parse(sealed) as { id: string }
    edited.id = 'changed'
    expect(openSnapshot(JSON.stringify(edited)).notices[0]).toMatch(/checksum/)
  })

  it('draws what it opened in the explorer', () => {
    const tree = openNewick('[&R] ((Alpha:1,Beta:1)95.1/95:1,Gamma:1);', 'x.nwk', { supportMethods: ['SH-aLRT', 'UFBoot'] }, NOW).snapshot
    const table = openTable('ID,Name,Parent\n1,Testudines,\n2,Chelonoidis,1\n', 'x.csv', { taxonID: 'ID', name: 'Name', parentID: 'Parent' }, ',', NOW).snapshot
    for (const [snapshot, label] of [[tree, 'Alpha'], [table, 'Testudines']] as const) {
      const dataset = indexDataset(snapshot)
      const t = targetsOf(snapshot)[0]!
      const html = renderToString(createElement(Explorer, { dataset, initialView: createView(dataset, { id: 'v', title: t.title, target: { kind: t.kind, id: t.id } }), title: t.title }))
      expect(html).toContain(label)
    }
  })
})
