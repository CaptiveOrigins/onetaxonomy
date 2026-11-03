import { createView, indexDataset, makeHighlight, type DatasetSnapshot, type TaxonomicView } from '@captiveorigins/onetaxonomy-core'
import { Explorer } from '@captiveorigins/onetaxonomy-react'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import amniotes from '../../fixtures/amniotes.json'
import checklist from '../../fixtures/checklist.json'
import structures from '../../fixtures/structures.json'

/**
 * Playground (M4, M5 overlays and exports): the explorer over the illustrative fixtures. Build with
 * `pnpm --filter @captiveorigins/onetaxonomy-playground build`, then open dist/index.html.
 */
// M5 overlays: an illustrative trait set and support values added to the fixtures here (not science).
const am = indexDataset({
  ...(amniotes as DatasetSnapshot),
  traits: [
    {
      id: 'repro',
      title: 'Reproduction (illustrative)',
      source: 'fixture',
      states: [
        { id: 'egg', label: 'Lays eggs', color: '#eeb684' },
        { id: 'live', label: 'Live birth', color: '#eda9ac' },
        { id: 'both', label: 'Both in the group', color: '#b9a8d9' },
      ],
      values: [
        { concept: 'c:testudines', state: 'egg' },
        { concept: 'c:crocodylia', state: 'egg' },
        { concept: 'c:aves', state: 'egg' },
        { concept: 'c:squamata', state: 'both' },
        { concept: 'c:mammalia', state: 'both', note: 'egg-laying monotremes' },
      ],
    },
  ],
})
const cl = indexDataset(checklist as DatasetSnapshot)
const st = indexDataset({
  ...(structures as DatasetSnapshot),
  phylogenies: (structures as DatasetSnapshot).phylogenies.map((p) =>
    p.id === 'fossil' ? { ...p, nodes: p.nodes.map((n) => (n.id === 'f0' ? { ...n, support: { value: 1, method: 'posterior (illustrative)' } } : n.id === 'f1' ? { ...n, support: { value: 0.71, method: 'posterior (illustrative)' } } : n)) } : p,
  ),
})

const archelosauria = (() => {
  const v = createView(am, { id: 'arch', title: 'Amniotes: turtles with archosaurs', target: { kind: 'phylogeny', id: 'archelosauria' } })
  return {
    ...v,
    highlights: [
      { ...makeHighlight(am, v, { id: 'archo', label: 'Archosaurs', members: ['t-crocodylia', 't-aves'] }), color: '#2f7d5c' },
      { ...makeHighlight(am, v, { id: 'trad', label: 'Traditional “reptiles”', members: ['t-squamata', 't-rhyncho', 't-testudines', 't-crocodylia'] }), color: '#d97706' },
    ],
  } satisfies TaxonomicView
})()

const examples = [
  { key: 'arch', title: 'Phylogeny: turtles with archosaurs', dataset: am, view: archelosauria },
  { key: 'anap', title: 'Phylogeny: turtles outside Sauria', dataset: am, view: createView(am, { id: 'anap', title: 'Turtles outside Sauria', target: { kind: 'phylogeny', id: 'anapsid-turtles' } }) },
  { key: 'trad', title: 'Classification: traditional classes', dataset: am, view: createView(am, { id: 'trad', title: 'Traditional classification', target: { kind: 'classification', id: 'traditional' } }) },
  { key: 'list', title: 'Classification: illustrative checklist', dataset: cl, view: createView(cl, { id: 'list', title: 'Illustrative checklist', target: { kind: 'classification', id: 'fx:checklist' } }) },
  { key: 'time', title: 'Time-calibrated tree with an extinct lineage', dataset: st, view: { ...createView(st, { id: 'time', title: 'Fossil example', target: { kind: 'phylogeny', id: 'fossil' }, layout: 'time' }), overlays: { support: { threshold: 0.95 }, extinction: true } } },
]

function App() {
  const [key, setKey] = useState(new URLSearchParams(location.search).get('example') ?? 'arch')
  const ex = useMemo(() => examples.find((e) => e.key === key) ?? examples[0]!, [key])
  return (
    <>
      <header>
        <h1>OneTaxonomy playground</h1>
        <p className="intro">Illustrative data only (invented or simplified). Every change is a view action: the data never changes.</p>
      </header>
      <nav aria-label="Examples">
        {examples.map((e) => (
          <button key={e.key} type="button" aria-pressed={e.key === ex.key} onClick={() => setKey(e.key)}>
            {e.title}
          </button>
        ))}
      </nav>
      <Explorer key={ex.key} dataset={ex.dataset} initialView={ex.view} title={ex.title} />
    </>
  )
}

createRoot(document.getElementById('app')!).render(<App />)
