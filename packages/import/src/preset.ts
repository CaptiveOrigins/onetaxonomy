import type { CuratedSelection, DatasetSnapshot, Id } from '@captiveorigins/onetaxonomy-core'

/**
 * A shareable community preset: references to pinned snapshots, curated
 * selections and presentation hints. It carries no taxonomic data of its own
 * (no names, concepts, placements or trees), so it can't become a shadow copy of
 * a source: opening it always reads the referenced snapshots.
 */
export type CommunityPreset = {
  format: 'onetaxonomy-preset'
  formatVersion: 1
  id: Id
  title: string
  version: string
  description?: string
  authors?: string[]
  /** License of the preset itself (the referenced data keeps its own). */
  license?: string
  /** Snapshots the preset was made against, pinned by checksum. */
  references: { snapshot: Id; version: string; checksum: string }[]
  selections: CuratedSelection[]
  /** Presentation hints by concept id. Highlights of kind `group` are never shown as clades. */
  style?: {
    highlights?: { label: string; kind: 'group' | 'clade'; concepts: Id[]; color?: string }[]
    collapsed?: Id[]
    layout?: string
  }
}

const SHADOW_KEYS = new Set(['names', 'concepts', 'placements', 'classifications', 'phylogenies', 'nodes', 'edges', 'profiles'])

/** Structural checks for a preset read from JSON; returns problems (empty = usable). */
export function validatePreset(value: unknown): string[] {
  const problems: string[] = []
  const p = value as Partial<CommunityPreset>
  if (typeof value !== 'object' || value === null) return ['A preset must be a JSON object']
  if (p.format !== 'onetaxonomy-preset') problems.push('format must be "onetaxonomy-preset"')
  if (p.formatVersion !== 1) problems.push(`formatVersion ${String(p.formatVersion)} is not supported`)
  for (const k of ['id', 'title', 'version'] as const) if (typeof p[k] !== 'string' || !p[k]) problems.push(`${k} is required`)
  if (!Array.isArray(p.references) || !p.references.length) problems.push('references must pin at least one snapshot')
  else p.references.forEach((r, i) => {
    if (!r?.snapshot || !r.version || !/^sha256:[0-9a-f]{64}$/.test(r.checksum ?? '')) problems.push(`references[${i}] needs snapshot, version and a sha256 checksum`)
  })
  if (!Array.isArray(p.selections)) problems.push('selections must be an array')
  // No shadow data anywhere in the file.
  const stack: [unknown, string][] = [[value, '']]
  while (stack.length) {
    const [v, path] = stack.pop()!
    if (Array.isArray(v)) v.forEach((x, i) => stack.push([x, `${path}[${i}]`]))
    else if (typeof v === 'object' && v !== null)
      for (const [k, x] of Object.entries(v)) {
        // A list of ids is a reference; a list of records is copied data.
        if (SHADOW_KEYS.has(k) && Array.isArray(x) && x.some((e) => typeof e === 'object' && e !== null)) problems.push(`${path ? `${path}.` : ''}${k}: presets reference taxonomic data, they don't contain it`)
        stack.push([x, path ? `${path}.${k}` : k])
      }
  }
  return problems
}

/** Checks a preset against the snapshots it is opened with: pins and concept ids. */
export function checkPresetReferences(preset: CommunityPreset, snapshots: DatasetSnapshot[]): string[] {
  const problems: string[] = []
  for (const ref of preset.references) {
    const s = snapshots.find((x) => x.id === ref.snapshot)
    if (!s) problems.push(`Snapshot ${ref.snapshot} ${ref.version} is not available`)
    else if (s.checksum !== ref.checksum) problems.push(`Snapshot ${ref.snapshot} differs from the pinned version ${ref.version} (checksum mismatch): review the changes before relying on this preset`)
  }
  const known = new Set(snapshots.flatMap((s) => s.concepts.map((c) => c.id)))
  const classifications = new Set(snapshots.flatMap((s) => s.classifications.map((c) => c.id)))
  for (const sel of preset.selections) {
    if (!classifications.has(sel.classification)) problems.push(`Selection ${sel.id}: classification ${sel.classification} not found`)
    const ids = [...sel.roots.map((r) => r.concept), ...sel.roots.flatMap((r) => (r.policy.kind === 'representative' ? r.policy.concepts : [])), ...(sel.exclude ?? []).map((e) => e.concept)]
    for (const id of ids) if (!known.has(id)) problems.push(`Selection ${sel.id}: concept ${id} not found`)
  }
  for (const h of preset.style?.highlights ?? []) for (const id of h.concepts) if (!known.has(id)) problems.push(`Highlight “${h.label}”: concept ${id} not found`)
  return problems
}
