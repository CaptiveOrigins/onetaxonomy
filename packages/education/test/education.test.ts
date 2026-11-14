import { describe, expect, it } from 'vitest'
import { createView, indexDataset, type DatasetSnapshot } from '@extantape/onetaxonomy-core'
import amniotesJson from '../../../fixtures/amniotes.json'
import { answerQuestion, checkResponse, createLesson, parseLesson, sceneAt, sceneFromView, serializeLesson, validateLesson, worksheetMarkdown, type LessonDeck } from '../src'

const am = indexDataset(amniotesJson as DatasetSnapshot)

const lesson = (): LessonDeck => {
  const deck = createLesson(am, { id: 'l1', title: 'Are reptiles a clade?' })
  const scene = sceneFromView(createView(am, { id: 'v', title: 'Amniotes', target: { kind: 'phylogeny', id: 'archelosauria' } }), { id: 's1', title: 'Turtles with archosaurs' })
  scene.view = { ...scene.view, collapsed: ['archelosauria'] }
  scene.steps = [
    { id: 'st1', caption: 'Open the turtles-and-archosaurs branch', actions: [{ type: 'expand', node: 'archelosauria' }], camera: { focus: 'archelosauria', zoom: 1.5 } },
    { id: 'st2', caption: 'Where do birds sit?', actions: [{ type: 'select', nodes: ['t-aves'] }] },
  ]
  scene.annotations = [
    { id: 'a1', text: 'Mammals branch off first.', target: { kind: 'node', node: 't-mammalia' } },
    { id: 'a2', text: 'Birds are archosaurs.', target: { kind: 'node', node: 't-aves' }, from: 'st2', tone: 'question' },
  ]
  deck.scenes.push(scene)
  deck.worksheets.push({
    id: 'w1',
    title: 'Clades',
    scene: 's1',
    questions: [
      { id: 'q1', kind: 'is-clade', members: ['t-crocodylia', 't-aves'] },
      { id: 'q2', kind: 'is-clade', members: ['t-squamata', 't-rhyncho', 't-testudines', 't-crocodylia'] },
      { id: 'q3', kind: 'mrca', members: ['t-testudines', 't-aves'] },
      { id: 'q4', kind: 'missing', members: ['t-squamata', 't-rhyncho', 't-testudines', 't-crocodylia'] },
      { id: 'q5', kind: 'open', prompt: 'Why might a field guide still use "reptiles"?' },
    ],
  })
  return deck
}

describe('lessons (M5)', () => {
  it('reveals a scene step by step: view actions, camera and annotations', () => {
    const scene = lesson().scenes[0]!
    const start = sceneAt(scene, 0, am)
    expect(start.view.collapsed).toEqual(['archelosauria'])
    expect(start.annotations.map((a) => a.id)).toEqual(['a1'])
    const end = sceneAt(scene, 2, am)
    expect(end.view.collapsed).toEqual([])
    expect(end.view.selected).toEqual(['t-aves'])
    expect(end.camera).toEqual({ focus: 'archelosauria', zoom: 1.5 })
    expect(end.annotations.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(end.caption).toBe('Where do birds sit?')
    expect(sceneAt(scene, 99, am).step).toBe(2)
  })

  it('computes answers from the hypothesis, never from the lesson', () => {
    const deck = lesson()
    const scene = deck.scenes[0]!
    const [q1, q2, q3, q4] = deck.worksheets[0]!.questions
    expect(answerQuestion(q1!, scene, am)).toMatchObject({ answer: 'yes' })
    expect(answerQuestion(q2!, scene, am)).toMatchObject({ answer: 'no' })
    expect(answerQuestion(q3!, scene, am)).toMatchObject({ answer: 'archelosauria' })
    expect(answerQuestion(q4!, scene, am)).toMatchObject({ answer: ['t-aves'], labels: ['Aves'] })
    expect(checkResponse(q2!, { kind: 'is-clade', value: 'no' }, scene, am).correct).toBe(true)
    expect(checkResponse(q4!, { kind: 'missing', value: [] }, scene, am).correct).toBe(false)
  })

  it('prints worksheets with and without the answer key', () => {
    const deck = lesson()
    const blank = worksheetMarkdown(deck, 'w1', am)
    expect(blank).toContain('1. Do Crocodylia, Aves form a clade?')
    expect(blank).not.toContain('**Answer:**')
    const key = worksheetMarkdown(deck, 'w1', am, { answers: true })
    expect(key).toContain('**Answer:** Yes')
    expect(key).toContain('**Answer:** Aves')
  })

  it('validates lessons: bad steps, unknown nodes, classification questions, duplicate ids; round-trips', () => {
    const deck = lesson()
    expect(validateLesson(deck, am)).toEqual([])
    deck.scenes[0]!.steps.push({ id: 'st3', actions: [{ type: 'expand', node: 'nope' }] })
    deck.scenes[0]!.annotations.push({ id: 'a1', text: 'dupe', target: { kind: 'node', node: 'ghost' } })
    const cls = sceneFromView(createView(am, { id: 'c', title: 'C', target: { kind: 'classification', id: 'traditional' } }), { id: 's2', title: 'Classes' })
    deck.scenes.push(cls)
    deck.worksheets.push({ id: 'w2', title: 'x', scene: 's2', questions: [{ id: 'q9', kind: 'is-clade', members: ['c:reptilia'] }] })
    expect(validateLesson(deck, am).map((d) => d.code).sort()).toEqual(['bad-step', 'duplicate-id', 'needs-phylogeny', 'unknown-node'])
    expect(parseLesson(serializeLesson(lesson()))).toEqual(JSON.parse(serializeLesson(lesson())))
    expect(() => parseLesson('{"format":"x"}')).toThrow()
  })
})
