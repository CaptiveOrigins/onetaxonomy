import type { Id, Phylogeny, PhyloEdge, PhyloNode } from '../src'

/**
 * A small Newick-like reader for core tests only (the real reader is in the import
 * package, which core can't depend on): `((A:1,B:2)90:0.5,C);`. Tip `X` gets node
 * id `X` and concept `c:X`; internal nodes get `n0`, `n1`… in preorder, and a number
 * after `)` is support. Labels in `unmapped` get no concept.
 */
export function tiny(text: string, o: { id?: Id; rooted: boolean; unmapped?: string[]; lengthUnit?: Phylogeny['lengthUnit'] }): Phylogeny {
  let i = 0
  let inner = 0
  const nodes: PhyloNode[] = []
  const edges: PhyloEdge[] = []
  const word = () => {
    const start = i
    while (i < text.length && !/[(),:;]/.test(text[i]!)) i++
    return text.slice(start, i).trim()
  }
  const sub = (parent: Id | null): void => {
    let node: PhyloNode
    if (text[i] === '(') {
      node = { id: `n${inner++}` }
      nodes.push(node)
      i++
      for (;;) {
        sub(node.id)
        if (text[i] === ',') i++
        else if (text[i] === ')') {
          i++
          break
        } else throw new Error(`bad tiny tree at ${i}`)
      }
      const w = word()
      if (w) node.support = { value: Number(w) }
    } else {
      const w = word()
      node = { id: w, label: w, ...(o.unmapped?.includes(w) ? {} : { concepts: [`c:${w}`] }) }
      nodes.push(node)
    }
    let length: number | undefined
    if (text[i] === ':') {
      i++
      length = Number(word())
    }
    if (parent !== null) edges.push({ id: `e${edges.length}`, parent, child: node.id, ...(length !== undefined ? { length } : {}) })
  }
  sub(null)
  return { id: o.id ?? 't', title: 'T', version: '1', sources: ['s'], rooted: o.rooted, ...(o.lengthUnit ? { lengthUnit: o.lengthUnit } : {}), nodes, edges }
}

/** The tree back as text, children in stored order, with support and lengths: for checking rerooting by eye. */
export function show(p: Phylogeny): string {
  const kids = new Map<Id, Id[]>()
  const into = new Map<Id, PhyloEdge>()
  for (const e of p.edges) {
    kids.set(e.parent, [...(kids.get(e.parent) ?? []), e.child])
    into.set(e.child, e)
  }
  const node = new Map(p.nodes.map((n) => [n.id, n]))
  const root = p.nodes.find((n) => !into.has(n.id))!.id
  const go = (id: Id): string => {
    const n = node.get(id)!
    const ch = kids.get(id) ?? []
    const len = into.get(id)?.length
    return `${ch.length ? `(${ch.map(go).join(',')})` : (n.label ?? id)}${ch.length && n.support ? n.support.value : ''}${len !== undefined ? `:${len}` : ''}`
  }
  return `${go(root)};`
}
