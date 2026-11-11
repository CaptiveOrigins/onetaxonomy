import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { withPayload } from '@payloadcms/next/withPayload'

// The workspace root: the seed reads a fixture from it, and the OneTaxonomy packages are linked from it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  // Don't write an AGENTS.md into the app.
  agentRules: false,
}

export default withPayload(nextConfig)
