import type { DatasetIndex } from './dataset'
import type { CommonName, Id, LengthUnit, LifeStatus, Provenance, Source, Support, TaxonProfile } from './model'
import type { MonophylyResult } from './monophyly'
import type { Projection } from './project'
import type { PhylogenyIndex } from './tree'
import { viewTree, type TaxonomicView } from './view'

/** A citation as shown to people. `illustrative` sources are fixtures, never science. */
export type Citation = { source: Id; text: string; url?: string; license?: string; version?: string; illustrative: boolean }

export type ConceptDetails = {
  id: Id
  name: string
  authorship?: string
  rank?: string
  status: LifeStatus
  synonyms: string[]
  commonNames: CommonName[]
  profile?: TaxonProfile
  provenance?: Provenance
}

/** Everything the data says about one node of a view, with its citations (inspector). */
export type NodeDetails = {
  id: Id
  kind: 'classification' | 'phylogeny'
  /** Taxon concepts the node stands for (one in a classification; any number in a phylogeny). */
  concepts: ConceptDetails[]
  /** A phylogeny node with no explicit concept mapping (a sample, population or unnamed lineage). */
  unmapped: boolean
  /** Phylogeny only: as stated by the hypothesis. */
  label?: string
  support?: Support
  additionalSupport?: Support[]
  age?: { value: number; min?: number; max?: number; unit?: LengthUnit }
  branchLength?: { value: number; unit?: LengthUnit }
  /** The placement's own provenance (classification). */
  placement?: Provenance
  /** Observed trait states (never inferred), with their trait set. */
  traits: { set: Id; title: string; state: string; note?: string }[]
  /** Free-text citations from profiles, then the cited sources. */
  references: string[]
  citations: Citation[]
}

export function citationOf(source: Source): Citation {
  return {
    source: source.id,
    text: source.citation ?? source.title,
    ...(source.url ? { url: source.url } : {}),
    ...(source.license ? { license: source.license } : {}),
    ...(source.externalVersion ? { version: source.externalVersion } : {}),
    illustrative: Boolean(source.illustrative),
  }
}

const citeAll = (dataset: DatasetIndex, ids: Iterable<Id>): Citation[] => {
  const byId = new Map(dataset.snapshot.sources.map((s) => [s.id, s]))
  return [...new Set(ids)].flatMap((id) => (byId.has(id) ? [citationOf(byId.get(id)!)] : []))
}

/** The hierarchy's own sources: the classification's or the hypothesis' (always cited). */
function targetSources(dataset: DatasetIndex, view: Pick<TaxonomicView, 'target'>): Id[] {
  const tree = viewTree(dataset, view)
  return tree.kind === 'phylogeny' ? (tree as PhylogenyIndex).phylogeny.sources : dataset.classification(tree.id).classification.sources
}

