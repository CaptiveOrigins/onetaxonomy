'use client'

import { projectView, type DatasetIndex, type Id, type TaxonomicView } from '@captiveorigins/onetaxonomy-core'
import { sceneAt, sceneFromView, type Annotation, type Camera, type LessonDeck } from '@captiveorigins/onetaxonomy-education'
import type { TreeLayout } from '@captiveorigins/onetaxonomy-layout'
import { useMemo, useState, type KeyboardEvent } from 'react'

import { Explorer } from './Explorer.js'
import { layoutFor } from './layout.js'
import { Icon } from './icons.js'
import { treeViewBox, TreeView, type ViewBox } from './TreeView.js'

export type LessonMode =
  /** Teacher presents: the drawing follows the lesson, step by step. */
  | 'present'
  /** Students explore from the current step with the full explorer (changes stay local). */
  | 'explore'
  /** Authoring: build scenes from the explorer, annotate nodes. */
  | 'studio'

export type LessonLabels = Record<
  'previous' | 'next' | 'scene' | 'step' | 'present' | 'explore' | 'studio' | 'addScene' | 'sceneTitle' | 'annotate' | 'annotation' | 'remove' | 'notes' | 'selectToAnnotate' | 'modes' | 'caution',
  string
>

const LABELS: LessonLabels = {
  previous: 'Previous',
  next: 'Next',
  scene: 'Scene',
  step: 'Step',
  present: 'Present',
  explore: 'Explore',
  studio: 'Studio',
  addScene: 'Add scene from this view',
  sceneTitle: 'Scene title',
  annotate: 'Annotate the selected taxon',
  annotation: 'Note',
  remove: 'Remove',
  notes: 'Teacher notes',
  selectToAnnotate: 'Choose a taxon in the drawing to annotate it.',
  modes: 'Lesson mode',
  caution: 'Caution:',
}

/** The viewBox for a camera: centered on its node (or the whole tree), zoom 1 = fit. */
export function cameraBox(layout: TreeLayout, camera: Camera | undefined, full: ViewBox = treeViewBox(layout)): ViewBox {
  const zoom = camera?.zoom && camera.zoom > 0 ? camera.zoom : 1
  const node = camera?.focus ? layout.nodes.find((n) => n.id === camera.focus) : undefined
  const cx = node ? node.x : full.x + full.width / 2
  const cy = node ? node.y : full.y + full.height / 2
  const width = full.width / zoom
  const height = full.height / zoom
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

export type LessonPlayerProps = {
  dataset: DatasetIndex
  deck: LessonDeck
  /** Starting mode (default present). Studio needs `onChange`. */
  mode?: LessonMode
  /** Modes offered in the switcher (default: present and explore, plus studio when `onChange` is given). */
  modes?: LessonMode[]
  /** Called with the edited lesson (studio). */
  onChange?: (deck: LessonDeck) => void
  /** Show teacher notes (default false). */
  showNotes?: boolean
  height?: string
  labels?: Partial<LessonLabels>
}

/**
 * Plays a lesson deck. Present mode draws exactly what the lesson says at each step
 * (camera, reveals, annotations as numbered markers with their text beside the
 * drawing); explore mode opens the full explorer at that point; studio mode lets an
 * author add scenes from the explorer's current view and annotate taxa.
 */
export function LessonPlayer({ dataset, deck, mode: initialMode = 'present', modes, onChange, showNotes = false, height = '30rem', labels: custom }: LessonPlayerProps) {
  const labels = { ...LABELS, ...custom }
  const offered = modes ?? (['present', 'explore', ...(onChange ? (['studio'] as const) : [])] as LessonMode[])
  const [mode, setMode] = useState<LessonMode>(initialMode)
  const [sceneIndex, setSceneIndex] = useState(0)
  const [step, setStep] = useState(0)
  const scene = deck.scenes[Math.min(sceneIndex, deck.scenes.length - 1)]
  const frame = useMemo(() => (scene ? sceneAt(scene, step, dataset) : null), [scene, step, dataset])

  // Radio group pattern: one tab stop, arrow keys move and choose.
  const onModeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!by) return
    e.preventDefault()
    const i = (offered.indexOf(mode) + by + offered.length) % offered.length
    setMode(offered[i]!)
    ;(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[i])?.focus()
  }

  const go = (delta: 1 | -1) => {
    if (!scene) return
    const next = step + delta
    if (next >= 0 && next <= scene.steps.length) return setStep(next)
    const s = sceneIndex + delta
    if (s < 0 || s >= deck.scenes.length) return
    setSceneIndex(s)
    setStep(delta > 0 ? 0 : deck.scenes[s]!.steps.length)
  }

  return (
    <div className="ot-lesson" data-mode={mode}>
      <div className="ot-toolbar" role="toolbar" aria-label={deck.title}>
        <div className="ot-segmented" role="radiogroup" aria-label={labels.modes} onKeyDown={onModeKey}>
          {offered.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} onClick={() => setMode(m)}>
              {labels[m]}
            </button>
          ))}
        </div>
        <span className="ot-toolbar-gap" aria-hidden="true" />
        <button type="button" onClick={() => go(-1)} disabled={sceneIndex === 0 && step === 0}>
          <Icon name="previous" />
          {labels.previous}
        </button>
        <span className="ot-lesson-position" aria-live="polite">
          {labels.scene} {deck.scenes.length ? sceneIndex + 1 : 0}/{deck.scenes.length}
          {scene && scene.steps.length > 0 ? ` · ${labels.step} ${step}/${scene.steps.length}` : ''}
        </span>
        <button type="button" onClick={() => go(1)} disabled={!scene || (sceneIndex === deck.scenes.length - 1 && step === scene.steps.length)}>
          {labels.next}
          <Icon name="next" />
        </button>
      </div>
      {scene && frame && (
        <>
          <h2 className="ot-lesson-title">{scene.title}</h2>
          {frame.caption && <p className="ot-lesson-caption">{frame.caption}</p>}
          {mode === 'present' && <Present dataset={dataset} view={frame.view} camera={frame.camera} annotations={frame.annotations} title={scene.title} height={height} cautionLabel={labels.caution} />}
          {mode === 'explore' && <Explorer key={`${scene.id}:${step}`} dataset={dataset} initialView={frame.view} title={scene.title} height={height} />}
          {mode === 'studio' && onChange && <Studio dataset={dataset} deck={deck} sceneIndex={sceneIndex} startView={frame.view} onChange={onChange} labels={labels} height={height} onAdded={(i) => { setSceneIndex(i); setStep(0) }} />}
          {showNotes && scene.notes && (
            <aside className="ot-lesson-notes">
              <strong>{labels.notes}:</strong> {scene.notes}
            </aside>
          )}
        </>
      )}
    </div>
  )
}

