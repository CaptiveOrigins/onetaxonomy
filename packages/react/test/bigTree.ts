import type { DatasetSnapshot, PhyloEdge, PhyloNode } from '@captiveorigins/onetaxonomy-core'

/**
 * A made-up phylogeny with `tips` tips, for canvas and level-of-detail tests. Split
 * by a fixed rule (about a third to the left), so it is unbalanced like real trees
 * and the same every run. Tips are "Taxon 1"…; nothing here is real data.
 */
export function bigTree(tips: number): DatasetSnapshot {
  const nodes: PhyloNode[] = []
  const edges: PhyloEdge[] = []
  let inner = 0
  let tip = 0
  const build = (count: number, parent: string | null) => {
    let id: string
    if (count === 1) {
      tip++
      id = `t${tip}`
      nodes.push({ id, label: `Taxon ${tip}` })
    } else {
      id = `n${inner++}`
      nodes.push({ id })
    }
    if (parent !== null) edges.push({ id: `${parent}>${id}`, parent, child: id, length: 1 })
    if (count > 1) {
      const left = Math.max(1, Math.floor(count / 3))
      build(left, id)
      build(count - left, id)
    }
  }
  build(tips, null)
  return {
    schemaVersion: 1,
    id: `made-up-${tips}`,
    version: '1',
    createdAt: '2026-11-11T00:00:00.000Z',
    sources: [{ id: 'made-up', title: 'Made-up tree for tests', citation: 'Generated for tests. Not a scientific source.', license: 'CC0-1.0', illustrative: true }],
    names: [],
    concepts: [],
    classifications: [],
    phylogenies: [{ id: 'big', title: 'Made-up tree', version: '1', sources: ['made-up'], rooted: true, nodes, edges }],
  } as DatasetSnapshot
}
