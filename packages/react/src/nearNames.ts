import type { DatasetIndex, Id, NameStatus } from '@captiveorigins/onetaxonomy-core'

/**
 * How a tip's label came close to a name without matching it exactly:
 * - `spelling`: the same letters once underscores, spacing and letter case are set aside.
 * - `specimen-code`: the same once a trailing specimen code or voucher is left off ("Chelonoidis_carbonarius_MZUSP1234").
 * - `one-edit`: one letter added, dropped, changed, or two next to each other swapped.
 */
export type NearRule = 'spelling' | 'specimen-code' | 'one-edit'

/** A taxon whose name is close to a tip's label. Never an exact match, so never linked without a person choosing it. */
export type NearMatch = { concept: Id; status: NameStatus; name: string; rule: NearRule; dropped?: string }

/** Labels and names shorter than this (after normalising) aren't matched with one edit: "Bos" and "Bus" are both real. */
export const ONE_EDIT_MIN_LENGTH = 5

/** Underscores and runs of spaces become one space, letter case is folded. */
export const normaliseName = (s: string) => s.normalize('NFC').replace(/[_\s]+/g, ' ').trim().toLowerCase()

/**
 * Leaves off a trailing specimen code or voucher: the last words that contain a digit
 * ("MZUSP1234", "KU-12345", "1234"), and then a collection code in capitals right before
 * them ("MZUSP 1234"). Returns null when there is nothing to leave off, or nothing would be left.
 */
export function withoutSpecimenCode(label: string): { name: string; dropped: string } | null {
  const words = label.normalize('NFC').replace(/[_\s]+/g, ' ').trim().split(' ').filter(Boolean)
  let keep = words.length
  while (keep > 1 && /\d/.test(words[keep - 1]!)) keep--
  if (keep === words.length) return null
  if (keep > 2 && /^[A-Z]{2,}[-:.]?$/.test(words[keep - 1]!)) keep--
  if (keep < 1 || /\d/.test(words[0]!)) return null
  return { name: words.slice(0, keep).join(' '), dropped: words.slice(keep).join(' ') }
}

/** Optimal string alignment distance, but only whether it is exactly one (cheap: stops at the second difference). */
export function isOneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) {
    // A change, or two neighbours swapped.
    if (a.slice(i + 1) === b.slice(i + 1)) return true
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  // One letter added or dropped.
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

type NameIndex = {
  /** Normalised name → the names as written. */
  byKey: Map<string, string[]>
  /** Each normalised name with one letter dropped → the normalised names it came from (built on first use). */
  deletions: Map<string, Set<string>> | null
}

const deletionsOf = (s: string) => {
  const out = new Set<string>()
  for (let i = 0; i < s.length; i++) out.add(s.slice(0, i) + s.slice(i + 1))
  return out
}

const indexes = new WeakMap<DatasetIndex, NameIndex>()
function nameIndex(dataset: DatasetIndex): NameIndex {
  let ix = indexes.get(dataset)
  if (!ix) {
    const byKey = new Map<string, string[]>()
    for (const n of dataset.snapshot.names) {
      const k = normaliseName(n.name)
      if (k) byKey.set(k, [...new Set([...(byKey.get(k) ?? []), n.name])])
    }
    ix = { byKey, deletions: null }
    indexes.set(dataset, ix)
  }
  return ix
}

/** Normalised names one edit from `key`, through shared one-letter deletions, checked exactly. */
function oneEditKeys(ix: NameIndex, key: string): string[] {
  if (key.length < ONE_EDIT_MIN_LENGTH) return []
  if (!ix.deletions) {
    ix.deletions = new Map()
    for (const k of ix.byKey.keys()) {
      if (k.length < ONE_EDIT_MIN_LENGTH) continue
      for (const d of deletionsOf(k)) {
        let set = ix.deletions.get(d)
        if (!set) ix.deletions.set(d, (set = new Set()))
        set.add(k)
      }
    }
  }
  const found = new Set<string>()
  for (const k of ix.deletions.get(key) ?? []) found.add(k)
  for (const d of deletionsOf(key)) {
    if (ix.byKey.has(d) && d.length >= ONE_EDIT_MIN_LENGTH) found.add(d)
    for (const k of ix.deletions.get(d) ?? []) found.add(k)
  }
  return [...found].filter((k) => k.length >= ONE_EDIT_MIN_LENGTH && isOneEdit(key, k)).sort()
}

/**
 * Taxa whose names are close to `label` but not the same, by the first rule that finds any:
 * spelling (underscores, spacing, case), then a trailing specimen code left off, then one edit
 * (on the label, and on it without the code). Exact matches are not repeated here. Each taxon
 * appears once, under the closest rule. These are suggestions for a person to check, never links.
 */
export function nearNameMatches(dataset: DatasetIndex, label: string): NearMatch[] {
  const ix = nameIndex(dataset)
  const key = normaliseName(label)
  if (!key) return []
  const exact = new Set(dataset.findByName(label).map((h) => h.concept.id))
  const code = withoutSpecimenCode(label)
  const codeKey = code ? normaliseName(code.name) : null
  const out: NearMatch[] = []
  const seen = new Set<Id>(exact)
  const add = (names: string[], rule: NearRule, dropped?: string) => {
    for (const name of names) {
      for (const hit of dataset.findByName(name)) {
        if (seen.has(hit.concept.id)) continue
        seen.add(hit.concept.id)
        out.push({ concept: hit.concept.id, status: hit.status, name, rule, ...(dropped ? { dropped } : {}) })
      }
    }
  }
  add(ix.byKey.get(key) ?? [], 'spelling')
  if (out.length) return out
  if (codeKey) add(ix.byKey.get(codeKey) ?? [], 'specimen-code', code!.dropped)
  if (out.length) return out
  for (const k of oneEditKeys(ix, key)) add(ix.byKey.get(k)!, 'one-edit')
  if (codeKey) for (const k of oneEditKeys(ix, codeKey)) add(ix.byKey.get(k)!, 'one-edit', code!.dropped)
  return out
}
