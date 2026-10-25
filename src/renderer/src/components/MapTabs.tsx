import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { WORLD_MAP } from '../../../shared/types'
import type { MapSheet } from '../../../shared/types'
import { useWyrm } from '../store'
import { afterKeysUp } from '../lib/keys'
import { errorMessage } from '../lib/errors'
import {
  contentsOf,
  freshMapName,
  MAP_NAME_MAX,
  recordsOn,
  sheetOf,
  sheetsOf
} from '../lib/mapSheets'

type Asking =
  /** `from`: where focus goes back to — the tab, or the Rename… button. */
  { what: 'rename'; id: string; from: 'tab' | 'button' } | { what: 'clear' | 'delete'; id: string }

/**
 * F-12: the maps as file-folder tabs along the top of the map view — World
 * first, then the rest in the order they were made — with the map in view's
 * own business beside them: a new map, Rename…, Clear Map… and Delete
 * Map…. Clearing and deleting are confirmed, and checkpointed first, so
 * either can be got back from history (nothing is ever lost).
 *
 * The tabs are a WAI-ARIA tablist: the arrows (and Home and End) move along
 * them and choose as they go; a double-click renames. Every panel here keeps
 * Esc to itself (stopped: Esc is also "back"), and focus comes back to the
 * control that opened it once the key that closed it is up.
 */
export function MapTabs(): JSX.Element | null {
  const project = useWyrm((s) => s.project)
  const mapId = useWyrm((s) => s.mapId)
  const pins = useWyrm((s) => s.mapPins)
  const shapes = useWyrm((s) => s.mapShapes)
  const marks = useWyrm((s) => s.mapMarks)
  const chooseMap = useWyrm((s) => s.chooseMap)
  const addMap = useWyrm((s) => s.addMap)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [status, setStatus] = useState('')
  const strip = useRef<HTMLDivElement | null>(null)
  if (!project) return null
  const sheets = sheetsOf(project.data)
  const current = sheetOf(project.data, mapId)

  const focusTab = (id: string): void =>
    afterKeysUp(() => strip.current?.querySelector<HTMLElement>(`[data-map-tab="${id}"]`)?.focus())
  const focusControl = (name: string): void =>
    afterKeysUp(() => document.querySelector<HTMLElement>(`[data-map-action="${name}"]`)?.focus())

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const to =
      e.key === 'ArrowRight'
        ? (i + 1) % sheets.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + sheets.length) % sheets.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? sheets.length - 1
              : null
    if (to == null) return
    e.preventDefault()
    chooseMap(sheets[to].id)
    // The map below is mounted afresh; focus stays on the tab row.
    focusTab(sheets[to].id)
  }

  const newMap = async (): Promise<void> => {
    const id = await addMap(freshMapName(project.data))
    // Made with a name it can keep; offered at once to be given a better one.
    if (id) setAsking({ what: 'rename', id, from: 'tab' })
  }

  const counts = (id: string): string | null =>
    contentsOf({
      shapes: recordsOn(shapes, id, project.data).length,
      marks: recordsOn(marks, id, project.data).length,
      places: recordsOn(pins, id, project.data).length
    })

  return (
    <div className="map-tabs">
      <div className="map-tab-strip" role="tablist" aria-label="Maps" ref={strip}>
        {sheets.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            data-map-tab={m.id}
            id={`map-tab-${m.id}`}
            aria-controls="map-tab-panel"
            // The whole name, for a tab too narrow to show it.
            title={m.name}
            data-help="map-tabs"
            className={`map-tab${m.id === current.id ? ' on' : ''}`}
            aria-selected={m.id === current.id}
            tabIndex={m.id === current.id ? 0 : -1}
            onClick={() => chooseMap(m.id)}
            onDoubleClick={() => {
              chooseMap(m.id)
              setAsking({ what: 'rename', id: m.id, from: 'tab' })
            }}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {m.name}
          </button>
        ))}
      </div>
      {/* Beside the tabs, not among them: a tablist holds only tabs. */}
      <button
        type="button"
        className="map-tab add"
        data-help="map-tabs"
        data-map-action="new"
        aria-label="New map"
        onClick={() => void newMap()}
      >
        +
      </button>
      <span className="map-tab-actions" data-help="map-sheet-actions">
        <button
          type="button"
          className="board-tool"
          data-map-action="rename"
          aria-haspopup="dialog"
          onClick={() => setAsking({ what: 'rename', id: current.id, from: 'button' })}
        >
          <span className="board-tool-pin" aria-hidden="true" />
          <span>Rename…</span>
        </button>
        <button
          type="button"
          className="board-tool"
          data-map-action="clear"
          aria-haspopup="dialog"
          onClick={() => setAsking({ what: 'clear', id: current.id })}
        >
          <span className="board-tool-pin" aria-hidden="true" />
          <span>Clear Map…</span>
        </button>
        {current.id !== WORLD_MAP && (
          <button
            type="button"
            className="board-tool"
            data-map-action="delete"
            aria-haspopup="dialog"
            onClick={() => setAsking({ what: 'delete', id: current.id })}
          >
            <span className="board-tool-pin" aria-hidden="true" />
            <span>Delete Map…</span>
          </button>
        )}
      </span>
      <span className="sr-only" role="status">
        {status}
      </span>
      {asking?.what === 'rename' && (
        <RenamePanel
          sheet={sheetOf(project.data, asking.id)}
          onClose={(renamed) => {
            const { id, from } = asking
            setAsking(null)
            if (renamed) setStatus(`Map renamed ${renamed}.`)
            if (from === 'button') focusControl('rename')
            else focusTab(id)
          }}
        />
      )}
      {(asking?.what === 'clear' || asking?.what === 'delete') && (
        <ConfirmPanel
          what={asking.what}
          sheet={sheetOf(project.data, asking.id)}
          contents={counts(asking.id)}
          path={project.path}
          onClose={(done) => {
            const { what } = asking
            setAsking(null)
            if (done) setStatus(done)
            if (what === 'delete' && done) focusTab(WORLD_MAP)
            else focusControl(what)
          }}
        />
      )}
    </div>
  )
}

