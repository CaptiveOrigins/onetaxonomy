# @captiveorigins/onetaxonomy-education

Lessons over a pinned OneTaxonomy snapshot: decks of **scenes** (a view, a camera, annotations and step-by-step **reveals**) and **worksheets** whose answers are computed by the core science functions, never stored. Portable JSON, no networking; a live classroom (Phase 2) only syncs scene and step numbers.

```js
import { createView, indexDataset } from '@captiveorigins/onetaxonomy-core'
import { createLesson, sceneAt, sceneFromView, validateLesson, worksheetMarkdown } from '@captiveorigins/onetaxonomy-education'

const data = indexDataset(snapshot)
const deck = createLesson(data, { id: 'reptiles', title: 'Are reptiles a clade?' })
const scene = sceneFromView(createView(data, { id: 'v', title: 'Amniotes', target: { kind: 'phylogeny', id: 'my-tree' } }), { id: 's1', title: 'Amniotes' })
scene.steps.push({ id: 'st1', caption: 'Open the archosaurs', actions: [{ type: 'expand', node: 'archosauria' }], camera: { focus: 'archosauria', zoom: 1.5 } })
scene.annotations.push({ id: 'n1', text: 'Birds are archosaurs.', target: { kind: 'node', node: 'aves' }, from: 'st1' })
deck.scenes.push(scene)
deck.worksheets.push({ id: 'w1', title: 'Clades', scene: 's1', questions: [{ id: 'q1', kind: 'is-clade', members: ['crocs', 'aves'] }] })

validateLesson(deck, data)             // [] or diagnostics (bad steps, unknown nodes, classification questions…)
sceneAt(scene, 1, data)                // { view, camera, annotations, caption, step, steps }
worksheetMarkdown(deck, 'w1', data, { answers: true }) // printable, with the computed key
```

- **Questions**: `is-clade` (yes / no / can't tell), `mrca`, `missing` (what to add to make a clade), `open`. `answerQuestion` and `checkResponse` evaluate them with `isMonophyletic` and `findMRCA` over the scene's rooted hypothesis, with the reasons in words (`describeAssessment`). Clade questions on a classification are refused: a classification states no ancestry.
- **Pinned data**: a deck records the snapshot id, version and checksum; opening it over another snapshot warns, and answers are recomputed from what is loaded.
- **Players**: `LessonPlayer` in `@captiveorigins/onetaxonomy-react` presents (locked drawing), explores (full explorer from the current step) and authors (studio: scenes from the current view, annotations).

MIT licensed.
