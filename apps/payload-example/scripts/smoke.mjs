#!/usr/bin/env node
// Starts the example site on a free port with a throwaway database, then checks it the way a browser would:
// over HTTP, with sign-in cookies. Exits 0 when every check passes.
//
//   node scripts/smoke.mjs              build, then run the built site (what `pnpm smoke` does)
//   node scripts/smoke.mjs --skip-build run the site built last time
//   node scripts/smoke.mjs --dev        run `next dev` instead of a build
//
// It makes one more account and one proposal, so it always starts its own site and never checks one you have open.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifySnapshot } from '@extantape/onetaxonomy-core'

const flags = new Set(process.argv.slice(2))
const unknown = [...flags].filter((f) => !['--dev', '--skip-build'].includes(f))
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(' ')}\nUsage: node scripts/smoke.mjs [--dev | --skip-build]`)
  process.exit(2)
}
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runner = path.join(app, 'scripts', 'run.mjs')

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const run = (args, env, quiet) => spawn(process.execPath, [runner, ...args], { cwd: app, env, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
const finished = (child) => new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(child.exitCode) : child.once('exit', (code) => resolve(code))))

const port = await freePort()
const site = `http://localhost:${port}`
const password = randomBytes(12).toString('base64url')
// DATABASE_URI and EXAMPLE_UPLOADS are cleared so the checks never run against a database or a folder you named for
// something else.
const env = { ...process.env, PORT: String(port), EXAMPLE_URL: site, EXAMPLE_PASSWORD: password, DATABASE_URI: '', EXAMPLE_UPLOADS: '' }

if (!flags.has('--dev') && !flags.has('--skip-build')) {
  const started = Date.now()
  const code = await finished(run(['build'], env, false))
  if (code !== 0) {
    console.error('The build failed, so nothing was checked.')
    process.exit(1)
  }
  console.log(`Built in ${Math.round((Date.now() - started) / 1000)} s.`)
}

const server = run([flags.has('--dev') ? 'dev' : 'start'], env, true)
let log = ''
// The throwaway folder the site keeps uploaded files in, as it says when it starts.
let uploads = null
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk) => {
    log = (log + chunk).slice(-20_000)
    uploads ??= log.match(/^Uploads: (.+) \(deleted when this stops\)$/m)?.[1] ?? null
  })
const fixture = (name) => readFileSync(path.join(app, '../../fixtures', name))

let failed = 0
let passed = 0
function check(name, ok, detail) {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : `\n       ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

/**
 * One request. `as` is a signed-in person's cookie. `origin` is the page the request says it comes from; browsers
 * send it on writes. On reads they send `Sec-Fetch-Site` instead, so a request with a cookie and no `origin` says
 * `same-origin` unless `from` says otherwise (`null` sends neither, like a script that isn't a browser).
 */
async function call(method, pathname, { as, origin, from = 'same-origin', body } = {}) {
  const res = await fetch(site + pathname, {
    method,
    redirect: 'manual',
    headers: { ...(as ? { Cookie: as } : {}), ...(origin ? { Origin: origin } : as && from ? { 'Sec-Fetch-Site': from } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // Not JSON: a page.
  }
  return { status: res.status, text, json, res }
}
const get = (pathname, as) => call('GET', pathname, { as })

/** Uploads a file the way Payload's admin does: a form with the file and the document's other fields as JSON. */
async function upload(name, bytes, type, as) {
  const form = new FormData()
  form.set('file', new Blob([bytes], { type }), name)
  form.set('_payload', '{}')
  const res = await fetch(`${site}/api/sources?depth=0`, { method: 'POST', redirect: 'manual', headers: { ...(as ? { Cookie: as } : {}), Origin: site }, body: form, signal: AbortSignal.timeout(120_000) })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function signIn(email) {
  const { status, res } = await call('POST', '/api/users/login', { body: { email, password } })
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('payload-token='))
  check(`${email} signs in and gets a cookie that scripts can't read`, status === 200 && Boolean(cookie) && /;\s*HttpOnly/i.test(cookie ?? ''), { status })
  return cookie ? cookie.split(';')[0] : ''
}

