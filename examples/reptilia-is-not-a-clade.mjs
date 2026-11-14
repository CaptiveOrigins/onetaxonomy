// Is traditional class Reptilia a clade? Ask each hypothesis, not the classification.
// Run: pnpm build && pnpm --filter @extantape/onetaxonomy-examples start
import { readFileSync } from 'node:fs'
import { assessTaxon, findMRCA, indexDataset, isMonophyletic, validateDataset } from '@extantape/onetaxonomy-core'

const snapshot = JSON.parse(readFileSync(new URL('../fixtures/amniotes.json', import.meta.url), 'utf8'))
for (const d of validateDataset(snapshot)) console.log(`[${d.severity}] ${d.message}`)

const data = indexDataset(snapshot)
const traditional = data.classification('traditional')

console.log('\nClassification alone:', assessTaxon(traditional, 'c:reptilia', null).reason)
for (const h of ['archelosauria', 'anapsid-turtles']) {
  const tree = data.phylogeny(h)
  const r = assessTaxon(traditional, 'c:reptilia', tree)
  const missing = r.missing.map((id) => tree.node.get(id)?.label).join(', ')
  console.log(`${tree.phylogeny.title}: Reptilia is ${r.status} (missing: ${missing || 'none'})`)
  const turtlesWithArchosaurs = isMonophyletic(tree, ['t-testudines', 't-crocodylia', 't-aves'])
  console.log(`  turtles + crocodylians + birds: ${turtlesWithArchosaurs.status}; MRCA of turtles and birds: ${findMRCA(tree, ['t-testudines', 't-aves']).node}`)
}
