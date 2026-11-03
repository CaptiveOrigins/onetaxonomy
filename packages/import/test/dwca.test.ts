import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { dwcaAdapter, readDwca, readZip, ZipError } from '../src'
import { makeZip } from './zip-helper'

const meta = `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Taxon">
    <files><location>taxon.txt</location></files>
    <id index="0"/>
    <field index="1" term="http://rs.tdwg.org/dwc/terms/parentNameUsageID"/>
    <field index="2" term="http://rs.tdwg.org/dwc/terms/acceptedNameUsageID"/>
    <field index="3" term="http://rs.tdwg.org/dwc/terms/taxonomicStatus"/>
    <field index="4" term="http://rs.tdwg.org/dwc/terms/taxonRank"/>
    <field index="5" term="http://rs.tdwg.org/dwc/terms/scientificName"/>
    <field index="6" term="http://rs.tdwg.org/dwc/terms/scientificNameAuthorship"/>
    <field term="http://rs.tdwg.org/dwc/terms/nomenclaturalCode" default="ICZN"/>
  </core>
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.gbif.org/terms/1.0/VernacularName">
    <files><location>vernacular.txt</location></files>
    <coreid index="0"/>
    <field index="1" term="http://rs.tdwg.org/dwc/terms/vernacularName"/>
    <field index="2" term="http://purl.org/dc/terms/language"/>
  </extension>
  <extension rowType="http://rs.gbif.org/terms/1.0/Distribution" fieldsTerminatedBy="\\t">
    <files><location>distribution.txt</location></files>
    <coreid index="0"/>
  </extension>
</archive>`
const taxon = [
  'id\tparent\taccepted\tstatus\trank\tname\tauthor',
  'A\t\t\taccepted\tgenus\tExemplus\tFixture, 2026',
  'B\tA\t\taccepted\tspecies\tExemplus unus\tFixture, 2026',
  'C\t\tB\tsynonym\tspecies\tExemplus "primus"\tFixture, 2020',
].join('\n')
const vernacular = 'id\tname\tlang\nB\tfirst example\ten\nB\tBeispiel\tde\n'
const source = { id: 'dwc', title: 'Test archive' }

describe('Darwin Core Archive adapter', () => {
  it('reads core, vernacular names and meta.xml (deflated ZIP, platform inflate)', async () => {
    const zip = makeZip({ 'meta.xml': meta, 'taxon.txt': taxon, 'vernacular.txt': vernacular, 'distribution.txt': 'id\n' })
    const r = await dwcaAdapter({ source }).read(zip)
    expect(r.concepts.map((c) => c.id)).toEqual(['dwc:A', 'dwc:B'])
    const unus = r.concepts[1]!
    expect(unus.rank).toBe('species')
    expect(unus.commonNames).toEqual([
      { name: 'first example', locale: 'en', source: 'dwc' },
      { name: 'Beispiel', locale: 'de', source: 'dwc' },
    ])
    // No quoting declared: the quotes are part of the name.
    expect(r.names.find((n) => n.id === 'dwc:name:C')!.name).toBe('Exemplus "primus"')
    expect(unus.usages).toEqual([{ name: 'dwc:name:C', status: 'synonym', source: 'dwc' }])
    expect(r.classification!.placements).toEqual([
      { concept: 'dwc:A', parent: null },
      { concept: 'dwc:B', parent: 'dwc:A' },
    ])
    expect(r.warnings.map((w) => w.code)).toEqual(['unsupported-row-type'])
  })

  it('reads stored entries, a nested folder, and a caller-supplied inflate', async () => {
    const stored = makeZip({ 'export/meta.xml': meta, 'export/taxon.txt': taxon, 'export/vernacular.txt': vernacular }, { deflate: false })
    expect((await readDwca(stored, { source })).concepts).toHaveLength(2)
    const deflated = makeZip({ 'meta.xml': meta, 'taxon.txt': taxon, 'vernacular.txt': vernacular })
    expect((await readDwca(deflated, { source, inflate: async (d) => new Uint8Array(inflateRawSync(d)) })).concepts).toHaveLength(2)
  })

  it('reads an archive without meta.xml from its header row', async () => {
    const r = await readDwca({ files: { 'taxa.txt': 'taxonID\tparentNameUsageID\tscientificName\n1\t\tExemplus\n2\t1\tExemplus unus\n' } }, { source })
    expect(r.classification!.placements).toEqual([
      { concept: 'dwc:1', parent: null },
      { concept: 'dwc:2', parent: 'dwc:1' },
    ])
  })

  it('refuses archives it cannot read', async () => {
    await expect(readZip(new Uint8Array([1, 2, 3]))).rejects.toThrow(ZipError)
    await expect(readDwca({ files: { 'a.txt': 'x', 'b.txt': 'y' } }, { source })).rejects.toThrow(/can't tell/)
    await expect(readDwca({ files: { 'meta.xml': meta } }, { source })).rejects.toThrow(/missing/)
  })
})
