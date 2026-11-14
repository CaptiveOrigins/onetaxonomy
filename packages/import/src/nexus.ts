import type { Id, Phylogeny, Source } from '@extantape/onetaxonomy-core'
import type { ImportResult, ImportWarning, SourceAdapter } from './adapter'
import { NewickError, parseNewick, type NewickOptions } from './newick'

export type NexusOptions = Pick<NewickOptions, 'lengthUnit' | 'sampling' | 'internalLabels' | 'supportMethod' | 'supportMethods' | 'citation'> & {
  /** The source record, supplied by the project owner (title, citation, license, release). */
  source: Source
  /** Phylogeny ids are `<id>:<n>`, numbering the file's trees from 1. */
  id: Id
  version: string
  /** Default: the source title. Each tree's own name is added after it. */
  title?: string
  /**
   * Used only for a `TREE` without [&R] or [&U]: a NEXUS file doesn't have to say,
   * and nesting alone doesn't mean the root is known. `UTREE` is always unrooted.
   */
  rooted?: boolean
  /**
   * Explicit label → taxon concept mapping, applied after the TRANSLATE table (so it
   * sees taxon names, not the table's numbers). Unmapped labels stay unmapped.
   */
  mapLabel?: (label: string, isTip: boolean) => Id[] | undefined
}