export function inspectNode(dataset: DatasetIndex, view: Pick<TaxonomicView, 'target'>, id: Id): NodeDetails {
  const tree = viewTree(dataset, view)
  if (!tree.parent.has(id)) throw new RangeError(`Unknown node ${id} in ${view.target.kind} ${view.target.id}`)
  const phy = tree.kind === 'phylogeny' ? (tree as PhylogenyIndex) : null
  const conceptIds = phy ? [...(phy.node.get(id)!.concepts ?? [])] : [id]
  const profiles = new Map((dataset.snapshot.profiles ?? []).map((p) => [p.concept, p]))
  const concepts: ConceptDetails[] = conceptIds.flatMap((cid) => {
    const c = dataset.concept.get(cid)
    if (!c) return []
    const accepted = dataset.name.get(c.acceptedName)
    const profile = profiles.get(cid)
    return [
      {
        id: cid,
        name: accepted?.name ?? cid,
        ...(accepted?.authorship ? { authorship: accepted.authorship } : {}),
        ...(c.rank ? { rank: c.rank } : {}),
        status: profile?.status ?? 'unknown',
        synonyms: (c.usages ?? []).filter((u) => u.status === 'synonym' && u.name !== c.acceptedName).map((u) => dataset.name.get(u.name)?.name ?? u.name),
        commonNames: c.commonNames ?? [],
        ...(profile ? { profile } : {}),
        ...(c.provenance ? { provenance: c.provenance } : {}),
      },
    ]
  })
  const placement = phy ? undefined : dataset.classification(tree.id).classification.placements.find((p) => p.concept === id)?.provenance
  const traits = (dataset.snapshot.traits ?? []).flatMap((t) =>
    t.values
      .filter((v) => conceptIds.includes(v.concept))
      .map((v) => ({ set: t.id, title: t.title, state: t.states.find((s) => s.id === v.state)?.label ?? v.state, ...(v.note ? { note: v.note } : {}) })),
  )
  const traitSources = (dataset.snapshot.traits ?? []).filter((t) => t.values.some((v) => conceptIds.includes(v.concept))).map((t) => t.source)
  const n = phy?.node.get(id)
  const edge = phy?.edgeTo.get(id)
  const unit = phy?.phylogeny.lengthUnit
  return {
    id,
    kind: tree.kind,
    concepts,
    unmapped: Boolean(phy) && conceptIds.length === 0,
    ...(n?.label ? { label: n.label } : {}),
    ...(n?.support ? { support: n.support } : {}),
    ...(n?.additionalSupport?.length ? { additionalSupport: n.additionalSupport } : {}),
    ...(n?.age ? { age: { ...n.age, ...(unit ? { unit } : {}) } } : {}),
    ...(edge?.length !== undefined ? { branchLength: { value: edge.length, ...(unit ? { unit } : {}) } } : {}),
    ...(placement ? { placement } : {}),
    traits,
    references: [...new Set(concepts.flatMap((c) => c.profile?.citations ?? []))],
    citations: citeAll(dataset, [
      ...concepts.flatMap((c) => (c.provenance ? [c.provenance.source] : [])),
      ...(placement ? [placement.source] : []),
      ...traitSources,
      ...targetSources(dataset, view),
    ]),
  }
}

/** Per-node overlay marks for a projection (only stated values; see `ViewOverlays`). */
export type NodeOverlay = {
  support?: { value: number; method?: string; weak: boolean }
  extinct?: boolean
  /** Age of an extinct (fossil) node, where the hypothesis dates it. */
  fossilAge?: { value: number; unit?: LengthUnit }
  /** Observed state, or `mixed` when the node's concepts state different values. */
  trait?: { state: Id; label: string; color?: string } | { state: 'mixed'; label: string }
}

export function nodeOverlays(dataset: DatasetIndex, view: TaxonomicView, projection: Projection, { mixedLabel = 'Mixed states' }: { mixedLabel?: string } = {}): Map<Id, NodeOverlay> {
  const o = view.overlays ?? {}
  const out = new Map<Id, NodeOverlay>()
  const tree = viewTree(dataset, view)
  const phy = tree.kind === 'phylogeny' ? (tree as PhylogenyIndex) : null
  const set = o.trait !== undefined ? (dataset.snapshot.traits ?? []).find((t) => t.id === o.trait) : undefined
  const stateOf = set ? new Map(set.values.map((v) => [v.concept, v.state])) : null
  for (const node of projection.nodes) {
    const mark: NodeOverlay = {}
    const data = phy?.node.get(node.id)
    if (o.support && data?.support && !node.isTip) {
      const t = o.support.threshold
      mark.support = { value: data.support.value, ...(data.support.method ? { method: data.support.method } : {}), weak: t !== undefined && data.support.value < t }
    }
    if (o.extinction && node.status === 'extinct') {
      mark.extinct = true
      if (data?.age) mark.fossilAge = { value: data.age.value, ...(phy!.phylogeny.lengthUnit ? { unit: phy!.phylogeny.lengthUnit } : {}) }
    }
    if (stateOf && set) {
      const states = [...new Set(node.concepts.flatMap((c) => (stateOf.has(c) ? [stateOf.get(c)!] : [])))]
      if (states.length === 1) {
        const s = set.states.find((x) => x.id === states[0])!
        mark.trait = { state: s.id, label: s.label, ...(s.color ? { color: s.color } : {}) }
      } else if (states.length > 1) mark.trait = { state: 'mixed', label: mixedLabel }
    }
    if (Object.keys(mark).length) out.set(node.id, mark)
  }
  return out
}

