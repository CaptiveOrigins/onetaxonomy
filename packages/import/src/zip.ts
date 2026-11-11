/**
 * Minimal ZIP reader for Darwin Core Archives: stored and deflated entries, no
 * encryption, no ZIP64. Inflation uses the platform's `DecompressionStream`
 * (browsers, Node 18+, Deno, Tauri webviews), or a function the caller passes.
 */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>

type DecompressionStreamCtor = new (format: 'deflate-raw') => { readable: unknown; writable: unknown }

const platformInflate: Inflate = async (data) => {
  const DS = (globalThis as { DecompressionStream?: DecompressionStreamCtor }).DecompressionStream
  const R = (globalThis as { Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> } }).Response
  const B = (globalThis as { Blob?: new (parts: unknown[]) => { stream(): { pipeThrough(t: unknown): unknown } } }).Blob
  if (!DS || !R || !B) throw new Error('No DecompressionStream on this platform: pass an inflate function (e.g. from node:zlib inflateRawSync)')
  const stream = new B([data]).stream().pipeThrough(new DS('deflate-raw'))
  return new Uint8Array(await new R(stream).arrayBuffer())
}

type TextDecoderCtor = new () => { decode(b: Uint8Array): string }
/** UTF-8 decoding without depending on DOM or Node type declarations. */
export const decodeUtf8 = (b: Uint8Array): string => new (globalThis as unknown as { TextDecoder: TextDecoderCtor }).TextDecoder().decode(b)

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/** Reads every file entry of a ZIP archive into memory, keyed by its path. */
export async function readZip(bytes: Uint8Array, inflate: Inflate = platformInflate): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End of central directory: scan back over a possible archive comment (≤ 64 KiB).
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP archive (no end of central directory)')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  if (count === 0xffff || p === 0xffffffff) throw new ZipError('ZIP64 archives are not supported')
  const files = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new ZipError(`Damaged central directory at byte ${p}`)
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const fullSize = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = decodeUtf8(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    if (flags & 1) throw new ZipError(`${name} is encrypted`)
    if (view.getUint32(local, true) !== 0x04034b50) throw new ZipError(`Damaged local header for ${name}`)
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    // CRCs aren't checked, so at least refuse an entry that is cut short or doesn't unpack to its stated size.
    if (start + size > bytes.length) throw new ZipError(`${name} is cut short: the archive ends before its data does`)
    const data = bytes.subarray(start, start + size)
    let out: Uint8Array
    if (method === 0) out = data
    else if (method === 8) out = await inflate(data)
    else throw new ZipError(`${name} uses unsupported compression method ${method}`)
    if (out.length !== fullSize) throw new ZipError(`${name} unpacked to ${out.length} bytes, not the ${fullSize} the archive states`)
    files.set(name, out)
  }
  return files
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 as ZIP uses it (IEEE 802.3). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

type TextEncoderCtor = new () => { encode(s: string): Uint8Array }
/** UTF-8 encoding without depending on DOM or Node type declarations. */
export const encodeUtf8 = (s: string): Uint8Array => new (globalThis as unknown as { TextEncoder: TextEncoderCtor }).TextEncoder().encode(s)

/** MS-DOS date and time, as ZIP headers store them (local fields of the ISO time given, 2-second steps, 1980 at the earliest). */
function dosDateTime(iso: string): { time: number; date: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso)
  if (!m) return { time: 0, date: (1 << 5) | 1 }
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number]
  return { time: (h << 11) | (mi << 5) | Math.floor(s / 2), date: (Math.max(0, y - 1980) << 9) | (mo << 5) | d }
}

/**
 * Writes a ZIP archive with every entry stored (not compressed), in the order given, with UTF-8 names and real
 * CRCs, so `unzip`, Finder and any ZIP library read it. No ZIP64: the whole archive must stay under 4 GiB.
 */
export function writeZip(entries: { path: string; data: Uint8Array }[], { modified = '1980-01-01T00:00:00' }: { modified?: string } = {}): Uint8Array {
  const { time, date } = dosDateTime(modified)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const header = (size: number) => {
    const b = new Uint8Array(size)
    return { b, v: new DataView(b.buffer) }
  }
  for (const { path, data } of entries) {
    const name = encodeUtf8(path)
    const crc = crc32(data)
    const local = header(30)
    local.v.setUint32(0, 0x04034b50, true)
    local.v.setUint16(4, 20, true)
    local.v.setUint16(6, 0x0800, true) // names are UTF-8
    local.v.setUint16(8, 0, true) // stored
    local.v.setUint16(10, time, true)
    local.v.setUint16(12, date, true)
    local.v.setUint32(14, crc, true)
    local.v.setUint32(18, data.length, true)
    local.v.setUint32(22, data.length, true)
    local.v.setUint16(26, name.length, true)
    const c = header(46)
    c.v.setUint32(0, 0x02014b50, true)
    c.v.setUint16(4, 20, true)
    c.v.setUint16(6, 20, true)
    c.v.setUint16(8, 0x0800, true)
    c.v.setUint16(10, 0, true)
    c.v.setUint16(12, time, true)
    c.v.setUint16(14, date, true)
    c.v.setUint32(16, crc, true)
    c.v.setUint32(20, data.length, true)
    c.v.setUint32(24, data.length, true)
    c.v.setUint16(28, name.length, true)
    c.v.setUint32(42, offset, true)
    parts.push(local.b, name, data)
    central.push(c.b, name)
    offset += 30 + name.length + data.length
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0)
  if (offset + cdSize > 0xffffffff || entries.length > 0xfffe) throw new ZipError('Too large for a ZIP without ZIP64')
  const end = header(22)
  end.v.setUint32(0, 0x06054b50, true)
  end.v.setUint16(8, entries.length, true)
  end.v.setUint16(10, entries.length, true)
  end.v.setUint32(12, cdSize, true)
  end.v.setUint32(16, offset, true)
  const all = [...parts, ...central, end.b]
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0))
  let p = 0
  for (const b of all) {
    out.set(b, p)
    p += b.length
  }
  return out
}
