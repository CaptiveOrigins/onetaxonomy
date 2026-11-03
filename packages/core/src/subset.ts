import type { SelectionResult } from './curation'
import type { Classification, DatasetSnapshot, Id, Phylogeny } from './model'
import { SCHEMA_VERSION } from './model'

export type SubsetOptions = {
  id: Id
  version: string
  createdAt: string
  classification: Id
  /** Concepts to keep. Must be closed under ancestors in the classification (a `SelectionResult` is). */
  include: SelectionResult | Iterable<Id>
  /**
   * Phylogenies: `none` (default) leaves them out; `keep` copies those whose mapped
   * concepts are all inside the subset, untouched. Pruning a hypothesis changes it,
   * so OneTaxonomy never prunes one silently.
   */
  phylogenies?: 'none' | 'keep'
}

/**
 * A new, unsealed snapshot holding only the chosen concepts, the names and sources
 * they use, their placements, profiles and trait values, with `derivedFrom` provenance. Refuses an
 * include set that would orphan a placement (no silent re-parenting).
 */
export function extractSubset(source: DatasetSnapshot, o: SubsetOptions): DatasetSnapshot {
  const fromSelection = typeof o.include === 'object' && o.include !== null && 'included' in o.include
  const keep = new Set(fromSelection ? (o.include as SelectionResult).included : (o.include as Iterable<Id>))
  const cls = source.classifications.find((c) => c.id === o.classification)
  if (!cls) throw new RangeError(`Unknown classification ${o.classification}`)

  const placements = cls.placements.filter((p) => keep.has(p.concept))
  const placed = new Set(placements.map((p) => p.concept))
  for (const id of keep) if (!placed.has(id)) throw new RangeError(`Concept ${id} is not placed in classification ${cls.id}`)
  for (const p of placements) {
    if (p.parent !== null && !keep.has(p.parent)) throw new RangeError(`Concept ${p.concept} would lose its parent ${p.parent}: include ancestors (apply a selection) first`)
  }

  const concepts = source.concepts.filter((c) => keep.has(c.id))
  const nameIds = new Set<Id>()
  const sourceIds = new Set<Id>(cls.sources)
  for (const c of concepts) {
    nameIds.add(c.acceptedName)
    for (const u of c.usages ?? []) {
      nameIds.add(u.name)
      if (u.source) sourceIds.add(u.source)
    }
    if (c.provenance) sourceIds.add(c.provenance.source)
    for (const n of c.commonNames ?? []) if (n.source) sourceIds.add(n.source)
  }
  for (const p of placements) if (p.provenance) sourceIds.add(p.provenance.source)

  const phylogenies: Phylogeny[] =
    o.phylogenies === 'keep' ? source.phylogenies.filter((p) => p.nodes.every((n) => (n.concepts ?? []).every((c) => keep.has(c)))) : []
  for (const p of phylogenies) for (const s of p.sources) sourceIds.add(s)
  const traits = (source.traits ?? []).map((t) => ({ ...t, values: t.values.filter((v) => keep.has(v.concept)) })).filter((t) => t.values.length)
  for (const t of traits) sourceIds.add(t.source)

  const classification: Classification = { ...cls, placements }
  const out: DatasetSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    id: o.id,
    version: o.version,
    createdAt: o.createdAt,
    sources: source.sources.filter((s) => sourceIds.has(s.id)),
    names: source.names.filter((n) => nameIds.has(n.id)),
    concepts,
    classifications: [classification],
    phylogenies,
    derivedFrom: {
      snapshot: source.id,
      version: source.version,
      ...(source.checksum ? { checksum: source.checksum } : {}),
      ...(fromSelection ? { selection: (o.include as SelectionResult).selection } : {}),
    },
  }
  const profiles = source.profiles?.filter((p) => keep.has(p.concept))
  if (profiles?.length) out.profiles = profiles
  if (traits.length) out.traits = traits
  return out
}
