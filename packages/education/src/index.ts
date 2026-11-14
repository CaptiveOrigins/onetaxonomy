import {
  applyViewAction,
  canonicalJson,
  describeAssessment,
  findMRCA,
  isMonophyletic,
  validateView,
  viewTree,
  type DatasetIndex,
  type Id,
  type PhylogenyIndex,
  type TaxonomicView,
  type ViewAction,
} from '@extantape/onetaxonomy-core'

/**
 * Lessons (M5): portable decks of scenes over one pinned snapshot. A scene is a
 * view (what the class sees), a camera, annotations and reveal steps; steps are
 * ordinary view actions, so a live session (Phase 2) only has to sync step numbers.
 * Worksheet answers are never stored: they are computed by the core science
 * functions from the pinned snapshot, so a lesson can't teach a stale answer.
 */
export const LESSON_FORMAT_VERSION = 1 as const

/** Where the drawing looks: centered on a node (or the whole tree), zoom 1 = fit. */
export type Camera = { focus?: Id | null; zoom?: number }

export type Annotation = {
  id: Id
  text: string
  target: { kind: 'node'; node: Id } | { kind: 'group'; members: Id[] } | { kind: 'scene' }
  tone?: 'note' | 'question' | 'caution'
  /** Shown from this reveal step on (absent = from the start). */
  from?: Id
}

export type RevealStep = {
  id: Id
  caption?: string
  /** Applied in order on top of the previous steps. */
  actions: ViewAction[]
  camera?: Camera
}

export type Scene = {
  id: Id
  title: string
  view: TaxonomicView
  camera?: Camera
  annotations: Annotation[]
  steps: RevealStep[]
  /** For the teacher only (not shown to students). */
  notes?: string
}

export type Question =
  /** Do these taxa form a clade in the scene's hypothesis? (yes / no / can't tell) */
  | { id: Id; kind: 'is-clade'; members: Id[]; prompt?: string }
  /** Which node is the most recent common ancestor of these taxa? */
  | { id: Id; kind: 'mrca'; members: Id[]; prompt?: string }
  /** Which taxa must be added to make this a clade? */
  | { id: Id; kind: 'missing'; members: Id[]; prompt?: string }
  /** Open question answered by the teacher (optional model answer). */
  | { id: Id; kind: 'open'; prompt: string; modelAnswer?: string }

export type Worksheet = { id: Id; title: string; scene: Id; questions: Question[] }

export type LessonDeck = {
  format: 'onetaxonomy-lesson'
  formatVersion: typeof LESSON_FORMAT_VERSION
  id: Id
  title: string
  version: string
  snapshot: { id: Id; version: string; checksum?: string }
  authors?: string[]
  /** License of the lesson text (the data keeps its own sources' licenses). */
  license?: string
  audience?: string
  scenes: Scene[]
  worksheets: Worksheet[]
}

export function createLesson(dataset: DatasetIndex, o: { id: Id; title: string; version?: string }): LessonDeck {
  const s = dataset.snapshot
  return {
    format: 'onetaxonomy-lesson',
    formatVersion: LESSON_FORMAT_VERSION,
    id: o.id,
    title: o.title,
    version: o.version ?? '1',
    snapshot: { id: s.id, version: s.version, ...(s.checksum ? { checksum: s.checksum } : {}) },
    scenes: [],
    worksheets: [],
  }
}

/** A scene from the view a teacher is looking at. */
export function sceneFromView(view: TaxonomicView, o: { id: Id; title: string; camera?: Camera }): Scene {
  return { id: o.id, title: o.title, view: JSON.parse(JSON.stringify(view)) as TaxonomicView, ...(o.camera ? { camera: o.camera } : {}), annotations: [], steps: [] }
}

export type SceneFrame = {
  view: TaxonomicView
  camera: Camera
  /** Annotations visible at this step, in order. */
  annotations: Annotation[]
  caption?: string
  step: number
  steps: number
}

/** The scene after reveal steps 1…`step` (0 = the scene as it opens). */
export function sceneAt(scene: Scene, step: number, dataset: DatasetIndex): SceneFrame {
  const n = Math.max(0, Math.min(step, scene.steps.length))
  let view = scene.view
  let camera: Camera = scene.camera ?? {}
  const reached = new Set<Id>()
  for (const s of scene.steps.slice(0, n)) {
    for (const a of s.actions) view = applyViewAction(view, a, dataset)
    if (s.camera) camera = s.camera
    reached.add(s.id)
  }
  const caption = n > 0 ? scene.steps[n - 1]!.caption : undefined
  return {
    view,
    camera,
    annotations: scene.annotations.filter((a) => !a.from || reached.has(a.from)),
    ...(caption ? { caption } : {}),
    step: n,
    steps: scene.steps.length,
  }
}

export type LessonDiagnostic = { severity: 'error' | 'warning'; code: string; message: string; path: string }

