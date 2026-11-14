// A browser benchmark for the two tree renderers: how long a frame takes while a made-up tree is panned and zoomed,
// drawn as SVG and on the canvas, at several sizes. `node scripts/bench-browser.mjs` runs it in headless Chrome; a
// person can also open dist/bench.html in any browser and press Run.
//
// Each frame sets a new viewBox, as dragging and zooming do in the explorer, and renders at once. Two things are timed:
// the script time of that render (React, and for the canvas the plan and the draw calls), and the time between
// animation frames, which also holds the browser's style, layout and paint work on the main thread. Raster and
// compositing happen on other threads and the graphics card. They show up here only once they fall behind and the
// browser holds the next frame back, so a steady frame time means the page kept up, not that painting was free.
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { createView, indexDataset, projectView, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import { rectangular } from '@extantape/onetaxonomy-layout'
import { canvasPlanOf, TreeView, type ViewBox } from '@extantape/onetaxonomy-react'

const STAGE = 1000 // CSS pixels, square
const FRAMES = 180
const WARM_UP = 20
/** Tip rows on the stage at reading size: 25 pixels a row, where every name is drawn. */
const READING_ROWS = 40
/** The fastest the reading scroll goes, in pixels a frame: a brisk drag. */
const SCROLL_PX = 20

/** A made-up rooted tree (the same rule as scripts/bench-canvas.mjs): about a third of the tips go left at every split. */
function madeUp(tips: number): DatasetSnapshot {
  const nodes: { id: string; label?: string }[] = []
  const edges: { id: string; parent: string; child: string; length: number }[] = []
  let inner = 0
  let tip = 0
  const build = (count: number, parent: string | null) => {
    let id: string
    if (count === 1) {
      tip++
      id = `t${tip}`
      nodes.push({ id, label: `Taxon ${tip}` })
    } else {
      id = `n${inner++}`
      nodes.push({ id })
    }
    if (parent !== null) edges.push({ id: `${parent}>${id}`, parent, child: id, length: 1 })
    if (count > 1) {
      const left = Math.max(1, Math.floor(count / 3))
      build(left, id)
      build(count - left, id)
    }
  }
  build(tips, null)
  return {
    schemaVersion: 1, id: `made-up-${tips}`, version: '1', createdAt: '2026-11-11T00:00:00.000Z',
    sources: [{ id: 'made-up', title: 'Made-up tree for benchmarks', citation: 'Generated. Not a scientific source.', license: 'CC0-1.0', illustrative: true }],
    names: [], concepts: [], classifications: [],
    phylogenies: [{ id: 'big', title: 'Made-up tree', version: '1', sources: ['made-up'], rooted: true, nodes, edges }],
  } as unknown as DatasetSnapshot
}

const MOTIONS = ['pan', 'zoom', 'read'] as const
type Motion = (typeof MOTIONS)[number]
export type Scenario = { renderer: 'svg' | 'canvas'; tips: number }
export type Timing = { median: number; p95: number; worst: number }
export type MotionResult = { frames: number; interval: Timing; script: Timing; late: number; drawn: Timing | null; labels: Timing | null }
export type Result = Scenario & { nodes: number; mountScript: number; elements: number | null } & Record<Motion, MotionResult>
export type Report = { userAgent: string; dpr: number; stage: number; refresh: number; visibility: string; gpu: string; results: Result[] }

// 500 tips is 999 nodes, the last size `renderer="auto"` still draws as SVG. The larger SVG runs show what the
// threshold avoids, and the smaller ones where SVG still keeps up on a slowed main thread.
const SCENARIOS: Scenario[] = [
  { renderer: 'svg', tips: 125 },
  { renderer: 'canvas', tips: 125 },
  { renderer: 'svg', tips: 250 },
  { renderer: 'canvas', tips: 250 },
  { renderer: 'svg', tips: 500 },
  { renderer: 'canvas', tips: 500 },
  { renderer: 'svg', tips: 1000 },
  { renderer: 'canvas', tips: 1000 },
  { renderer: 'svg', tips: 2500 },
  { renderer: 'canvas', tips: 2500 },
  { renderer: 'svg', tips: 5000 },
  { renderer: 'canvas', tips: 5000 },
  { renderer: 'canvas', tips: 10000 },
]

const timing = (ms: number[]): Timing => {
  const s = [...ms].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0
  return { median: at(0.5), p95: at(0.95), worst: s[s.length - 1] ?? 0 }
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))

