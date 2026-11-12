// The panels' stylesheet: the drawing colours it copies from the React package stay equal to that package's, and the
// Payload theme variables it borrows give readable text and visible control edges in Payload's light and dark themes.
// Colours are read from the installed @payloadcms/ui, so a Payload upgrade that changes them is checked too.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname
const panels = readFileSync(join(here, '..', 'src', 'client', 'panels.css'), 'utf8')
const drawing = readFileSync(join(here, '..', '..', 'react', 'src', 'styles.css'), 'utf8')

/** The custom properties declared in one `{ … }` block, by name. */
const declared = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
/** The first `{ … }` block after `marker`. Nested blocks aren't expected there. */
const blockAfter = (css: string, marker: string) => {
  const at = css.indexOf(marker)
  if (at < 0) throw new Error(`"${marker}" isn't in the stylesheet`)
  const open = css.indexOf('{', at + marker.length)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('drawing colours copied into the panels', () => {
  const colours = (vars: Record<string, string>) => Object.fromEntries(Object.entries(vars).filter(([name]) => !['--ot-font', '--ot-edge-width'].includes(name)))
  const light = colours(declared(blockAfter(drawing, '.ot-tip-links')))
  const dark = colours(declared(blockAfter(drawing.slice(drawing.indexOf('@media (prefers-color-scheme: dark)')), '.ot-tip-links')))

  it('reads both themes from the React package', () => {
    expect(Object.keys(light).length).toBeGreaterThanOrEqual(14)
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
    expect(light['--ot-surface']).not.toBe(dark['--ot-surface'])
  })

  it('has the React package’s light values', () => {
    expect(declared(blockAfter(panels, '/* drawing:light */'))).toEqual(light)
  })

  it('has the React package’s dark values, under Payload’s own dark-theme marker', () => {
    expect(declared(blockAfter(panels, '/* drawing:dark */'))).toEqual(dark)
    expect(panels).toMatch(/\/\* drawing:dark \*\/\s*html\[data-theme='dark'\] \.onetaxonomy-panel /)
    // The admin's theme is the person's choice in Payload, not the system's: no system-preference switch here.
    expect(panels).not.toMatch(/prefers-color-scheme/)
  })
})

describe('contrast in Payload’s themes', () => {
  const scss = dirname(createRequire(import.meta.url).resolve('@payloadcms/ui/scss'))
  const colors = readFileSync(join(scss, 'colors.scss'), 'utf8')
  // Sass interpolations (`#{$name}`) hold a brace each: take them out so a block ends where it really ends.
  const app = readFileSync(join(scss, 'app.scss'), 'utf8').replace(/#\{[^}]*\}/g, 'sass')
  const root = { ...declared(blockAfter(colors, ':root')), ...declared(blockAfter(app, ':root')) }
  const themes = {
    light: root,
    dark: { ...root, ...declared(blockAfter(colors, "html[data-theme='dark']")), ...declared(blockAfter(app, "&[data-theme='dark']")) },
  }

  /** A Payload variable's colour in a theme, as [r, g, b]. */
  const rgb = (theme: Record<string, string>, name: string): [number, number, number] => {
    let value = theme[name]
    for (let hops = 0; value && hops < 10; hops++) {
      const ref = /^var\((--[\w-]+)\)$/.exec(value)
      if (!ref) break
      value = theme[ref[1]!]
    }
    const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value ?? '')
    if (!m) throw new Error(`${name} isn't a plain colour in Payload's stylesheet: ${value}`)
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  /** WCAG 2.2 contrast ratio. */
  const luminance = (c: [number, number, number]) => {
    const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: [number, number, number], b: [number, number, number]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
  }

  /** The Payload variable each panel variable takes its colour from. */
  const borrowed = (name: string) => {
    const m = new RegExp(`${name}:\\s*var\\((--theme-[\\w-]+),`).exec(panels)
    if (!m) throw new Error(`${name} doesn't take a Payload theme variable`)
    return m[1]!
  }

  for (const [themeName, theme] of Object.entries(themes)) {
    const of = (name: string) => rgb(theme, borrowed(name))
    const surfaces = { panel: '--otp-bg', raised: '--otp-raised' }

    it(`${themeName}: text and muted text are at least 4.5:1 on the panel and on raised boxes`, () => {
      for (const [where, surface] of Object.entries(surfaces)) {
        expect(contrast(of('--otp-text'), of(surface)), `text on ${where}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(of('--otp-muted'), of(surface)), `muted on ${where}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${themeName}: the edges of buttons and text boxes are at least 3:1 on both`, () => {
      for (const [where, surface] of Object.entries(surfaces)) expect(contrast(of('--otp-control-border'), of(surface)), `control edge on ${where}`).toBeGreaterThanOrEqual(3)
      // A text box sits on Payload's own input background.
      expect(contrast(of('--otp-control-border'), rgb(theme, '--theme-input-bg'))).toBeGreaterThanOrEqual(3)
    })

    it(`${themeName}: the primary button's words are at least 4.5:1 on it`, () => {
      expect(contrast(rgb(theme, '--theme-elevation-0'), rgb(theme, '--theme-elevation-800'))).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('reads different colours for the two themes', () => {
    expect(rgb(themes.light, '--theme-elevation-0')).not.toEqual(rgb(themes.dark, '--theme-elevation-0'))
    expect(rgb(themes.light, '--theme-text')).not.toEqual(rgb(themes.dark, '--theme-text'))
  })
})

describe('status without colour', () => {
  it('never colours a status word, a notice or a step by its state alone', () => {
    // The state colours are used only for bars and edges. Text stays in the text or muted colour.
    for (const name of ['--otp-success', '--otp-warning', '--otp-error']) {
      const uses = [...panels.matchAll(new RegExp(`([\\w-]+):\\s*var\\(${name}\\)`, 'g'))].map((m) => m[1])
      expect(uses.length, name).toBeGreaterThan(0)
      for (const property of uses) expect(property, `${name} as ${property}`).toMatch(/^border(-[a-z-]+)?-color$|^border-color$/)
    }
  })
})
