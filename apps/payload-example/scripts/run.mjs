#!/usr/bin/env node
// Runs the example site: `node scripts/run.mjs dev|build|start`.
// Unless DATABASE_URI names a database, it starts a throwaway in-memory MongoDB first (data is gone when it stops)
// and seeds two accounts with a password made up for this run. The site listens on this machine only.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const command = process.argv[2] ?? 'dev'
if (!['dev', 'build', 'start'].includes(command)) {
  console.error('Usage: node scripts/run.mjs dev|build|start')
  process.exit(2)
}

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = process.env.PORT || '3000'
const env = { ...process.env, PORT: port, NEXT_TELEMETRY_DISABLED: '1' }
env.EXAMPLE_URL ||= `http://localhost:${port}`
// Signs the sign-in cookies. A new one each run is fine for a throwaway site; a real site sets its own and keeps it.
env.PAYLOAD_SECRET ||= randomBytes(32).toString('hex')

let mongo = null
if (command === 'build') {
  // Building connects to nothing: every page here is rendered per request.
  env.DATABASE_URI ||= 'mongodb://127.0.0.1:27017/not-used-while-building'
} else if (!env.DATABASE_URI) {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server')
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  env.DATABASE_URI = mongo.getUri('onetaxonomy-example')
  const made = !env.EXAMPLE_PASSWORD
  env.EXAMPLE_PASSWORD ||= randomBytes(12).toString('base64url')
  console.log(`\nIn-memory database started. Nothing is kept after this stops.`)
  console.log(`Site:    ${env.EXAMPLE_URL}`)
  console.log(`Admin:   ${env.EXAMPLE_URL}/admin`)
  console.log(`Curator: curator@example.org`)
  console.log(`Member:  member@example.org`)
  console.log(made ? `Password for both, made up for this run: ${env.EXAMPLE_PASSWORD}\n` : `Password for both: the one in EXAMPLE_PASSWORD\n`)
}

const next = createRequire(import.meta.url).resolve('next/dist/bin/next')
const args = command === 'build' ? ['build'] : [command, '--hostname', 'localhost', '--port', port]
const child = spawn(process.execPath, [next, ...args], { cwd: app, env, stdio: 'inherit' })

let stopping = false
async function stop(code) {
  if (stopping) return
  stopping = true
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  if (mongo) await mongo.stop().catch(() => {})
  process.exit(code)
}
child.on('exit', (code, signal) => void stop(code ?? (signal ? 1 : 0)))
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void stop(0))