/** Sources behind what a view shows: the hierarchy's, the shown concepts', and an active trait set's. */
export function viewCitations(dataset: DatasetIndex, view: TaxonomicView, projection: Projection): Citation[] {
  const shown = projection.nodes.flatMap((n) => n.concepts.flatMap((c) => {
    const p = dataset.concept.get(c)?.provenance
    return p ? [p.source] : []
  }))
  const trait = view.overlays?.trait !== undefined ? (dataset.snapshot.traits ?? []).find((t) => t.id === view.overlays!.trait)?.source : undefined
  return citeAll(dataset, [...targetSources(dataset, view), ...shown, ...(trait ? [trait] : [])])
}

/**
 * What an exported diagram must say about itself (I13, I15): classification vs
 * phylogeny, what is hidden, the pinned snapshot, and the sources. Plain lines, so
 * exports in any format (SVG, PNG, PDF, print) carry the same disclosure.
 */
export type ViewDisclosure = { title: string; lines: string[]; citations: Citation[]; illustrative: boolean }

/**
 * How a rooted hypothesis got its root, in one line: the method, then the record's
 * own note. When there is no note, the outgroup and the record it came from are
 * spelled out instead, so a rerooted tree is never shown as if it were the source's.
 */
function rootingLine(t: PhylogenyIndex): string {
  const r = t.phylogeny.rooting!
  if (r.note) return `Rooting (${r.method}): ${r.note}`
  const name = (id: Id) => t.node.get(id)?.label ?? id
  const parts = [
    r.outgroup?.length ? `on the outgroup ${r.outgroup.map(name).join(', ')}` : '',
    r.from ? `from ${r.from.id} version ${r.from.version}` : '',
  ].filter(Boolean)
  return `Rooting (${r.method})${parts.length ? `: ${parts.join(', ')}` : ''}.`
}

export function describeView(dataset: DatasetIndex, view: TaxonomicView, projection: Projection, { notice }: { notice?: string } = {}): ViewDisclosure {
  const tree = viewTree(dataset, view)
  const s = dataset.snapshot
  const lines: string[] = []
  if (tree.kind === 'classification') {
    const c = dataset.classification(tree.id).classification
    lines.push(`Classification: ${c.title}, version ${c.version}. It records accepted placements, not common ancestry.`)
  } else {
    const p = (tree as PhylogenyIndex).phylogeny
    const sampling = p.sampling === 'complete' ? 'complete sampling' : p.sampling === 'partial' ? 'partial sampling: absent taxa may still belong to its clades' : 'sampling not stated'
    lines.push(`Phylogenetic hypothesis: ${p.title}, version ${p.version}; ${p.rooted ? 'rooted' : 'unrooted (no ancestry implied)'}; ${sampling}.`)
    if (p.rooted && p.rooting) lines.push(rootingLine(tree as PhylogenyIndex))
  }
  if (view.proposal) {
    const p = view.proposal
    lines.unshift(`PROPOSED by ${p.author}: “${p.title}” (${p.created.slice(0, 10)}), ${p.moves.length} ${p.moves.length === 1 ? 'move' : 'moves'} from the arrangement named below. Not an accepted arrangement.`)
    if (p.moves.length && tree.kind === 'phylogeny') lines.push('Moved branches have no lengths, and groups whose members changed have no support values or ages: the hypothesis never tested this arrangement.')
  }
  if (notice) lines.push(notice)
  const c = projection.counts
  const notShown = c.hidden + c.filtered + c.collapsed + c.outsideFocus + (c.supportCollapsed ?? 0)
  lines.push(notShown ? `${c.shown} of ${c.total} nodes shown; ${notShown} not shown (${[c.collapsed && `${c.collapsed} folded`, c.supportCollapsed && `${c.supportCollapsed} merged into polytomies for low support`, c.hidden && `${c.hidden} hidden`, c.filtered && `${c.filtered} filtered`, c.outsideFocus && `${c.outsideFocus} outside the focus`].filter(Boolean).join(', ')}).` : `All ${c.total} nodes shown.`)
  if (projection.truncated) lines.push('The drawing was truncated at its node limit.')
  if (Object.keys(view.order).length) lines.push('Sibling order was rearranged for display; it carries no meaning.')
  for (const h of view.highlights) lines.push(h.kind === 'clade' ? `“${h.label}”: clade (monophyletic in ${h.assessment?.hypothesis ? `${h.assessment.hypothesis.id} v${h.assessment.hypothesis.version}` : 'this hypothesis'}).` : `“${h.label}”: a group for viewing, not a clade.`)
  const trait = view.overlays?.trait !== undefined ? (s.traits ?? []).find((t) => t.id === view.overlays!.trait) : undefined
  if (trait) lines.push(`Colors: observed states of “${trait.title}” as stated by its source; uncolored nodes have no stated value (nothing is inferred).`)
  if (projection.supportCollapse) {
    const sc = projection.supportCollapse
    const n = sc.collapsed.length
    lines.push(`${n} ${n === 1 ? 'branch' : 'branches'} with support below ${sc.threshold} ${n === 1 ? 'is collapsed into a polytomy' : 'are collapsed into polytomies'} for display; the hypothesis itself keeps ${n === 1 ? 'it' : 'them'}.${sc.withoutSupport ? ` ${sc.withoutSupport} internal ${sc.withoutSupport === 1 ? 'branch has' : 'branches have'} no support value and ${sc.withoutSupport === 1 ? 'was' : 'were'} not collapsed.` : ''}`)
  }
  if (view.overlays?.support?.threshold !== undefined) lines.push(`Support below ${view.overlays.support.threshold} is marked weak.`)
  lines.push(`Data: snapshot ${s.id} ${s.version}${s.checksum ? ` (${s.checksum.slice(0, 19)}…)` : ''}.`)
  const citations = viewCitations(dataset, view, projection)
  const illustrative = citations.some((x) => x.illustrative)
  if (illustrative) lines.push('Contains illustrative (fixture) data: not for scientific use.')
  return { title: view.proposal ? `Proposed by ${view.proposal.author}: ${view.title}` : view.title, lines, citations, illustrative }
}