/** Malformed NEXUS: the message names the line. */
export class NexusError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`)
    this.name = 'NexusError'
  }
}

export function nexusAdapter(options: NexusOptions): SourceAdapter<string> {
  return {
    describe: () => ({ id: 'nexus', title: 'NEXUS trees (TREES blocks with TRANSLATE tables)', formats: ['text/plain (NEXUS)'] }),
    read: async (text) => readNexus(text, options),
  }
}

/** One command: its text up to (not including) the `;`, where it starts, and its words with comments removed. */
type Command = { text: string; start: number; line: number; words: Token[] }
type Token = { value: string; quoted: boolean; at: number }

type Lines = (offset: number) => number

/** Line number (1-based) of a character offset, by binary search over the line starts. */
function lineIndex(text: string): Lines {
  const starts = [0]
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') starts.push(k + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

/** Splits text into `;`-terminated commands, honoring quotes and (nested) comments. */
function commands(text: string, from: number, ln: Lines): Command[] {
  const out: Command[] = []
  let i = from
  let start = from
  let words: Token[] = []
  let word = ''
  let wordAt = -1
  const flush = () => {
    if (word) words.push({ value: word, quoted: false, at: wordAt })
    word = ''
  }
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '[') {
      flush()
      const open = i
      let depth = 0
      do {
        if (text[i] === '[') depth++
        else if (text[i] === ']') depth--
        i++
        if (i > text.length || (depth > 0 && i === text.length)) throw new NexusError('Unclosed comment “[”', ln(open))
      } while (depth > 0)
      continue
    }
    if (ch === "'") {
      flush()
      const open = i++
      let value = ''
      for (;;) {
        if (i >= text.length) throw new NexusError('Unclosed quoted word', ln(open))
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            value += "'"
            i += 2
            continue
          }
          i++
          break
        }
        value += text[i++]
      }
      words.push({ value, quoted: true, at: open })
      continue
    }
    if (ch === ';') {
      flush()
      if (words.length) out.push({ text: text.slice(start, i), start, line: ln(words[0]!.at), words })
      words = []
      start = ++i
      continue
    }
    if (/\s/.test(ch)) flush()
    else if (ch === ',' || ch === '=') {
      flush()
      words.push({ value: ch, quoted: false, at: i })
    } else {
      if (!word) wordAt = i
      word += ch
    }
    i++
  }
  flush()
  if (words.length) throw new NexusError(`“${words[0]!.value}” is not ended with “;”`, ln(words[0]!.at))
  return out
}

/** Unquoted NEXUS words use `_` for a space, as in Newick. */
const plain = (t: Token) => (t.quoted ? t.value : t.value.replace(/_/g, ' '))

/**
 * Reads the trees in a NEXUS file's TREES blocks. A TRANSLATE table turns the tree's
 * tip tokens back into taxon names before `mapLabel` sees them. `[&R]` and `[&U]`
 * say whether a tree is rooted; `UTREE` is unrooted; otherwise the `rooted` option
 * decides, and without it the file is refused. Other blocks (TAXA, CHARACTERS…) and
 * commands are skipped with a warning. Malformed input is refused with the line.
 */
export function readNexus(text: string, o: NexusOptions): ImportResult {
  const ln = lineIndex(text)
  const lead = /^\s*(\[[^\]]*\]\s*)*/.exec(text)![0].length
  if (!/^#nexus\b/i.test(text.slice(lead))) throw new NexusError('Not a NEXUS file: it must start with #NEXUS', ln(lead))
  const warnings: ImportWarning[] = []
  const phylogenies: Phylogeny[] = []
  let block: { name: string; line: number } | null = null
  let translate: Map<string, string> | null = null
  let sawTrees = false

  for (const cmd of commands(text, lead + 6, ln)) {
    const key = cmd.words[0]!.value.toUpperCase()
    if (!block) {
      if (key !== 'BEGIN' || cmd.words.length !== 2) throw new NexusError(`Expected “BEGIN <block>;”, found “${cmd.words.map((w) => w.value).join(' ')}”`, cmd.line)
      block = { name: cmd.words[1]!.value.toUpperCase(), line: cmd.line }
      if (block.name === 'TREES') {
        sawTrees = true
        translate = null
      } else warnings.push({ code: 'skipped-block', message: `${block.name} block is not read`, line: cmd.line })
      continue
    }
    if (key === 'END' || key === 'ENDBLOCK') {
      block = null
      continue
    }
    if (key === 'BEGIN') throw new NexusError(`BEGIN inside the ${block.name} block opened on line ${block.line}: end it first`, cmd.line)
    if (block.name !== 'TREES') continue
    if (key === 'TRANSLATE') translate = readTranslate(cmd, ln)
    else if (key === 'TREE' || key === 'UTREE') phylogenies.push(readTree(cmd, key, text, ln, phylogenies.length, translate, o, warnings))
    else if (key !== 'TITLE' && key !== 'LINK') warnings.push({ code: 'unsupported-command', message: `${key} in the TREES block is not read`, line: cmd.line })
  }
  if (block) throw new NexusError(`The ${block.name} block opened on line ${block.line} has no END`, ln(text.length))
  if (!sawTrees) throw new NexusError('No TREES block in this file', 1)
  if (!phylogenies.length) throw new NexusError('The TREES block has no trees', 1)
  return { source: o.source, names: [], concepts: [], phylogenies, rawIds: {}, warnings }
}

function readTranslate(cmd: Command, ln: Lines): Map<string, string> {
  const table = new Map<string, string>()
  const w = cmd.words.slice(1)
  for (let k = 0; k < w.length; ) {
    const from = w[k]
    const to = w[k + 1]
    if (!from || from.value === ',' || !to || to.value === ',') throw new NexusError('TRANSLATE entries are “token name”, separated by commas', ln((from ?? cmd.words[0]!).at))
    const keyText = plain(from)
    if (table.has(keyText)) throw new NexusError(`TRANSLATE lists “${from.value}” twice`, ln(from.at))
    table.set(keyText, plain(to))
    k += 2
    if (k < w.length) {
      if (w[k]!.value !== ',') throw new NexusError(`Expected “,” after “${to.value}” in TRANSLATE`, ln(w[k]!.at))
      k++
    }
  }
  return table
}

function readTree(cmd: Command, key: 'TREE' | 'UTREE', text: string, ln: Lines, index: number, translate: Map<string, string> | null, o: NexusOptions, warnings: ImportWarning[]): Phylogeny {
  const eq = cmd.words.findIndex((w) => w.value === '=' && !w.quoted)
  const nameTokens = cmd.words.slice(1, eq).filter((w) => w.value !== '*')
  if (eq < 0 || nameTokens.length !== 1) throw new NexusError(`Expected “${key} <name> = <tree>;”`, cmd.line)
  const name = plain(nameTokens[0]!)
  const body = cmd.words[eq]!.at + 1
  const newick = `${text.slice(body, cmd.start + cmd.text.length)};`
  const lead = /^\s*/.exec(newick)![0].length // parseNewick trims; positions count from here
  const id = `${o.id}:${index + 1}`
  const values = translate ? new Set(translate.values()) : null
  const untranslated: string[] = []
  const tr = (label: string, isTip: boolean) => {
    if (!isTip || !translate) return label
    const t = translate.get(label)
    if (t !== undefined) return t
    if (!values!.has(label)) untranslated.push(label)
    return label
  }
  let p: Phylogeny
  try {
    p = parseNewick(newick, {
      id,
      title: `${o.title ?? o.source.title}: ${name}`,
      version: o.version,
      sources: [o.source.id],
      ...(o.citation ? { citation: o.citation } : {}),
      ...(key === 'UTREE' ? { rooted: false } : o.rooted !== undefined ? { rooted: o.rooted } : {}),
      ...(o.lengthUnit ? { lengthUnit: o.lengthUnit } : {}),
      ...(o.sampling ? { sampling: o.sampling } : {}),
      ...(o.internalLabels ? { internalLabels: o.internalLabels } : {}),
      ...(o.supportMethod ? { supportMethod: o.supportMethod } : {}),
      ...(o.supportMethods ? { supportMethods: o.supportMethods } : {}),
      ...(o.mapLabel ? { mapLabel: (label: string, isTip: boolean) => o.mapLabel!(tr(label, isTip), isTip) } : {}),
    })
  } catch (e) {
    if (e instanceof NewickError) throw new NexusError(`Tree “${name}”: ${e.message.replace(/ \(at character \d+\)$/, '')}`, ln(body + lead + e.position))
    throw e
  }
  // Tips take their taxon names from the table (internal labels are not translated).
  const parents = new Set(p.edges.map((e) => e.parent))
  untranslated.length = 0
  for (const n of p.nodes) if (n.label !== undefined && !parents.has(n.id)) n.label = tr(n.label, true)
  if (untranslated.length) warnings.push({ code: 'untranslated-label', message: `Tree “${name}”: ${untranslated.length} tip label(s) are neither a TRANSLATE token nor a translated name (${untranslated.slice(0, 5).join(', ')}); kept as written`, line: cmd.line })
  return p
}
