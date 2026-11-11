/**
 * A small, strict XML reader for the import adapters: elements, attributes, text,
 * CDATA, comments and processing instructions, with the line each element starts on.
 * No DTDs, no external entities and no namespaces beyond dropping a prefix: enough
 * for phyloXML, and nothing that reaches outside the text it is given. Iterative, so
 * deeply nested trees don't overflow the stack.
 */
export type XmlElement = {
  /** Local name (any `prefix:` dropped). */
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  /** Text directly inside this element, entities decoded, concatenated. */
  text: string
  /** 1-based line of the start tag. */
  line: number
}

export class XmlError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly element?: string,
  ) {
    super(`${message} (line ${line}${element ? `, <${element}>` : ''})`)
    this.name = 'XmlError'
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const local = (name: string) => name.slice(name.indexOf(':') + 1)
// Sticky patterns, matched at a position without copying the rest of the text.
const END_TAG = /<\/([^\s>]+)\s*>/y
const START_TAG = /<([A-Za-z_][\w.:-]*)/y
const SPACE = /\s*/y
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/y
const at = (re: RegExp, text: string, i: number) => {
  re.lastIndex = i
  return re.exec(text)
}

export function parseXml(text: string): XmlElement {
  let i = 0
  let line = 1
  const advance = (to: number) => {
    for (let k = i; k < to && k < text.length; k++) if (text[k] === '\n') line++
    i = to
  }
  const decode = (s: string, ln: number, element?: string) =>
    s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);|&/g, (m, e: string | undefined) => {
      if (!e) throw new XmlError('A bare “&” must be written &amp;', ln, element)
      if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16))
      if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10))
      const v = ENTITIES[e]
      if (v === undefined) throw new XmlError(`Unknown entity &${e};`, ln, element)
      return v
    })
  const skipTo = (end: string, what: string) => {
    const k = text.indexOf(end, i)
    if (k < 0) throw new XmlError(`Unclosed ${what}`, line)
    advance(k + end.length)
  }

  const stack: XmlElement[] = []
  let root: XmlElement | null = null
  while (i < text.length) {
    const lt = text.indexOf('<', i)
    const chunkEnd = lt < 0 ? text.length : lt
    if (chunkEnd > i) {
      const raw = text.slice(i, chunkEnd)
      const top = stack.at(-1)
      if (top) top.text += decode(raw, line, top.name)
      else if (raw.trim()) throw new XmlError('Text outside the root element', line)
      advance(chunkEnd)
    }
    if (lt < 0) break
    if (text.startsWith('<!--', i)) skipTo('-->', 'comment')
    else if (text.startsWith('<![CDATA[', i)) {
      const start = i + 9
      const k = text.indexOf(']]>', start)
      if (k < 0) throw new XmlError('Unclosed CDATA section', line)
      const top = stack.at(-1)
      if (!top) throw new XmlError('CDATA outside the root element', line)
      top.text += text.slice(start, k)
      advance(k + 3)
    } else if (text.startsWith('<?', i)) skipTo('?>', 'processing instruction')
    else if (text.startsWith('<!DOCTYPE', i)) {
      if (root || stack.length) throw new XmlError('DOCTYPE after the root element', line)
      const bracket = text.indexOf('[', i)
      const close = text.indexOf('>', i)
      if (bracket >= 0 && bracket < close) throw new XmlError('DOCTYPE with an internal subset is not read (it can declare entities)', line)
      skipTo('>', 'DOCTYPE')
    } else if (text[i + 1] === '/') {
      const m = at(END_TAG, text, i)
      if (!m) throw new XmlError('Malformed end tag', line)
      const top = stack.pop()
      if (!top) throw new XmlError(`End tag </${m[1]}> with no open element`, line)
      if (local(m[1]!) !== top.name) throw new XmlError(`End tag </${m[1]}> does not match <${top.name}> opened on line ${top.line}`, line, top.name)
      advance(i + m[0].length)
    } else {
      const startLine = line
      const nameMatch = at(START_TAG, text, i)
      if (!nameMatch) throw new XmlError('Malformed start tag', line)
      const el: XmlElement = { name: local(nameMatch[1]!), attrs: {}, children: [], text: '', line: startLine }
      advance(i + nameMatch[0].length)
      let selfClosing = false
      for (;;) {
        advance(i + at(SPACE, text, i)![0].length)
        if (text.startsWith('/>', i)) {
          selfClosing = true
          advance(i + 2)
          break
        }
        if (text[i] === '>') {
          advance(i + 1)
          break
        }
        const a = at(ATTRIBUTE, text, i)
        if (!a) throw new XmlError(i >= text.length ? 'Unclosed start tag' : 'Malformed attribute', line, el.name)
        const key = local(a[1]!)
        if (a[1]!.startsWith('xmlns')) {
          advance(i + a[0].length)
          continue
        }
        if (key in el.attrs) throw new XmlError(`Attribute ${key} given twice`, line, el.name)
        el.attrs[key] = decode(a[3] ?? a[4] ?? '', line, el.name)
        advance(i + a[0].length)
      }
      const parent = stack.at(-1)
      if (parent) parent.children.push(el)
      else if (root) throw new XmlError('More than one root element', startLine, el.name)
      else root = el
      if (!selfClosing) stack.push(el)
    }
  }
  if (stack.length) {
    const open = stack.at(-1)!
    throw new XmlError(`<${open.name}> opened on line ${open.line} is never closed`, line, open.name)
  }
  if (!root) throw new XmlError('No root element', line)
  return root
}
