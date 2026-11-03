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
    const data = bytes.subarray(start, start + size)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, await inflate(data))
    else throw new ZipError(`${name} uses unsupported compression method ${method}`)
  }
  return files
}