/** The display's frame time as this browser gives it, with nothing to draw. */
async function refreshInterval(): Promise<number> {
  const stamps: number[] = []
  for (let i = 0; i < 40; i++) stamps.push(await nextFrame())
  return timing(stamps.slice(1).map((t, i) => t - stamps[i]!)).median
}

type Frame = { whole: ViewBox; reading: number; target: { x: number; y: number } }

/**
 * The box for frame `i`. Every box is square, like the stage, so the picture never changes shape.
 * - pan: the whole tree, sliding in a slow loop a tenth of the stage each way. Every node is in view on every frame.
 * - zoom: from the whole tree in to reading size on a tip in the middle, and back out, so names come and go.
 * - read: at reading size, scrolling up and down the tips at up to 20 pixels a frame. Every name in view is drawn.
 */
function boxAt(motion: Motion, i: number, { whole, reading, target }: Frame): ViewBox {
  const a = (i / 90) * 2 * Math.PI
  if (motion === 'pan') return { ...whole, x: whole.x + whole.width * 0.1 * Math.sin(a), y: whole.y + whole.height * 0.1 * Math.sin(2 * a) }
  if (motion === 'read') {
    const reach = ((SCROLL_PX * 90) / (2 * Math.PI) / STAGE) * reading // layout units either side of the target
    return { x: target.x - reading / 2, y: target.y + reach * Math.sin(a) - reading / 2, width: reading, height: reading }
  }
  // The same step in zoom every frame (a steady pinch), holding the target where it would sit under a pointer.
  const least = reading / whole.width
  const k = Math.pow(least, (1 - Math.cos(a)) / 2)
  const far = least < 1 ? (k - least) / (1 - least) : 0 // 1 at the whole tree, 0 at reading size
  const side = whole.width * k
  const cx = target.x + (whole.x + whole.width / 2 - target.x) * far
  const cy = target.y + (whole.y + whole.height / 2 - target.y) * far
  return { x: cx - side / 2, y: cy - side / 2, width: side, height: side }
}

async function run(s: Scenario, stage: HTMLElement, refresh: number): Promise<Result> {
  const dataset = indexDataset(madeUp(s.tips))
  const view = createView(dataset, { id: 'v', title: 'Made-up', target: { kind: 'phylogeny', id: 'big' } })
  const projection = projectView(dataset, view, { limit: Infinity })
  const layout = rectangular(projection)
  // A square box holding the whole tree with a small margin, centred on it.
  const side = Math.max(layout.width, layout.height) + 32
  const whole: ViewBox = { x: layout.width / 2 - side / 2, y: layout.height / 2 - side / 2, width: side, height: side }
  const leaves = layout.nodes.filter((n) => n.leaf)
  const rowGap = layout.height / Math.max(1, leaves.length - 1)
  const target = leaves.reduce((best, n) => (Math.abs(n.y - layout.height / 2) < Math.abs(best.y - layout.height / 2) ? n : best), leaves[0]!)
  const frame: Frame = { whole, reading: Math.min(side, READING_ROWS * rowGap), target: { x: target.x, y: target.y } }

  stage.replaceChildren()
  const host = document.createElement('div')
  stage.append(host)
  const root = createRoot(host)
  const draw = (box: ViewBox) => {
    const t = performance.now()
    flushSync(() =>
      root.render(<TreeView projection={projection} layout={layout} title="Made-up tree" renderer={s.renderer} viewBox={box} canvasSize={{ width: STAGE, height: STAGE }} />),
    )
    return performance.now() - t
  }

  const mountScript = draw(whole)
  await nextFrame()
  await nextFrame()
  const elements = s.renderer === 'svg' ? host.querySelectorAll('svg *').length : null

  const move = async (motion: Motion): Promise<MotionResult> => {
    const script: number[] = []
    const interval: number[] = []
    const drawn: number[] = []
    const labels: number[] = []
    let last = await nextFrame()
    for (let i = 0; i < WARM_UP + FRAMES; i++) {
      const ms = draw(boxAt(motion, i, frame))
      const now = await nextFrame()
      if (i >= WARM_UP) {
        script.push(ms)
        interval.push(now - last)
        const plan = s.renderer === 'canvas' ? canvasPlanOf(host.querySelector('canvas')) : undefined
        if (plan) {
          drawn.push(plan.counts.drawn)
          labels.push(plan.counts.labelsShown)
        }
      }
      last = now
    }
    return {
      frames: interval.length,
      interval: timing(interval),
      script: timing(script),
      // A frame is late when it took more than one and a half of the display's frame times.
      late: interval.filter((ms) => ms > refresh * 1.5).length / interval.length,
      drawn: drawn.length ? timing(drawn) : null,
      labels: labels.length ? timing(labels) : null,
    }
  }
  const pan = await move('pan')
  const zoom = await move('zoom')
  const read = await move('read')
  root.unmount()
  return { ...s, nodes: layout.nodes.length, mountScript, elements, pan, zoom, read }
}

