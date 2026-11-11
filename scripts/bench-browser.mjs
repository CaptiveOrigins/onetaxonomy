#!/usr/bin/env node
// Runs the renderer benchmark page (apps/playground/bench.tsx) in headless Chrome and adds a section to
// docs/benchmarks-browser.md. Three runs: pixel density 1, pixel density 2, and pixel density 2 with Chrome's main
// thread slowed four times (its stand-in for a slower device; it does not slow the graphics card).
//
//   pnpm -r build && node scripts/bench-browser.mjs            # runs (about ten minutes) and writes the section
//   node scripts/bench-browser.mjs --print                      # runs and prints the section, writes nothing
//   node scripts/bench-browser.mjs --json > numbers.json        # runs and prints the raw numbers
//   node scripts/bench-browser.mjs --from numbers.json          # no run: the section from saved numbers
//   CHROME=/path/to/chrome node scripts/bench-browser.mjs       # another Chrome or Chromium
//
// It needs a Chrome or Chromium already on this machine and downloads nothing. The page is opened from the built
// files on disk, Chrome gets a throwaway profile that is deleted afterwards, and its debugging port listens on this
// machine only. Nothing is sent anywhere.
//
// What it measures and what it can't is written at the top of docs/benchmarks-browser.md (HEAD below).
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const page = join(root, 'apps/playground/dist/bench.html')
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

/** One run of the page in a fresh headless Chrome at the given pixel density, with its main thread slowed `slow` times. */
async function runAt(dpr, slow) {
  const profile = mkdtempSync(join(os.tmpdir(), 'onetaxonomy-bench-'))
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`,
      '--window-size=1100,1100',
      `--force-device-scale-factor=${dpr}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--metrics-recording-only',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let text = ''
      const timer = setTimeout(() => reject(new Error('Chrome did not say where its debugging port is within 30 seconds')), 30_000)
      child.stderr.on('data', (chunk) => {
        text += chunk
        const m = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)
        if (m) {
          clearTimeout(timer)
          resolve(m[1])
        }
      })
      child.on('exit', (code) => reject(new Error(`Chrome exited (${code}) before it was ready`)))
    })
    const ws = new WebSocket(endpoint)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('Could not connect to Chrome')), { once: true })
    })
    let next = 0
    const waiting = new Map()
    const events = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.method) {
        events.get(msg.method)?.(msg.params)
        return
      }
      const w = waiting.get(msg.id)
      if (!w) return
      waiting.delete(msg.id)
      if (msg.error) w.reject(new Error(msg.error.message))
      else w.resolve(msg.result)
    })
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++next
        waiting.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    const version = await send('Browser.getVersion')
    // Open a blank tab, then load the page and wait for it, so the script below runs in the page and not in the blank one.
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    if (slow > 1) await send('Emulation.setCPUThrottlingRate', { rate: slow }, sessionId)
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the page did not load within 30 seconds')), 30_000)
      events.set('Page.loadEventFired', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    const nav = await send('Page.navigate', { url: pathToFileURL(page).href }, sessionId)
    if (nav.errorText) throw new Error(`the page did not load: ${nav.errorText}`)
    await loaded
    const answer = await send(
      'Runtime.evaluate',
      {
        expression: `window.runBench ? window.runBench() : Promise.reject(new Error('the page loaded without its script'))`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    )
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text)
    ws.close()
    return { ...answer.result.value, browser: version.product, slow }
  } finally {
    child.kill()
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)))
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}
const MOTIONS = ['pan', 'zoom', 'read']
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** Runs the page three ways and gives everything the report needs, as plain data. */
async function measure() {
  if (!existsSync(page) || !existsSync(join(root, 'apps/playground/dist/bench.js'))) {
    console.error('apps/playground/dist/bench.html is missing. Run `pnpm -r build` first.')
    process.exit(1)
  }
  if (!chrome) {
    console.error('No Chrome or Chromium found. Set CHROME to its path.')
    process.exit(1)
  }
  const load = () => os.loadavg().map((l) => Number(l.toFixed(1)))
  const loadBefore = load()
  const reports = []
  for (const [dpr, slow] of [[1, 1], [2, 1], [2, 4]]) reports.push(await runAt(dpr, slow))
  return {
    date: new Date().toISOString().slice(0, 10),
    machine: process.platform === 'darwin' ? `${sh('sysctl', ['-n', 'hw.model'])}, ${sh('sysctl', ['-n', 'machdep.cpu.brand_string'])}` : (os.cpus()[0]?.model ?? 'unknown'),
    cores: os.cpus().length,
    loadBefore,
    loadAfter: load(),
    headless: true,
    reports,
  }
}