/** Everything that would break or mislead when the lesson is opened over this snapshot. */
export function validateLesson(deck: LessonDeck, dataset: DatasetIndex): LessonDiagnostic[] {
  const out: LessonDiagnostic[] = []
  const add = (severity: LessonDiagnostic['severity'], code: string, path: string, message: string) => out.push({ severity, code, path, message })
  if (deck.format !== 'onetaxonomy-lesson' || deck.formatVersion !== LESSON_FORMAT_VERSION) add('error', 'format', '', `Not a version ${LESSON_FORMAT_VERSION} OneTaxonomy lesson`)
  const s = dataset.snapshot
  if (deck.snapshot.id !== s.id || deck.snapshot.version !== s.version || (deck.snapshot.checksum && s.checksum && deck.snapshot.checksum !== s.checksum))
    add('warning', 'snapshot-mismatch', 'snapshot', `Lesson was written for ${deck.snapshot.id} ${deck.snapshot.version}; this is ${s.id} ${s.version}. Answers are recomputed from this snapshot: check them before class.`)
  const ids = new Set<Id>()
  const unique = (id: Id, path: string) => {
    if (ids.has(id)) add('error', 'duplicate-id', path, `Duplicate id “${id}”`)
    ids.add(id)
  }
  const scenes = new Map<Id, Scene>()
  deck.scenes.forEach((scene, i) => {
    const p = `scenes[${i}]`
    unique(scene.id, p)
    scenes.set(scene.id, scene)
    for (const d of validateView(scene.view, dataset)) if (d.code !== 'snapshot-mismatch') add(d.severity, `view-${d.code}`, `${p}.view`, d.message)
    let tree
    try {
      tree = viewTree(dataset, scene.view)
    } catch {
      return
    }
    const known = (id: Id) => tree.parent.has(id)
    let view = scene.view
    scene.steps.forEach((step, j) => {
      unique(step.id, `${p}.steps[${j}]`)
      for (const a of step.actions) {
        try {
          view = applyViewAction(view, a, dataset)
        } catch (e) {
          add('error', 'bad-step', `${p}.steps[${j}]`, `Step “${step.caption ?? step.id}” can't be applied: ${(e as Error).message}`)
        }
      }
      if (step.camera?.focus && !known(step.camera.focus)) add('error', 'unknown-node', `${p}.steps[${j}].camera`, `Camera focus ${step.camera.focus} isn't in this hierarchy`)
    })
    if (scene.camera?.focus && !known(scene.camera.focus)) add('error', 'unknown-node', `${p}.camera`, `Camera focus ${scene.camera.focus} isn't in this hierarchy`)
    const stepIds = new Set(scene.steps.map((x) => x.id))
    scene.annotations.forEach((a, j) => {
      unique(a.id, `${p}.annotations[${j}]`)
      const targets = a.target.kind === 'node' ? [a.target.node] : a.target.kind === 'group' ? a.target.members : []
      for (const t of targets) if (!known(t)) add('error', 'unknown-node', `${p}.annotations[${j}]`, `Annotation “${a.text.slice(0, 40)}” points at ${t}, which isn't in this hierarchy`)
      if (a.from && !stepIds.has(a.from)) add('error', 'unknown-step', `${p}.annotations[${j}]`, `Annotation shown from unknown step ${a.from}`)
    })
  })
  deck.worksheets.forEach((w, i) => {
    const p = `worksheets[${i}]`
    unique(w.id, p)
    const scene = scenes.get(w.scene)
    if (!scene) return add('error', 'unknown-scene', p, `Worksheet “${w.title}” uses unknown scene ${w.scene}`)
    w.questions.forEach((q, j) => {
      unique(q.id, `${p}.questions[${j}]`)
      if (q.kind === 'open') return
      if (scene.view.target.kind !== 'phylogeny') return add('error', 'needs-phylogeny', `${p}.questions[${j}]`, 'Clade and common-ancestor questions need a scene showing a rooted phylogeny, not a classification')
      const tree = dataset.phylogeny(scene.view.target.id)
      if (!tree.rooted) add('error', 'needs-rooted', `${p}.questions[${j}]`, 'An unrooted hypothesis states no ancestry: use a rooted one')
      const unknown = q.members.filter((m) => !tree.parent.has(m))
      if (unknown.length) add('error', 'unknown-node', `${p}.questions[${j}]`, `${unknown.join(', ')} not in the scene's hypothesis`)
      if (q.members.length < (q.kind === 'mrca' ? 2 : 1)) add('error', 'too-few', `${p}.questions[${j}]`, 'Pick more taxa')
    })
  })
  return out
}

const nameOf = (dataset: DatasetIndex, p: PhylogenyIndex, id: Id): string => {
  const n = p.node.get(id)
  if (n?.label) return n.label
  if (n?.concepts?.length) return n.concepts.map((c) => dataset.nameOf(c) ?? c).join(' / ')
  return 'an unnamed ancestor'
}

export type Answer =
  | { question: Id; kind: 'is-clade'; answer: 'yes' | 'no' | 'cant-tell'; explanation: string[] }
  | { question: Id; kind: 'mrca'; answer: Id | null; label: string | null; explanation: string[] }
  | { question: Id; kind: 'missing'; answer: Id[]; labels: string[]; explanation: string[] }
  | { question: Id; kind: 'open'; answer: string | null; explanation: string[] }

