import type { DatasetSnapshot, Id } from './model'

export type SnapshotDiff = {
  from: { id: Id; version: string; checksum?: string }
  to: { id: Id; version: string; checksum?: string }
  added: Id[]
  removed: Id[]
  /** Same concept id, different accepted name string. */
  renamed: { concept: Id; from: string; to: string }[]
  /** Same concept id, different stated rank. */
  rankChanged: { concept: Id; from: string | undefined; to: string | undefined }[]
  /** Same concept id, different parent in the classification with the same id. */
  relocated: { concept: Id; classification: Id; from: Id | null; to: Id | null }[]
  /**
   * Candidate splits: a name accepted by one concept before and used by several
   * concepts after. Candidates only: sources must confirm (OneTaxonomy never
   * decides that two circumscriptions are the same).
   */
  splitCandidates: { name: string; from: Id; to: Id[] }[]
  /** Candidate lumps/synonymizations: a removed concept's accepted name now used (often as a synonym) by another concept. */
  mergeCandidates: { name: string; from: Id; into: Id; status: string }[]
}

/**
 * Compares two snapshots by concept id (adapters derive ids from the source's own
 * identifiers, so ids are stable across releases of one source).
 */
export function diffSnapshots(a: DatasetSnapshot, b: DatasetSnapshot): SnapshotDiff {
  const nameA = new Map(a.names.map((n) => [n.id, n.name]))
  const nameB = new Map(b.names.map((n) => [n.id, n.name]))
  const conA = new Map(a.concepts.map((c) => [c.id, c]))
  const conB = new Map(b.concepts.map((c) => [c.id, c]))

  const added = b.concepts.filter((c) => !conA.has(c.id)).map((c) => c.id)
  const removed = a.concepts.filter((c) => !conB.has(c.id)).map((c) => c.id)
  const renamed: SnapshotDiff['renamed'] = []
  const rankChanged: SnapshotDiff['rankChanged'] = []
  for (const ca of a.concepts) {
    const cb = conB.get(ca.id)
    if (!cb) continue
    const na = nameA.get(ca.acceptedName) ?? ''
    const nb = nameB.get(cb.acceptedName) ?? ''
    if (na !== nb) renamed.push({ concept: ca.id, from: na, to: nb })
    if ((ca.rank ?? '') !== (cb.rank ?? '')) rankChanged.push({ concept: ca.id, from: ca.rank, to: cb.rank })
  }

  const relocated: SnapshotDiff['relocated'] = []
  for (const ka of a.classifications) {
    const kb = b.classifications.find((k) => k.id === ka.id)
    if (!kb) continue
    const parentB = new Map(kb.placements.map((p) => [p.concept, p.parent]))
    for (const p of ka.placements) {
      if (!parentB.has(p.concept)) continue
      const to = parentB.get(p.concept)!
      if (to !== p.parent) relocated.push({ concept: p.concept, classification: ka.id, from: p.parent, to })
    }
  }

  // Name string → concepts using it, per snapshot.
  const users = (s: DatasetSnapshot, names: Map<Id, string>) => {
    const m = new Map<string, { concept: Id; status: string }[]>()
    for (const c of s.concepts) {
      const seen = new Set<string>()
      for (const u of [{ name: c.acceptedName, status: 'accepted' }, ...(c.usages ?? [])]) {
        const key = names.get(u.name)?.toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        m.set(key, [...(m.get(key) ?? []), { concept: c.id, status: u.status }])
      }
    }
    return m
  }
  const usersA = users(a, nameA)
  const usersB = users(b, nameB)
  const splitCandidates: SnapshotDiff['splitCandidates'] = []
  for (const [key, list] of usersA) {
    const accepted = list.filter((u) => u.status === 'accepted')
    if (accepted.length !== 1) continue
    const after = (usersB.get(key) ?? []).map((u) => u.concept)
    if (after.length > 1) splitCandidates.push({ name: nameA.get(conA.get(accepted[0]!.concept)!.acceptedName)!, from: accepted[0]!.concept, to: after })
  }
  const mergeCandidates: SnapshotDiff['mergeCandidates'] = []
  for (const id of removed) {
    const name = nameA.get(conA.get(id)!.acceptedName)
    if (!name) continue
    for (const u of usersB.get(name.toLowerCase()) ?? []) mergeCandidates.push({ name, from: id, into: u.concept, status: u.status })
  }

  return {
    from: { id: a.id, version: a.version, ...(a.checksum ? { checksum: a.checksum } : {}) },
    to: { id: b.id, version: b.version, ...(b.checksum ? { checksum: b.checksum } : {}) },
    added,
    removed,
    renamed,
    rankChanged,
    relocated,
    splitCandidates,
    mergeCandidates,
  }
}

export type ReferenceImpact = {
  id: Id
  change: 'removed' | 'renamed' | 'relocated' | 'rank-changed' | 'split-candidate' | 'merge-candidate'
  detail: string
}

/**
 * What a diff means for saved references (a view, selection, lesson or app record
 * pointing at concept ids). Reports only; the references themselves stay untouched
 * until someone migrates them on purpose.
 */
export function referenceImpact(diff: SnapshotDiff, references: Iterable<Id>): ReferenceImpact[] {
  const refs = new Set(references)
  const out: ReferenceImpact[] = []
  const merges = new Map<Id, SnapshotDiff['mergeCandidates']>()
  for (const m of diff.mergeCandidates) merges.set(m.from, [...(merges.get(m.from) ?? []), m])
  for (const id of diff.removed) {
    if (!refs.has(id)) continue
    const into = merges.get(id)
    out.push({ id, change: into ? 'merge-candidate' : 'removed', detail: into ? `Name now used by ${into.map((m) => `${m.into} (${m.status})`).join(', ')}` : 'Concept no longer in the dataset' })
  }
  for (const r of diff.renamed) if (refs.has(r.concept)) out.push({ id: r.concept, change: 'renamed', detail: `${r.from} → ${r.to}` })
  for (const r of diff.relocated) if (refs.has(r.concept)) out.push({ id: r.concept, change: 'relocated', detail: `${r.from ?? 'root'} → ${r.to ?? 'root'} in ${r.classification}` })
  for (const r of diff.rankChanged) if (refs.has(r.concept)) out.push({ id: r.concept, change: 'rank-changed', detail: `${r.from ?? 'none'} → ${r.to ?? 'none'}` })
  for (const s of diff.splitCandidates) if (refs.has(s.from)) out.push({ id: s.from, change: 'split-candidate', detail: `“${s.name}” now used by ${s.to.join(', ')}` })
  return out
}
