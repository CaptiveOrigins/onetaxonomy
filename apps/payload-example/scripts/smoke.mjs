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
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifySnapshot } from '@captiveorigins/onetaxonomy-core'

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
// DATABASE_URI is cleared so the checks never run against a database you named for something else.
const env = { ...process.env, PORT: String(port), EXAMPLE_URL: site, EXAMPLE_PASSWORD: password, DATABASE_URI: '' }

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
for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => (log = (log + chunk).slice(-20_000)))

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
  }
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
  check('a visitor now reads version 2\'s summary, with the ids and no names', publicSummary.status === 200 && publicFrom?.author === String(me?.id) && !('authorName' in publicFrom) && !('acceptedByName' in publicFrom) && !publicSummary.text.includes('Morgan') && !publicSummary.text.includes('Cara') && !publicSummary.text.includes('@example.org'), publicFrom ?? { status: publicSummary.status })
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
if (failed && up) console.log(`\nThe site's last output:\n${log.split('\n').slice(-25).join('\n')}`)
console.log(`\n${passed} passed, ${failed} failed.`)
process.exit(failed ? 1 : 0)