async function checks() {
  // Public pages.
  const home = await get('/')
  const links = [...home.text.matchAll(/href="(\/views\/[^"]+)"/g)].map((m) => m[1])
  check('the home page lists the two published views', home.status === 200 && links.length === 2 && home.text.includes('Amniotes: one tree hypothesis') && home.text.includes('Amniotes: the traditional classes'), { status: home.status, links })
  for (const link of links) {
    const page = await get(link)
    const svgs = (page.text.match(/<svg[\s>]/g) ?? []).length
    check(`${link} draws one SVG tree, with its outline, what it leaves out and its sources`, page.status === 200 && svgs === 1 && page.text.includes('role="tree"') && page.text.includes('Illustrative data') && page.text.includes('<h2>Sources</h2>'), { status: page.status, svgs })
  }
  check('a view that does not exist is "not found"', (await get('/views/000000000000000000000000')).status === 404 && (await get('/views/nothing-here')).status === 404)

  // What a visitor who isn't signed in may read through the API.
  const publicSnaps = await get('/api/taxonomy-snapshots?depth=0')
  const published = publicSnaps.json?.docs ?? []
  check('a visitor sees the published snapshot and not the staged one', publicSnaps.status === 200 && published.length === 1 && published[0].snapshotId === 'fixture-amniotes' && published[0].status === 'published', published.map((d) => [d.snapshotId, d.status]))
  const snap = published[0]?.id
  // A snapshot's content comes only when it is asked for by name; the list and a plain read leave it out.
  const plain = await get(`/api/taxonomy-snapshots/${snap}?depth=0`)
  const named = await get(`/api/taxonomy-snapshots/${snap}?depth=0&select[snapshot]=true`)
  check('a list and a plain read of a snapshot leave its content out, and a read that selects it gets it', plain.status === 200 && plain.json?.checksum === published[0]?.checksum && !('snapshot' in plain.json) && !publicSnaps.text.includes('schemaVersion') && !plain.text.includes('schemaVersion') && named.json?.snapshot?.checksum === published[0]?.checksum && named.json?.snapshot?.concepts?.length > 0, { plain: plain.text.length, list: publicSnaps.text.length, named: named.text.length })
  const search = await get(`/api/taxonomy-snapshots/${snap}/search?q=aves`)
  check('a visitor can search the published snapshot', search.status === 200 && JSON.stringify(search.json).includes('Aves'), { status: search.status })
  const viewId = links[0]?.split('/').pop()
  check('a visitor can read a published view\'s projection', (await get(`/api/taxonomy-views/${viewId}/projection`)).status === 200)
  const gql = await call('POST', '/api/graphql', { body: { query: '{ TaxonomySnapshots { docs { snapshotId status } } }' } })
  const gqlDocs = gql.json?.data?.TaxonomySnapshots?.docs
  check('GraphQL shows a visitor the same one snapshot', gql.status === 200 && Array.isArray(gqlDocs) && gqlDocs.length === 1 && gqlDocs[0].snapshotId === 'fixture-amniotes', gql.json ?? gql.status)

  // What a visitor may not do.
  check('a visitor cannot store a snapshot', (await call('POST', '/api/taxonomy-snapshots', { body: { snapshot: {} } })).status === 403)
  check('a visitor cannot make a proposal', (await call('POST', '/api/taxonomy-proposals', { body: { snapshot: snap, proposal: {} } })).status === 403)
  const anonUsers = await get('/api/users')
  check('a visitor cannot list the accounts', anonUsers.status === 403 || (anonUsers.json?.docs ?? []).length === 0, { status: anonUsers.status })
  const anonProposals = await get('/api/taxonomy-proposals')
  check('a visitor sees no proposals', anonProposals.status === 403 || (anonProposals.json?.docs ?? []).length === 0, { status: anonProposals.status })

  // Sign-in.
  const member = await signIn('member@example.org')
  const curator = await signIn('curator@example.org')
  check('a wrong password is refused', (await call('POST', '/api/users/login', { body: { email: 'member@example.org', password: 'not-the-password' } })).status === 401)
  const me = (await get('/api/users/me', member)).json?.user
  check('the member\'s cookie is the member', me?.email === 'member@example.org' && me?.role === 'member', me && { email: me.email, role: me.role })

  const meFrom = async (from) => (await call('GET', '/api/users/me', { as: member, from })).json?.user ?? null
  check('the cookie counts for nothing on a read from another site, or with no word on where it came from', (await meFrom('cross-site')) === null && (await meFrom(null)) === null)

  // Accounts: nobody raises their own role, and a member sees only themself.
  await call('PATCH', `/api/users/${me?.id}`, { as: member, origin: site, body: { role: 'curator' } })
  check('a member cannot make themself a curator', (await get('/api/users/me', member)).json?.user?.role === 'member')
  const seenByMember = (await get('/api/users?depth=0', member)).json?.docs ?? []
  check('a member sees only their own account', seenByMember.length === 1 && seenByMember[0].email === 'member@example.org', seenByMember.map((u) => u.handle))
  const admin = async (as) => (await get('/api/access', as)).json?.canAccessAdmin
  const open = { curator: await admin(curator), member: await admin(member), visitor: await admin(undefined) }
  check('the admin is open to the curator and closed to the member and to a visitor', open.curator === true && !open.member && !open.visitor, open)
  const loginPage = await get('/admin/login')
  check('the admin sign-in page loads', loginPage.status === 200 && /<html/i.test(loginPage.text), { status: loginPage.status })
  const dashboard = await get('/admin', curator)
  check('the admin loads for the curator', dashboard.status === 200 && dashboard.text.includes('taxonomy-snapshots'), { status: dashboard.status })
  const refused = await get('/admin', member)
  check('the admin sends the member to its "unauthorized" page', refused.status >= 300 && refused.status < 400 && (refused.res.headers.get('location') ?? '').endsWith('/admin/unauthorized'), { status: refused.status, to: refused.res.headers.get('location') })

  // Staged work is the curator's.
  const allSnaps = (await get('/api/taxonomy-snapshots?depth=0', curator)).json?.docs ?? []
  const staged = allSnaps.find((d) => d.status === 'staged')
  check('the curator sees the staged snapshot too', allSnaps.length === 2 && Boolean(staged), allSnaps.map((d) => [d.snapshotId, d.status]))
  for (const [who, as] of [['a visitor', undefined], ['the member', member]]) {
    check(`${who} gets "not found" for the staged snapshot and its export`, (await get(`/api/taxonomy-snapshots/${staged?.id}`, as)).status === 404 && (await get(`/api/taxonomy-snapshots/${staged?.id}/export`, as)).status === 404)
  }

  // A proposal, from a signed-in page of this site.
  const draft = { title: 'Birds are reptiles', base: { kind: 'classification', id: 'traditional', version: '1' }, moves: [{ node: 'c:aves', from: null, to: 'c:reptilia' }] }
  const elsewhere = await call('POST', '/api/taxonomy-proposals?depth=0', { as: member, origin: 'https://elsewhere.example', body: { snapshot: snap, proposal: draft } })
  check('the member\'s cookie sent from another site counts for nothing', elsewhere.status === 403, { status: elsewhere.status })
  const made = await call('POST', '/api/taxonomy-proposals?depth=0', { as: member, origin: site, body: { snapshot: snap, proposal: { ...draft, author: 'Somebody Else' } } })
  const proposal = made.json?.doc
  check('the member\'s proposal is stored private, under their account\'s id, with their handle shown beside it', made.status === 201 && proposal?.status === 'private' && Boolean(me?.id) && proposal?.proposal?.author === String(me?.id) && proposal?.authorName === 'Morgan Member', made.json?.errors ?? { status: made.status, author: proposal?.proposal?.author, authorName: proposal?.authorName })
  check('the stored proposal does not hold the member\'s email address', Boolean(proposal) && !JSON.stringify(proposal).includes('@example.org'))
  check('a private proposal is not there for the curator', (await get(`/api/taxonomy-proposals/${proposal?.id}/preview`, curator)).status === 404)
  const shared = await call('PATCH', `/api/taxonomy-proposals/${proposal?.id}?depth=0`, { as: member, origin: site, body: { status: 'shared' } })
  check('the member shares it', shared.status === 200 && shared.json?.doc?.status === 'shared', { status: shared.status })
  check('a shared proposal is still not there for a visitor', (await get(`/api/taxonomy-proposals/${proposal?.id}/preview`)).status === 404)

  // A second member, made by the curator, reads the shared proposal without learning the author's email address.
  const second = await call('POST', '/api/users', { as: curator, origin: site, body: { email: 'second@example.org', password, handle: 'Sam Second', role: 'member' } })
  check('the curator adds an account', second.status === 201 && second.json?.doc?.role === 'member', second.json?.errors ?? { status: second.status })
  const sam = await signIn('second@example.org')
  const seenBySam = await get(`/api/taxonomy-proposals/${proposal?.id}`, sam)
  check('another member reads the shared proposal with the author\'s handle, and without their email address', seenBySam.status === 200 && seenBySam.json?.authorName === 'Morgan Member' && !seenBySam.text.includes('member@example.org'), { status: seenBySam.status, authorName: seenBySam.json?.authorName })
  const checksum = shared.json?.doc?.checksum
  for (const [who, as] of [['its author', member], ['another member', sam]]) {
    check(`${who} cannot accept it`, (await call('POST', `/api/taxonomy-proposals/${proposal?.id}/accept`, { as, origin: site, body: { version: '2', checksum } })).status === 404)
  }

  // The curator previews and accepts: a new staged version, sealed, recording both people by id and neither by name.
  const curatorId = (await get('/api/users/me', curator)).json?.user?.id
  const preview = await get(`/api/taxonomy-proposals/${proposal?.id}/preview`, curator)
  check('the curator previews it and it can be accepted', preview.status === 200 && preview.json?.acceptable === true, preview.json?.problems ?? { status: preview.status })
  const accepted = await call('POST', `/api/taxonomy-proposals/${proposal?.id}/accept`, { as: curator, origin: site, body: { version: '2', checksum } })
  const next = accepted.json?.snapshot
  check('accepting makes version 2, staged', accepted.status === 200 && accepted.json?.proposal?.status === 'accepted' && next?.version === '2' && next?.status === 'staged', accepted.json ?? { status: accepted.status })
  const content = (await get(`/api/taxonomy-snapshots/${next?.doc}/export`, curator)).json
  check('version 2 is sealed and its checksum holds', Boolean(content) && verifySnapshot(content))
  const record = content?.derivedFrom?.proposal
  check('version 2 records the proposer and the curator by id', Boolean(me?.id) && Boolean(curatorId) && record?.author === String(me?.id) && record?.acceptedBy === String(curatorId), record)
  const sealed = JSON.stringify(content ?? '')
  check('version 2 holds no handle and no email address', Boolean(content) && !sealed.includes('Morgan Member') && !sealed.includes('Cara Curator') && !sealed.includes('@example.org'))
  // The handle is looked up when shown: a new one shows at once, and nothing sealed changes.
  await call('PATCH', `/api/users/${me?.id}`, { as: curator, origin: site, body: { handle: 'Morgan Renamed' } })
  const renamed = await get(`/api/taxonomy-proposals/${proposal?.id}`, sam)
  const again = (await get(`/api/taxonomy-snapshots/${next?.doc}/export`, curator)).json
  check('a changed handle shows on the accepted proposal at once, and version 2 is unchanged', renamed.json?.authorName === 'Morgan Renamed' && Boolean(content?.checksum) && again?.checksum === content?.checksum && verifySnapshot(again), { authorName: renamed.json?.authorName })
  check('version 2 is not public until the curator publishes it', (await get(`/api/taxonomy-snapshots/${next?.doc}/export`)).status === 404 && ((await get('/api/taxonomy-snapshots?depth=0')).json?.docs ?? []).length === 1)
  for (const [who, as] of [['its author', member], ['the curator', curator]]) {
    check(`an accepted proposal can't be deleted by ${who}`, (await call('DELETE', `/api/taxonomy-proposals/${proposal?.id}`, { as, origin: site })).status >= 400)
  }
  check('the accepted proposal is still there', (await get(`/api/taxonomy-proposals/${proposal?.id}?depth=0`, member)).json?.status === 'accepted')

  // The admin panels: on the curator's edit pages, and the addresses they call. No browser runs here, so this
  // checks that each page carries its panel and that the site answers the panel's requests, not a click.
  for (const [what, pathname] of [['snapshot', `taxonomy-snapshots/${next?.doc}`], ['view', `taxonomy-views/${viewId}`], ['proposal', `taxonomy-proposals/${proposal?.id}`]]) {
    const page = await get(`/admin/collections/${pathname}`, curator)
    check(`the curator's ${what} page in the admin carries the plugin's panel`, page.status === 200 && page.text.includes('onetaxonomy-panel'), { status: page.status })
    // The stored snapshot can be 15 MB. Its page must not carry it, in the form or anywhere else in what is sent.
    if (what === 'snapshot') check('the snapshot\'s admin page is sent without the snapshot\'s content and without the field for it', !page.text.includes('schemaVersion') && !page.text.includes('id="field-snapshot"'), { length: page.text.length, content: page.text.includes('schemaVersion'), field: (page.text.match(/.{60}id="field-snapshot".{60}/) ?? [])[0] })
  }
  const blank = await get('/admin/collections/taxonomy-snapshots/create', curator)
  check('the new-snapshot form in the admin still has the field to paste one into', blank.status === 200 && blank.text.includes('id="field-snapshot"'), { status: blank.status })
  const summary = await get(`/api/taxonomy-snapshots/${next?.doc}/summary`, curator)
  const from = summary.json?.derivedFrom?.proposal
  check('version 2\'s summary shows the curator both people by id, with their handles looked up beside them', summary.status === 200 && from?.author === String(me?.id) && from?.authorName === 'Morgan Renamed' && from?.acceptedBy === String(curatorId) && from?.acceptedByName === 'Cara Curator', from ?? { status: summary.status })
  check('the staged version\'s summary is "not found" for a visitor and for the member', (await get(`/api/taxonomy-snapshots/${next?.doc}/summary`)).status === 404 && (await get(`/api/taxonomy-snapshots/${next?.doc}/summary`, member)).status === 404)
  // Publishing the way the panel does: one PATCH that asks for three fields back.
  const asPanel = `/api/taxonomy-snapshots/${next?.doc}?depth=0&select[status]=true&select[publishedBy]=true&select[publishedAt]=true`
  check('the member cannot publish version 2', (await call('PATCH', asPanel, { as: member, origin: site, body: { status: 'published' } })).status >= 400 && (await get(`/api/taxonomy-snapshots/${next?.doc}/summary`, curator)).json?.snapshot?.status === 'staged')
  const publishing = await call('PATCH', asPanel, { as: curator, origin: site, body: { status: 'published' } })
  const answered = publishing.json?.doc
  check('the curator publishes version 2, and the answer holds the fields asked for and not the snapshot\'s content', publishing.status === 200 && answered?.status === 'published' && Boolean(answered?.publishedAt) && !('snapshot' in answered) && publishing.text.length < 2000, { status: publishing.status, keys: answered && Object.keys(answered), length: publishing.text.length })
  const publicSummary = await get(`/api/taxonomy-snapshots/${next?.doc}/summary`)
  const publicFrom = publicSummary.json?.derivedFrom?.proposal
  await imports({ member, curator })
  check('a visitor now reads version 2\'s summary, with the ids and no names', publicSummary.status === 200 && publicFrom?.author === String(me?.id) && !('authorName' in publicFrom) && !('acceptedByName' in publicFrom) && !publicSummary.text.includes('Morgan') && !publicSummary.text.includes('Cara') && !publicSummary.text.includes('@example.org'), publicFrom ?? { status: publicSummary.status })
}