function Present({ dataset, view, camera, annotations, title, height, cautionLabel }: { dataset: DatasetIndex; view: TaxonomicView; camera: Camera; annotations: Annotation[]; title: string; height: string; cautionLabel: string }) {
  const projection = useMemo(() => projectView(dataset, view), [dataset, view])
  const layout = useMemo(() => layoutFor(projection, view.layout.kind), [projection, view.layout.kind])
  const box = useMemo(() => cameraBox(layout, camera), [layout, camera])
  const badges = new Map<Id, string>()
  annotations.forEach((a, i) => {
    const target = a.target.kind === 'node' ? a.target.node : a.target.kind === 'group' ? a.target.members[0] : undefined
    if (target && !badges.has(target)) badges.set(target, String(i + 1))
  })
  return (
    <div className="ot-panes">
      <div className="ot-canvas ot-present" style={{ height }}>
        <TreeView projection={projection} layout={layout} highlights={view.highlights} title={title} viewBox={box} badges={badges} />
      </div>
      {annotations.length > 0 && (
        <ol className="ot-annotations">
          {annotations.map((a) => (
            <li key={a.id} data-tone={a.tone ?? 'note'}>
              {/* A caution says so in words, not only in color. */}
              {a.tone === 'caution' && <strong>{cautionLabel} </strong>}
              {a.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Studio({ dataset, deck, sceneIndex, startView, onChange, labels, height, onAdded }: { dataset: DatasetIndex; deck: LessonDeck; sceneIndex: number; startView: TaxonomicView; onChange: (d: LessonDeck) => void; labels: LessonLabels; height: string; onAdded: (index: number) => void }) {
  const [view, setView] = useState<TaxonomicView>(startView)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const scene = deck.scenes[sceneIndex]
  const selected = view.selected[0]
  const uid = (p: string) => `${p}-${Date.now().toString(36)}`
  const update = (fn: (d: LessonDeck) => void) => {
    const next = JSON.parse(JSON.stringify(deck)) as LessonDeck
    fn(next)
    onChange(next)
  }
  return (
    <div className="ot-studio">
      <Explorer key={`${scene?.id ?? 'new'}`} dataset={dataset} initialView={startView} title={scene?.title ?? deck.title} height={height} onViewChange={setView} />
      <div className="ot-studio-tools">
        <form
          className="ot-inspector-actions"
          onSubmit={(e) => {
            e.preventDefault()
            update((d) => {
              d.scenes.splice(sceneIndex + 1, 0, sceneFromView({ ...view, selected: [] }, { id: uid('scene'), title: title || `${labels.scene} ${d.scenes.length + 1}` }))
            })
            setTitle('')
            onAdded(sceneIndex + 1)
          }}
        >
          <label className="ot-select">
            <span>{labels.sceneTitle}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <button type="submit">
            <Icon name="plus" />
            {labels.addScene}
          </button>
        </form>
        {scene && (
          <form
            className="ot-inspector-actions"
            onSubmit={(e) => {
              e.preventDefault()
              if (!selected || !note.trim()) return
              update((d) => {
                d.scenes[sceneIndex]!.annotations.push({ id: uid('note'), text: note.trim(), target: { kind: 'node', node: selected } })
              })
              setNote('')
            }}
          >
            <label className="ot-select">
              <span>{labels.annotation}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} disabled={!selected} placeholder={selected ? '' : labels.selectToAnnotate} />
            </label>
            <button type="submit" disabled={!selected || !note.trim()}>
              <Icon name="info" />
              {labels.annotate}
            </button>
          </form>
        )}
        {scene && scene.annotations.length > 0 && (
          <ol className="ot-annotations">
            {scene.annotations.map((a) => (
              <li key={a.id}>
                {a.text}{' '}
                <button type="button" className="ot-remove" aria-label={`${labels.remove}: ${a.text}`} onClick={() => update((d) => void (d.scenes[sceneIndex]!.annotations = d.scenes[sceneIndex]!.annotations.filter((x) => x.id !== a.id)))}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
