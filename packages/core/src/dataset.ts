import type { Classification, DatasetSnapshot, Id, Phylogeny, ScientificName, TaxonConcept } from './model'
import { indexClassification, indexPhylogeny, type ClassificationIndex, type PhylogenyIndex } from './tree'

/** Lookup tables for one snapshot, with hierarchy indexes built on first use. */
export type DatasetIndex = {
  snapshot: DatasetSnapshot
  concept: ReadonlyMap<Id, TaxonConcept>
  name: ReadonlyMap<Id, ScientificName>
  classification(id: Id): ClassificationIndex
  phylogeny(id: Id): PhylogenyIndex
  /** Accepted name string of a concept (for display; never an identity). */
  nameOf(concept: Id): string | undefined
  /**
   * Concepts that use a name string (accepted or not), case-insensitively. Several
   * results mean the name is ambiguous (homonyms, splits): the caller must choose.
   */
  findByName(name: string): { concept: TaxonConcept; status: 'accepted' | 'synonym' | 'misapplied' | 'provisional' | 'unknown' }[]
}

export function indexDataset(snapshot: DatasetSnapshot): DatasetIndex {
  const concept = new Map(snapshot.concepts.map((c) => [c.id, c]))
  const name = new Map(snapshot.names.map((n) => [n.id, n]))
  const cls = new Map<Id, ClassificationIndex>()
  const phy = new Map<Id, PhylogenyIndex>()
  const byName = new Map<string, { concept: TaxonConcept; status: 'accepted' | 'synonym' | 'misapplied' | 'provisional' | 'unknown' }[]>()
  for (const c of snapshot.concepts) {
    const usages = [{ name: c.acceptedName, status: 'accepted' as const }, ...(c.usages ?? []).filter((u) => u.name !== c.acceptedName)]
    for (const u of usages) {
      const key = name.get(u.name)?.name.toLowerCase()
      if (key) byName.set(key, [...(byName.get(key) ?? []), { concept: c, status: u.status }])
    }
  }
  const find = <T, I>(cache: Map<Id, I>, list: T[], id: Id, make: (x: T) => I, what: string) => {
    let hit = cache.get(id)
    if (!hit) {
      const rec = list.find((x) => (x as { id: Id }).id === id)
      if (!rec) throw new RangeError(`Unknown ${what} ${id}`)
      hit = make(rec)
      cache.set(id, hit)
    }
    return hit
  }
  return {
    snapshot,
    concept,
    name,
    classification: (id) => find<Classification, ClassificationIndex>(cls, snapshot.classifications, id, indexClassification, 'classification'),
    phylogeny: (id) => find<Phylogeny, PhylogenyIndex>(phy, snapshot.phylogenies, id, indexPhylogeny, 'phylogeny'),
    nameOf: (c) => name.get(concept.get(c)?.acceptedName ?? '')?.name,
    findByName: (n) => byName.get(n.trim().toLowerCase()) ?? [],
  }
}
