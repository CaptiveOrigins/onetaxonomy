import type { Id, LengthUnit, Phylogeny, PhyloEdge, PhyloNode } from '@extantape/onetaxonomy-core'

export type NewickOptions = {
  id: Id
  title: string
  version: string
  sources: Id[]
  citation?: string
  /**
   * Whether the tree is rooted. Required unless the file says so with [&R] or [&U]:
   * a Newick string's nesting does not by itself mean the root is known.
   */
  rooted?: boolean
  /** Unit of the branch lengths (required to read them as time; see validateDataset). */
  lengthUnit?: LengthUnit
  sampling?: Phylogeny['sampling']
  /** Internal node labels: `auto` (default) reads numbers as support values, other text as labels. */
  internalLabels?: 'auto' | 'support' | 'label'
  supportMethod?: string
  /**
   * Names the methods of paired support labels such as `95.1/95`, in order (e.g. ['SH-aLRT', 'UFBoot']).
   * The first becomes `support`, the rest `additionalSupport`. Without this, such labels stay plain labels.
   */
  supportMethods?: string[]
  /**
   * Explicit label → taxon concept mapping. Labels without a mapping stay unmapped:
   * names are never matched to concepts by guesswork.
   */
  mapLabel?: (label: string, isTip: boolean) => Id[] | undefined
  /** Prefix for generated node/edge ids (default: the phylogeny id). */
  idPrefix?: string
}

export class NewickError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} (at character ${position + 1})`)
    this.name = 'NewickError'
  }
}

type Raw = { label?: string; quoted: boolean; length?: number; comments: string[]; children: Raw[] }

/** Parses one Newick tree into a Phylogeny. Ids are deterministic (preorder). */
export function parseNewick(text: string, o: NewickOptions): Phylogeny {
  let i = 0
  const s = text.trim()
  const ws = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++
  }
  const comment = (): string => {
    const start = i
    let depth = 0
    do {
      if (s[i] === '[') depth++
      else if (s[i] === ']') depth--
      i++
      if (i > s.length) throw new NewickError('Unclosed comment', start)
    } while (depth > 0)
    return s.slice(start + 1, i - 1)
  }
  const comments = (into: string[]) => {
    ws()
    while (s[i] === '[') {
      into.push(comment())
      ws()
    }
  }
  const label = (node: Raw) => {
    comments(node.comments)
    if (s[i] === "'") {
      const start = i++
      let out = ''
      for (;;) {
        if (i >= s.length) throw new NewickError('Unclosed quoted label', start)
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            out += "'"
            i += 2
            continue
          }
          i++
          break
        }
        out += s[i++]
      }
      node.label = out
      node.quoted = true
    } else {
      const start = i
      while (i < s.length && !/[\s(),:;[\]']/.test(s[i]!)) i++
      // Unquoted underscores stand for spaces (Newick convention).
      if (i > start) node.label = s.slice(start, i).replace(/_/g, ' ')
    }
    comments(node.comments)
    if (s[i] === ':') {
      i++
      ws()
      const start = i
      while (i < s.length && /[-+0-9.eE]/.test(s[i]!)) i++
      const v = Number(s.slice(start, i))
      if (i === start || !Number.isFinite(v)) throw new NewickError('Invalid branch length', start)
      node.length = v
      comments(node.comments)
    }
  }
  const subtree = (): Raw => {
    const node: Raw = { quoted: false, comments: [], children: [] }
    comments(node.comments)
    if (s[i] === '(') {
      i++
      for (;;) {
        node.children.push(subtree())
        ws()
        if (s[i] === ',') {
          i++
          continue
        }
        if (s[i] === ')') {
          i++
          break
        }
        throw new NewickError(`Expected “,” or “)”, found “${s[i] ?? 'end of input'}”`, i)
      }
    }
    label(node)
    return node
  }

  const head: string[] = []
  comments(head)
  const flag = head.find((c) => /^&[RU]$/i.test(c.trim()))
  const rooted = flag ? flag.trim().toUpperCase() === '&R' : o.rooted
  if (rooted === undefined) throw new NewickError('Say whether the tree is rooted (option rooted, or [&R]/[&U] in the file)', 0)
  const root = subtree()
  ws()
  if (s[i] !== ';') throw new NewickError('Expected “;” at the end of the tree', i)
  i++
  ws()
  if (i < s.length) throw new NewickError('Only one tree per call: text follows the first “;”', i)

  const prefix = o.idPrefix ?? o.id
  const nodes: PhyloNode[] = []
  const edges: PhyloEdge[] = []
  const walk: { raw: Raw; parent: Id | null }[] = [{ raw: root, parent: null }]
  while (walk.length) {
    const { raw, parent } = walk.shift()!
    const id = `${prefix}:n${nodes.length}`
    const isTip = raw.children.length === 0
    const node: PhyloNode = { id }
    if (raw.label !== undefined) {
      const mode = o.internalLabels ?? 'auto'
      const numeric = !raw.quoted && raw.label.trim() !== '' && Number.isFinite(Number(raw.label))
      const paired = !isTip && !raw.quoted && mode !== 'label' && o.supportMethods?.length ? raw.label.trim().split('/') : undefined
      if (paired && paired.length === o.supportMethods!.length && paired.every((v) => v !== '' && Number.isFinite(Number(v)))) {
        const [first, ...rest] = paired.map((v, i) => ({ value: Number(v), method: o.supportMethods![i]! }))
        node.support = first!
        if (rest.length) node.additionalSupport = rest
      } else if (!isTip && (mode === 'support' || (mode === 'auto' && numeric))) node.support = { value: Number(raw.label), ...(o.supportMethod ? { method: o.supportMethod } : {}) }
      else node.label = raw.label
    }
    const mapped = node.label !== undefined ? o.mapLabel?.(node.label, isTip) : undefined
    if (mapped?.length) node.concepts = mapped
    if (raw.comments.length) node.annotations = { newickComments: raw.comments }
    nodes.push(node)
    if (parent !== null) edges.push({ id: `${prefix}:e${edges.length}`, parent, child: id, ...(raw.length !== undefined ? { length: raw.length } : {}) })
    // Breadth-first keeps ids stable and readable; children keep their order.
    for (const c of raw.children) walk.push({ raw: c, parent: id })
  }
  return {
    id: o.id,
    title: o.title,
    version: o.version,
    sources: o.sources,
    ...(o.citation ? { citation: o.citation } : {}),
    rooted,
    ...(o.lengthUnit ? { lengthUnit: o.lengthUnit } : {}),
    ...(o.sampling ? { sampling: o.sampling } : {}),
    nodes,
    edges,
  }
}

const quote = (label: string) => (/[\s(),:;[\]'_]/.test(label) ? `'${label.replace(/'/g, "''")}'` : label)

