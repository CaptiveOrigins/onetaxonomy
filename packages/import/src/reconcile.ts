import type { DatasetSnapshot, Id, NameStatus } from '@extantape/onetaxonomy-core'

export type ReconcileReport = {
  /** Concepts that share an external identifier in a namespace both sources use. Strong links. */
  sharedIdentifier: { a: Id; b: Id; identifier: { source: string; id: string } }[]
  /**
   * Concepts that only share a name string (with authorship when both give one).
   * Candidates for a person to review: the same name can mean different
   * circumscriptions (splits, lumps) or different organisms (homonyms).
   */
  sameName: { a: Id; b: Id; name: string; statusA: NameStatus; statusB: NameStatus; authorshipDiffers: boolean }[]
  /** Name strings used by more than one concept on either side: never auto-linked. */
  ambiguous: { name: string; a: Id[]; b: Id[] }[]
  onlyInA: Id[]
  onlyInB: Id[]
}

/**
 * Compares two datasets' concepts by identifier and by name. Reports only: it
 * never merges, renames or re-parents anything (scientific invariant: concepts from
 * different sources stay distinct until a curator links them).
 */
export function reconcile(a: DatasetSnapshot, b: DatasetSnapshot, { identifierSources }: { identifierSources?: string[] } = {}): ReconcileReport {
  const linked = new Set<Id>()
  const sharedIdentifier: ReconcileReport['sharedIdentifier'] = []
  const idIndex = new Map<string, Id[]>()
  const key = (x: { source: string; id: string }) => `${x.source}\u0000${x.id}`
  const allowed = (s: string) => !identifierSources || identifierSources.includes(s)
  for (const c of b.concepts) for (const x of c.externalIds ?? []) if (allowed(x.source)) idIndex.set(key(x), [...(idIndex.get(key(x)) ?? []), c.id])
  for (const c of a.concepts) {
    for (const x of c.externalIds ?? []) {
      if (!allowed(x.source)) continue
      for (const hit of idIndex.get(key(x)) ?? []) {
        if (sharedIdentifier.some((s) => s.a === c.id && s.b === hit)) continue
        sharedIdentifier.push({ a: c.id, b: hit, identifier: x })
        linked.add(c.id).add(hit)
      }
    }
  }

  type Use = { concept: Id; status: NameStatus; authorship?: string }
  const uses = (s: DatasetSnapshot) => {
    const names = new Map(s.names.map((n) => [n.id, n]))
    const m = new Map<string, Use[]>()
    for (const c of s.concepts) {
      for (const u of [{ name: c.acceptedName, status: 'accepted' as NameStatus }, ...(c.usages ?? []).filter((u) => u.name !== c.acceptedName)]) {
        const n = names.get(u.name)
        if (!n) continue
        const k = n.name.trim().toLowerCase()
        const list = m.get(k) ?? []
        if (!list.some((x) => x.concept === c.id)) list.push({ concept: c.id, status: u.status, ...(n.authorship ? { authorship: n.authorship } : {}) })
        m.set(k, list)
      }
    }
    return m
  }
  const ua = uses(a)
  const ub = uses(b)
  const sameName: ReconcileReport['sameName'] = []
  const ambiguous: ReconcileReport['ambiguous'] = []
  const display = new Map([...a.names, ...b.names].map((n) => [n.name.trim().toLowerCase(), n.name.trim()]))
  for (const [k, la] of ua) {
    const lb = ub.get(k)
    if (!lb) continue
    if (la.length > 1 || lb.length > 1) {
      ambiguous.push({ name: display.get(k)!, a: la.map((x) => x.concept), b: lb.map((x) => x.concept) })
      continue
    }
    const [x, y] = [la[0]!, lb[0]!]
    if (sharedIdentifier.some((s) => s.a === x.concept && s.b === y.concept)) continue
    const norm = (s?: string) => s?.replace(/[\s.,()]/g, '').toLowerCase()
    sameName.push({ a: x.concept, b: y.concept, name: display.get(k)!, statusA: x.status, statusB: y.status, authorshipDiffers: Boolean(x.authorship && y.authorship && norm(x.authorship) !== norm(y.authorship)) })
    linked.add(x.concept).add(y.concept)
  }
  for (const amb of ambiguous) for (const id of [...amb.a, ...amb.b]) linked.add(id)

  return {
    sharedIdentifier,
    sameName,
    ambiguous,
    onlyInA: a.concepts.filter((c) => !linked.has(c.id)).map((c) => c.id),
    onlyInB: b.concepts.filter((c) => !linked.has(c.id)).map((c) => c.id),
  }
}
