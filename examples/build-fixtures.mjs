// Regenerates fixtures/checklist*.json from the CSV files (run after `pnpm build`):
//   node examples/build-fixtures.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { sealSnapshot } from '@captiveorigins/onetaxonomy-core'
import { readChecklistTable, DARWIN_CORE_COLUMNS, toSnapshot } from '@captiveorigins/onetaxonomy-import'

const dir = new URL('../fixtures/', import.meta.url)
for (const [file, release] of [['checklist', '1'], ['checklist-v2', '2']]) {
  const result = readChecklistTable(readFileSync(new URL(`${file}.csv`, dir), 'utf8'), {
    source: {
      id: 'fixture-checklist',
      title: 'OneTaxonomy illustrative checklist (fictional taxa)',
      citation: 'Illustrative teaching data with invented names. Not a scientific source.',
      license: 'CC0-1.0',
      externalVersion: release,
      illustrative: true,
    },
    idPrefix: 'fx',
    classification: { id: 'fx:checklist', title: 'Illustrative checklist', version: release },
    columns: { ...DARWIN_CORE_COLUMNS, vernacular: [{ column: 'vernacular_en', locale: 'en' }, { column: 'vernacular_de', locale: 'de' }] },
  })
  if (result.warnings.length) throw new Error(result.warnings.map((w) => w.message).join('\n'))
  const snapshot = sealSnapshot(toSnapshot(result, { id: 'fixture-checklist', version: release, createdAt: '2026-11-02T00:00:00.000Z' }))
  writeFileSync(new URL(`${file}.json`, dir), `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`${file}.json: ${snapshot.concepts.length} concepts, ${snapshot.names.length} names, ${snapshot.checksum}`)
}
