# Browser benchmarks

How long a frame takes while a made-up tree is panned, zoomed and scrolled, drawn as SVG and on the canvas. Each tip is "Taxon n" and about a third of the tips go left at every split, the same trees as [benchmarks.md](benchmarks.md), which times the pure steps in Node. Written by `node scripts/bench-browser.mjs` after `pnpm -r build`. Rerun it to add another machine or browser; each run adds a section above the older ones.

**What this measures.** The page (`apps/playground/bench.tsx`) sets a new view box on every animation frame, as dragging and zooming do in the explorer, and renders at once. It records the time between animation frames and the script time of each render (React, and for the canvas the plan and the draw calls). Three motions: **pan** slides the whole tree with every node in view; **zoom** goes from the whole tree in to reading size (40 tip rows on the drawing, every name drawn) and back; **read** scrolls the tips at reading size, at up to 20 pixels a frame. In the tables, a frame is given in milliseconds as median / 95th percentile / worst, **late** is the share of frames that took more than one and a half display frames, and script is the median.

**What it doesn't.**

- Other browser engines. Only the browsers with a section below were measured. WebKit, which the Mac app and Safari use, and Firefox may differ. To measure one, open `apps/playground/dist/bench.html` in it, press Run, save the numbers and run `node scripts/bench-browser.mjs --from onetaxonomy-bench.json`.
- A window on a real screen. A headless run draws with the graphics card but shows nothing.
- All of painting. Raster and compositing happen off the main thread. They show in the frame time only once they fall behind and the browser holds the next frame back, so a steady frame time means the page kept up, not that painting cost nothing.
- A slow device. "Main thread slowed 4 times" is Chrome's own throttle. It slows script, style and layout on the main thread and leaves the graphics card and the other threads at full speed, so it is a rough stand-in, not a phone or an old laptop.
- Radial layouts, highlights, traits, support values and folded branches. The trees are plain rectangular ones with names on the tips.
- The outline (`TreeOutline`), which isn't virtualized.

## Chrome 157.0.8103.40, headless, 2026-11-11

- Machine: Mac14,13, Apple M2 Max, 12 cores.
- Browser: Chrome 157.0.8103.40, headless (no window on a screen). Graphics: ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version).
- Load: the machine was busy with other work. Load average 6.8, 8, 8.1 before and 11.6, 10.4, 9.3 after (1, 5 and 15 minutes).
- Drawing: 1000 × 1000 CSS pixels. 180 frames for each motion, after 20 warm-up frames. One run of each; not repeated.

What the numbers say, counting a size as on time when under 5% of its frames were late in every motion:

- **Pixel density 1:** SVG was on time up to 1,999 nodes; it first fell behind at 4,999 nodes (78% of frames late while zooming, median frame 33 ms, 30 frames a second). The canvas was on time at every size, up to 19,999 nodes.
- **Pixel density 2:** SVG was on time up to 1,999 nodes; it first fell behind at 4,999 nodes (79% of frames late while zooming, median frame 33 ms, 30 frames a second). The canvas was on time at every size, up to 19,999 nodes.
- **Pixel density 2, main thread slowed 4 times:** SVG was on time up to 499 nodes; it first fell behind at 999 nodes (58% of frames late while zooming, median frame 33 ms, 30 frames a second). The canvas was on time at every size, up to 19,999 nodes.

`TreeView` draws as SVG up to 1,000 drawn nodes and on the canvas above that. The largest SVG tree measured at or under the switch: pixel density 1: 999 nodes, on time; pixel density 2: 999 nodes, on time; pixel density 2, main thread slowed 4 times: 999 nodes, 58% of frames late while zooming.

### Pixel density 1

The display frame here, with nothing to draw: 16.7 ms (60 frames a second).

| Renderer | Tips | Nodes | Pan: frame, late | Zoom: frame, late | Read: frame, late | Script (pan / zoom / read) | First render, script |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| svg | 125 | 249 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.5 / 0.5 / 0.5 | 6.7 |
| canvas | 125 | 249 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.3 / 0.3 / 0.2 | 3.3 |
| svg | 250 | 499 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.0 / 1.0 / 1.0 | 2.6 |
| canvas | 250 | 499 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.3 / 0.2 / 0.2 | 2.1 |
| svg | 500 | 999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.8 / 1.7 / 1.8 | 4.2 |
| canvas | 500 | 999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.4 / 0.3 / 0.3 | 2.0 |
| svg | 1,000 | 1,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 3.5 / 3.5 / 3.3 | 8.5 |
| canvas | 1,000 | 1,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.6 / 0.3 / 0.2 | 4.8 |
| svg | 2,500 | 4,999 | 33 / 33 / 33, 64% | 33 / 33 / 50, 78% | 33 / 33 / 34, 60% | 8.3 / 8.3 / 8.2 | 21 |
| canvas | 2,500 | 4,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.1 / 0.4 / 0.2 | 4.1 |
| svg | 5,000 | 9,999 | 67 / 67 / 83, 100% | 67 / 67 / 83, 100% | 50 / 67 / 67, 98% | 18 / 18 / 17 | 42 |
| canvas | 5,000 | 9,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.4 / 0.4 / 0.2 | 8.7 |
| canvas | 10,000 | 19,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.7 / 0.6 / 0.2 | 10 |

