import { createView, indexDataset, parseView, serializeView, validateDataset, validateView, type DatasetSnapshot, type TaxonomicView } from '@captiveorigins/onetaxonomy-core'
import type { ChecklistColumns } from '@captiveorigins/onetaxonomy-import'
import { Explorer } from '@captiveorigins/onetaxonomy-react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'

import { pickDataset, pickView, saveJson, type PickedFile } from './files'
import { COLUMN_KEYS, delimiterOf, kindOf, newickQuestions, openDwca, openNewick, openSnapshot, openTable, sealedJson, suggestColumns, tableHeader, targetsOf, type ColumnKey, type Opened, type Target } from './open'
import { StatusBar } from './StatusBar'
import { checkForUpdates, IN_APP_UPDATES, loadSettings, saveSettings, type Settings } from './updates'

const COLUMN_LABELS: Record<ColumnKey, string> = {
  taxonID: 'Taxon ID (required)',
  name: 'Scientific name (required)',
  parentID: 'Parent ID',
  acceptedID: 'Accepted ID (for synonyms)',
  status: 'Status',
  rank: 'Rank',
  authorship: 'Authorship',
}

type Pending =
  | { kind: 'newick'; file: PickedFile; rooted: boolean; supportMethods: number }
  | { kind: 'table'; file: PickedFile; header: string[]; delimiter: string; columns: Partial<Record<ColumnKey, string>> }

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function App() {
  const [snapshot, setSnapshot] = useState<DatasetSnapshot | null>(null)
  const [fileName, setFileName] = useState('')
  const [notices, setNotices] = useState<string[]>([])
  const [seal, setSeal] = useState('')
  const [status, setStatus] = useState('')
  const [targetKey, setTargetKey] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [settings, setSettings] = useState<Settings>({ autoUpdate: true, appearance: 'auto' })
  const [showSettings, setShowSettings] = useState(false)
  const [loadedView, setLoadedView] = useState<TaxonomicView | null>(null)
  const [viewKey, setViewKey] = useState(0)
  const currentView = useRef<TaxonomicView | null>(null)

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s)
      if (IN_APP_UPDATES && s.autoUpdate) void checkForUpdates(false).then((m) => m && setStatus(m))
    })
  }, [])
  useEffect(() => {
    if (settings.appearance === 'auto') document.documentElement.removeAttribute('data-appearance')
    else document.documentElement.setAttribute('data-appearance', settings.appearance)
  }, [settings.appearance])

  // A saved view belongs to what's on screen: forget it whenever the Explorer starts over.
  useEffect(() => {
    currentView.current = null
  }, [viewKey])

  const dataset = useMemo(() => (snapshot ? indexDataset(snapshot) : null), [snapshot])
  const targets = useMemo(() => (snapshot ? targetsOf(snapshot) : []), [snapshot])
  const key = (t: Target) => `${t.kind}:${t.id}`
  const target = targets.find((t) => key(t) === targetKey) ?? targets[0]
  const view = useMemo(() => {
    if (loadedView) return loadedView
    return dataset && target ? createView(dataset, { id: 'main', title: target.title, target: { kind: target.kind, id: target.id } }) : null
  }, [dataset, target, loadedView])

  const show = (opened: Opened, path: string) => {
    // Throws on a dataset that can't be shown, so it reaches the caller's error message rather than a blank window.
    const index = indexDataset(opened.snapshot)
    const first = targetsOf(opened.snapshot)[0]
    if (first) createView(index, { id: 'main', title: first.title, target: { kind: first.kind, id: first.id } })
    const problems = validateDataset(opened.snapshot).filter((d) => d.severity === 'error').length
    setSnapshot(opened.snapshot)
    setFileName(baseName(path))
    setNotices(opened.notices)
    setSeal(opened.seal ?? '')
    setTargetKey('')
    setLoadedView(null)
    setPending(null)
    setViewKey((n) => n + 1)
    setStatus(targetsOf(opened.snapshot).length ? `Opened ${baseName(path)}.${problems ? ` ${problems} problems found; see the list below.` : ''}` : `${baseName(path)} has no classification or tree to show. Check that it's the right file, or map its columns differently.`)
  }

  const fail = (what: string, e: unknown, next: string) => setStatus(`Could not ${what}: ${message(e)} ${next}`)

  const open = async () => {
    try {
      const file = await pickDataset()
      if (!file) return
      const now = new Date().toISOString()
      const kind = kindOf(file.path)
      if (kind === 'snapshot') show(openSnapshot(file.text), file.path)
      else if (kind === 'dwca') show(await openDwca(file.bytes!, file.path, now), file.path)
      else if (kind === 'newick') {
        const q = newickQuestions(file.text)
        if (q.rooted || q.supportMethods) setPending({ kind: 'newick', file, ...q })
        else show(openNewick(file.text, file.path, {}, now), file.path)
      } else {
        const delimiter = delimiterOf(file.path, file.text)
        const header = tableHeader(file.text, delimiter)
        setPending({ kind: 'table', file, header, delimiter, columns: suggestColumns(header) })
      }
    } catch (e) {
      fail('open that file', e, 'Check that it is a checklist, Darwin Core Archive, Newick tree or OneTaxonomy snapshot, then try again.')
    }
  }

  const openView = async () => {
    if (!dataset) return
    try {
      const text = await pickView()
      if (!text) return
      const v = parseView(text)
      const issues = validateView(v, dataset)
      const errors = issues.filter((d) => d.severity === 'error')
      if (errors.length) {
        setStatus(`Could not open that view: ${errors[0]!.message} Open the dataset it was made from, then try again.`)
        return
      }
      setLoadedView(v)
      setViewKey((n) => n + 1)
      setNotices(issues.map((d) => d.message))
      setStatus('View opened.')
    } catch (e) {
      fail('open that view', e, 'Check that it was saved from OneTaxonomy, then try again.')
    }
  }

  const save = async (name: string, text: () => string, done: string) => {
    try {
      const path = await saveJson(name, text())
      if (path) setStatus(`${done} ${baseName(path)}.`)
    } catch (e) {
      fail('save', e, 'Nothing was changed. Try another location.')
    }
  }

  const changeSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    void saveSettings(next).catch((e) => fail('save settings', e, 'They apply until you close the app.'))
  }

  return (
    <>
      <header className="app-header">
        <span className="app-title">{fileName || 'OneTaxonomy'}</span>
        <button type="button" onClick={() => void open()}>Open…</button>
        <button type="button" disabled={!dataset} onClick={() => void openView()}>Open view…</button>
        <button type="button" disabled={!view} onClick={() => void save(`${fileName.replace(/\.[^.]+$/, '') || 'view'}.view.json`, () => serializeView(currentView.current ?? view!), 'Saved view to')}>Save view…</button>
        <button type="button" disabled={!snapshot} onClick={() => void save(`${snapshot?.id ?? 'dataset'}.snapshot.json`, () => sealedJson(snapshot!), 'Saved snapshot to')}>Save snapshot…</button>
        {targets.length > 1 && (
          <label>
            Show{' '}
            <select
              value={target ? key(target) : ''}
              onChange={(e) => {
                setTargetKey(e.target.value)
                setLoadedView(null)
                setViewKey((n) => n + 1)
              }}
            >
              {targets.map((t) => (
                <option key={key(t)} value={key(t)}>{t.kind === 'phylogeny' ? 'Tree' : 'Classification'}: {t.title}</option>
              ))}
            </select>
          </label>
        )}
        <span className="app-spacer" />
        <button type="button" disabled={!view} onClick={() => void invoke('print_window').catch((e) => fail('print', e, 'Try again.'))}>Print</button>
        <button type="button" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)}>Settings</button>
      </header>
      <StatusBar status={status} seal={seal} notices={notices} />
      <main className="app-main">
        {showSettings ? (
          <SettingsPanel settings={settings} onChange={changeSettings} onCheck={() => void checkForUpdates(true).then((m) => m && setStatus(m))} onClose={() => setShowSettings(false)} />
        ) : pending?.kind === 'newick' ? (
          <NewickForm
            pending={pending}
            onCancel={() => setPending(null)}
            onOpen={(rooted, supportMethods) => {
              try {
                show(openNewick(pending.file.text, pending.file.path, { ...(pending.rooted ? { rooted } : {}), supportMethods }, new Date().toISOString()), pending.file.path)
              } catch (e) {
                fail('read that tree', e, 'Check that it is valid Newick, then try again.')
              }
            }}
          />
        ) : pending?.kind === 'table' ? (
          <TableForm
            pending={pending}
            onCancel={() => setPending(null)}
            onOpen={(columns) => {
              try {
                show(openTable(pending.file.text, pending.file.path, columns, pending.delimiter, new Date().toISOString()), pending.file.path)
              } catch (e) {
                fail('read that table', e, 'Check the column choices, then try again.')
              }
            }}
          />
        ) : dataset && view ? (
          <Explorer key={viewKey} dataset={dataset} initialView={view} title={view.title} height="calc(100vh - 110px)" onViewChange={(v) => { currentView.current = v }} />
        ) : (
          <section className="app-panel">
            <h2>Open a dataset</h2>
            <p className="app-hint">A CSV or TSV checklist, a Darwin Core Archive (.zip), a Newick tree, or a OneTaxonomy snapshot. Your file is read on this Mac and is never changed.</p>
            <button type="button" onClick={() => void open()}>Open…</button>
          </section>
        )}
      </main>
    </>
  )
}

