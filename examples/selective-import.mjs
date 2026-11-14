// M3 acceptance demo: read a checklist (CSV), choose three nonadjacent taxa, import
// only those plus their ancestor paths, and show what was left out.
//   pnpm build && node examples/selective-import.mjs
import { readFileSync } from 'node:fs'
import { indexDataset, sealSnapshot, diffSnapshots, referenceImpact, getCoverageReport } from '@extantape/onetaxonomy-core'
import { readChecklistTable, toSnapshot, selectiveImport } from '@extantape/onetaxonomy-import'

const csv = readFileSync(new URL('../fixtures/checklist.csv', import.meta.url), 'utf8')
const read = readChecklistTable(csv, {
  source: { id: 'fixture-checklist', title: 'Illustrative checklist (fictional taxa)', illustrative: true, externalVersion: '1' },
  idPrefix: 'fx',
  classification: { id: 'fx:checklist' },
})
const full = sealSnapshot(toSnapshot(read, { id: 'fixture-checklist', version: '1', createdAt: '2026-11-02T00:00:00.000Z' }))
const ds = indexDataset(full)
const pick = (name) => ds.findByName(name)[0].concept.id

const { snapshot, coverage, diagnostics } = selectiveImport(
  full,
  {
    id: 'demo',
    title: 'Three nonadjacent taxa',
    version: '1',
    classification: 'fx:checklist',
    roots: ['Alphus secundus', 'Gammus quintus', 'Zetus nonus'].map((n) => ({ concept: pick(n), policy: { kind: 'allAvailableDescendants' } })),
  },
  { id: 'demo-curated', version: '1', createdAt: '2026-11-02T00:00:00.000Z', knownToScience: { [pick('Alphus secundus')]: { count: 2, rank: 'subspecies', source: 'illustrative count' } } },
)

const cur = indexDataset(snapshot)
console.log(`Imported ${snapshot.concepts.length} of ${full.concepts.length} concepts:`)
const walk = (id, depth) => {
  console.log(`${'  '.repeat(depth)}${cur.nameOf(id)} (${cur.concept.get(id).rank})`)
  for (const c of cur.classification('fx:checklist').children.get(id)) walk(c, depth + 1)
}
for (const r of cur.classification('fx:checklist').roots) walk(r, 1)

console.log('\nCoverage per chosen root (dataset · known to science):')
for (const g of coverage) {
  const known = g.knownToScience === 'not-stated' ? 'not stated' : `${g.knownToScience.includedAtRank} of ${g.knownToScience.count} ${g.knownToScience.rank} (${g.knownToScience.source})`
  console.log(`  ${g.name}: ${g.dataset.included}/${g.dataset.total} in the dataset · ${known}`)
}
const [whole] = getCoverageReport(ds, { classification: 'fx:checklist', included: snapshot.concepts.map((c) => c.id), groups: [...ds.classification('fx:checklist').roots] })
console.log(`\nLeft out under ${whole.name}: ${whole.dataset.omitted} of ${whole.dataset.total} concepts, in these branches:`)
console.log(`  ${whole.dataset.omittedBranches.map((id) => ds.nameOf(id)).join(', ')}`)
console.log(`Diagnostics: ${diagnostics.filter((d) => d.severity !== 'info').length} errors/warnings`)

// A new release of the source: what changes for the curated references?
const v2 = JSON.parse(readFileSync(new URL('../fixtures/checklist-v2.json', import.meta.url), 'utf8'))
const impact = referenceImpact(diffSnapshots(full, v2), snapshot.concepts.map((c) => c.id))
console.log('\nRelease 2 would affect:')
for (const i of impact) console.log(`  ${ds.nameOf(i.id)}: ${i.change} (${i.detail})`)