### Pixel density 2

The display frame here, with nothing to draw: 16.7 ms (60 frames a second).

| Renderer | Tips | Nodes | Pan: frame, late | Zoom: frame, late | Read: frame, late | Script (pan / zoom / read) | First render, script |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| svg | 125 | 249 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.5 / 0.5 / 0.5 | 6.1 |
| canvas | 125 | 249 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.3 / 0.3 / 0.2 | 3.9 |
| svg | 250 | 499 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.0 / 1.0 / 1.0 | 2.6 |
| canvas | 250 | 499 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.3 / 0.3 / 0.2 | 1.8 |
| svg | 500 | 999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.8 / 1.8 / 1.8 | 4.6 |
| canvas | 500 | 999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.4 / 0.3 / 0.2 | 2.1 |
| svg | 1,000 | 1,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 3.4 / 3.6 / 3.4 | 9.0 |
| canvas | 1,000 | 1,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 0.6 / 0.3 / 0.2 | 4.7 |
| svg | 2,500 | 4,999 | 33 / 33 / 34, 68% | 33 / 33 / 50, 79% | 33 / 33 / 34, 60% | 8.5 / 8.3 / 8.2 | 20 |
| canvas | 2,500 | 4,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.2 / 0.4 / 0.2 | 4.0 |
| svg | 5,000 | 9,999 | 67 / 67 / 83, 100% | 67 / 67 / 83, 100% | 67 / 67 / 67, 98% | 20 / 19 / 19 | 46 |
| canvas | 5,000 | 9,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.3 / 0.5 / 0.2 | 8.7 |
| canvas | 10,000 | 19,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.7 / 0.6 / 0.3 | 15 |

### Pixel density 2, main thread slowed 4 times

The display frame here, with nothing to draw: 16.7 ms (60 frames a second).

| Renderer | Tips | Nodes | Pan: frame, late | Zoom: frame, late | Read: frame, late | Script (pan / zoom / read) | First render, script |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| svg | 125 | 249 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 2.0 / 2.1 / 2.1 | 27 |
| canvas | 125 | 249 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.0 / 0.8 / 0.8 | 16 |
| svg | 250 | 499 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 3.9 / 4.1 / 4.0 | 12 |
| canvas | 250 | 499 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.0 / 0.9 / 0.8 | 7.8 |
| svg | 500 | 999 | 17 / 33 / 34, 44% | 33 / 33 / 33, 58% | 17 / 33 / 34, 34% | 7.7 / 7.6 / 7.4 | 20 |
| canvas | 500 | 999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 1.3 / 1.2 / 0.8 | 9.3 |
| svg | 1,000 | 1,999 | 50 / 50 / 67, 100% | 50 / 67 / 67, 100% | 50 / 50 / 67, 98% | 15 / 15 / 15 | 36 |
| canvas | 1,000 | 1,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 2.4 / 1.2 / 0.7 | 18 |
| svg | 2,500 | 4,999 | 133 / 133 / 150, 100% | 133 / 150 / 167, 100% | 117 / 133 / 150, 100% | 37 / 37 / 36 | 91 |
| canvas | 2,500 | 4,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 4.4 / 1.5 / 0.8 | 20 |
| svg | 5,000 | 9,999 | 250 / 283 / 317, 100% | 250 / 283 / 300, 100% | 250 / 283 / 283, 100% | 76 / 73 / 74 | 185 |
| canvas | 5,000 | 9,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 5.4 / 1.7 / 0.7 | 30 |
| canvas | 10,000 | 19,999 | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 17 / 17 / 17, 0% | 7.0 / 2.5 / 0.9 | 55 |

### What was on screen

The SVG holds every element whatever the view. The canvas plans each frame: it leaves out what is out of view and merges subtrees too small to tell apart. Median for each frame, with the most in any frame in brackets.

| Tips | Nodes | SVG elements | Canvas, pan: nodes drawn | Canvas, zoom: nodes drawn, names | Canvas, read: nodes drawn, names |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 125 | 249 | 875 | 249 (249) | 181 (249), 0 (55) | 113 (115), 40 (41) |
| 250 | 499 | 1,750 | 483 (499) | 243 (499), 0 (55) | 109 (111), 40 (41) |
| 500 | 999 | 3,500 | 949 (999) | 332 (999), 0 (55) | 114 (116), 40 (41) |
| 1,000 | 1,999 | 7,000 | 1,309 (1,389) | 460 (1,999), 0 (55) | 112 (113), 40 (41) |
| 2,500 | 4,999 | 17,500 | 2,320 (2,479) | 718 (2,686), 0 (55) | 115 (116), 39 (41) |
| 5,000 | 9,999 | 35,000 | 2,369 (2,519) | 1,010 (3,171), 0 (53) | 115 (116), 40 (41) |
| 10,000 | 19,999 | not run | 2,499 (2,679) | 1,429 (3,321), 0 (55) | 112 (114), 40 (41) |
