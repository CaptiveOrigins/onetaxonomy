import amniotesJson from '../../../fixtures/amniotes.json'
import structuresJson from '../../../fixtures/structures.json'
import type { DatasetSnapshot } from '../src'

export const amniotes = amniotesJson as DatasetSnapshot
export const structures = structuresJson as DatasetSnapshot
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
