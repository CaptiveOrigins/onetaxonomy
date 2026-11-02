import type { DatasetSnapshot } from './model'
import { sha256Hex } from './sha256'

/** JSON with object keys sorted at every level: the same data always gives the same text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

/** Checksum of a snapshot's content (everything except `checksum` itself). */
export function snapshotChecksum(s: DatasetSnapshot): string {
  const { checksum: _omit, ...content } = s
  return `sha256:${sha256Hex(canonicalJson(content))}`
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

/**
 * Makes a snapshot immutable: sets its checksum and deep-freezes it. Views pin
 * `{ id, version, checksum }`; any later change is a new snapshot.
 */
export function sealSnapshot(s: DatasetSnapshot): Readonly<DatasetSnapshot> {
  return deepFreeze({ ...structuredCloneJson(s), checksum: snapshotChecksum(s) })
}

/** Whether a snapshot still matches its recorded checksum. */
export const verifySnapshot = (s: DatasetSnapshot) => Boolean(s.checksum) && s.checksum === snapshotChecksum(s)

const structuredCloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
