import type { Id, LengthUnit, Phylogeny, PhyloEdge, PhyloNode, Source, Support } from '@extantape/onetaxonomy-core'
import type { ImportResult, ImportWarning, SourceAdapter } from './adapter'
import { parseXml, XmlError, type XmlElement } from './xml'

/** What a phyloXML clade says about its taxon, for explicit mapping to concepts. */
export type PhyloXmlTaxonomy = {
  scientificName?: string
  code?: string
  rank?: string
  commonNames?: string[]
  /** `<id provider="ncbi">9606</id>` → `{ provider: 'ncbi', id: '9606' }`. */
  ids: { provider?: string; id: string }[]
}

export type PhyloXmlOptions = {
  /** The source record, supplied by the project owner (title, citation, license, release). */
  source: Source
  /** Phylogeny ids are `<id>:<n>`, numbering the file's phylogenies from 1. */
  id: Id
  version: string
  /** Default: the source title. Each phylogeny's own `<name>` is added after it. */
  title?: string
  citation?: string
  /** Used only for a `<phylogeny>` without the `rooted` attribute (the phyloXML schema requires it). */
  rooted?: boolean
  /** Unit of the branch lengths. phyloXML doesn't state one; without it lengths are not read as time. */
  lengthUnit?: LengthUnit
  sampling?: Phylogeny['sampling']
  /** Explicit label → concepts. A clade's label is its `<name>`, else its taxonomy's scientific name, else its code. */
  mapLabel?: (label: string, isTip: boolean) => Id[] | undefined
  /** Explicit taxonomy → concepts (e.g. by NCBI id). Tried before `mapLabel`. Nothing is matched by guesswork. */
  mapTaxonomy?: (taxonomy: PhyloXmlTaxonomy, isTip: boolean) => Id[] | undefined
}

/** Malformed phyloXML: the message names the line and element. */
export class PhyloXmlError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly element: string,
  ) {
    super(`${message} (line ${line}, <${element}>)`)
    this.name = 'PhyloXmlError'
  }
}

/** Clade children that are read; anything else is reported once per element name. */
const READ = new Set(['clade', 'name', 'branch_length', 'confidence', 'taxonomy'])

export function phyloXmlAdapter(options: PhyloXmlOptions): SourceAdapter<string> {
  return {
    describe: () => ({ id: 'phyloxml', title: 'phyloXML (clades, names, branch lengths, confidence, taxonomy)', formats: ['application/xml (phyloXML)'] }),
    read: async (text) => readPhyloXml(text, options),
  }
}

const child = (el: XmlElement, name: string) => el.children.find((c) => c.name === name)
const children = (el: XmlElement, name: string) => el.children.filter((c) => c.name === name)

function number(el: XmlElement, raw: string, what: string): number {
  const v = Number(raw.trim())
  if (raw.trim() === '' || !Number.isFinite(v)) throw new PhyloXmlError(`${what} “${raw.trim()}” is not a number`, el.line, el.name)
  return v
}

/**
 * Reads every `<phylogeny>` in a phyloXML document: nested clades, names, branch
 * lengths, confidence values (the first is `support`, the rest `additionalSupport`,
 * each with its `type` as the method) and taxonomy (kept as an annotation, and
 * offered to `mapTaxonomy`). Rooting comes from the `rooted` attribute. Other clade
 * elements (sequences, events, dates, colors…) are not read and are listed in the
 * warnings. Malformed XML or values are refused with the line and element.
 */
export function readPhyloXml(text: string, o: PhyloXmlOptions): ImportResult {
  let doc: XmlElement
  try {
    doc = parseXml(text)
  } catch (e) {
    if (e instanceof XmlError) throw new PhyloXmlError(e.message.replace(/ \(line \d+(, <[^>]+>)?\)$/, ''), e.line, e.element ?? 'document')
    throw e
  }
  if (doc.name !== 'phyloxml') throw new PhyloXmlError(`The root element is <${doc.name}>, not <phyloxml>`, doc.line, doc.name)
  const trees = children(doc, 'phylogeny')
  if (!trees.length) throw new PhyloXmlError('No <phylogeny> in this file', doc.line, doc.name)
  const warnings: ImportWarning[] = []
  const skipped = new Map<string, { count: number; line: number }>()
  const phylogenies = trees.map((t, index) => readTree(t, index, trees.length, o, skipped, warnings))
  for (const [name, { count, line }] of skipped)
    warnings.push({ code: 'unsupported-element', message: `<${name}> is not read (${count} in the file, first on line ${line})`, line })
  return { source: o.source, names: [], concepts: [], phylogenies, rawIds: {}, warnings }
}