/** The answer to one question, computed from the snapshot (never stored in the lesson). */
export function answerQuestion(q: Question, scene: Scene, dataset: DatasetIndex): Answer {
  if (q.kind === 'open') return { question: q.id, kind: 'open', answer: q.modelAnswer ?? null, explanation: [] }
  const p = dataset.phylogeny(scene.view.target.id)
  const result = isMonophyletic(p, q.members)
  const words = describeAssessment(dataset, result)
  const explanation = [words.headline, ...words.details]
  if (q.kind === 'is-clade')
    return { question: q.id, kind: 'is-clade', answer: result.status === 'monophyletic' ? 'yes' : result.status === 'not-monophyletic' ? 'no' : 'cant-tell', explanation }
  if (q.kind === 'mrca') {
    const m = findMRCA(p, q.members)
    return m.status === 'found'
      ? { question: q.id, kind: 'mrca', answer: m.node, label: nameOf(dataset, p, m.node), explanation: [`Their most recent common ancestor is ${nameOf(dataset, p, m.node)}.`, ...(result.caveats.length ? words.details : [])] }
      : { question: q.id, kind: 'mrca', answer: null, label: null, explanation }
  }
  // Tips the selection leaves out (only meaningful when the answer is "not a clade" because of them).
  const missing = result.reason === 'missing-descendants' ? result.missing : []
  return { question: q.id, kind: 'missing', answer: missing, labels: missing.map((m) => nameOf(dataset, p, m)), explanation }
}

export type Response = { kind: 'is-clade'; value: 'yes' | 'no' | 'cant-tell' } | { kind: 'mrca'; value: Id } | { kind: 'missing'; value: Id[] }

/** Checks a student's response (the same evaluation a live session's server will run). */
export function checkResponse(q: Question, response: Response, scene: Scene, dataset: DatasetIndex): { correct: boolean; answer: Answer } {
  const answer = answerQuestion(q, scene, dataset)
  let correct = false
  if (answer.kind === 'is-clade' && response.kind === 'is-clade') correct = response.value === answer.answer
  if (answer.kind === 'mrca' && response.kind === 'mrca') correct = response.value === answer.answer
  if (answer.kind === 'missing' && response.kind === 'missing') correct = response.value.length === answer.answer.length && answer.answer.every((m) => response.value.includes(m))
  return { correct, answer }
}

const DEFAULT_PROMPTS = {
  'is-clade': (names: string) => `Do ${names} form a clade? (yes / no / can't tell)`,
  mrca: (names: string) => `Which node is the most recent common ancestor of ${names}?`,
  missing: (names: string) => `Which taxa would you add to ${names} to make a clade?`,
}

/** A printable worksheet (Markdown), optionally with the computed answer key. */
export function worksheetMarkdown(deck: LessonDeck, worksheetId: Id, dataset: DatasetIndex, { answers = false }: { answers?: boolean } = {}): string {
  const w = deck.worksheets.find((x) => x.id === worksheetId)
  if (!w) throw new RangeError(`Unknown worksheet ${worksheetId}`)
  const scene = deck.scenes.find((s) => s.id === w.scene)
  if (!scene) throw new RangeError(`Unknown scene ${w.scene}`)
  const tree = viewTree(dataset, scene.view)
  const label = (id: Id) => (tree.kind === 'phylogeny' ? nameOf(dataset, tree as PhylogenyIndex, id) : (dataset.nameOf(id) ?? id))
  const lines = [`# ${w.title}`, '', `${deck.title} · ${scene.title}`, '']
  w.questions.forEach((q, i) => {
    const names = q.kind === 'open' ? '' : q.members.map(label).join(', ')
    lines.push(`${i + 1}. ${q.prompt ?? (q.kind === 'open' ? '' : DEFAULT_PROMPTS[q.kind](names))}`, '')
    if (!answers) {
      lines.push('   ______________________________________________', '')
      return
    }
    const a = answerQuestion(q, scene, dataset)
    const short =
      a.kind === 'is-clade' ? { yes: 'Yes', no: 'No', 'cant-tell': "Can't tell" }[a.answer]
      : a.kind === 'mrca' ? (a.label ?? "Can't tell")
      : a.kind === 'missing' ? (a.labels.length ? a.labels.join(', ') : 'Nothing: it is already a clade, or it cannot be decided here')
      : (a.answer ?? '(teacher marks)')
    lines.push(`   **Answer:** ${short}`, ...a.explanation.map((e) => `   ${e}`), '')
  })
  lines.push(`Data: snapshot ${deck.snapshot.id} ${deck.snapshot.version}. Answers are computed from this snapshot, relative to the hypothesis shown.`)
  return lines.join('\n')
}

export const serializeLesson = (deck: LessonDeck): string => canonicalJson(deck)

export function parseLesson(text: string): LessonDeck {
  const deck = JSON.parse(text) as LessonDeck
  if (deck?.format !== 'onetaxonomy-lesson' || deck.formatVersion !== LESSON_FORMAT_VERSION) throw new Error(`Not a version ${LESSON_FORMAT_VERSION} OneTaxonomy lesson`)
  return deck
}
