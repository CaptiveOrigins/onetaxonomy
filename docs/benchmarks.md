# Benchmarks

Made-up trees of 1,000, 10,000 and 50,000 tips (each tip "Taxon n", about a third of the tips going left at every split, so the tree is unbalanced like real ones). Written by `node scripts/bench-canvas.mjs` after `pnpm -r build`. Rerun it to add another machine; keep each machine's section.

**What this measures:** CPU time in Node for the pure steps: projecting the view (with `projectView`'s 10,000-node limit lifted, so every node is drawn), laying it out, and the canvas renderer's level-of-detail plan (`prepareTree`, `planCanvas`) and hit-testing. Each figure is the median of 10 runs (5 for 50,000 tips) after two warm-up runs, in milliseconds, with the fastest run in brackets.

**What it doesn't:** painting. This repo has no canvas for Node (no `node-canvas` dependency), so the draw was run against a context that only counts calls, to show how much would be drawn. Paint time and frame rates while panning or zooming need a real browser (WebKit in the Mac app, Safari, Chrome, Firefox) and have **not** been measured. Nothing here says the canvas is smooth at 1–2k visible nodes yet: the plan for one frame is cheap enough to allow it, and a browser run has to confirm it.

## Mac14,13, 2026-11-11

- Machine: Mac14,13, Apple M2 Max, 12 cores, 64 GB
- OS: Darwin 24.1.0 (arm64)
- Node: v26.12.1
- Load while running: load average 21.4, 23.5, 18.2 (1, 5, 15 min) on 12 cores. Other work was running on this machine at the same time, so treat these as rough; rerun on a quiet machine for cleaner numbers.

| Tips | Nodes | Renderer (auto) | Project view | Rectangular layout | Radial layout | Prepare (once per layout) | Plan, whole tree 800×600 | Plan, ~1 px per tip 1000×1000 | Plan, names readable 1000×1000 | Plan, radial whole tree 800×800 (prepared) | 100 hit tests |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,999 | canvas | 2.82 (2.17) | 0.72 (0.68) | 2.15 (1.86) | 1.27 (1.17) | 0.40 (0.36) | 0.41 (0.40) | 0.18 (0.18) | 0.56 (0.46) | 3.25 (2.91) |
| 10,000 | 19,999 | canvas | 33.1 (23.9) | 9.78 (8.34) | 20.4 (16.4) | 12.1 (10.2) | 0.58 (0.51) | 0.33 (0.33) | 0.12 (0.11) | 2.31 (2.08) | 2.96 (2.90) |
| 50,000 | 99,999 | canvas | 110 (104) | 55.9 (52.7) | 122 (111) | 78.7 (67.4) | 1.51 (1.34) | 0.34 (0.34) | 0.11 (0.10) | 10.8 (8.57) | 3.07 (3.01) |

What each plan drew:

| Tips | Whole tree, 800×600 | ~1 px per tip, 1000×1000 | Names readable, 1000×1000 | Radial, whole tree, 800×800 |
| ---: | --- | --- | --- | --- |
| 1,000 | 1,389 drawn, 305 wedges holding 610, 0 out of view, 0 labels shown, 695 left out | 1,999 drawn, 0 wedges holding 0, 0 out of view, 0 labels shown, 1,000 left out | 120 drawn, 0 wedges holding 0, 1,879 out of view, 43 labels shown, 0 left out | 1,989 drawn, 5 wedges holding 10, 0 out of view, 0 labels shown, 995 left out |
| 10,000 | 1,781 drawn, 891 wedges holding 18,218, 0 out of view, 0 labels shown, 891 left out | 2,036 drawn, 0 wedges holding 0, 17,963 out of view, 0 labels shown, 1,018 left out | 119 drawn, 0 wedges holding 0, 19,880 out of view, 43 labels shown, 0 left out | 5,315 drawn, 2,658 wedges holding 14,684, 0 out of view, 0 labels shown, 2,658 left out |
| 50,000 | 1,783 drawn, 892 wedges holding 98,216, 0 out of view, 0 labels shown, 892 left out | 2,037 drawn, 0 wedges holding 0, 97,962 out of view, 0 labels shown, 1,018 left out | 113 drawn, 0 wedges holding 0, 99,886 out of view, 37 labels shown, 0 left out | 5,489 drawn, 2,745 wedges holding 94,510, 0 out of view, 0 labels shown, 2,745 left out |

Calls the ~1 px per tip plan makes on a 2D context (counted, not timed):

| Tips | moveTo | lineTo | arc | fill | stroke | fillText |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,998 | 3,996 | 0 | 0 | 1 | 0 |
| 10,000 | 2,007 | 4,014 | 0 | 0 | 1 | 0 |
| 50,000 | 2,007 | 4,014 | 0 | 0 | 1 | 0 |

Edges are batched into at most four paths (plain, weak, and each while dragging), so the stroke count stays small however many edges there are.

## Not measured yet

- Paint time and frame rate in a browser, at 1–2k visible nodes, at 1× and 2× pixel density. Needs a person with the Mac app or a browser open, or a headless browser run.
- The SVG renderer at the threshold (1,000 drawn nodes), to check the threshold is in the right place. It was chosen by judgment: the explorer re-renders every SVG node on each pan step, and at 1,000 nodes that is 1,000 React elements per pointer move.
- The outline (`TreeOutline`) with 10,000+ rows: it isn't virtualized, and on large trees it may be slower than the drawing.