/**
 * A monophyly result in words (clade selector, lessons, plugin admin). Names come
 * from the dataset; ids are only shown when a node has no name.
 */
export function describeAssessment(dataset: DatasetIndex, result: MonophylyResult): { headline: string; details: string[] } {
  const h = result.hypothesis
  const phy = h ? dataset.phylogeny(h.id) : null
  const nameOf = (id: Id) => {
    const n = phy?.node.get(id)
    if (n?.label) return n.label
    if (n?.concepts?.length) return n.concepts.map((c) => dataset.nameOf(c) ?? c).join(' / ')
    return dataset.nameOf(id) ?? id
  }
  const names = (ids: Id[], max = 8) => (ids.length > max ? `${ids.slice(0, max).map(nameOf).join(', ')} and ${ids.length - max} more` : ids.map(nameOf).join(', '))
  const where = h ? `in ${phy?.phylogeny.title ?? h.id} (version ${h.version})` : ''
  const headlines: Record<MonophylyResult['reason'], string> = {
    'complete-clade': `A clade ${where}: everything descended from their most recent common ancestor is included.`,
    'missing-descendants': `Not a clade ${where}: their most recent common ancestor has other descendants.`,
    'different-trees': `Not a clade ${where}: the selection spans separate trees of the hypothesis.`,
    'unresolved-polytomy': `Can't tell ${where}: it depends on how an unresolved branching point (polytomy) resolves.`,
    unrooted: `Can't tell ${where}: the hypothesis is unrooted, so it states no ancestry.`,
    'classification-only': 'Can’t tell: a classification states placements, not common ancestry. Choose a phylogenetic hypothesis to check against.',
    'unknown-node': `Can't tell ${where}: some of the selection isn't in this hypothesis.`,
    empty: 'Nothing selected.',
    'no-mapped-members': `Can't tell ${where}: none of the taxon's members are linked to this hypothesis.`,
  }
  const details: string[] = []
  if (result.missing.length) details.push(result.reason === 'unresolved-polytomy' ? `Also under the same branching point: ${names(result.missing)}.` : `Also descended from that ancestor: ${names(result.missing)}.`)
  const caveat: Record<MonophylyResult['caveats'][number], string> = {
    'single-terminal': 'A single tip is trivially a clade.',
    'partial-sampling': 'The hypothesis samples only part of the group: taxa missing from it may still belong.',
    'sampling-unknown': 'The hypothesis doesn’t state how completely it samples the group.',
    'unmapped-members': `${result.unmapped?.length ?? 0} member(s) aren't linked to this hypothesis and were not checked.`,
  }
  for (const c of result.caveats) details.push(caveat[c])
  return { headline: headlines[result.reason].replace(/\s+:/, ':').replace(/ {2,}/g, ' '), details }
}