// --from uses numbers saved earlier (with --json, or with the page's "Save the numbers" link) and runs nothing.
const from = arg('--from')
const run = from ? JSON.parse(readFileSync(from, 'utf8')) : await measure()
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(run, null, 2))
  process.exit(0)
}

const f = (ms) => (ms < 10 ? ms.toFixed(1) : ms.toFixed(0))
const n = (x) => Math.round(x).toLocaleString('en-US')
const first = run.reports[0]
const headless = run.headless !== false
/** On time: under 5% late frames in every motion. */
const onTime = (x) => MOTIONS.every((m) => x[m].late < 0.05)
const title = (r) => `Pixel density ${r.dpr}${r.slow > 1 ? `, main thread slowed ${r.slow} times` : ''}`

const lines = []
lines.push(`## ${first.browser.includes(' ') ? first.browser : first.browser.replace('/', ' ')}${headless ? ', headless' : ''}, ${run.date}`)
lines.push('')
lines.push(`- Machine: ${run.machine ? `${run.machine}, ${run.cores} cores` : `not recorded${run.cores ? ` (${run.cores} cores)` : ''}`}.`)
lines.push(`- Browser: ${first.browser.includes(' ') ? first.browser : first.browser.replace('/', ' ')}${headless ? ', headless (no window on a screen)' : ', in a window'}. Graphics: ${first.gpu}.`)
lines.push(run.loadBefore ? `- Load: the machine was busy with other work. Load average ${run.loadBefore.join(', ')} before and ${run.loadAfter.join(', ')} after (1, 5 and 15 minutes).` : '- Load: not recorded.')
lines.push(`- Drawing: ${first.stage} × ${first.stage} CSS pixels. 180 frames for each motion, after 20 warm-up frames. One run of each; not repeated.`)
lines.push('')
lines.push('What the numbers say, counting a size as on time when under 5% of its frames were late in every motion:')
lines.push('')
for (const r of run.reports) {
  const say = (renderer, name) => {
    const rows = r.results.filter((x) => x.renderer === renderer)
    if (!rows.length) return `${name} wasn't run`
    const miss = rows.find((x) => !onTime(x))
    const ok = rows.filter((x) => onTime(x) && (!miss || x.nodes < miss.nodes)).at(-1)
    if (!miss) return `${name} was on time at every size, up to ${n(ok.nodes)} nodes`
    // The motion with the most late frames. A median alone can hide them: 44% late still has a median of one frame.
    const worst = MOTIONS.reduce((w, m) => (miss[m].late > miss[w].late ? m : w))
    const doing = { pan: 'panning', zoom: 'zooming', read: 'scrolling at reading size' }[worst]
    const at = `${name} first fell behind at ${n(miss.nodes)} nodes (${(miss[worst].late * 100).toFixed(0)}% of frames late while ${doing}, median frame ${f(miss[worst].interval.median)} ms, ${(1000 / miss[worst].interval.median).toFixed(0)} frames a second)`
    return ok ? `${name} was on time up to ${n(ok.nodes)} nodes; ${at.replace(`${name} first`, 'it first')}` : `${at}, the smallest size run`
  }
  lines.push(`- **${title(r)}:** ${say('svg', 'SVG')}. ${say('canvas', 'The canvas')}.`)
}
// `TreeView` draws as SVG up to CANVAS_THRESHOLD drawn nodes (packages/react/src/canvasPlan.ts) and on the canvas above.
const SWITCH = 1000
const atSwitch = run.reports.map((r) => ({ r, row: r.results.filter((x) => x.renderer === 'svg' && x.nodes <= SWITCH).at(-1) })).filter((x) => x.row)
if (atSwitch.length) {
  const lateIn = (row) => {
    const worst = MOTIONS.reduce((w, m) => (row[m].late > row[w].late ? m : w))
    return `${(row[worst].late * 100).toFixed(0)}% of frames late while ${{ pan: 'panning', zoom: 'zooming', read: 'scrolling at reading size' }[worst]}`
  }
  const each = atSwitch.map(({ r, row }) => `${title(r).replace(/^P/, 'p')}: ${n(row.nodes)} nodes, ${onTime(row) ? 'on time' : lateIn(row)}`)
  lines.push('')
  lines.push(`\`TreeView\` draws as SVG up to ${n(SWITCH)} drawn nodes and on the canvas above that. The largest SVG tree measured at or under the switch: ${each.join('; ')}.`)
}
lines.push('')
for (const r of run.reports) {
  lines.push(`### ${title(r)}`)
  lines.push('')
  lines.push(`The display frame here, with nothing to draw: ${r.refresh.toFixed(1)} ms (${(1000 / r.refresh).toFixed(0)} frames a second).`)
  lines.push('')
  lines.push('| Renderer | Tips | Nodes | Pan: frame, late | Zoom: frame, late | Read: frame, late | Script (pan / zoom / read) | First render, script |')
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const x of r.results) {
    const frame = (d) => `${f(d.interval.median)} / ${f(d.interval.p95)} / ${f(d.interval.worst)}, ${(d.late * 100).toFixed(0)}%`
    lines.push(`| ${x.renderer} | ${n(x.tips)} | ${n(x.nodes)} | ${MOTIONS.map((m) => frame(x[m])).join(' | ')} | ${MOTIONS.map((m) => f(x[m].script.median)).join(' / ')} | ${f(x.mountScript)} |`)
  }
  lines.push('')
}
lines.push('### What was on screen')
lines.push('')
lines.push('The SVG holds every element whatever the view. The canvas plans each frame: it leaves out what is out of view and merges subtrees too small to tell apart. Median for each frame, with the most in any frame in brackets.')
lines.push('')
lines.push('| Tips | Nodes | SVG elements | Canvas, pan: nodes drawn | Canvas, zoom: nodes drawn, names | Canvas, read: nodes drawn, names |')
lines.push('| ---: | ---: | ---: | ---: | ---: | ---: |')
for (const tips of [...new Set(first.results.map((x) => x.tips))]) {
  const svg = first.results.find((x) => x.tips === tips && x.renderer === 'svg')
  const canvas = first.results.find((x) => x.tips === tips && x.renderer === 'canvas')
  const drawn = (d, names) => `${n(d.drawn.median)} (${n(d.drawn.worst)})${names ? `, ${n(d.labels.median)} (${n(d.labels.worst)})` : ''}`
  lines.push(`| ${n(tips)} | ${n((svg ?? canvas).nodes)} | ${svg ? n(svg.elements) : 'not run'} | ${canvas ? drawn(canvas.pan, false) : 'not run'} | ${canvas ? drawn(canvas.zoom, true) : 'not run'} | ${canvas ? drawn(canvas.read, true) : 'not run'} |`)
}
const section = lines.join('\n')