/** Naming a map: Return keeps the name, Esc keeps the old one. A name that
 *  will not do is said beside the field, never refused silently. */
function RenamePanel({
  sheet,
  onClose
}: {
  sheet: MapSheet
  onClose: (renamed?: string) => void
}): JSX.Element {
  const renameMap = useWyrm((s) => s.renameMap)
  const [value, setValue] = useState(sheet.name)
  const [problem, setProblem] = useState<string | null>(null)
  const field = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])

  const save = async (): Promise<void> => {
    if (value.trim() === sheet.name) return onClose()
    try {
      const wrong = await renameMap(sheet.id, value)
      if (wrong) setProblem(wrong)
      else onClose(value.trim())
    } catch (e) {
      setProblem(errorMessage(e))
    }
  }

  return (
    <div
      className="map-scale-panel map-sheet-panel"
      role="dialog"
      aria-label="Rename map"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else if (e.key === 'Enter' && (e.target as Element).tagName === 'INPUT') {
          e.preventDefault()
          e.stopPropagation()
          afterKeysUp(() => void save())
        }
      }}
    >
      <label className="map-scale-field">
        <span>Name of the map</span>
        <input
          ref={field}
          className="text-field"
          value={value}
          maxLength={MAP_NAME_MAX + 10}
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'map-rename-problem' : undefined}
          onChange={(e) => {
            setValue(e.target.value)
            setProblem(null)
          }}
        />
      </label>
      {problem && (
        <div id="map-rename-problem" className="map-name-problem map-scale-problem" role="alert">
          {problem}
        </div>
      )}
      <div className="dialog-buttons">
        <button type="button" className="btn" onClick={() => onClose()}>
          Cancel
        </button>
        <button type="button" className="btn default" onClick={() => void save()}>
          Rename
        </button>
      </div>
    </div>
  )
}

/**
 * Clearing or deleting a map, said in full before it happens: what goes
 * (counted), what stays (the World Book's places), and that a checkpoint
 * comes first. Cancel has focus, so a Return that arrives here by accident
 * takes nothing away.
 */
function ConfirmPanel({
  what,
  sheet,
  contents,
  path,
  onClose
}: {
  what: 'clear' | 'delete'
  sheet: MapSheet
  contents: string | null
  path: string
  /** `done` is what to tell a screen reader, once it is done. */
  onClose: (done?: string) => void
}): JSX.Element {
  const clearMap = useWyrm((s) => s.clearMap)
  const deleteMap = useWyrm((s) => s.deleteMap)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const cancel = useRef<HTMLButtonElement | null>(null)
  useEffect(() => cancel.current?.focus(), [])
  const nothing = what === 'clear' && contents == null

  const go = (): void => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    const act = what === 'clear' ? clearMap(path, sheet.id) : deleteMap(path, sheet.id)
    act
      .then(() => onClose(what === 'clear' ? `${sheet.name} cleared.` : `${sheet.name} deleted.`))
      .catch((e: unknown) => {
        setProblem(errorMessage(e))
        setBusy(false)
      })
  }

  const kept =
    'Places stay in the World Book. A checkpoint is made first, so it can be got back from History.'
  return (
    <div
      className="map-scale-panel map-sheet-panel"
      role="alertdialog"
      aria-label={what === 'clear' ? `Clear ${sheet.name}` : `Delete ${sheet.name}`}
      aria-describedby="map-confirm-text"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="field-name">{what === 'clear' ? 'CLEAR MAP' : 'DELETE MAP'}</div>
      <p id="map-confirm-text" className="map-confirm-text">
        {nothing
          ? `Nothing is drawn on ${sheet.name} yet, so there is nothing to clear.`
          : what === 'clear'
            ? `Take everything off ${sheet.name} — its ${contents}? Its size and scale stay. ${kept}`
            : `Delete ${sheet.name}${contents ? ` and everything on it — its ${contents}` : ''}? ${kept}`}
      </p>
      {problem && (
        <div className="map-name-problem map-scale-problem" role="alert">
          {problem}
        </div>
      )}
      <div className="dialog-buttons">
        {/* Cancel has focus, so Cancel is drawn as the default: what Return
            does is what the ring says. */}
        <button ref={cancel} type="button" className="btn default" onClick={() => onClose()}>
          {nothing ? 'OK' : 'Cancel'}
        </button>
        {!nothing && (
          <button type="button" className="btn" onClick={go} aria-busy={busy}>
            {busy
              ? what === 'clear'
                ? 'Clearing…'
                : 'Deleting…'
              : what === 'clear'
                ? 'Clear Map'
                : 'Delete Map'}
          </button>
        )}
      </div>
    </div>
  )
}