function readTree(t: XmlElement, index: number, count: number, o: PhyloXmlOptions, skipped: Map<string, { count: number; line: number }>, warnings: ImportWarning[]): Phylogeny {
  const id = `${o.id}:${index + 1}`
  const flag = t.attrs.rooted
  let rooted: boolean
  if (flag === undefined) {
    if (o.rooted === undefined) throw new PhyloXmlError('Say whether the tree is rooted: the rooted attribute is missing and no rooted option was given', t.line, t.name)
    rooted = o.rooted
  } else if (flag === 'true' || flag === '1') rooted = true
  else if (flag === 'false' || flag === '0') rooted = false
  else throw new PhyloXmlError(`rooted="${flag}" must be true or false`, t.line, t.name)
  const clades = children(t, 'clade')
  if (clades.length !== 1) throw new PhyloXmlError(clades.length ? `A phylogeny has one top-level <clade>; this one has ${clades.length}` : 'This phylogeny has no <clade>', t.line, t.name)
  const name = child(t, 'name')?.text.trim()

  const nodes: PhyloNode[] = []
  const edges: PhyloEdge[] = []
  const queue: { el: XmlElement; parent: Id | null }[] = [{ el: clades[0]!, parent: null }]
  // Breadth-first, like the Newick reader: stable, readable ids; children keep their order.
  for (let q = 0; q < queue.length; q++) {
    const { el, parent } = queue[q]!
    const nodeId = `${id}:n${nodes.length}`
    const kids = children(el, 'clade')
    const isTip = kids.length === 0
    for (const c of el.children) {
      if (READ.has(c.name)) continue
      const s = skipped.get(c.name)
      skipped.set(c.name, { count: (s?.count ?? 0) + 1, line: s?.line ?? c.line })
    }

    // Branch length: attribute or element; both must agree.
    const attr = el.attrs.branch_length !== undefined ? number(el, el.attrs.branch_length, 'branch_length') : undefined
    const elLen = child(el, 'branch_length')
    const fromEl = elLen ? number(elLen, elLen.text, 'branch_length') : undefined
    if (attr !== undefined && fromEl !== undefined && attr !== fromEl) throw new PhyloXmlError(`branch_length is given twice with different values (${attr} and ${fromEl})`, el.line, el.name)
    const length = attr ?? fromEl

    const supports: Support[] = children(el, 'confidence').map((c) => ({ value: number(c, c.text, 'confidence'), ...(c.attrs.type ? { method: c.attrs.type } : {}) }))
    const tax = child(el, 'taxonomy')
    const taxonomy: PhyloXmlTaxonomy | undefined = tax
      ? {
          ...(child(tax, 'scientific_name') ? { scientificName: child(tax, 'scientific_name')!.text.trim() } : {}),
          ...(child(tax, 'code') ? { code: child(tax, 'code')!.text.trim() } : {}),
          ...(child(tax, 'rank') ? { rank: child(tax, 'rank')!.text.trim() } : {}),
          ...(children(tax, 'common_name').length ? { commonNames: children(tax, 'common_name').map((c) => c.text.trim()) } : {}),
          ids: children(tax, 'id').map((x) => ({ ...(x.attrs.provider ? { provider: x.attrs.provider } : {}), id: x.text.trim() })),
        }
      : undefined
    const label = child(el, 'name')?.text.trim() || taxonomy?.scientificName || taxonomy?.code || undefined

    const node: PhyloNode = { id: nodeId }
    if (label) node.label = label
    const mapped = (taxonomy && o.mapTaxonomy?.(taxonomy, isTip)) || (label !== undefined ? o.mapLabel?.(label, isTip) : undefined)
    if (mapped?.length) node.concepts = mapped
    if (supports.length) {
      node.support = supports[0]!
      if (supports.length > 1) node.additionalSupport = supports.slice(1)
    }
    if (taxonomy) node.annotations = { phyloxml: { taxonomy } }
    nodes.push(node)
    if (parent !== null) edges.push({ id: `${id}:e${edges.length}`, parent, child: nodeId, ...(length !== undefined ? { length } : {}) })
    else if (length !== undefined) warnings.push({ code: 'schema', message: `The root clade of phylogeny ${index + 1} has a branch length (${length}); there is no branch above a root, so it is not kept`, line: el.line })
    for (const k of kids) queue.push({ el: k, parent: nodeId })
  }
  return {
    id,
    title: `${o.title ?? o.source.title}${name ? `: ${name}` : count > 1 ? ` (tree ${index + 1})` : ''}`,
    version: o.version,
    sources: [o.source.id],
    ...(o.citation ? { citation: o.citation } : {}),
    rooted,
    ...(o.lengthUnit ? { lengthUnit: o.lengthUnit } : {}),
    ...(o.sampling ? { sampling: o.sampling } : {}),
    nodes,
    edges,
  }
}
