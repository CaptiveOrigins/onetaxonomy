#!/usr/bin/env node
// Times layout, projection and the canvas renderer's level-of-detail plan on made-up
// trees of 1,000, 10,000 and 50,000 tips, in Node, and writes docs/benchmarks.md.
//
//   pnpm -r build && node scripts/bench-canvas.mjs            # writes docs/benchmarks.md
//   node scripts/bench-canvas.mjs --print                      # prints, writes nothing
//
// What it measures is CPU time in Node for the pure steps. It does not paint: Node has
// no canvas here (no node-canvas dependency), so the draw is run against a context that
// only counts calls, to check what would be drawn. How long painting takes, and frame
// rates while panning, need a real browser and are not reported.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { createView, indexDataset, projectView } = await import(join(root, 'packages/core/dist/index.js'))
const { radial, rectangular } = await import(join(root, 'packages/layout/dist/index.js'))
const { chooseRenderer, drawPlan, hitTest, LIGHT_COLORS, planCanvas, prepareTree } = await import(join(root, 'packages/react/dist/canvasPlan.js'))
const { treeViewBox } = await import(join(root, 'packages/react/dist/TreeView.js'))

/** A made-up rooted tree (the same rule as the react tests' bigTree): about a third of the tips go left at every split. */
function madeUp(tips) {
  const nodes = []
  const edges = []
  let inner = 0
  let tip = 0
  const build = (count, parent) => {
    let id
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
  }
}

/** A 2D context that does nothing but count calls. */
function counter() {
  const calls = {}
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1 }
  for (const op of ['save', 'restore', 'setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'fill', 'stroke', 'fillText', 'translate', 'rotate', 'setLineDash'])
    ctx[op] = () => void (calls[op] = (calls[op] ?? 0) + 1)
  return { ctx, calls }
}

function time(fn, runs) {
  for (let i = 0; i < 2; i++) fn() // warm up
  const ms = []
  let out
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    out = fn()
    ms.push(performance.now() - t)
  }
  ms.sort((a, b) => a - b)
  return { median: ms[Math.floor(ms.length / 2)], min: ms[0], runs, out }
}

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}
const machine = {
  model: process.platform === 'darwin' ? sh('sysctl', ['-n', 'hw.model']) : 'unknown',
  cpu: process.platform === 'darwin' ? sh('sysctl', ['-n', 'machdep.cpu.brand_string']) : (os.cpus()[0]?.model ?? 'unknown'),
  cores: os.cpus().length,
  memory: `${Math.round(os.totalmem() / 2 ** 30)} GB`,
  os: `${os.type()} ${os.release()} (${process.arch})`,
  node: process.version,
  load: `load average ${os.loadavg().map((l) => l.toFixed(1)).join(", ")} (1, 5, 15 min) on ${os.cpus().length} cores`,
  date: new Date().toISOString().slice(0, 10),
}

const rows = []
for (const tips of [1000, 10000, 50000]) {
  const runs = tips >= 50000 ? 5 : 10
  const snapshot = madeUp(tips)
  const d = indexDataset(snapshot)
  const view = createView(d, { id: 'v', title: 'Made-up', target: { kind: 'phylogeny', id: 'big' } })
  // projectView stops at 10,000 nodes by default (and says so in `truncated`); the benchmark lifts that to draw everything.
  const proj = time(() => projectView(d, view, { limit: Infinity }), runs)
  const p = proj.out
  const rect = time(() => rectangular(p), runs)
  const rad = time(() => radial(p), runs)
  const layout = rect.out
  const prep = time(() => prepareTree(p, layout), runs)
  const prepared = prep.out
  // Fit: the whole tree on an 800 × 600 canvas.
  const fitBox = treeViewBox(layout)
  const fit = time(() => planCanvas(prepared, { box: fitBox, width: 800, height: 600 }), runs)
  // Zoomed: a 1,000 × 1,000 canvas at 1 px between tips, so about 1–2k nodes are in view.
  const k = 1 / 24
  const zoomBox = { x: -16, y: (layout.height / 2) - 500 / k, width: 1000 / k, height: 1000 / k }
  const zoom = time(() => planCanvas(prepared, { box: zoomBox, width: 1000, height: 1000 }), runs)
  // Close: names readable (12 px), as when reading part of the tree.
  const leaves = layout.nodes.filter((n) => n.leaf)
  const mid = leaves[Math.floor(leaves.length / 2)]
  const closeBox = { x: mid.x - 700, y: mid.y - 500, width: 1000, height: 1000 }
  const close = time(() => planCanvas(prepared, { box: closeBox, width: 1000, height: 1000 }), runs)
  const radialPrepared = prepareTree(p, rad.out)
  const radialPlan = time(() => planCanvas(radialPrepared, { box: treeViewBox(rad.out), width: 800, height: 800 }), runs)
  const draw = counter()
  drawPlan(draw.ctx, zoom.out, LIGHT_COLORS, { scale: 2 })
  const hits = time(() => {
    let found = 0
    for (let i = 0; i < 100; i++) if (hitTest(zoom.out, (i * 97) % 1000, (i * 61) % 1000)) found++
    return found
  }, runs)
  rows.push({
    tips, nodes: layout.nodes.length, renderer: chooseRenderer(layout), proj, rect, rad, prep, fit, zoom, close, radialPlan, hits,
    calls: draw.calls,
  })
}

