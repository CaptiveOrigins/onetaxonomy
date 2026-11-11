import { defineConfig } from 'vitest/config'

// A real Payload on an in-memory MongoDB per test file: files run one at a time.
export default defineConfig({
  test: { environment: 'node', testTimeout: 60_000, hookTimeout: 180_000, fileParallelism: false },
})
