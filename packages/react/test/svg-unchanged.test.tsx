// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createView, indexDataset, makeHighlight, nodeOverlays, projectView, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import { radial, rectangular } from '@extantape/onetaxonomy-layout'
import { traitShapes, TreeView } from '../src'
import checklistJson from '../../../fixtures/checklist.json'
import amniotesJson from '../../../fixtures/amniotes.json'

/**
 * The SVG drawing below the canvas threshold must stay exactly what it was before the
 * canvas renderer existed. The snapshots were written from the code before that change
 * (2026-11-11) and pin the whole markup: nodes, labels, halos, marks, drag and drop.
 *
 * One change since, on purpose (2026-11-11): where a name starts. Four `<text>` tags differ
 * from the first snapshots and nothing else does. Three inner nodes' names (amniota, fx:14,
 * fx:16) moved from 6 units above the node, where a child's branch could run through them,
 * to the node's own row; and a folded branch's name (fx:2) starts 16 units out, past its
 * triangle, instead of 8. `label-place.test.tsx` tests the rule.
 */
const cl = indexDataset(checklistJson as DatasetSnapshot)
const traitData = (): DatasetSnapshot => ({
  ...(JSON.parse(JSON.stringify(amniotesJson)) as DatasetSnapshot),
  traits: [{ id: 'repro', title: 'Reproduction', source: 'fixture', states: [{ id: 'egg', label: 'Lays eggs', color: '#eeb684' }, { id: 'live', label: 'Live birth' }], values: [{ concept: 'c:testudines', state: 'egg' }, { concept: 'c:mammalia', state: 'live' }] }],
})

describe('SVG drawing below the canvas threshold is unchanged', () => {
  it('checklist, rectangular, one branch folded', () => {
    const v = { ...createView(cl, { id: 'v', title: 'Checklist', target: { kind: 'classification', id: 'fx:checklist' } }), collapsed: ['fx:2'] }
    const p = projectView(cl, v)
    expect(renderToStaticMarkup(<TreeView projection={p} layout={rectangular(p)} title="Checklist" />)).toMatchSnapshot()
  })

  it('amniotes, radial and rectangular, with highlights, traits, badges, drag and a drop target', () => {
    const d = indexDataset(traitData())
    const base = { ...createView(d, { id: 'v', title: 't', target: { kind: 'phylogeny', id: 'archelosauria' } }), overlays: { trait: 'repro' } }
    const h = { ...makeHighlight(d, base, { id: 'a', label: 'Archosaurs', members: ['t-crocodylia', 't-aves'] }), color: '#f00' }
    const v = { ...base, highlights: [h], selected: ['t-aves'] }
    const p = projectView(d, v)
    const common = { projection: p, highlights: [h], title: 'Amniotes', overlays: nodeOverlays(d, v, p), traitShapes: traitShapes(d.snapshot.traits?.[0]) }
    expect(renderToStaticMarkup(<TreeView {...common} layout={radial(p)} />)).toMatchSnapshot()
    expect(
      renderToStaticMarkup(
        <TreeView {...common} layout={rectangular(p)} interactive badges={new Map([['t-aves', '1']])} drag={{ ids: new Set(['t-aves']), dx: 4, dy: 5 }} dropTarget="archosauria" viewBox={{ x: 0, y: 0, width: 300, height: 200 }} />,
      ),
    ).toMatchSnapshot()
  })
})
