import { describe, expect, it } from 'vitest'
import { applyViewAction, createView, describeView, indexDataset, projectView, sealSnapshot, snapshotChecksum, validateView, ViewActionError, type DatasetSnapshot, type Phylogeny } from '../src'
import { checklist } from './helpers'
import { tiny } from './tiny-tree'

const letters = [...'ABCDEF']
const snapshotOf = (p: Phylogeny): DatasetSnapshot => ({
  schemaVersion: 1, id: 's', version: '1', createdAt: '2026-11-11', sources: [{ id: 's', title: 'S', illustrative: true }],
  names: letters.map((l) => ({ id: `nm:${l}`, name: `Taxon ${l}` })),
  concepts: letters.map((l) => ({ id: `c:${l}`, acceptedName: `nm:${l}` })),
  classifications: [], phylogenies: [p],
})
// n0 root; n1 = (A,B) support 40; n2 = (C,(D,E)) support 60; n3 = (D,E) support 95.
const sealed = sealSnapshot(snapshotOf(tiny('((A:1,B:1)40:1,(C:1,(D:1,E:1)95:2)60:1,F:1);', { rooted: true, lengthUnit: 'substitutions-per-site' })))
const ds = indexDataset(sealed)
const base = createView(ds, { id: 'v', title: 'V', target: { kind: 'phylogeny', id: 't' } })
const shape = (v: typeof base) => {
  const p = projectView(ds, v)
  return p.nodes.map((n) => `${n.id}<${n.parent ?? '-'}${n.length !== undefined ? `:${n.length}` : ''}`)
}

describe('collapsing low-support branches (view only)', () => {
  it('draws branches below the threshold as polytomies and lists them', () => {
    const before = JSON.stringify(sealed)
    const v = applyViewAction(base, { type: 'collapseBelowSupport', threshold: 50 }, ds)
    expect(v.supportCollapse).toEqual({ threshold: 50 })
    const p = projectView(ds, v)
    // n1 (40) goes; A and B hang from the root with n1's length added (1 + 1).
    expect(shape(v)).toEqual(['n0<-', 'A<n0:2', 'B<n0:2', 'n2<n0:1', 'C<n2:1', 'n3<n2:2', 'D<n3:1', 'E<n3:1', 'F<n0:1'])
    expect(p.supportCollapse).toEqual({ threshold: 50, collapsed: ['n1'], withoutSupport: 0 })
    expect(p.counts).toMatchObject({ total: 10, shown: 9, supportCollapsed: 1 })
    expect(p.nodes.find((n) => n.id === 'A')!.depth).toBe(1)
    // A higher threshold takes n2 too; collapsed branches chain their lengths.
    expect(shape(applyViewAction(v, { type: 'collapseBelowSupport', threshold: 70 }, ds))).toEqual(['n0<-', 'A<n0:2', 'B<n0:2', 'C<n0:2', 'n3<n0:3', 'D<n3:1', 'E<n3:1', 'F<n0:1'])
    expect(JSON.stringify(sealed)).toBe(before)
    expect(snapshotChecksum(sealed)).toBe(sealed.checksum)
  })

  it('discloses it in every export', () => {
    const v = applyViewAction(base, { type: 'collapseBelowSupport', threshold: 50 }, ds)
    const lines = describeView(ds, v, projectView(ds, v)).lines
    expect(lines).toContain('1 branch with support below 50 is collapsed into a polytomy for display; the hypothesis itself keeps it.')
    expect(lines).toContain('9 of 10 nodes shown; 1 not shown (1 merged into polytomies for low support).')
  })

  it('never collapses a branch with no support value, and says how many it left', () => {
    const p = tiny('((A:1,B:1):1,(C:1,D:1)30:1);', { rooted: true })
    const d = indexDataset(snapshotOf(p))
    const v = applyViewAction(createView(d, { id: 'v', title: 'V', target: { kind: 'phylogeny', id: 't' } }), { type: 'collapseBelowSupport', threshold: 50 }, d)
    const proj = projectView(d, v)
    expect(proj.supportCollapse).toEqual({ threshold: 50, collapsed: ['n2'], withoutSupport: 1 })
    expect(describeView(d, v, proj).lines.some((l) => l.endsWith('1 internal branch has no support value and was not collapsed.'))).toBe(true)
  })

  it('keeps a missing length missing instead of guessing one', () => {
    const p = tiny('((A:1,B:1)40,C:1);', { rooted: true })
    const d = indexDataset(snapshotOf(p))
    const v = applyViewAction(createView(d, { id: 'v', title: 'V', target: { kind: 'phylogeny', id: 't' } }), { type: 'collapseBelowSupport', threshold: 50 }, d)
    expect(projectView(d, v).nodes.map((n) => [n.id, n.length])).toEqual([['n0', undefined], ['A', undefined], ['B', undefined], ['C', 1]])
  })

  it('leaves a branch the user folded alone, and turns off with null', () => {
    let v = applyViewAction(base, { type: 'collapse', node: 'n1' }, ds)
    v = applyViewAction(v, { type: 'collapseBelowSupport', threshold: 50 }, ds)
    expect(projectView(ds, v).nodes.find((n) => n.id === 'n1')).toMatchObject({ collapsed: true, hiddenDescendants: 2 })
    expect(projectView(ds, v).supportCollapse!.collapsed).toEqual([])
    const off = applyViewAction(v, { type: 'collapseBelowSupport', threshold: null }, ds)
    expect(off.supportCollapse).toBeUndefined()
    expect(projectView(ds, off).supportCollapse).toBeUndefined()
  })

  it('refuses classifications and thresholds that are not numbers', () => {
    const cl = indexDataset(checklist)
    const cv = createView(cl, { id: 'c', title: 'C', target: { kind: 'classification', id: 'fx:checklist' } })
    expect(() => applyViewAction(cv, { type: 'collapseBelowSupport', threshold: 50 }, cl)).toThrow(ViewActionError)
    expect(() => applyViewAction(base, { type: 'collapseBelowSupport', threshold: Number.NaN }, ds)).toThrow(/finite number/)
    expect(validateView({ ...cv, supportCollapse: { threshold: 50 } }, cl).map((d) => d.code)).toContain('support-collapse')
  })
})
