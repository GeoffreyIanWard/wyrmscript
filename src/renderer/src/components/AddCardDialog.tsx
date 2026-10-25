import { useState } from 'react'
import type { JSX } from 'react'
import type { Entity } from '../../../shared/types'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'
import { errorMessage } from '../lib/errors'
import type { CardKind } from '../lib/corkboard'
import { mapNameProblem, sheetsOf } from '../lib/mapSheets'

const KIND_LABEL: Record<CardKind, string> = {
  scene: 'Scene',
  character: 'Character',
  location: 'Location',
  map: 'Map'
}

/**
 * Add a card to the corkboard (F-45).
 *
 * One question first — what kind of card — because the answer decides what
 * gets made: a scene is a new document in the manuscript, a character or
 * location is a story-bible entry. For the two bible kinds the dialog also
 * offers the entries that already exist and are not yet on the board, since
 * "put Elara on the board" is at least as common as "invent someone new" and
 * a second copy of a character is never what anyone meant.
 *
 * Everything it creates is the real thing from the first moment: a scene is
 * an ordinary tagged document with an empty body, an entry is an ordinary
 * entry. The board never has a card that is only a card.
 */
export function AddCardDialog({
  onClose
}: {
  /** Called with the id of the card made or put on the board, if any. */
  onClose: (cardId?: string) => void
}): JSX.Element {
  // Closing without making anything. Wrapped, not passed straight through:
  // as a click or mousedown handler, onClose would be handed the event as
  // its card id.
  const cancel = (): void => onClose()
  const trapRef = useFocusTrap<HTMLDivElement>(cancel)
  const entities = useWyrm((s) => s.entities)
  const addSceneDoc = useWyrm((s) => s.addSceneDoc)
  const createEntity = useWyrm((s) => s.createEntity)
  const addEntityToBoard = useWyrm((s) => s.addEntityToBoard)
  const project = useWyrm((s) => s.project)
  const addMap = useWyrm((s) => s.addMap)
  const setMapOnBoard = useWyrm((s) => s.setMapOnBoard)
  // Maps not on the board yet; a map is put up the way an entry is.
  const offBoardMaps = project ? sheetsOf(project.data).filter((m) => !m.onBoard) : []

  const [kind, setKind] = useState<CardKind>('scene')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entityType = kind === 'character' ? 'character' : kind === 'location' ? 'world' : null
  // Entries of this kind not already on the board. Derived during render
  // rather than selected, per the house rule against fresh objects from a
  // zustand selector.
  const existing: Entity[] =
    entityType == null
      ? []
      : entities
          .filter((e) => e.type === entityType && !e.onBoard)
          .sort((a, b) => a.name.localeCompare(b.name))

  // A kind change empties the title field's meaning ("A Knock at Night" is
  // not a character), so the error goes with it — cleared where the change
  // happens, not in an effect that would re-render to do it.
  const chooseKind = (k: CardKind): void => {
    setKind(k)
    setError(null)
  }

  const finish = async (work: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const made = await work()
      onClose(typeof made === 'string' ? made : undefined)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const createNew = (): void => {
    const name = title.trim()
    if (name === '') return
    if (kind === 'map' && project) {
      // Said here, before anything is made: a second "Port Cray" is never
      // what anyone meant.
      const wrong = mapNameProblem(project.data, name)
      if (wrong) {
        setError(wrong)
        return
      }
    }
    void finish(async () => {
      if (kind === 'scene') return (await addSceneDoc(name)) ?? undefined
      if (kind === 'map') {
        const id = await addMap(name)
        if (id) await setMapOnBoard(id, true)
        return id ?? undefined
      }
      return (await createEntity(entityType as 'character' | 'world', name, { onBoard: true }))?.id
    })
  }

  return (
    <div className="dialog-overlay" onMouseDown={cancel}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={cancel} />
          <span className="title">Add Card</span>
        </div>
        <div className="dialog-body">
          <fieldset>
            <legend>What kind of card?</legend>
            <div role="radiogroup" aria-label="Kind of card">
              {(['scene', 'character', 'location', 'map'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className="control-row"
                  onClick={() => chooseKind(k)}
                >
                  <span className={`check${kind === k ? ' on' : ''}`} />
                  <span>{KIND_LABEL[k]}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              {kind === 'scene' ? 'New scene' : `New ${KIND_LABEL[kind].toLowerCase()}`}
            </legend>
            <div className="add-card-new">
              <input
                className="text-field"
                placeholder={
                  kind === 'scene'
                    ? 'Title of the scene'
                    : kind === 'map'
                      ? 'Name of the map'
                      : 'Name'
                }
                value={title}
                // Read-only, not disabled, while adding: a disabled field
                // drops focus to the page, and a failure would leave it there.
                readOnly={busy}
                aria-invalid={error != null ? true : undefined}
                aria-describedby={error != null ? 'add-card-error' : undefined}
                autoFocus
                onChange={(e) => {
                  setTitle(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createNew()
                }}
              />
              <button
                type="button"
                className="btn default"
                disabled={busy || title.trim() === ''}
                onClick={createNew}
              >
                {busy ? 'Adding…' : 'Add'}
              </button>
            </div>
            <div className="dialog-hint">
              {kind === 'scene'
                ? 'A real document in the manuscript, tagged as a scene, ready to write.'
                : kind === 'map'
                  ? 'A new map, as a tab in the map view, with its card here — the whole map, shrunk.'
                  : `A real ${KIND_LABEL[kind].toLowerCase()} in the story bible, with its card here.`}
            </div>
          </fieldset>
          {entityType != null && (
            <fieldset>
              <legend>Or one already in the book</legend>
              {existing.length === 0 ? (
                <div className="dialog-hint">
                  Every {KIND_LABEL[kind].toLowerCase()} in the book is already on the board.
                </div>
              ) : (
                <div className="version-list add-card-existing">
                  {existing.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className="version-row"
                      disabled={busy}
                      onClick={() => void finish(() => addEntityToBoard(e.id).then(() => e.id))}
                    >
                      <span className="row-title">{e.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {kind === 'map' && (
            <fieldset>
              <legend>Or a map already drawn</legend>
              {offBoardMaps.length === 0 ? (
                <div className="dialog-hint">Every map is already on the board.</div>
              ) : (
                <div className="version-list add-card-existing">
                  {offBoardMaps.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="version-row"
                      disabled={busy}
                      onClick={() => void finish(() => setMapOnBoard(m.id, true).then(() => m.id))}
                    >
                      <span className="row-title">{m.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {error != null && (
            <div id="add-card-error" className="dialog-hint add-card-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="dialog-buttons">
          <button className="btn" onClick={cancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