/** Writes a Phylogeny (one tree of it: `root`, default the first root) as Newick. */
export function toNewick(p: Phylogeny, { root, labels = 'label' }: { root?: Id; labels?: 'label' | 'id' } = {}): string {
  const children = new Map<Id, Id[]>()
  const into = new Map<Id, PhyloEdge>()
  for (const e of p.edges) {
    children.set(e.parent, [...(children.get(e.parent) ?? []), e.child])
    into.set(e.child, e)
  }
  const node = new Map(p.nodes.map((n) => [n.id, n]))
  const start = root ?? p.nodes.find((n) => !into.has(n.id))?.id
  if (!start) throw new Error('No root to write')
  // Iterative post-order: deep trees must not overflow the stack.
  const out = new Map<Id, string>()
  const stack: { id: Id; done: boolean }[] = [{ id: start, done: false }]
  while (stack.length) {
    const top = stack.pop()!
    const kids = children.get(top.id) ?? []
    if (!top.done && kids.length) {
      stack.push({ id: top.id, done: true }, ...[...kids].reverse().map((k) => ({ id: k, done: false })))
      continue
    }
    const n = node.get(top.id)!
    const text = labels === 'id' ? n.id : (n.label ?? (n.support ? String(n.support.value) : ''))
    const len = into.get(top.id)?.length
    out.set(top.id, `${kids.length ? `(${kids.map((k) => out.get(k)).join(',')})` : ''}${text ? quote(text) : ''}${len !== undefined ? `:${len}` : ''}`)
  }
  return `${p.rooted ? '[&R] ' : '[&U] '}${out.get(start)};`
}