const f = (ms) => (ms < 10 ? ms.toFixed(2) : ms < 100 ? ms.toFixed(1) : ms.toFixed(0))
const t = (r) => `${f(r.median)} (${f(r.min)})`
const c = (p) => `${p.counts.drawn.toLocaleString('en-US')} drawn, ${p.counts.merged.subtrees.toLocaleString('en-US')} wedges holding ${p.counts.merged.nodes.toLocaleString('en-US')}, ${p.counts.outOfView.toLocaleString('en-US')} out of view, ${p.counts.labelsShown.toLocaleString('en-US')} labels shown, ${p.counts.labelsOmitted.toLocaleString('en-US')} left out`

const md = `# Benchmarks

Made-up trees of 1,000, 10,000 and 50,000 tips (each tip "Taxon n", about a third of the tips going left at every split, so the tree is unbalanced like real ones). Written by \`node scripts/bench-canvas.mjs\` after \`pnpm -r build\`. Rerun it to add another machine; keep each machine's section.

**What this measures:** CPU time in Node for the pure steps: projecting the view (with \`projectView\`'s 10,000-node limit lifted, so every node is drawn), laying it out, and the canvas renderer's level-of-detail plan (\`prepareTree\`, \`planCanvas\`) and hit-testing. Each figure is the median of ${rows[0].proj.runs} runs (5 for 50,000 tips) after two warm-up runs, in milliseconds, with the fastest run in brackets.

**What it doesn't:** painting. This repo has no canvas for Node (no \`node-canvas\` dependency), so the draw was run against a context that only counts calls, to show how much would be drawn. Paint time and frame rates while panning or zooming need a real browser (WebKit in the Mac app, Safari, Chrome, Firefox) and have **not** been measured. Nothing here says the canvas is smooth at 1–2k visible nodes yet: the plan for one frame is cheap enough to allow it, and a browser run has to confirm it.

## ${machine.model}, ${machine.date}

- Machine: ${machine.model}, ${machine.cpu}, ${machine.cores} cores, ${machine.memory}
- OS: ${machine.os}
- Node: ${machine.node}
- Load while running: ${machine.load}. Other work was running on this machine at the same time, so treat these as rough; rerun on a quiet machine for cleaner numbers.

| Tips | Nodes | Renderer (auto) | Project view | Rectangular layout | Radial layout | Prepare (once per layout) | Plan, whole tree 800×600 | Plan, ~1 px per tip 1000×1000 | Plan, names readable 1000×1000 | Plan, radial whole tree 800×800 (prepared) | 100 hit tests |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.map((r) => `| ${r.tips.toLocaleString('en-US')} | ${r.nodes.toLocaleString('en-US')} | ${r.renderer} | ${t(r.proj)} | ${t(r.rect)} | ${t(r.rad)} | ${t(r.prep)} | ${t(r.fit)} | ${t(r.zoom)} | ${t(r.close)} | ${t(r.radialPlan)} | ${t(r.hits)} |`).join('\n')}

What each plan drew:

| Tips | Whole tree, 800×600 | ~1 px per tip, 1000×1000 | Names readable, 1000×1000 | Radial, whole tree, 800×800 |
| ---: | --- | --- | --- | --- |
${rows.map((r) => `| ${r.tips.toLocaleString('en-US')} | ${c(r.fit.out)} | ${c(r.zoom.out)} | ${c(r.close.out)} | ${c(r.radialPlan.out)} |`).join('\n')}

Calls the ~1 px per tip plan makes on a 2D context (counted, not timed):

| Tips | moveTo | lineTo | arc | fill | stroke | fillText |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.map((r) => `| ${r.tips.toLocaleString('en-US')} | ${(r.calls.moveTo ?? 0).toLocaleString('en-US')} | ${(r.calls.lineTo ?? 0).toLocaleString('en-US')} | ${(r.calls.arc ?? 0).toLocaleString('en-US')} | ${(r.calls.fill ?? 0).toLocaleString('en-US')} | ${(r.calls.stroke ?? 0).toLocaleString('en-US')} | ${(r.calls.fillText ?? 0).toLocaleString('en-US')} |`).join('\n')}

Edges are batched into at most four paths (plain, weak, and each while dragging), so the stroke count stays small however many edges there are.

## Not measured yet

- Paint time and frame rate in a browser, at 1–2k visible nodes, at 1× and 2× pixel density. Needs a person with the Mac app or a browser open, or a headless browser run.
- The SVG renderer at the threshold (1,000 drawn nodes), to check the threshold is in the right place. It was chosen by judgment: the explorer re-renders every SVG node on each pan step, and at 1,000 nodes that is 1,000 React elements per pointer move.
- The outline (\`TreeOutline\`) with 10,000+ rows: it isn't virtualized, and on large trees it may be slower than the drawing.
`

if (process.argv.includes('--print')) console.log(md)
else {
  writeFileSync(join(root, 'docs/benchmarks.md'), md)
  console.log(`Wrote docs/benchmarks.md (${machine.model}, ${machine.node}).`)
}
