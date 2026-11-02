# 0002 — A pure, dependency-free core

**Context.** The core must run in browsers, Node, workers, Tauri webviews and a Payload server, with no React, Payload, database, Node-only or Tauri dependency.

**Decision.** `@onetaxonomy/core` has no runtime dependencies and is type-checked with `lib: ES2023` and `types: []` (no DOM, no Node), so any platform API use fails to compile. Records are plain JSON. Checksums use a small pure SHA-256 (verified against the standard test vectors) because platform crypto is asynchronous and differs by environment. Traversal is iterative (no recursion limits) and bounded where results can be large.

**Consequences.** Slightly more code (hashing, index building) in exchange for identical, synchronous behaviour everywhere. Tests may use Node types (`tsconfig.test.json`); source may not.
