import { describe, expect, it } from 'vitest'
import { comparePhylogenies, indexPhylogeny, isMonophyletic, sealSnapshot, validateDataset } from '@extantape/onetaxonomy-core'
import { nexusAdapter, NexusError, readNexus, toSnapshot, type NexusOptions } from '../src'

const source = { id: 'src', title: 'Example trees', license: 'CC-BY-4.0', citation: 'Illustrative trees, 2026', illustrative: true }
const o: NexusOptions = { source, id: 'nx', version: '1' }
const lines = (...l: string[]) => l.join('\n')

const file = lines(
  '#NEXUS',
  '[written by hand for the tests]',
  'BEGIN TAXA;',
  '  DIMENSIONS NTAX=4;',
  "  TAXLABELS Alpha_one 'Beta two' Gamma Delta;",
  'END;',
  'BEGIN TREES;',
  '  TITLE Trees;',
  '  TRANSLATE',
  '    1 Alpha_one,',
  "    2 'Beta two',",
  '    3 Gamma,',
  '    4 Delta;',
  '  TREE best = [&R] ((1:0.1,2:0.2)95:0.05,(3:0.3,4:0.4)80:0.05);',
  "  UTREE 'second tree' = (1,2,(3,4)[&note=x]);",
  'END;',
)

describe('NEXUS adapter', () => {
  it('reads each tree in a TREES block, translating tips and keeping rooting, lengths and support', async () => {
    const adapter = nexusAdapter({ ...o, lengthUnit: 'substitutions-per-site' })
    expect(adapter.describe().id).toBe('nexus')
    const r = await adapter.read(file)
    expect(r.source).toEqual(source) // license and citation travel with the source
    expect(r.phylogenies!.map((p) => [p.id, p.title, p.rooted])).toEqual([
      ['nx:1', 'Example trees: best', true],
      ['nx:2', 'Example trees: second tree', false],
    ])
    const best = r.phylogenies![0]!
    expect(best.nodes.filter((n) => n.label).map((n) => n.label)).toEqual(['Alpha one', 'Beta two', 'Gamma', 'Delta'])
    expect(best.nodes.filter((n) => n.support).map((n) => n.support!.value)).toEqual([95, 80])
    expect(best.edges.map((e) => e.length)).toEqual([0.05, 0.05, 0.1, 0.2, 0.3, 0.4])
    expect(best.lengthUnit).toBe('substitutions-per-site')
    expect(r.phylogenies![1]!.nodes.find((n) => n.annotations)!.annotations).toEqual({ newickComments: ['&note=x'] })
    // The TAXA block isn't read, and says so.
    expect(r.warnings).toEqual([{ code: 'skipped-block', message: 'TAXA block is not read', line: 3 }])
  })

  it('maps translated names, not table numbers, to concepts, and only when told to', () => {
    const r = readNexus(file, { ...o, mapLabel: (l) => ({ 'Alpha one': ['c:a'], 'Beta two': ['c:b'], Gamma: ['c:g'], Delta: ['c:d'] })[l] })
    const [best, second] = r.phylogenies!
    expect(best!.nodes.filter((n) => n.concepts).map((n) => n.concepts![0])).toEqual(['c:a', 'c:b', 'c:g', 'c:d'])
    // Both trees are the same unrooted topology: Robinson-Foulds 0.
    expect(comparePhylogenies(best!, second!)).toMatchObject({ status: 'compared', mode: 'unrooted', rf: 0 })
    const t = indexPhylogeny(best!)
    expect(isMonophyletic(t, best!.nodes.filter((n) => n.concepts?.[0] === 'c:a' || n.concepts?.[0] === 'c:b').map((n) => n.id)).status).toBe('monophyletic')
    expect(readNexus(file, o).phylogenies![0]!.nodes.some((n) => n.concepts)).toBe(false)
  })

  it('builds a valid snapshot that can be sealed', () => {
    const snap = toSnapshot(readNexus(file, o), { id: 's', version: '1', createdAt: '2026-11-11T00:00:00Z' })
    expect(validateDataset(snap).filter((d) => d.severity === 'error')).toEqual([])
    expect(sealSnapshot(snap).checksum).toMatch(/^sha256:/)
  })

  it('needs rooting stated: [&R]/[&U], UTREE, or the option', () => {
    const t = lines('#NEXUS', 'BEGIN TREES;', 'TREE a = ((A,B),(C,D));', 'END;')
    expect(() => readNexus(t, o)).toThrow(/Say whether the tree is rooted.*\(line 3\)/)
    expect(readNexus(t, { ...o, rooted: true }).phylogenies![0]!.rooted).toBe(true)
    expect(readNexus(t.replace('TREE a', 'UTREE a'), { ...o, rooted: true }).phylogenies![0]!.rooted).toBe(false)
  })

  it('warns about tip labels that are not in the TRANSLATE table', () => {
    const t = lines('#NEXUS', 'BEGIN TREES;', 'TRANSLATE 1 A, 2 B;', 'TREE a = [&U] (1,2,X);', 'END;')
    expect(readNexus(t, o).warnings).toEqual([{ code: 'untranslated-label', message: 'Tree “a”: 1 tip label(s) are neither a TRANSLATE token nor a translated name (X); kept as written', line: 4 }])
  })

  it('refuses malformed files with the line', () => {
    const refuse = (text: string) => {
      try {
        readNexus(text, { ...o, rooted: true })
      } catch (e) {
        expect(e).toBeInstanceOf(NexusError)
        return (e as Error).message
      }
      throw new Error('accepted')
    }
    expect(refuse('(A,B);')).toBe('Not a NEXUS file: it must start with #NEXUS (line 1)')
    expect(refuse(lines('#NEXUS', 'BEGIN TREES;', 'TREE a = ((A,B),C);'))).toBe('The TREES block opened on line 2 has no END (line 3)')
    expect(refuse(lines('#NEXUS', 'BEGIN TREES;', '', 'TREE a = ((A,B),', '  C:x);', 'END;'))).toBe('Tree “a”: Invalid branch length (line 5)')
    expect(refuse(lines('#NEXUS', 'BEGIN TREES;', 'TRANSLATE 1 A, 1 B;', 'END;'))).toBe('TRANSLATE lists “1” twice (line 3)')
    expect(refuse(lines('#NEXUS', 'BEGIN TREES;', 'TRANSLATE 1 A 2 B;', 'END;'))).toBe('Expected “,” after “A” in TRANSLATE (line 3)')
    expect(refuse(lines('#NEXUS', 'BEGIN TREES;', '[never closed', 'END;'))).toBe('Unclosed comment “[” (line 3)')
    expect(refuse(lines('#NEXUS', 'BEGIN TREES;', 'TREE a = (A,B);', 'END'))).toBe('“END” is not ended with “;” (line 4)')
    expect(refuse(lines('#NEXUS', 'BEGIN TAXA;', 'END;'))).toBe('No TREES block in this file (line 1)')
    expect(refuse(lines('#NEXUS', 'BEGIN TREES;', 'END;'))).toBe('The TREES block has no trees (line 1)')
    expect(refuse(lines('#NEXUS', 'BEGIN TREES;', 'TREE = (A,B);', 'END;'))).toBe('Expected “TREE <name> = <tree>;” (line 3)')
  })
})
