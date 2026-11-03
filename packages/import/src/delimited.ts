/**
 * Reads delimited text (CSV, TSV) per RFC 4180: quoted fields, doubled quotes,
 * delimiters and line breaks inside quotes, CRLF or LF, and a leading BOM.
 * `quote: null` turns quoting off (Darwin Core Archives often declare no quote).
 */
export function parseDelimited(text: string, { delimiter = ',', quote = '"' as string | null } = {}): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    // A trailing empty line is not a row.
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  while (i < s.length) {
    const ch = s[i]!
    if (quoted) {
      if (ch === quote) {
        if (s[i + 1] === quote) {
          field += quote
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (quote !== null && ch === quote && field === '') {
      quoted = true
      i++
    } else if (s.startsWith(delimiter, i)) {
      endField()
      i += delimiter.length
    } else if (ch === '\r' && s[i + 1] === '\n') {
      endRow()
      i += 2
    } else if (ch === '\n' || ch === '\r') {
      endRow()
      i++
    } else {
      field += ch
      i++
    }
  }
  if (quoted) throw new SyntaxError('Unclosed quoted field at the end of the file')
  if (field !== '' || row.length) endRow()
  return rows
}

/** Rows as objects keyed by the header row. Missing cells are empty strings. */
export function parseDelimitedRecords(text: string, options?: Parameters<typeof parseDelimited>[1]): Record<string, string>[] {
  const [header, ...rows] = parseDelimited(text, options)
  if (!header) return []
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])))
}
