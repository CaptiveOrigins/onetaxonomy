import { describe, expect, it } from 'vitest'
import { findMRCA, indexPhylogeny, isMonophyletic, validateDataset, type DatasetSnapshot } from '@extantape/onetaxonomy-core'

import { NewickError, parseNewick, toNewick } from '../src'

const base = { id: 't', title: 'Test', version: '1', sources: ['s'] }

describe('parseNewick', () => {
  it('reads labels, lengths, support, quoting and underscores', () => {
    const p = parseNewick("((A_b:0.1,'C, d''e':0.2)95:0.05,F:1e-3);", { ...base, rooted: true, lengthUnit: 'substitutions-per-site' })
    expect(p.nodes.map((n) => n.label ?? `#${n.support?.value ?? ''}`)).toEqual(['#', '#95', 'F', 'A b', "C, d'e"])
    expect(p.edges.map((e) => e.length)).toEqual([0.05, 0.001, 0.1, 0.2])
    expect(p.nodes[1]!.support).toEqual({ value: 95 })
  })
  it('requires rooting to be stated, and honors [&R]/[&U]', () => {
    expect(() => parseNewick('(A,B);', base)).toThrow(NewickError)
    expect(parseNewick('[&U] (A,B,(C,D));', base).rooted).toBe(false)
    expect(parseNewick('[&R] (A,(B,C));', { ...base, rooted: false }).rooted).toBe(true)
  })
  it('keeps polytomies (no silent dichotomizing)', () => {
    const p = parseNewick('((A,B,C,D),(E,F));', { ...base, rooted: true })
    const t = indexPhylogeny(p)
    const ids = (labels: string[]) => labels.map((l) => p.nodes.find((n) => n.label === l)!.id)
    expect(t.children.get(p.nodes[1]!.id)).toHaveLength(4)
    expect(isMonophyletic(t, ids(['A', 'B'])).status).toBe('indeterminate')
  })
  it('maps labels to concepts only when told to (missing stays missing)', () => {
    const p = parseNewick('(Aves,Crocodylia,Unknown_sample);', { ...base, rooted: true, mapLabel: (l) => ({ Aves: ['c:aves'], Crocodylia: ['c:croc'] })[l] })
    expect(p.nodes.map((n) => n.concepts ?? null)).toEqual([null, ['c:aves'], ['c:croc'], null])
  })
  it('keeps comments as annotations', () => {
    const p = parseNewick('(A[&age=66],B)root;', { ...base, rooted: true })
    expect(p.nodes.find((n) => n.label === 'A')!.annotations).toEqual({ newickComments: ['&age=66'] })
  })
  it('explains syntax errors with a position', () => {
    expect(() => parseNewick('(A,B', { ...base, rooted: true })).toThrow(/Expected “,” or “\)”/)
    expect(() => parseNewick('(A,B);(C,D);', { ...base, rooted: true })).toThrow(/Only one tree/)
    expect(() => parseNewick('(A:x,B);', { ...base, rooted: true })).toThrow(/Invalid branch length/)
  })
  it('produces a valid hypothesis inside a snapshot', () => {
    const p = parseNewick('((Squamata,Rhynchocephalia)Lepidosauria,(Testudines,(Crocodylia,Aves)Archosauria))Sauria;', { ...base, rooted: true })
    const snap: DatasetSnapshot = { schemaVersion: 1, id: 'x', version: '1', createdAt: '2026-11-02T00:00:00Z', sources: [{ id: 's', title: 'S' }], names: [], concepts: [], classifications: [], phylogenies: [p] }
    expect(validateDataset(snap).filter((d) => d.severity === 'error')).toEqual([])
    const t = indexPhylogeny(p)
    const id = (l: string) => p.nodes.find((n) => n.label === l)!.id
    expect(findMRCA(t, [id('Testudines'), id('Aves')])).toMatchObject({ status: 'found' })
  })
  it('round-trips through toNewick', () => {
    const text = "[&R] ((A:0.1,'B c':0.2)Inner:0.3,D:0.4)Root;"
    const p = parseNewick(text, { ...base })
    expect(toNewick(p)).toBe(text)
    expect(toNewick(parseNewick(toNewick(p), base))).toBe(text)
  })
  it('handles deep nesting without recursion in the writer', () => {
    const n = 5000
    const text = `${'('.repeat(n)}A${',B)'.repeat(n)};`
    expect(() => toNewick(parseNewick(text, { ...base, rooted: true }))).not.toThrow()
  })
})

describe('paired support labels', () => {
  const text = '((a:1,b:1)95.1/96:1,c:1)80/70;'
  const base = { id: 't', title: 't', version: '1', sources: [], rooted: true }
  it('reads each named method', () => {
    const p = parseNewick(text, { ...base, supportMethods: ['SH-aLRT', 'UFBoot'] })
    const node = p.nodes.find((n) => n.support?.value === 95.1)!
    expect(node.support).toEqual({ value: 95.1, method: 'SH-aLRT' })
    expect(node.additionalSupport).toEqual([{ value: 96, method: 'UFBoot' }])
  })
  it('keeps them as plain labels unless methods are named', () => {
    const p = parseNewick(text, base)
    expect(p.nodes.some((n) => n.label === '95.1/96')).toBe(true)
    expect(p.nodes.some((n) => n.additionalSupport)).toBe(false)
  })
  it('keeps a label whose parts do not match the methods', () => {
    const p = parseNewick('((a,b)95/96/97,c);', { ...base, supportMethods: ['SH-aLRT', 'UFBoot'] })
    expect(p.nodes.some((n) => n.label === '95/96/97')).toBe(true)
  })
})