const HEAD = `# Browser benchmarks

How long a frame takes while a made-up tree is panned, zoomed and scrolled, drawn as SVG and on the canvas. Each tip is "Taxon n" and about a third of the tips go left at every split, the same trees as [benchmarks.md](benchmarks.md), which times the pure steps in Node. Written by \`node scripts/bench-browser.mjs\` after \`pnpm -r build\`. Rerun it to add another machine or browser; each run adds a section above the older ones.

**What this measures.** The page (\`apps/playground/bench.tsx\`) sets a new view box on every animation frame, as dragging and zooming do in the explorer, and renders at once. It records the time between animation frames and the script time of each render (React, and for the canvas the plan and the draw calls). Three motions: **pan** slides the whole tree with every node in view; **zoom** goes from the whole tree in to reading size (40 tip rows on the drawing, every name drawn) and back; **read** scrolls the tips at reading size, at up to 20 pixels a frame. In the tables, a frame is given in milliseconds as median / 95th percentile / worst, **late** is the share of frames that took more than one and a half display frames, and script is the median.

**What it doesn't.**

- Other browser engines. Only the browsers with a section below were measured. WebKit, which the Mac app and Safari use, and Firefox may differ. To measure one, open \`apps/playground/dist/bench.html\` in it, press Run, save the numbers and run \`node scripts/bench-browser.mjs --from onetaxonomy-bench.json\`.
- A window on a real screen. A headless run draws with the graphics card but shows nothing.
- All of painting. Raster and compositing happen off the main thread. They show in the frame time only once they fall behind and the browser holds the next frame back, so a steady frame time means the page kept up, not that painting cost nothing.
- A slow device. "Main thread slowed 4 times" is Chrome's own throttle. It slows script, style and layout on the main thread and leaves the graphics card and the other threads at full speed, so it is a rough stand-in, not a phone or an old laptop.
- Radial layouts, highlights, traits, support values and folded branches. The trees are plain rectangular ones with names on the tips.
- The outline (\`TreeOutline\`), which isn't virtualized.
`

if (process.argv.includes('--print')) console.log(section)
else {
  const file = join(root, 'docs/benchmarks-browser.md')
  const old = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const at = old.indexOf('\n## ')
  writeFileSync(file, `${HEAD}\n${section}\n${at === -1 ? '' : old.slice(at)}`)
  console.log(`Wrote ${file}`)
}
