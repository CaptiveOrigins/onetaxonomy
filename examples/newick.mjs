// Read a Newick tree, keep its polytomy, and ask questions with stated rooting.
import { findMRCA, indexPhylogeny, isMonophyletic } from '@extantape/onetaxonomy-core'
import { parseNewick, toNewick } from '@extantape/onetaxonomy-import'

const tree = parseNewick('((A,B,C,D)Unresolved,(E,F)Pair)Root;', { id: 'demo', title: 'Demo', version: '1', sources: ['demo'], rooted: true })
const index = indexPhylogeny(tree)
const id = (label) => tree.nodes.find((n) => n.label === label).id

console.log(toNewick(tree))
console.log('E + F:', isMonophyletic(index, [id('E'), id('F')]).status)
console.log('A + B (part of a polytomy):', isMonophyletic(index, [id('A'), id('B')]).status)
console.log('A + E:', isMonophyletic(index, [id('A'), id('E')]).status, '— MRCA', findMRCA(index, [id('A'), id('E')]).node)
