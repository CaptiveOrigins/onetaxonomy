import type { Citation, ViewDisclosure } from '@extantape/onetaxonomy-core'

/** Properties copied into exported SVGs (they carry no stylesheet). */
const INLINE = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'visibility', 'display']
const NS = 'http://www.w3.org/2000/svg'

export const citationLine = (c: Citation): string =>
  [c.text, c.version && `version ${c.version}`, c.license, c.url, c.illustrative && 'illustrative data'].filter(Boolean).join(' · ')

/** The disclosure as plain lines: what the diagram is, what is hidden, the data and sources. */
export const disclosureLines = (d: ViewDisclosure, sourcesLabel = 'Sources'): string[] => [...d.lines, ...(d.citations.length ? [`${sourcesLabel}:`, ...d.citations.map((c) => `  ${citationLine(c)}`)] : [])]

/**
 * A self-contained copy of a drawing: computed styles inlined, the viewBox kept, and
 * the disclosure written underneath, so the file can't travel without saying whether
 * it is a classification or a phylogeny and what was left out (I13).
 */
export function standaloneSvg(svg: SVGSVGElement, disclosure: ViewDisclosure, { lineHeight = 15, fontSize = 11, sourcesLabel }: { lineHeight?: number; fontSize?: number; sourcesLabel?: string } = {}): string {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const src = svg.querySelectorAll('*')
  copy.querySelectorAll('*').forEach((el, i) => {
    const cs = getComputedStyle(src[i]!)
    for (const prop of INLINE) {
      const v = cs.getPropertyValue(prop)
      if (v) (el as SVGElement).style.setProperty(prop, v)
    }
  })
  const [x, y, w, h] = (copy.getAttribute('viewBox') ?? '0 0 600 400').split(/\s+/).map(Number) as [number, number, number, number]
  const lines = disclosureLines(disclosure, sourcesLabel)
  const g = document.createElementNS(NS, 'g')
  g.setAttribute('class', 'ot-disclosure')
  lines.forEach((line, i) => {
    const t = document.createElementNS(NS, 'text')
    t.setAttribute('x', String(x + 8))
    t.setAttribute('y', String(y + h + 12 + (i + 1) * lineHeight))
    t.setAttribute('style', `font-family: system-ui, sans-serif; font-size: ${fontSize}px; fill: #4c312c`)
    t.textContent = line
    g.appendChild(t)
  })
  copy.appendChild(g)
  const total = h + 24 + lines.length * lineHeight
  copy.setAttribute('viewBox', `${x} ${y} ${w} ${total}`)
  copy.setAttribute('width', String(Math.round(w)))
  copy.setAttribute('height', String(Math.round(total)))
  // A namespace declaration, not a plain attribute: a plain `xmlns` attribute can be serialized next to the
  // serializer's own, and a file with the attribute twice isn't valid XML (seen in jsdom).
  copy.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', NS)
  copy.removeAttribute('style')
  // The title and description stay first, where readers of the file look for its name (WCAG 1.1.1).
  for (const el of copy.querySelectorAll(':scope > title, :scope > desc')) el.removeAttribute('style')
  // A white page behind the drawing, so PNGs and dark-mode exports stay legible.
  const bg = document.createElementNS(NS, 'rect')
  for (const [k, v] of Object.entries({ x, y, width: w, height: total, fill: '#ffffff' })) bg.setAttribute(k, String(v))
  copy.insertBefore(bg, copy.querySelector(':scope > desc')?.nextSibling ?? copy.querySelector(':scope > title')?.nextSibling ?? copy.firstChild)
  return new XMLSerializer().serializeToString(copy)
}

/** Rasterizes a standalone SVG (from `standaloneSvg`) to PNG in the browser. */
export async function svgToPng(svgText: string, { scale = 2 }: { scale?: number } = {}): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not render the drawing as an image'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(img.naturalWidth * scale)
    canvas.height = Math.ceil(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
