import { SCHEMA_VERSION, TIME_UNITS, type DatasetSnapshot, type Id } from './model'

export type Severity = 'error' | 'warning' | 'info'

export type Diagnostic = {
  severity: Severity
  code: DiagnosticCode
  message: string
  /** JSON-path-like location, e.g. `phylogenies[0].edges[3]`. */
  path: string
  ids?: Id[]
  suggestion?: string
}

export type DiagnosticCode =
  | 'schema-version'
  | 'duplicate-id'
  | 'dangling-reference'
  | 'missing-source'
  | 'cycle'
  | 'multiple-parents'
  | 'self-edge'
  | 'length-without-unit'
  | 'negative-length'
  | 'time-without-calibration'
  | 'unrooted-with-rooting-note'
  | 'synonym-is-accepted'
  | 'empty-hierarchy'
  | 'illustrative-source'

/**
 * Checks a snapshot and explains every problem. Never mutates or repairs: errors make
 * the snapshot unusable (indexes would refuse it), warnings are scientific caveats.
 */
export function validateDataset(s: DatasetSnapshot): Diagnostic[] {
  const out: Diagnostic[] = []
  const add = (severity: Severity, code: DiagnosticCode, path: string, message: string, extra: Partial<Diagnostic> = {}) => out.push({ severity, code, path, message, ...extra })

  if (s.schemaVersion !== SCHEMA_VERSION) add('error', 'schema-version', 'schemaVersion', `Schema version ${s.schemaVersion} is not supported (expected ${SCHEMA_VERSION}).`, { suggestion: 'Migrate the snapshot with the matching @captiveorigins/onetaxonomy-import release.' })

  // Identity: ids are unique within each record family.
  const unique = (family: string, ids: Id[]) => {
    const seen = new Set<Id>()
    ids.forEach((id, i) => {
      if (seen.has(id)) add('error', 'duplicate-id', `${family}[${i}]`, `Duplicate ${family} id “${id}”.`, { ids: [id], suggestion: 'Give each record its own opaque id; never reuse a name as an id.' })
      seen.add(id)
    })
    return seen
  }
  const sources = unique('sources', s.sources.map((x) => x.id))
  const names = unique('names', s.names.map((x) => x.id))
  const concepts = unique('concepts', s.concepts.map((x) => x.id))
  unique('classifications', s.classifications.map((x) => x.id))
  unique('phylogenies', s.phylogenies.map((x) => x.id))

  const needSource = (path: string, id: Id | undefined) => {
    if (id !== undefined && !sources.has(id)) add('error', 'missing-source', path, `Source “${id}” is not listed in sources.`, { ids: [id], suggestion: 'Add the source record (citation, license, version) or fix the reference.' })
  }
  s.sources.forEach((src, i) => {
    if (src.illustrative) add('info', 'illustrative-source', `sources[${i}]`, `“${src.title}” is illustrative data, not for scientific use.`)
  })

  s.concepts.forEach((c, i) => {
    const p = `concepts[${i}]`
    if (!names.has(c.acceptedName)) add('error', 'dangling-reference', `${p}.acceptedName`, `Concept “${c.id}” names unknown accepted name “${c.acceptedName}”.`, { ids: [c.id, c.acceptedName] })
    c.usages?.forEach((u, j) => {
      if (!names.has(u.name)) add('error', 'dangling-reference', `${p}.usages[${j}]`, `Concept “${c.id}” has a usage of unknown name “${u.name}”.`, { ids: [c.id, u.name] })
      if (u.name === c.acceptedName && u.status === 'synonym') add('warning', 'synonym-is-accepted', `${p}.usages[${j}]`, `Concept “${c.id}” lists its accepted name as a synonym.`, { ids: [c.id] })
      needSource(`${p}.usages[${j}].source`, u.source)
    })
    c.externalIds?.forEach((x, j) => needSource(`${p}.externalIds[${j}].source`, x.source))
    needSource(`${p}.provenance.source`, c.provenance?.source)
  })

  const hierarchy = (path: string, ids: Id[], links: [Id, Id | null][]) => {
    if (!ids.length) add('warning', 'empty-hierarchy', path, 'The hierarchy has no members.')
    const parent = new Map<Id, Id | null>()
    links.forEach(([c, p], i) => {
      if (parent.has(c)) add('error', 'multiple-parents', `${path}[${i}]`, `“${c}” has more than one parent; a classification or tree gives each member one.`, { ids: [c], suggestion: 'Keep alternative placements in a separate classification or hypothesis.' })
      if (c === p) add('error', 'self-edge', `${path}[${i}]`, `“${c}” is its own parent.`, { ids: [c] })
      parent.set(c, p)
    })
    // Cycle check: walk up from every member, bounded by the member count.
    const known = new Set(ids)
    const reported = new Set<Id>()
    for (const start of ids) {
      let x: Id | null | undefined = start
      for (let steps = 0; x != null && steps <= ids.length; steps++) x = parent.get(x) ?? null
      if (x != null && !reported.has(x)) {
        const cycle: Id[] = []
        let y: Id | null | undefined = x
        do {
          cycle.push(y!)
          reported.add(y!)
          y = parent.get(y!) ?? null
        } while (y != null && y !== x && cycle.length <= ids.length)
        add('error', 'cycle', path, `Cycle: ${cycle.join(' → ')} → ${x}.`, { ids: cycle, suggestion: 'Check the parent references of these members.' })
      }
    }
    links.forEach(([c, p], i) => {
      if (!known.has(c) || (p !== null && !known.has(p))) add('error', 'dangling-reference', `${path}[${i}]`, `Link ${p} → ${c} names a member that isn’t in this hierarchy.`, { ids: [c, ...(p ? [p] : [])] })
    })
  }

  s.classifications.forEach((c, i) => {
    const p = `classifications[${i}]`
    c.sources.forEach((x, j) => needSource(`${p}.sources[${j}]`, x))
    c.placements.forEach((pl, j) => {
      if (!concepts.has(pl.concept)) add('error', 'dangling-reference', `${p}.placements[${j}]`, `Placement names unknown concept “${pl.concept}”.`, { ids: [pl.concept] })
      needSource(`${p}.placements[${j}].provenance.source`, pl.provenance?.source)
    })
    hierarchy(`${p}.placements`, c.placements.map((x) => x.concept), c.placements.map((x) => [x.concept, x.parent]))
  })

  s.phylogenies.forEach((t, i) => {
    const p = `phylogenies[${i}]`
    t.sources.forEach((x, j) => needSource(`${p}.sources[${j}]`, x))
    unique(`${p}.nodes`, t.nodes.map((n) => n.id))
    unique(`${p}.edges`, t.edges.map((e) => e.id))
    t.nodes.forEach((n, j) =>
      n.concepts?.forEach((c) => {
        if (!concepts.has(c)) add('error', 'dangling-reference', `${p}.nodes[${j}].concepts`, `Node “${n.id}” maps to unknown concept “${c}”.`, { ids: [n.id, c] })
      }),
    )
    hierarchy(`${p}.edges`, t.nodes.map((n) => n.id), t.edges.map((e) => [e.child, e.parent]))
    const withLength = t.edges.filter((e) => e.length !== undefined)
    if (withLength.length && (!t.lengthUnit || t.lengthUnit === 'unspecified'))
      add('warning', 'length-without-unit', `${p}.lengthUnit`, `Branch lengths have no unit: they can’t be read as time or change.`, { suggestion: 'Set lengthUnit (e.g. substitutions-per-site or Ma) from the source.' })
    t.edges.forEach((e, j) => {
      if (e.length !== undefined && e.length < 0) add('warning', 'negative-length', `${p}.edges[${j}]`, `Edge “${e.id}” has a negative length (${e.length}).`, { ids: [e.id] })
    })
    if (t.timeCalibrated && !(t.lengthUnit && TIME_UNITS.includes(t.lengthUnit)))
      add('error', 'time-without-calibration', `${p}.timeCalibrated`, 'The hypothesis says it is time-calibrated but its length unit is not a time unit.', { suggestion: 'Use Ma, ka or years, or drop timeCalibrated.' })
    if (!t.rooted && t.rooting) add('warning', 'unrooted-with-rooting-note', `${p}.rooting`, 'A rooting is described but the hypothesis is marked unrooted.')
  })

  s.profiles?.forEach((pr, i) => {
    if (!concepts.has(pr.concept)) add('error', 'dangling-reference', `profiles[${i}].concept`, `Profile for unknown concept “${pr.concept}”.`, { ids: [pr.concept] })
  })
  s.traits?.forEach((t, i) => {
    const p = `traits[${i}]`
    needSource(`${p}.source`, t.source)
    const states = new Set(t.states.map((x) => x.id))
    const seen = new Set<Id>()
    t.values.forEach((v, j) => {
      if (!concepts.has(v.concept)) add('error', 'dangling-reference', `${p}.values[${j}].concept`, `Trait value for unknown concept “${v.concept}”.`, { ids: [v.concept] })
      if (!states.has(v.state)) add('error', 'dangling-reference', `${p}.values[${j}].state`, `Unknown state “${v.state}” in “${t.title}”.`, { ids: [v.state] })
      if (seen.has(v.concept)) add('error', 'duplicate-id', `${p}.values[${j}]`, `“${t.title}” states a value for “${v.concept}” twice.`, { ids: [v.concept], suggestion: 'One value per concept; describe polymorphism as its own state.' })
      seen.add(v.concept)
    })
  })
  unique('traits', (s.traits ?? []).map((x) => x.id))
  return out
}

export const hasErrors = (d: Diagnostic[]) => d.some((x) => x.severity === 'error')
