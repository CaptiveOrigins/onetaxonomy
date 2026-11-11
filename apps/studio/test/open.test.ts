import { indexDataset, createView, midpointRoot, projectView, sealSnapshot, validateDataset, verifySnapshot } from '@captiveorigins/onetaxonomy-core'
import { Explorer } from '@captiveorigins/onetaxonomy-react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MISMATCH_NOTICE, OPEN_EXTENSIONS, UNSEALED_NOTICE, delimiterOf, kindOf, newickQuestions, nexusQuestions, openNewick, openNexus, openPhyloXml, openSnapshot, openTable, openTree, phyloXmlQuestions, sealedJson, suggestColumns, tableHeader, targetsOf, withPhylogeny, withTrees } from '../src/open'
import { StatusBar } from '../src/StatusBar'
import { NEXUS } from './fixtures'

const NOW = '2026-11-04T00:00:00.000Z'

describe('opening files', () => {
  it('recognizes each kind by extension', () => {
    expect(['a.json', 'a.nwk', 'a.treefile', 'a.CSV', 'a.zip', 'a.pdf'].map((n) => kindOf(n))).toEqual(['snapshot', 'newick', 'newick', 'table', 'dwca', null])
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

  it('says when a snapshot is unsealed, so a sealed file with its checksum line deleted never opens silently', () => {
    const { snapshot } = openNewick('[&R] (a,b);', 'x.nwk', {}, NOW)
    const sealed = sealedJson(snapshot)
    expect(openSnapshot(sealed).seal).toBeUndefined()
    const stripped = JSON.parse(sealed) as { checksum?: string }
    delete stripped.checksum
    expect(openSnapshot(JSON.stringify(stripped)).seal).toBe(UNSEALED_NOTICE)
    const edited = JSON.parse(sealed) as { id: string }
    edited.id = 'changed'
    const mismatch = openSnapshot(JSON.stringify(edited))
    expect(mismatch.seal).toBe(MISMATCH_NOTICE)
    expect(mismatch.notices[0]).toBe(MISMATCH_NOTICE)
  })

  it('shows the seal notice inside the status region a screen reader announces, and nothing for a sealed file', () => {
    const shown = renderToString(createElement(StatusBar, { status: 'Opened x.json.', seal: UNSEALED_NOTICE, notices: ['a note'] }))
    expect(shown).toMatch(/^<div class="app-status" role="status">/)
    expect(shown).toContain("This snapshot isn&#x27;t sealed, so changes to it since it was made can&#x27;t be detected.")
    // Outside the collapsed list of notes, so it's seen without opening anything.
    expect(shown.indexOf('app-seal')).toBeLessThan(shown.indexOf('<details>'))
    const quiet = renderToString(createElement(StatusBar, { status: 'Opened x.json.', seal: '', notices: [] }))
    expect(quiet).not.toContain('app-seal')
  })

  it('saves a sealed copy without changing the snapshot that is open', () => {
    const { snapshot } = openNewick('[&R] (a,b);', 'x.nwk', {}, NOW)
    const before = JSON.stringify(snapshot)
    const sealed = JSON.parse(sealedJson(snapshot)) as { checksum?: string }
    expect(sealed.checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(snapshot)).toBe(before)
    expect(Object.isFrozen(snapshot)).toBe(false)
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


describe('opening NEXUS and phyloXML', () => {
  it('maps every extension in the open dialog to a kind, and tells NEXUS from Newick in a shared extension', () => {
    expect(OPEN_EXTENSIONS.filter((e) => kindOf(`a.${e}`) === null)).toEqual([])
    expect(['a.nex', 'a.NEXUS', 'a.nxs', 'a.xml', 'a.phyloxml'].map((n) => kindOf(n))).toEqual(['nexus', 'nexus', 'nexus', 'phyloxml', 'phyloxml'])
    expect(kindOf('a.tre', NEXUS)).toBe('nexus')
    expect(kindOf('a.tre', '[saved by a tool]\n#nexus\n')).toBe('nexus')
    expect(kindOf('a.tre', '((a,b),c);')).toBe('newick')
    expect(kindOf('a.tre')).toBe('newick')
  })

  it('asks about rooting only for a NEXUS TREE that does not say', () => {
    expect(nexusQuestions(NEXUS)).toEqual({ rooted: false, supportMethods: 0 })
    expect(nexusQuestions('#NEXUS\nbegin trees; tree a = ((x,y),z); end;').rooted).toBe(true)
    expect(nexusQuestions('#NEXUS\nbegin trees; utree a = ((x,y),z); end;').rooted).toBe(false)
    // BEAST puts a comment with "=" in it before the tree's own "=".
    expect(nexusQuestions('#NEXUS\nbegin trees; tree STATE_0 [&lnP=-12.5] = [&R] ((x,y),z); end;').rooted).toBe(false)
    expect(nexusQuestions('#NEXUS\nbegin trees; tree a = [&U] ((x,y)95/90,z); end;')).toEqual({ rooted: false, supportMethods: 2 })
  })

  it('asks about rooting only for a phyloXML phylogeny without the rooted attribute', () => {
    expect(phyloXmlQuestions('<phyloxml><phylogeny rooted="true"><clade/></phylogeny></phyloxml>').rooted).toBe(false)
    expect(phyloXmlQuestions('<phyloxml><phylogeny><clade/></phylogeny></phyloxml>').rooted).toBe(true)
  })

  it('opens every tree in a NEXUS file with names from TRANSLATE, and lists what it skipped as notes with their line', () => {
    const { snapshot, notices, seal } = openNexus(NEXUS, '/x/Two trees.nex', {}, NOW)
    expect(seal).toBeUndefined()
    expect(targetsOf(snapshot).map((t) => t.id)).toEqual(['two-trees:1', 'two-trees:2'])
    expect(snapshot.phylogenies[0]!.nodes.filter((n) => n.label).map((n) => n.label).sort()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma'])
    expect(snapshot.concepts).toEqual([]) // nothing mapped by guesswork
    expect(notices).toEqual(['Line 2: TAXA block is not read'])
    expect(validateDataset(snapshot).filter((d) => d.severity === 'error')).toEqual([])
  })

  it('opens phyloXML with the answer to the rooting question, and notes unread elements', () => {
    const xml = '<phyloxml><phylogeny><clade><clade><name>A</name><branch_length>1</branch_length></clade><clade><name>B</name><color><red>1</red><green>1</green><blue>1</blue></color></clade></clade></phylogeny></phyloxml>'
    expect(() => openPhyloXml(xml, 'x.xml', {}, NOW)).toThrow(/root/i)
    const { snapshot, notices } = openTree('phyloxml', xml, 'x.xml', { rooted: false }, NOW)
    expect(snapshot.phylogenies[0]!.rooted).toBe(false)
    expect(notices).toEqual([expect.stringMatching(/^Line 1: <color> is not read/)])
  })

  it('adds a rooted copy as a new, unsealed snapshot that says what it came from, leaving the open one sealed and unchanged', () => {
    const open = sealSnapshot(openNexus(NEXUS, 'two.nex', {}, NOW).snapshot)
    const before = JSON.stringify(open)
    const rooted = midpointRoot(open.phylogenies[0]!, { id: 'two:1-midpoint', version: '2026-11-11' })
    const next = withPhylogeny(open, rooted, '2026-11-11T00:00:00.000Z')
    expect(JSON.stringify(open)).toBe(before)
    expect(verifySnapshot(open)).toBe(true)
    expect(next.checksum).toBeUndefined()
    expect(next.derivedFrom).toEqual({ snapshot: open.id, version: open.version, checksum: open.checksum })
    expect(next.version).toBe(`${open.version}+two:1-midpoint`)
    expect(next.phylogenies.map((p) => p.id)).toEqual(['two:1', 'two:2', 'two:1-midpoint'])
    expect(validateDataset(next).filter((d) => d.severity === 'error')).toEqual([])
    expect(verifySnapshot(JSON.parse(sealedJson(next)))).toBe(true)
    expect(() => withPhylogeny(next, rooted, NOW)).toThrow(/already has a tree with the id two:1-midpoint/)
  })
})

describe('adding trees to an open dataset', () => {
  const checklist = () => openTable('taxonID,scientificName,parentNameUsageID\n1,Alphus,\n2,Alphus primus,1\n3,Alphus secundus,1\n', '/made-up/alphus.csv', { taxonID: 'taxonID', name: 'scientificName', parentID: 'parentNameUsageID' }, ',', NOW).snapshot
  it('adds the trees as a new snapshot, renaming a source or tree id already in use, and leaves the open one alone', () => {
    const open = sealSnapshot(checklist())
    const before = JSON.stringify(open)
    const tree = openNewick('[&R] (Alphus_primus,Alphus_secundus);', '/made-up/alphus.nwk', {}, NOW).snapshot
    expect(tree.sources[0]!.id).toBe(open.sources[0]!.id) // both files are called "alphus"
    const next = withTrees(open, tree, '2026-11-11T00:00:00.000Z')
    expect(JSON.stringify(open)).toBe(before)
    expect(next.sources.map((x) => x.id)).toEqual(['alphus', 'alphus-2'])
    expect(next.phylogenies.map((p) => [p.id, p.sources])).toEqual([['alphus', ['alphus-2']]])
    expect(next.concepts).toBe(open.concepts)
    expect(next.checksum).toBeUndefined()
    expect(next.derivedFrom).toEqual({ snapshot: open.id, version: open.version, checksum: open.checksum })
    expect(validateDataset(next).filter((d) => d.severity === 'error')).toEqual([])
    // The same file again: its tree gets a new id rather than replacing the first.
    const again = withTrees(next, tree, NOW)
    expect(again.phylogenies.map((p) => p.id)).toEqual(['alphus', 'alphus-2'])
    expect(again.sources.map((x) => x.id)).toEqual(['alphus', 'alphus-2', 'alphus-3'])
    // Tips are never linked on the way in.
    expect(again.phylogenies.flatMap((p) => p.nodes).some((n) => n.concepts?.length)).toBe(false)
  })

  it('refuses a file that brings taxa or no tree, instead of merging taxonomies', () => {
    const open = checklist()
    expect(() => withTrees(open, open, NOW)).toThrow(/holds taxa or a classification as well as trees/)
    expect(() => withTrees(open, { ...open, names: [], concepts: [], classifications: [], phylogenies: [] }, NOW)).toThrow(/holds no tree/)
  })
})