function NewickForm({ pending, onOpen, onCancel }: { pending: Extract<Pending, { kind: 'newick' }>; onOpen: (rooted: boolean, supportMethods: string[]) => void; onCancel: () => void }) {
  const [rooted, setRooted] = useState('')
  const [methods, setMethods] = useState('')
  const names = methods.split(',').map((m) => m.trim()).filter(Boolean)
  const ready = (!pending.rooted || rooted !== '') && (!pending.supportMethods || names.length === pending.supportMethods)
  return (
    <section className="app-panel">
      <h2>About {baseName(pending.file.path)}</h2>
      <p className="app-hint">The file doesn't say, so OneTaxonomy won't guess.</p>
      {pending.rooted && (
        <label className="app-field">
          Is this tree rooted?
          <select value={rooted} onChange={(e) => setRooted(e.target.value)}>
            <option value="">Choose…</option>
            <option value="yes">Yes, the root is known</option>
            <option value="no">No, or I'm not sure</option>
          </select>
        </label>
      )}
      {pending.supportMethods > 0 && (
        <label className="app-field">
          Its nodes carry {pending.supportMethods} support values each. Name the methods in order, separated by commas.
          <input value={methods} placeholder="SH-aLRT, UFBoot" onChange={(e) => setMethods(e.target.value)} />
        </label>
      )}
      <div className="app-row">
        <button type="button" disabled={!ready} onClick={() => onOpen(rooted === 'yes', names)}>Open tree</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}

function TableForm({ pending, onOpen, onCancel }: { pending: Extract<Pending, { kind: 'table' }>; onOpen: (columns: ChecklistColumns) => void; onCancel: () => void }) {
  const [columns, setColumns] = useState(pending.columns)
  const { taxonID, name } = columns
  return (
    <section className="app-panel">
      <h2>Columns in {baseName(pending.file.path)}</h2>
      <p className="app-hint">Check these choices. Matches come from the column names alone.</p>
      {COLUMN_KEYS.map((k) => (
        <label className="app-field" key={k}>
          {COLUMN_LABELS[k]}
          <select value={columns[k] ?? ''} onChange={(e) => setColumns({ ...columns, [k]: e.target.value || undefined })}>
            <option value="">Not in this file</option>
            {pending.header.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      ))}
      <div className="app-row">
        <button type="button" disabled={!taxonID || !name} onClick={() => onOpen({ ...Object.fromEntries(Object.entries(columns).filter(([, v]) => v)), taxonID: taxonID!, name: name! })}>Open table</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}

export function SettingsPanel({ settings, onChange, onCheck, onClose }: { settings: Settings; onChange: (patch: Partial<Settings>) => void; onCheck: () => void; onClose: () => void }) {
  return (
    <section className="app-panel">
      <h2>Settings</h2>
      <label className="app-field">
        Appearance
        <select value={settings.appearance} onChange={(e) => onChange({ appearance: e.target.value as Settings['appearance'] })}>
          <option value="auto">Auto (follow the system)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      {IN_APP_UPDATES && (
        <label className="app-field" style={{ display: 'flex', gap: 8 }}>
          <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => onChange({ autoUpdate: e.target.checked })} />
          Check for updates when the app opens
        </label>
      )}
      <div className="app-row">
        {IN_APP_UPDATES && <button type="button" onClick={onCheck}>Check now</button>}
        <button type="button" onClick={onClose}>Done</button>
      </div>
    </section>
  )
}
