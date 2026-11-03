import amniotesJson from '../../../fixtures/amniotes.json'
import structuresJson from '../../../fixtures/structures.json'
import type { DatasetSnapshot } from '../src'

export const amniotes = amniotesJson as DatasetSnapshot
export const structures = structuresJson as DatasetSnapshot
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
import checklistJson from '../../../fixtures/checklist.json'
import checklistV2Json from '../../../fixtures/checklist-v2.json'

/** Illustrative checklist with invented names (fixtures/checklist.csv); ids are `fx:<row id>`. */
export const checklist = checklistJson as DatasetSnapshot
export const checklistV2 = checklistV2Json as DatasetSnapshot