function gpu(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return (gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '') || 'not reported'
  } catch {
    return 'not reported'
  }
}

const f = (ms: number) => (ms < 10 ? ms.toFixed(1) : ms.toFixed(0))
const cell = (t: Timing) => `${f(t.median)} / ${f(t.p95)} / ${f(t.worst)}`

function show(report: Report, out: HTMLElement) {
  const rows = report.results.flatMap((r) =>
    MOTIONS.map((m) => {
      const x = r[m]
      return `<tr><td>${r.renderer}</td><td>${r.tips.toLocaleString('en-US')}</td><td>${r.nodes.toLocaleString('en-US')}</td><td>${m}</td><td>${x.drawn ? Math.round(x.drawn.median).toLocaleString('en-US') : (r.elements ?? 0).toLocaleString('en-US') + ' elements'}</td><td>${cell(x.interval)}</td><td>${(1000 / x.interval.median).toFixed(0)}</td><td>${(x.late * 100).toFixed(0)}%</td><td>${cell(x.script)}</td></tr>`
    }),
  )
  out.innerHTML =
    `<p>Display frame time here: ${report.refresh.toFixed(1)} ms. Pixel density: ${report.dpr}. Stage: ${report.stage} × ${report.stage} CSS pixels. ${FRAMES} frames per motion. Times are median / 95th percentile / worst, in milliseconds.</p>` +
    `<table><thead><tr><th scope="col">Renderer</th><th scope="col">Tips</th><th scope="col">Nodes</th><th scope="col">Motion</th><th scope="col">Drawn</th><th scope="col">Frame time</th><th scope="col">Frames a second</th><th scope="col">Late frames</th><th scope="col">Script time</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

/**
 * A link that saves the numbers as a file, in the shape `node scripts/bench-browser.mjs --from <file>` reads. The file
 * is made in the page and saved by the browser; nothing is sent anywhere.
 */
function saveLink(report: Report): HTMLElement {
  const run = {
    date: new Date().toISOString().slice(0, 10),
    machine: null,
    cores: navigator.hardwareConcurrency ?? null,
    loadBefore: null,
    loadAfter: null,
    headless: false,
    reports: [{ ...report, browser: report.userAgent, slow: 1 }],
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }))
  a.download = 'onetaxonomy-bench.json'
  a.textContent = 'Save the numbers (onetaxonomy-bench.json)'
  const p = document.createElement('p')
  p.append(a)
  return p
}

let running: Promise<Report> | null = null

/** Runs every scenario once and gives the numbers. Asked for twice, it gives the same run. */
function runBench(): Promise<Report> {
  running ??= (async () => {
    const stage = document.getElementById('stage')!
    const status = document.getElementById('status')!
    const refresh = await refreshInterval()
    const results: Result[] = []
    for (const s of SCENARIOS) {
      status.textContent = `Running ${s.renderer}, ${s.tips.toLocaleString('en-US')} tips…`
      results.push(await run(s, stage, refresh))
    }
    stage.replaceChildren()
    const report: Report = { userAgent: navigator.userAgent, dpr: window.devicePixelRatio, stage: STAGE, refresh, visibility: document.visibilityState, gpu: gpu(), results }
    status.textContent = 'Done.'
    const out = document.getElementById('results')!
    show(report, out)
    out.append(saveLink(report))
    return report
  })()
  return running
}

declare global {
  interface Window {
    runBench: typeof runBench
  }
}
window.runBench = runBench
document.getElementById('run')?.addEventListener('click', () => void runBench())
