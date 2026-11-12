#!/usr/bin/env node
// Clicks through the plugin's admin panels in a real browser. It starts the example site on a free port with a
// throwaway database, opens a Chrome or Chromium that is already installed (headless, with a throwaway profile that
// is deleted afterwards and a debugging port on 127.0.0.1), signs in as the made-up curator and does what a curator
// does: publishes a snapshot by keyboard, runs the import jobs, accepts a proposal, pastes a new snapshot into
// Payload's own form and publishes it with Payload's own Save. Exits 0 when every check passes.
//
//   node scripts/click-through.mjs               build, then run the built site
//   node scripts/click-through.mjs --skip-build  run the site built last time
//   node scripts/click-through.mjs --dev         run `next dev` instead of a build
//   node scripts/click-through.mjs --shots dir   also save a screenshot of each step into `dir`
//   CHROME=/path/to/chrome node scripts/click-through.mjs
//
// Nothing is installed and nothing is sent anywhere by this script. The pages do ask one other site: Payload's code
// editor loads from cdn.jsdelivr.net, so the steps that paste a snapshot need the network. Any other request off
// the site fails the run.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flags = new Set()
let shots = null
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--shots' && args[i + 1]) shots = path.resolve(args[(i += 1)])
  else flags.add(args[i])
}
const unknown = [...flags].filter((f) => !['--dev', '--skip-build'].includes(f))
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(' ')}\nUsage: node scripts/click-through.mjs [--dev | --skip-build] [--shots <folder>]`)
  process.exit(2)
}
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))
if (!chrome) {
  console.error('No Chrome or Chromium found. Set CHROME to its path.')
  process.exit(2)
}
if (shots) mkdirSync(shots, { recursive: true })

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runner = path.join(app, 'scripts', 'run.mjs')
const fixture = (name) => readFileSync(path.join(app, '../../fixtures', name), 'utf8')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const finished = (child) => new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(child.exitCode) : child.once('exit', (code) => resolve(code))))
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const port = await freePort()
const site = `http://localhost:${port}`
const password = randomBytes(12).toString('base64url')
// DATABASE_URI and EXAMPLE_UPLOADS are cleared so this never runs against a database or a folder you named for
// something else.
const env = { ...process.env, PORT: String(port), EXAMPLE_URL: site, EXAMPLE_PASSWORD: password, DATABASE_URI: '', EXAMPLE_UPLOADS: '' }
const run = (how, quiet) => spawn(process.execPath, [runner, how], { cwd: app, env, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' })

if (!flags.has('--dev') && !flags.has('--skip-build')) {
  if ((await finished(run('build', false))) !== 0) {
    console.error('The build failed, so nothing was checked.')
    process.exit(1)
  }
}

const server = run(flags.has('--dev') ? 'dev' : 'start', true)
let log = ''
for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => (log = (log + chunk).slice(-8000)))

let failed = 0
let passed = 0
function check(name, ok, detail) {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : `\n       ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

/** One request from this script, not from the browser: to set a step up, or to read back what a click stored. */
async function api(method, pathname, { as, body } = {}) {
  const res = await fetch(site + pathname, { method, headers: { ...(as ? { Cookie: as } : {}), Origin: site, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120_000) })
  return { status: res.status, json: await res.json().catch(() => null), res }
}
const signIn = async (email) => (await api('POST', '/api/users/login', { body: { email, password } })).res.headers.getSetCookie().find((c) => c.startsWith('payload-token='))?.split(';')[0]

const profile = mkdtempSync(path.join(os.tmpdir(), 'onetaxonomy-click-through-'))
let browser = null
try {
  let up = false
  for (let i = 0; i < 180 && !up && server.exitCode === null; i += 1) {
    up = await fetch(site + '/').then((r) => r.status === 200, () => false)
    if (!up) await sleep(1000)
  }
  if (!up) throw new Error(`the site didn't start:\n${log}`)

  // Made-up things to look at, beside what the site seeds: a shared proposal from the member, a draft view, and a
  // second import job over the file the first one reads.
  const member = await signIn('member@example.org')
  const curator = await signIn('curator@example.org')
  const snaps = (await api('GET', '/api/taxonomy-snapshots?depth=0&select[status]=true&select[snapshotId]=true', { as: curator })).json.docs
  const published = snaps.find((d) => d.status === 'published')
  const staged = snaps.find((d) => d.status === 'staged')
  const views = (await api('GET', '/api/taxonomy-views?depth=0&select[title]=true', { as: curator })).json.docs
  const made = await api('POST', '/api/taxonomy-proposals?depth=0', { as: member, body: { snapshot: published.id, proposal: { title: 'Birds are reptiles', notes: 'A made-up note.', base: { kind: 'classification', id: 'traditional', version: '1' }, moves: [{ node: 'c:aves', from: null, to: 'c:reptilia', note: 'A made-up move note.' }] } } })
  await api('PATCH', `/api/taxonomy-proposals/${made.json.doc.id}?depth=0`, { as: member, body: { status: 'shared' } })
  const firstView = (await api('GET', `/api/taxonomy-views/${views[0].id}?depth=0`, { as: curator })).json
  const draft = await api('POST', '/api/taxonomy-views?depth=0', { as: curator, body: { title: 'A draft view', snapshot: published.id, view: { ...firstView.view, id: 'draft-view', title: 'A draft view' } } })
  const jobs = (await api('GET', '/api/taxonomy-imports?depth=0', { as: curator })).json.docs
  const waiting = jobs.find((j) => j.status === 'queued')
  const broken = jobs.find((j) => j.status === 'failed')
  const same = await api('POST', '/api/taxonomy-imports?depth=0', { as: curator, body: { title: 'The same file again', format: 'csv', file: waiting?.file, settings: waiting?.settings } })
  check('made a shared proposal, a draft view and a second import job to look at', made.status === 201 && draft.status === 201 && same.status === 201 && Boolean(broken), { proposal: made.status, draft: draft.status, job: same.status, why: draft.json?.errors ?? same.json?.errors })

  browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--window-size=1300,1500', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--metrics-recording-only', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => {
    let text = ''
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 30_000)
    browser.stderr.on('data', (chunk) => {
      text += chunk
      const m = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
  })
  const ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('no connection to Chrome')), { once: true })
  })

  // What the pages did, as Chrome reports it.
  let next = 0
  const answers = new Map()
  const problems = [] // page errors, console errors and requests off the site
  const requests = [] // the pages' own calls to the site's API
  const editor = [] // Payload's code editor, fetched from jsDelivr
  const editorCancelled = []
  const readsByPost = new Set() // Payload reads some lists with a POST marked as a GET
  const writes = [] // writes to the snapshots collection, to look at what was sent
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    const sent = msg.method === 'Network.requestWillBeSent' ? msg.params.request : null
    if (msg.method === 'Runtime.exceptionThrown') {
      const what = msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text
      // The code editor says this when its page is left while it loads.
      if (/Canceled: Canceled/.test(what)) editorCancelled.push(what)
      else problems.push(`exception: ${what}`)
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)}`)
    if (sent) {
      const here = sent.url.replace(site, '')
      const marked = Boolean(sent.headers['X-Payload-HTTP-Method-Override'])
      if (sent.url.startsWith(site)) {
        if (here.includes('/api/') && !here.includes('/api/users') && !here.includes('payload-preferences')) requests.push(`${sent.method} ${here}`)
        if (sent.method === 'POST' && marked) readsByPost.add(`${sent.method} ${here}`)
        if (['PATCH', 'POST'].includes(sent.method) && /\/api\/taxonomy-snapshots(\/\w+)?(\?|$)/.test(sent.url) && !marked) writes.push({ id: msg.params.requestId, method: sent.method, url: here })
      } else if (sent.url.startsWith('https://cdn.jsdelivr.net/npm/monaco-editor@')) editor.push(sent.url)
      else if (!/^(data|about|blob):/.test(sent.url)) problems.push(`request off the site: ${sent.url}`)
    }
    // A question from the browser itself, such as "Leave site?" over a form with unsaved changes, holds every later
    // step until it is answered. Nothing here should raise one, so it counts as a problem, and is answered to go on.
    if (msg.method === 'Page.javascriptDialogOpening') {
      problems.push(`the browser asked: ${msg.params.type} ${JSON.stringify(msg.params.message.slice(0, 120))}`)
      ws.send(JSON.stringify({ id: (next += 1), method: 'Page.handleJavaScriptDialog', params: { accept: true }, sessionId: msg.sessionId }))
    }
    const waiter = answers.get(msg.id)
    if (!waiter) return
    clearTimeout(waiter.timer)
    answers.delete(msg.id)
    if (msg.error) waiter.reject(new Error(msg.error.message))
    else waiter.resolve(msg.result)
  })
  const raw = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = (next += 1)
      // A browser that stops answering ends the run with a failure, not a hang.
      const timer = setTimeout(() => answers.delete(id) && reject(new Error(`the browser didn't answer ${method} within 2 minutes`)), 120_000)
      answers.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  const { targetId } = await raw('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => raw(method, params, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')

  // What a person does: look, wait, go somewhere, click, press a key.
  const theme = (value) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] })
  const js = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text)
    return answer.result.value
  }
  const panelText = () => js(`document.querySelector('.onetaxonomy-panel')?.innerText ?? ''`)
  const until = async (expression, what, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await js(`!!(${expression})`).catch(() => false)) return true
      await sleep(250)
    }
    check(`waited for ${what}`, false, await js(`document.querySelector('.onetaxonomy-panel')?.innerText?.slice(0, 600) ?? document.body.innerText.slice(0, 600)`).catch(String))
    return false
  }
  const panelSays = (words, what, ms) => until(`document.querySelector('.onetaxonomy-panel')?.innerText.includes(${JSON.stringify(words)})`, what, ms)
  const go = async (pathname) => {
    await send('Page.navigate', { url: site + pathname })
    await sleep(500)
    await until(`document.readyState === 'complete'`, `${pathname} to load`)
  }
  const flushAt = []
  /** Looks at the page as it stands: notes any panel parts sitting flush against each other, and saves a screenshot. */
  const look = async (name) => {
    const parts = await flush()
    if (parts.length) flushAt.push({ at: name, parts })
    if (!shots) return
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'))
  }
  const button = (name, within) => `[...document.querySelectorAll(${JSON.stringify(`${within} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(name)})`
  const clickButton = (name, within = '.onetaxonomy-panel') => js(`(() => { const b = ${button(name, within)}; if (!b) return false; b.click(); return true })()`)
  const focusButton = (name, within = '.onetaxonomy-panel') => js(`(() => { const b = ${button(name, within)}; if (!b) return false; b.focus(); return true })()`)
  /** A real mouse press at the middle of an element, for Payload's own controls, which listen for one. */
  const clickAt = async (selector) => {
    const at = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    if (!at) return false
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
    return true
  }
  const key = async (name) => {
    const code = { Enter: 13, Escape: 27 }[name]
    const base = { key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    if (name === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }
  const type = (selector, value) => js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const focused = () => js(`(() => { const e = document.activeElement; return e ? (e.getAttribute('role') ?? e.tagName.toLowerCase()) + ':' + (e.getAttribute('aria-labelledby') ? document.getElementById(e.getAttribute('aria-labelledby'))?.textContent.slice(0, 40) : e.textContent.trim().slice(0, 40)) : '' })()`)
  const saveIsOff = () => js(`(() => { const b = document.querySelector('#action-save'); return b ? b.disabled || b.getAttribute('aria-disabled') === 'true' : null })()`)
  /** The panel's parts, and the gap above each one after the first, as the browser lays them out. */
  const flush = () => js(`[...document.querySelectorAll('.onetaxonomy-panel > *, .onetaxonomy-panel__block > *, .onetaxonomy-panel__live > *')].filter((e) => e.previousElementSibling && parseFloat(getComputedStyle(e).marginTop) + parseFloat(getComputedStyle(e).paddingTop) + parseFloat(getComputedStyle(e.previousElementSibling).marginBottom) < 3).map((e) => e.tagName.toLowerCase() + '.' + e.className + ': ' + e.textContent.trim().slice(0, 30))`)
  const linkTo = (label) => js(`[...document.querySelectorAll('.onetaxonomy-panel a')].find((a) => a.textContent.trim() === ${JSON.stringify(label)})?.getAttribute('href') ?? ''`)
  const snapshotPage = /^\/admin\/collections\/taxonomy-snapshots\/\w+$/

  // Sign in from the browser, so the cookie is the browser's own.
  await theme('light')
  await go('/admin/login')
  await until(`document.querySelector('input[name="email"], input#field-email')`, 'the sign-in form')
  const signedIn = await js(`fetch('/api/users/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'curator@example.org', password: ${JSON.stringify(password)} }) }).then((r) => r.status)`)
  check('the curator signs in from the browser', signedIn === 200, signedIn)

  // A staged snapshot, published with the keyboard.
  await go(`/admin/collections/taxonomy-snapshots/${staged.id}`)
  await panelSays('Staged', 'the snapshot panel')
  let text = await panelText()
  check('the snapshot panel shows status, counts and tables', text.includes('Staged') && /\d+ names/.test(text) && text.includes('Phylogenies'), text.slice(0, 400))
  await look('01-snapshot-staged')
  const bare = await js(`({ content: document.documentElement.innerHTML.includes('schemaVersion'), field: Boolean(document.querySelector('#field-snapshot, .json-field, .monaco-editor')), label: document.querySelector('#field-label')?.value ?? null })`)
  check('a stored snapshot\'s page is sent without its content, has no code editor, and asks nobody for one', bare.content === false && bare.field === false && editor.length === 0 && bare.label === 'fixture-structures 1', { ...bare, editor: editor.length })
  await focusButton('Publish this snapshot')
  await key('Enter')
  await sleep(300)
  check('Enter on the button opens the question and moves the focus to it', (await focused()).startsWith('group:Publish this snapshot?'), await focused())
  await key('Escape')
  await sleep(300)
  check('Escape closes it and returns the focus to the button', (await focused()) === 'button:Publish this snapshot', await focused())
  await key('Enter')
  await sleep(300)
  await look('02-snapshot-confirm')
  requests.length = 0
  await clickButton('Publish')
  await panelSays('This snapshot is published.', 'the snapshot to publish')
  await sleep(1500)
  text = await panelText()
  const formStatus = await js(`document.querySelector('#field-status')?.innerText ?? ''`)
  check('after publishing, the panel says Published and offers Withdraw', text.includes('Published') && text.includes('Withdraw this snapshot') && !text.includes('Publish this snapshot'), text.slice(0, 300))
  check('after publishing, Payload\'s own status field shows published and its form has nothing to save', /published/i.test(formStatus) && (await saveIsOff()) === true, { formStatus: formStatus.slice(0, 80), saveIsOff: await saveIsOff() })
  check('publishing sent one PATCH that asks for three fields back, then read the summary again', requests.filter((r) => r.startsWith('PATCH')).length === 1 && requests[0].includes('select[status]=true') && requests.some((r) => r.startsWith('GET') && r.endsWith('/summary')), requests)
  await look('03-snapshot-published')
  check('Payload follows the system theme: light', (await js(`document.documentElement.getAttribute('data-theme')`)) === 'light')
  await theme('dark')
  await go(`/admin/collections/taxonomy-snapshots/${staged.id}`)
  check('and dark, with the panel still there after a reload', await until(`document.documentElement.getAttribute('data-theme') === 'dark' && document.querySelector('.onetaxonomy-panel')?.innerText.includes('Published')`, 'the dark theme after a reload'))
  await sleep(500)
  await look('04-snapshot-published-dark')

  // A published view, and a draft one with an unsaved change.
  await go(`/admin/collections/taxonomy-views/${views[0].id}`)
  await until(`document.querySelector('.onetaxonomy-panel svg')`, 'the view panel drawing')
  text = await panelText()
  check('the view panel draws the saved view and offers Withdraw on a published one', text.includes('Published') && text.includes('Withdraw this view') && text.includes('The same tree as an outline'), text.slice(0, 300))
  await look('05-view-published-dark')
  const drawn = await js(`(() => { const s = document.querySelector('.onetaxonomy-figure svg'); return { shown: Math.round(s.getBoundingClientRect().width), own: Math.round(s.viewBox.baseVal.width) } })()`)
  check('a small tree is drawn at its own size, not blown up', drawn.shown === drawn.own, drawn)
  await theme('light')
  await go(`/admin/collections/taxonomy-views/${draft.json.doc.id}`)
  await until(`document.documentElement.getAttribute('data-theme') === 'light' && document.querySelector('.onetaxonomy-panel svg')`, 'the draft view panel drawing')
  await type('#field-title', 'A draft view, edited')
  await until(`${button('Publish this view', '.onetaxonomy-panel')}?.disabled === true`, 'Publish to wait for unsaved changes', 10_000)
  text = await panelText()
  check('with an unsaved change, Publish waits and says to save first', text.includes('Save your changes first.'), text.slice(0, 300))
  await look('06-view-draft-unsaved')
  await js(`document.querySelector('#action-save').click()`)
  await until(`document.querySelector('.onetaxonomy-panel [aria-label="Drawing of A draft view, edited"]') && ${button('Publish this view', '.onetaxonomy-panel')}?.disabled === false`, 'the view panel to follow Payload\'s Save', 20_000)
  text = await panelText()
  check('after Payload\'s own Save the view panel shows the saved title and offers Publish again', !text.includes('Save your changes first.') && (await js(`Boolean(document.querySelector('.onetaxonomy-panel [aria-label="Drawing of A draft view, edited"]'))`)) === true, text.slice(0, 300))

  // The import jobs: one waiting, one that failed, and one over a file that was imported already.
  const release1 = JSON.parse(fixture('checklist.json'))
  await go(`/admin/collections/taxonomy-imports/${waiting.id}`)
  await panelSays('Run this import', 'the import panel')
  text = await panelText()
  check('a waiting job says Queued, shows four steps not yet done, and offers to run', text.includes('Queued') && text.includes('It hasn’t run yet.') && (text.match(/not yet/g) ?? []).length === 4 && !text.includes('Runs started'), text.slice(0, 400))
  await look('07-import-queued')
  requests.length = 0
  await focusButton('Run this import')
  await key('Enter')
  await panelSays('The import finished and stored a staged snapshot.', 'the import to finish')
  await sleep(1500)
  text = await panelText()
  const storedLink = await linkTo('Open the staged snapshot this job stored')
  check('running it by keyboard ends at Done, with every step done, the snapshot\'s checksum and a link to it', text.includes('Done') && (text.match(/\bdone\b/g) ?? []).length >= 4 && text.includes(release1.checksum) && snapshotPage.test(storedLink) && !text.includes('Run this import') && !text.includes('Run it again'), { storedLink, text: text.slice(0, 500) })
  check('running it sent one POST, and the page\'s own form has nothing to save', requests.filter((r) => r.startsWith('POST') && !readsByPost.has(r)).length === 1 && requests.some((r) => r.endsWith('/run')) && (await saveIsOff()) === true, { requests, saveIsOff: await saveIsOff() })
  const copies = await js(`Object.fromEntries(['message', 'checksum', 'inputSha256', 'diagnostics', 'warnings', 'warningCount', 'progress'].map((n) => { const e = document.querySelector('#field-' + n); return [n, e ? e.type + ':' + String(e.value).slice(0, 80) : null] }))`)
  check('the form below the panel doesn\'t show the result a second time, and still holds it after the run', Object.values(copies).every((v) => typeof v === 'string' && v.startsWith('hidden:')) && copies.checksum === `hidden:${release1.checksum}` && copies.message.length > 'hidden:'.length, copies)
  await look('08-import-done')
  await go(storedLink)
  await panelSays('Staged', 'the imported snapshot\'s panel')
  const imported = await js(`({ label: document.querySelector('#field-label')?.value ?? null, checksum: document.querySelector('#field-checksum')?.value ?? null })`)
  text = await panelText()
  check('its link opens the staged snapshot, with the checksum of fixtures/checklist.json', imported.label === 'fixture-checklist 1' && imported.checksum === release1.checksum && text.includes(`${Object.keys(release1.names).length} names`), { imported, text: text.slice(0, 300) })
  await look('09-import-snapshot')

  await go(`/admin/collections/taxonomy-imports/${broken.id}`)
  await panelSays('Run it again', 'the failed import\'s panel')
  text = await panelText()
  const logOpen = await js(`[...document.querySelectorAll('.onetaxonomy-panel details')].find((d) => d.querySelector('summary')?.textContent.trim() === 'Progress log')?.open ?? null`)
  check('a failed job says Failed, what stopped it and where it stopped, with its log open', text.includes('Failed') && text.includes('What stopped it') && text.includes('Missing required column') && text.includes('stopped here') && logOpen === true && /Runs started\s+1\b/.test(text), { logOpen, text: text.slice(0, 500) })
  await look('10-import-failed')
  await clickButton('Run it again')
  await panelSays('The import stopped.', 'the failed import to stop again')
  await sleep(1500)
  text = await panelText()
  check('running it again fails the same way, says so, and still offers to run', text.includes('Failed') && text.includes('Missing required column') && /Runs started\s+2\b/.test(text) && text.includes('Run it again') && !(await linkTo('Open the staged snapshot this job stored')), text.slice(0, 500))

  await go(`/admin/collections/taxonomy-imports/${same.json.doc.id}`)
  await panelSays('Run this import', 'the second job\'s panel')
  await clickButton('Run this import')
  await panelSays('This file with these settings was imported before.', 'the second job to find the snapshot')
  await sleep(1500)
  text = await panelText()
  check('a job over the same file and settings ends at Already imported and links to the same snapshot', text.includes('Already imported') && (await linkTo('Open the staged snapshot this job found')) === storedLink, { link: await linkTo('Open the staged snapshot this job found'), text: text.slice(0, 300) })
  await look('11-import-already')
  await type('#field-title', 'The same file again, renamed')
  await until(`(() => { const b = document.querySelector('#action-save'); return b && !b.disabled })()`, 'Save to wake after the title changed', 10_000)
  await clickAt('#action-save')
  await until(`(() => { const b = document.querySelector('#action-save'); return b && (b.disabled || b.getAttribute('aria-disabled') === 'true') })()`, 'Payload\'s Save on a finished job', 20_000)
  await sleep(1000)
  const renamed = await api('GET', `/api/taxonomy-imports/${same.json.doc.id}?depth=0`, { as: curator })
  text = await panelText()
  check('Payload\'s own Save renames a finished job and leaves its result as it was', renamed.json?.title === 'The same file again, renamed' && renamed.json?.status === 'already-imported' && renamed.json?.checksum === release1.checksum && renamed.json?.attempts === 1 && text.includes('Already imported'), { title: renamed.json?.title, status: renamed.json?.status, checksum: renamed.json?.checksum, attempts: renamed.json?.attempts, text: text.slice(0, 200) })

  // A shared proposal, accepted into a new version.
  await go(`/admin/collections/taxonomy-proposals/${made.json.doc.id}`)
  await panelSays('Accept this proposal', 'the proposal panel')
  text = await panelText()
  check('the proposal panel shows the change in names and the author\'s handle beside the id', text.includes('Aves') && text.includes('Morgan Member') && text.includes('Shared'), text.slice(0, 500))
  await look('12-proposal-shared')
  await clickButton('Accept this proposal')
  await sleep(300)
  const heldBack = await js(`${button('Accept into a new version', '.onetaxonomy-confirm')}?.disabled`)
  await type('.onetaxonomy-confirm input', '2')
  await sleep(300)
  await look('13-proposal-accept-confirm')
  const warned = (await panelText()).includes('These are sealed into the new version and can’t be taken out later')
  check('accepting waits for a version name and warns what is sealed', heldBack === true && warned, { heldBack, warned })
  requests.length = 0
  await clickButton('Accept into a new version', '.onetaxonomy-confirm')
  await panelSays('Accepted into the new staged version 2', 'the proposal to be accepted')
  await sleep(1500)
  text = await panelText()
  const acceptedLink = await linkTo('Open the new snapshot')
  check('after accepting: Accepted, no decide buttons, and a link to the new snapshot in the admin', text.includes('Accepted') && !text.includes('Accept this proposal') && snapshotPage.test(acceptedLink), { acceptedLink, text: text.slice(0, 300) })
  check('accepting sent one POST of its own', requests.filter((r) => r.startsWith('POST') && !readsByPost.has(r)).length === 1 && requests.some((r) => r.endsWith('/accept')), { requests, readsByPost: [...readsByPost] })
  await look('14-proposal-accepted')
  await go(acceptedLink)
  await panelSays('by accepting a proposal', 'the new snapshot\'s panel')
  text = await panelText()
  check('the new snapshot\'s panel shows who proposed and accepted, by id with the handle looked up', text.includes('Morgan Member') && text.includes('Cara Curator') && text.includes('The ids are sealed in this snapshot.'), text.slice(0, 600))
  await look('15-snapshot-from-proposal')

  // A new snapshot, pasted into Payload's own form, then published with Payload's own status field and Save.
  const postData = async (w) => (await send('Network.getRequestPostData', { requestId: w.id }).catch(() => ({ postData: '' }))).postData ?? ''
  const pasted = fixture('checklist-v2.json')
  const sealed = JSON.parse(pasted)
  await go('/admin/collections/taxonomy-snapshots/create')
  await until(`document.querySelector('#field-snapshot') || document.querySelector('.json-field')`, 'the new-snapshot form')
  const hasEditor = await until(`window.monaco?.editor?.getModels?.().length > 0`, 'Payload\'s code editor on the new-snapshot form (it loads from cdn.jsdelivr.net, so this needs the network)')
  check('the new-snapshot form has the field to paste into, and no panel yet', hasEditor && (await js(`Boolean(document.querySelector('.json-field .monaco-editor'))`)) === true && (await panelText()) === '', { panel: await panelText() })
  await look('16-snapshot-create')
  await js(`window.monaco.editor.getModels()[0].setValue(${JSON.stringify(pasted)})`)
  await sleep(1000)
  writes.length = 0
  await clickAt('#action-save')
  await until(`/\\/admin\\/collections\\/taxonomy-snapshots\\/[0-9a-f]{24}$/.test(location.pathname)`, 'the new snapshot to be stored and its page opened')
  await panelSays('Staged', 'the new snapshot\'s panel')
  const createdPath = await js(`location.pathname`)
  const created = createdPath.split('/').pop()
  text = await panelText()
  const afterCreate = await js(`({ content: document.documentElement.innerHTML.includes('schemaVersion'), field: Boolean(document.querySelector('#field-snapshot, .json-field, .monaco-editor')), label: document.querySelector('#field-label')?.value ?? null, checksum: document.querySelector('#field-checksum')?.value ?? null })`)
  check('pasting a sealed snapshot and pressing Save stores it and opens its page, with the panel and no editor', writes.length === 1 && writes[0].method === 'POST' && text.includes('Staged') && afterCreate.field === false && afterCreate.label === 'fixture-checklist 2' && afterCreate.checksum === sealed.checksum, { writes, afterCreate, text: text.slice(0, 200) })
  check('the page the form lands on after storing holds no snapshot content', afterCreate.content === false, afterCreate)
  await look('17-snapshot-created')
  const stored = await api('GET', `/api/taxonomy-snapshots/${created}?depth=0&select[snapshot]=true&select[status]=true`, { as: curator })
  check('what was stored is what was pasted: the same checksum and the same names', stored.json?.snapshot?.checksum === sealed.checksum && stored.json?.status === 'staged' && Object.keys(stored.json?.snapshot?.names ?? {}).length === Object.keys(sealed.names).length, { status: stored.status, got: stored.json?.snapshot?.checksum })

  await go(createdPath)
  await panelSays('Staged', 'the stored snapshot\'s panel after a reload')
  await sleep(1500)
  await clickAt('#field-status .rs__control')
  await until(`document.querySelectorAll('.rs__option').length > 0`, 'the status options', 10_000)
  await js(`[...document.querySelectorAll('.rs__option')].find((o) => /^published$/i.test(o.textContent.trim()))?.setAttribute('data-pick', '1')`)
  await clickAt('.rs__option[data-pick="1"]')
  await until(`(() => { const b = document.querySelector('#action-save'); return b && !b.disabled })()`, 'Save to wake after the status changed', 10_000)
  text = await panelText()
  check('with the status changed in Payload\'s field and not saved, the panel still shows what is stored', text.includes('Staged') && text.includes('Publish this snapshot'), text.slice(0, 300))
  writes.length = 0
  await clickAt('#action-save')
  await panelSays('Published', 'Payload\'s Save to publish the snapshot')
  await sleep(1500)
  const sentBodies = []
  for (const w of writes) {
    const body = await postData(w)
    sentBodies.push({ method: w.method, url: w.url, length: body.length, content: /schemaVersion|"snapshot"\s*:/.test(body), status: /published/.test(body) })
  }
  const afterSave = await api('GET', `/api/taxonomy-snapshots/${created}?depth=0&select[snapshot]=true&select[status]=true&select[publishedBy]=true`, { as: curator })
  text = await panelText()
  check('Payload\'s own Save publishes it: one PATCH that carries the status and no snapshot content', sentBodies.length === 1 && sentBodies[0].method === 'PATCH' && sentBodies[0].content === false && sentBodies[0].status === true && sentBodies[0].length < 4000, sentBodies)
  check('after that Save the stored content is untouched, the status is published, and the panel says so', afterSave.json?.status === 'published' && afterSave.json?.snapshot?.checksum === sealed.checksum && Boolean(afterSave.json?.publishedBy) && text.includes('Published') && text.includes('Withdraw this snapshot'), { status: afterSave.json?.status, checksum: afterSave.json?.snapshot?.checksum, by: afterSave.json?.publishedBy, text: text.slice(0, 200) })
  await look('18-snapshot-saved-by-payload')

  await go('/admin/collections/taxonomy-snapshots')
  await until(`document.querySelectorAll('table tbody tr').length >= 3`, 'the list of snapshots')
  check('the list of snapshots in the admin is sent without any snapshot\'s content', (await js(`document.documentElement.innerHTML.includes('schemaVersion')`)) === false)
  const listed = await js(`document.querySelector('table')?.innerText ?? ''`)
  check('and still names each snapshot by its label, which the form no longer shows', listed.includes('fixture-amniotes 1') && listed.includes('fixture-checklist 2'), listed.slice(0, 400))

  check('on every page looked at, the panel\'s parts are spaced apart, as the browser lays them out', flushAt.length === 0, flushAt.slice(0, 6))
  check('no page error, console error or request off the site, apart from Payload\'s code editor', problems.length === 0, problems.slice(0, 8))
  console.log(`     Payload's code editor was fetched from cdn.jsdelivr.net in ${editor.length} requests${editorCancelled.length ? `, and said a load was cancelled ${editorCancelled.length} times when its page was left` : ''}.`)
  ws.close()
} catch (error) {
  check('the click-through ran to the end', false, String(error?.stack ?? error))
} finally {
  if (browser) {
    browser.kill()
    await finished(browser)
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  server.kill('SIGTERM')
  await finished(server)
}

if (failed) console.log(`\nThe site's last output:\n${log.slice(-3000)}`)
console.log(`\n${passed} passed, ${failed} failed.${shots ? ` Screenshots are in ${shots}.` : ''}`)
process.exit(failed ? 1 : 0)
