import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Next.js and other React Server Components hosts read `'use client'` from each built file. A file that calls a
 * client hook without it can't be imported from a Server Component at all, and it takes the whole package entry down
 * with it. `tsc` keeps the directive in `dist`, so the source is what's checked here.
 */
const SRC = join(import.meta.dirname, '..', 'src')
const files = readdirSync(SRC).filter((f) => /\.tsx?$/.test(f))
const source = (f: string) => readFileSync(join(SRC, f), 'utf8')
const isClient = (f: string) => /^'use client'\s*\n/.test(source(f))
/** Hooks that run on the server too. */
const SERVER_HOOKS = new Set(['useId'])
const hooksOf = (f: string) =>
  [...source(f).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'react'/g)]
    .flatMap((m) => m[1]!.split(','))
    .map((name) => name.trim())
    .filter((name) => /^use[A-Z]/.test(name))

describe('client and server modules', () => {
  it('marks every file that calls a client hook as a client module', () => {
    const unmarked = files.filter((f) => hooksOf(f).some((h) => !SERVER_HOOKS.has(h)) && !isClient(f))
    expect(unmarked).toEqual([])
  })

  it('keeps the list of client modules as written here', () => {
    // Adding a file to this list takes its plain helpers away from Server Components: say so in the README.
    expect(files.filter(isClient).sort()).toEqual(['CanvasTreeView.tsx', 'Explorer.tsx', 'Lesson.tsx', 'Phylo.tsx', 'TipLinks.tsx', 'TreeOutline.tsx', 'toolbar.ts'])
  })

  it('keeps TreeView and the layout helper callable on a server', () => {
    for (const f of ['TreeView.tsx', 'layout.ts', 'canvasPlan.ts', 'shapes.tsx', 'export.ts', 'index.ts']) expect(isClient(f), f).toBe(false)
    expect(hooksOf('TreeView.tsx')).toEqual(['useId'])
  })

  it('exports layoutFor from the entry, from the server-safe file', () => {
    expect(source('index.ts')).toMatch(/export \{ layoutFor \} from '\.\/layout\.js'/)
    expect(source('Explorer.tsx')).not.toMatch(/export function layoutFor/)
  })
})