/** Imports: source files and jobs are the curator's, a job waits until it is run, and the same file gives the same snapshot. */
async function imports({ member, curator }) {
  const run = (id, as) => call('POST', `/api/taxonomy-imports/${id}/run`, { as, origin: site })
  const snapshots = async () => ((await get('/api/taxonomy-snapshots?depth=0&limit=100', curator)).json?.docs ?? []).length
  const jobs = (await get('/api/taxonomy-imports?depth=0', curator)).json?.docs ?? []
  const waiting = jobs.find((j) => j.status === 'queued')
  const broken = jobs.find((j) => j.status === 'failed')
  check('the curator sees the two seeded import jobs: one waiting, and one that failed and says why', jobs.length === 2 && Boolean(waiting) && waiting.attempts === 0 && Boolean(broken) && !broken.snapshot && /Missing required column/.test(broken.diagnostics?.[0]?.message ?? ''), jobs.map((j) => [j.title, j.status, j.message]))
  const files = (await get('/api/sources?depth=0', curator)).json?.docs ?? []
  const first = files.find((f) => f.filename === 'checklist.csv')
  // Payload gives a file's address with the site in front; `get` wants the path.
  const address = first?.url ? first.url.replace(site, '') : '/api/sources/file/checklist.csv'
  check('the curator reads the seeded source file back, byte for byte', address.startsWith('/api/sources/file/') && (await get(address, curator)).text === String(fixture('checklist.csv')), files.map((f) => [f.filename, f.url]))
  for (const [who, as] of [['a visitor', undefined], ['the member', member]]) {
    const seen = { files: (await get('/api/sources?depth=0', as)).status, file: (await get(address, as)).status, jobs: (await get('/api/taxonomy-imports?depth=0', as)).status, job: (await get(`/api/taxonomy-imports/${waiting?.id}`, as)).status, run: (await run(waiting?.id, as)).status, upload: (await upload('mine.csv', 'id,name\n', 'text/csv', as)).status }
    check(`${who} is refused the source files, a file by its address, the import jobs, running one, and uploading`, Object.values(seen).every((status) => status === 403 || status === 404), seen)
  }
  check('nobody but the curator ran the waiting job or added a file', (await get(`/api/taxonomy-imports/${waiting?.id}?depth=0`, curator)).json?.status === 'queued' && ((await get('/api/sources?depth=0', curator)).json?.docs ?? []).length === files.length)
  const page = await get(`/admin/collections/taxonomy-imports/${waiting?.id}`, curator)
  check('the curator\'s import job page in the admin carries the plugin\'s panel', page.status === 200 && page.text.includes('onetaxonomy-panel'), { status: page.status })

  // Running the waiting job gives the committed fixture, checksum and all, staged.
  const release1 = JSON.parse(fixture('checklist.json'))
  const before = await snapshots()
  const ran = await run(waiting?.id, curator)
  const made = (await get(`/api/taxonomy-snapshots/${ran.json?.snapshot}?depth=0`, curator)).json
  check('the curator runs the waiting job: a staged snapshot with the checksum of fixtures/checklist.json', ran.status === 200 && ran.json?.status === 'done' && ran.json?.checksum === release1.checksum && made?.status === 'staged' && made?.snapshotId === 'fixture-checklist' && (await snapshots()) === before + 1, ran.json ?? { status: ran.status })
  check('the staged import is "not found" for a visitor', (await get(`/api/taxonomy-snapshots/${ran.json?.snapshot}`)).status === 404)
  const again = await run(waiting?.id, curator)
  check('running the finished job again stores nothing new', again.status === 200 && again.json?.status === 'done' && again.json?.snapshot === ran.json?.snapshot && (await snapshots()) === before + 1, again.json ?? { status: again.status })
  const settings = (await get(`/api/taxonomy-imports/${waiting?.id}?depth=0`, curator)).json?.settings
  const same = await call('POST', '/api/taxonomy-imports?depth=0', { as: curator, origin: site, body: { title: 'The same file again', format: 'csv', file: first?.id, settings } })
  const found = await run(same.json?.doc?.id, curator)
  check('a new job over the same file and settings waits, then finds the snapshot already stored', same.status === 201 && same.json?.doc?.status === 'queued' && found.json?.status === 'already-imported' && found.json?.snapshot === ran.json?.snapshot && (await snapshots()) === before + 1, found.json ?? same.json?.errors ?? { status: same.status })
  const failedAgain = await run(broken?.id, curator)
  check('running the failed job again fails the same way and stores nothing', failedAgain.status === 200 && failedAgain.json?.status === 'failed' && /Missing required column/.test(failedAgain.json?.message ?? '') && (await snapshots()) === before + 1, failedAgain.json ?? { status: failedAgain.status })

  // The whole way round over HTTP: upload release 2, make its job, run it.
  const release2 = JSON.parse(fixture('checklist-v2.json'))
  const sent = await upload('checklist-v2.csv', fixture('checklist-v2.csv'), 'text/csv', curator)
  check('the curator uploads a file, and it lands in the site\'s throwaway folder', sent.status === 201 && Boolean(uploads) && existsSync(path.join(uploads ?? '', sent.json?.doc?.filename ?? 'none')), sent.json?.errors ?? { status: sent.status, uploads })
  const v2 = { ...settings, snapshot: { ...settings?.snapshot, version: '2' }, source: { ...settings?.source, externalVersion: '2' }, options: { ...settings?.options, classification: { ...settings?.options?.classification, version: '2' } } }
  const job2 = await call('POST', '/api/taxonomy-imports?depth=0', { as: curator, origin: site, body: { title: 'Checklist, release 2', format: 'csv', file: sent.json?.doc?.id, settings: v2 } })
  const ran2 = await run(job2.json?.doc?.id, curator)
  check('a job over the uploaded file gives the checksum of fixtures/checklist-v2.json', job2.status === 201 && ran2.json?.status === 'done' && ran2.json?.checksum === release2.checksum && (await snapshots()) === before + 2, ran2.json ?? job2.json?.errors ?? { status: job2.status })
  const html = await upload('page.html', '<!doctype html><script>alert(1)</script>', 'text/html', curator)
  check('an HTML file is refused as a source file, even from the curator', html.status >= 400 && html.status < 500, { status: html.status })
  const edited = await call('PATCH', `/api/taxonomy-imports/${job2.json?.doc?.id}?depth=0`, { as: curator, origin: site, body: { status: 'queued' } })
  check('a finished job\'s results can\'t be edited, even by the curator', edited.status >= 400 && edited.status < 500 && (await get(`/api/taxonomy-imports/${job2.json?.doc?.id}?depth=0`, curator)).json?.status === 'done', { status: edited.status })
}

let up = false
try {
  for (let i = 0; i < 180 && !up && server.exitCode === null; i += 1) {
    up = await fetch(site + '/', { signal: AbortSignal.timeout(60_000) }).then((r) => r.status === 200, () => false)
    if (!up) await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  if (up) await checks()
  else check('the site starts', false, log.split('\n').slice(-15).join('\n       '))
} catch (error) {
  check('the checks ran to the end', false, String(error?.stack ?? error))
} finally {
  server.kill('SIGTERM')
  await finished(server)
}
if (up) check('the folder of uploaded files is gone once the site has stopped', Boolean(uploads) && !existsSync(uploads), { uploads })
if (failed && up) console.log(`\nThe site's last output:\n${log.split('\n').slice(-25).join('\n')}`)
console.log(`\n${passed} passed, ${failed} failed.`)
process.exit(failed ? 1 : 0)
