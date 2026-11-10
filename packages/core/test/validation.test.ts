import { describe, expect, it } from 'vitest'

import { hasErrors, sealSnapshot, sha256Hex, snapshotChecksum, validateDataset, verifySnapshot } from '../src'
import { amniotes, clone, structures } from './helpers'

const codes = (s: Parameters<typeof validateDataset>[0]) => validateDataset(s).map((d) => d.code)

describe('validateDataset (I9, I10, I15)', () => {
  it('the fixtures are valid (and flagged as illustrative)', () => {
    for (const f of [amniotes, structures]) {
      expect(hasErrors(validateDataset(f))).toBe(false)
      expect(codes(f)).toContain('illustrative-source')
    }
  })
  it('reports duplicate ids, dangling references and missing sources', () => {
    const s = clone(amniotes)
    s.concepts.push({ ...s.concepts[0]! })
    s.concepts[1]!.acceptedName = 'n:nope'
    s.classifications[0]!.sources.push('unlisted')
    expect(codes(s)).toEqual(expect.arrayContaining(['duplicate-id', 'dangling-reference', 'missing-source']))
  })
  it('reports cycles once, with the members on the cycle', () => {
    const s = clone(structures)
    s.phylogenies[0]!.edges.push({ id: 'x', parent: 'a', child: 'root' })
    const cycles = validateDataset(s).filter((d) => d.code === 'cycle')
    expect(cycles).toHaveLength(1)
    expect(cycles[0]!.ids).toEqual(expect.arrayContaining(['a', 'p', 'root']))
  })
  it('reports second parents and self-edges', () => {
    const s = clone(structures)
    s.phylogenies[0]!.edges.push({ id: 'y', parent: 'ef', child: 'a' }, { id: 'z', parent: 'b', child: 'b' })
    expect(codes(s)).toEqual(expect.arrayContaining(['multiple-parents', 'self-edge']))
  })
  it('lengths need a unit; time needs a time unit', () => {
    const s = clone(structures)
    delete s.phylogenies[2]!.lengthUnit
    s.phylogenies[3]!.lengthUnit = 'substitutions-per-site'
    expect(codes(s)).toEqual(expect.arrayContaining(['length-without-unit', 'time-without-calibration']))
  })
  it('never mutates its input', () => {
    const s = clone(amniotes)
    const before = JSON.stringify(s)
    validateDataset(s)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('snapshots (I1)', () => {
  it('sha256 matches the standard test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
    expect(sha256Hex('Köhlerschildkröte 🐢')).toHaveLength(64)
  })
  it('sealing freezes and checksums; key order does not matter', () => {
    const sealed = sealSnapshot(amniotes)
    expect(verifySnapshot(sealed)).toBe(true)
    expect(Object.isFrozen(sealed.phylogenies[0]!.nodes)).toBe(true)
    expect(() => (sealed.phylogenies[0]!.nodes as unknown[]).push({})).toThrow()
    const reordered = Object.fromEntries(Object.entries(clone(amniotes)).reverse()) as typeof amniotes
    expect(snapshotChecksum(reordered)).toBe(snapshotChecksum(amniotes))
    const changed = clone(sealed)
    changed.phylogenies[0]!.edges[0]!.length = 1
    expect(verifySnapshot(changed)).toBe(false)
  })
  it('never verifies a snapshot without a checksum (fails closed)', () => {
    const plain = clone(amniotes)
    expect(verifySnapshot({ ...plain, checksum: undefined })).toBe(false)
    expect(verifySnapshot({ ...plain, checksum: '' })).toBe(false)
  })
  it('seals a copy, leaving the caller’s object unfrozen and unchanged, and replaces a stale checksum', () => {
    const plain = clone(amniotes)
    const before = JSON.stringify(plain)
    const sealed = sealSnapshot(plain)
    expect(Object.isFrozen(plain)).toBe(false)
    expect(JSON.stringify(plain)).toBe(before)
    const stale = sealSnapshot({ ...clone(sealed), checksum: 'sha256:0000' })
    expect(stale.checksum).toBe(sealed.checksum)
    expect(verifySnapshot(stale)).toBe(true)
  })
})
