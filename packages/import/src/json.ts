import { SCHEMA_VERSION, validateDataset, verifySnapshot, type DatasetSnapshot, type Diagnostic } from '@captiveorigins/onetaxonomy-core'

/**
 * Reads a OneTaxonomy snapshot from JSON text: checks the schema version, the
 * checksum (when the snapshot is sealed) and runs `validateDataset`. The caller
 * decides what to do with warnings; errors make the snapshot unusable.
 */
export function readSnapshotJson(text: string): { snapshot: DatasetSnapshot; diagnostics: Diagnostic[]; checksum: 'verified' | 'mismatch' | 'unsealed' } {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || !Array.isArray((value as DatasetSnapshot).concepts)) throw new Error('Not a OneTaxonomy snapshot (no concepts array)')
  const snapshot = value as DatasetSnapshot
  if (snapshot.schemaVersion !== SCHEMA_VERSION) throw new Error(`Snapshot schema version ${String(snapshot.schemaVersion)} is not supported (expected ${SCHEMA_VERSION}); migrate it first`)
  for (const k of ['sources', 'names', 'classifications', 'phylogenies'] as const) if (!Array.isArray(snapshot[k])) throw new Error(`Snapshot field “${k}” must be an array`)
  const checksum = snapshot.checksum === undefined ? 'unsealed' : verifySnapshot(snapshot) ? 'verified' : 'mismatch'
  return { snapshot, diagnostics: validateDataset(snapshot), checksum }
}
