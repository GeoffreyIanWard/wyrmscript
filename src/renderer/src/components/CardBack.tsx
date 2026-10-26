import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { CastEntry, DocFile, DocMeta } from '../../../shared/types'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'
import { CardCorner } from './CardCorner'
import { errorMessage } from '../lib/errors'
import { backOf, backPatch, suggestionsFor, type CardBack as Back } from '../lib/cardBack'

const BLANK_META = (id: string): DocMeta => ({ id, title: '', created: '', modified: '' })

/**
 * F-42: the back of a scene's index card — the scene outlined before any
 * prose exists.
 *
 * Every field shows and every field is optional: outlining is fast and
 * loose, and a form that blocks is a form the writer stops using. **Enter
 * saves and turns to the next scene's card**, in the board's binder order,
 * so a whole act can be outlined without touching the mouse; Shift+Enter
 * breaks a line in the synopsis.
 *
 * **There is no Cancel.** Writing on a card is writing on a card: every way
 * out — Done, the close box, Esc, a click outside, even the dialog being
 * torn down because another project came to the front — keeps what was
 * written. The one exception is a save that fails: then the writer is
 * offered Try Again or Close Without Saving, because a save that can never
 * succeed must not hold the whole window hostage.
 *
 * **What is written is what was edited.** Each card remembers what it showed
 * when it was turned to (`seed`), and only the fields that differ from that
 * are saved, over the document as it is on disk now. A field another device
 * synced in while the board was up is not overwritten by a card the writer
 * turned past without touching it.
 */
export function CardBack({
  path,
  sceneIds,
  startId,
  docs,
  onWritten,
  onClose
}: {
  /** The project the card was turned over in, which every write goes to. */
  path: string
  /** Every scene on the board, in binder order: the order Enter turns through. */
  sceneIds: string[]
  startId: string
  /** The board's documents, for the current backs and the suggestions. */
  docs: DocFile[]
  /** A card was written; the board re-reads so its front shows the change. */
  onWritten: () => Promise<unknown>
  onClose: () => void
}): JSX.Element {
  const setCardBack = useWyrm((s) => s.setCardBack)
  const entities = useWyrm((s) => s.entities)

  // What each card says as of this dialog: the board's copy, overlaid with
  // whatever was written here, so turning back to a card shows its new back
  // without waiting on the board to re-read.
  const [written, setWritten] = useState<Record<string, DocFile>>({})
  const metaFor = (id: string, over: Record<string, DocFile> = written): DocMeta =>
    (over[id] ?? docs.find((d) => d.meta.id === id))?.meta ?? BLANK_META(id)

  const [id, setId] = useState(startId)
  const [seed, setSeed] = useState<Back>(() => backOf(metaFor(startId)))
  const [back, setBack] = useState<Back>(seed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The last failed save was on the way out: offer a way out without it. */
  const [failedClosing, setFailedClosing] = useState(false)
  const [pick, setPick] = useState('')

  const title = metaFor(id).title
  const index = sceneIds.indexOf(id)
  const nextId = index >= 0 && index < sceneIds.length - 1 ? sceneIds[index + 1] : null

  const characters = entities
    .filter((e) => e.type === 'character')
    .sort((a, b) => a.name.localeCompare(b.name))
  const places = entities
    .filter((e) => e.type === 'world')
    .sort((a, b) => a.name.localeCompare(b.name))
  const nameOf = new Map(entities.map((e) => [e.id, e.name]))
  // Cast entries for entries since deleted are kept, never cascaded away —
  // the entry may come back from the history — but there is nothing to show.
  const shown = back.cast.filter((c) => nameOf.has(c.entityId))
  const hidden = back.cast.length - shown.length
  const castable = characters.filter((c) => !back.cast.some((e) => e.entityId === c.id))
  const allDocs = [...docs.filter((d) => !written[d.meta.id]), ...Object.values(written)]
  const acts = suggestionsFor(allDocs, 'act')
  const types = suggestionsFor(allDocs, 'sceneType')

  // The latest form, for the teardown flush. Written in an effect, not during
  // render; `closed` marks a deliberate exit, which has already saved (or
  // chosen not to), so the flush must not write a second time.
  const latest = useRef({ id, seed, back })
  useEffect(() => {
    latest.current = { id, seed, back }
  })
  const closed = useRef(false)
  useEffect(
    () => () => {
      if (closed.current) return
      // Torn down without a deliberate exit: another project came to the
      // front, or the board went away. Nothing is left on screen to show an
      // error on, so a failure is logged — but the write is addressed to the
      // project the card was turned in, never to whichever is in front now.
      const { id: at, seed: was, back: now } = latest.current
      const patch = backPatch(was, now)
      if (patch) void setCardBack(path, at, patch).catch((err) => console.error(err))
    },
    [path, setCardBack]
  )

  const finish = (): void => {
    closed.current = true
    onClose()
  }

  /** Writes what was edited on this card, then turns to `then` or closes. */
  const save = async (then: string | null): Promise<void> => {
    if (busy) return
    const patch = backPatch(seed, back)
    let over = written
    if (patch) {
      setBusy(true)
      setError(null)
      try {
        const updated = await setCardBack(path, id, patch)
        over = { ...written, [id]: updated }
        setWritten(over)
        // Saved: what the card now shows is what is on disk, so a teardown
        // from here on has nothing to flush for it.
        setSeed(back)
        latest.current = { id, seed: back, back }
        await onWritten()
      } catch (err) {
        setError(errorMessage(err))
        setFailedClosing(then == null)
        setBusy(false)
        return
      }
    }
    setError(null)
    setFailedClosing(false)
    if (then == null) {
      finish()
      return
    }
    const next = backOf(metaFor(then, over))
    setId(then)
    setSeed(next)
    setBack(next)
    setPick('')
    setBusy(false)
  }

  const done = (): void => void save(null)
  const trapRef = useFocusTrap<HTMLDivElement>(done)

  // Turning to the next card puts the caret in its synopsis. The fields are
  // never disabled during a save — a disabled field loses focus to <body>,
  // and the writer's next keystroke goes nowhere — so this is about landing
  // somewhere useful, not about recovering focus that was thrown away.
  const synopsisRef = useRef<HTMLTextAreaElement>(null)
  const turnedFrom = useRef(id)
  useEffect(() => {
    if (turnedFrom.current === id) return
    turnedFrom.current = id
    synopsisRef.current?.focus()
  }, [id])

  // After adding someone, the caret goes to their motivation; after taking
  // someone out, to the picker — a removed button would drop it to <body>.
  const focusAfter = useRef<{ kind: 'added'; entityId: string } | { kind: 'removed' } | null>(null)
  useEffect(() => {
    const want = focusAfter.current
    focusAfter.current = null
    if (!want) return
    const root = trapRef.current
    if (!root) return
    const target =
      want.kind === 'added'
        ? root.querySelector<HTMLElement>(`[data-cast="${want.entityId}"] input`)
        : root.querySelector<HTMLElement>('.card-back-add select')
    ;(target ?? synopsisRef.current)?.focus()
  }, [back.cast, trapRef])

  const set = <K extends keyof Back>(key: K, value: Back[K]): void => {
    if (busy) return
    setBack((b) => ({ ...b, [key]: value }))
  }
  const setCast = (entityId: string, patch: Partial<CastEntry>): void => {
    if (busy) return
    setBack((b) => ({
      ...b,
      cast: b.cast.map((c) => (c.entityId === entityId ? { ...c, ...patch } : c))
    }))
  }
  const addCast = (): void => {
    if (busy || !pick) return
    focusAfter.current = { kind: 'added', entityId: pick }
    set('cast', [...back.cast, { entityId: pick }])
    setPick('')
  }
  const removeCast = (entityId: string): void => {
    if (busy) return
    focusAfter.current = { kind: 'removed' }
    set(
      'cast',
      back.cast.filter((e) => e.entityId !== entityId)
    )
  }

  /** Enter turns the card; Shift+Enter is a line break where there are lines. */
  const onEnter = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    void save(nextId)
  }

  return (
    <div className="dialog-overlay" onMouseDown={done}>
      <div
        className="dialog card-back"
        ref={trapRef}
        role="dialog"
        aria-label={`Back of ${title}`}
        aria-busy={busy}
        data-help="card-back"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={done} />
          <span className="title">Back of the Card</span>
        </div>
        <div className="dialog-body card-back-body">
          <div className="card-back-head">
            <span className="card-back-title">{title}</span>
            {index >= 0 && (
              <span className="card-back-count">
                {index + 1} of {sceneIds.length}
              </span>
            )}
          </div>

          <label className="card-back-field">
            <span>Synopsis</span>
            <textarea
              ref={synopsisRef}
              className="card-back-ruled"
              rows={3}
              value={back.synopsis}
              placeholder="What happens"
              readOnly={busy}
              onChange={(e) => set('synopsis', e.target.value)}
              onKeyDown={onEnter}
            />
          </label>

          <div className="card-back-pair">
            <label className="card-back-field">
              <span>Act</span>
              <input
                className="text-field"
                list="card-back-acts"
                value={back.act}
                placeholder="I, II, III…"
                readOnly={busy}
                onChange={(e) => set('act', e.target.value)}
                onKeyDown={onEnter}
              />
            </label>
            <label className="card-back-field">
              <span>Scene type</span>
              <input
                className="text-field"
                list="card-back-types"
                value={back.sceneType}
                placeholder="Confrontation, reveal…"
                readOnly={busy}
                onChange={(e) => set('sceneType', e.target.value)}
                onKeyDown={onEnter}
              />
            </label>
          </div>
          <datalist id="card-back-acts">
            {acts.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
          <datalist id="card-back-types">
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <label className="card-back-field">
            <span>Location</span>
            <select
              className="text-field"
              value={back.location}
              onChange={(e) => set('location', e.target.value)}
            >
              <option value="">Nowhere yet</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {back.location !== '' && !nameOf.has(back.location) && (
                <option value={back.location}>An entry no longer in the World Book</option>
              )}
            </select>
          </label>

          <label className="card-back-field">
            <span>Conflict</span>
            <input
              className="text-field"
              value={back.conflict}
              placeholder="Who wants what, and who is in the way"
              readOnly={busy}
              onChange={(e) => set('conflict', e.target.value)}
              onKeyDown={onEnter}
            />
          </label>

          <fieldset className="card-back-cast">
            <legend>In this scene</legend>
            {shown.map((c) => {
              const name = nameOf.get(c.entityId)
              return (
                <div
                  key={c.entityId}
                  className="card-back-character"
                  role="group"
                  aria-label={name}
                  data-cast={c.entityId}
                >
                  <div className="card-back-character-head">
                    <span>{name}</span>
                    <button
                      type="button"
                      className="card-back-remove"
                      aria-label={`Take ${name} out of this scene`}
                      onClick={() => removeCast(c.entityId)}
                    >
                      ×
                    </button>
                  </div>
                  {(['motivation', 'goal', 'note'] as const).map((key) => (
                    <input
                      key={key}
                      className="text-field"
                      aria-label={`${name}: ${key}`}
                      placeholder={
                        key === 'motivation' ? 'Motivation' : key === 'goal' ? 'Goal' : 'Note'
                      }
                      value={c[key] ?? ''}
                      readOnly={busy}
                      onChange={(e) => setCast(c.entityId, { [key]: e.target.value })}
                      onKeyDown={onEnter}
                    />
                  ))}
                </div>
              )
            })}
            {hidden > 0 && (
              <div className="dialog-hint">
                {hidden === 1 ? 'One character' : `${hidden} characters`} no longer in the Character
                Book, kept in case they come back.
              </div>
            )}
            {characters.length === 0 ? (
              <div className="dialog-hint">No one in the Character Book yet.</div>
            ) : (
              castable.length > 0 && (
                // Choosing and adding are two steps: a select that cast
                // whoever it landed on would add someone on every arrow key
                // and every letter of type-ahead.
                <div className="card-back-add">
                  <select
                    className="text-field"
                    aria-label="Character to add to this scene"
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      // Enter here adds, never turns the card.
                      e.preventDefault()
                      e.stopPropagation()
                      addCast()
                    }}
                  >
                    <option value="">Add a character…</option>
                    {castable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" disabled={!pick} onClick={addCast}>
                    Add
                  </button>
                </div>
              )
            )}
          </fieldset>

          <div className="dialog-hint">
            Every field is optional. Enter saves and turns to the next card
            {nextId == null ? ' — this is the last one' : ''}.
          </div>
          {error != null && (
            <div className="dialog-hint add-card-error" role="alert">
              Could not save this card: {error}
            </div>
          )}
        </div>
        <div className="dialog-buttons">
          {failedClosing ? (
            <>
              <button className="btn" onClick={finish}>
                Close Without Saving
              </button>
              <button className="btn default" onClick={done}>
                Try Again
              </button>
            </>
          ) : (
            <>
              {nextId != null && (
                <button className="btn" onClick={() => void save(nextId)}>
                  Next Card
                </button>
              )}
              <button className="btn default" onClick={done}>
                Done
              </button>
            </>
          )}
        </div>
        {/* The same corner as the front's, to turn back: every way out of
            the back keeps what was written, and this one is the card's own.
            Last, so it comes last to Tab as it sits last on the card. */}
        <CardCorner
          className="card-back-corner"
          side="back"
          label="Turn back to the front"
          onTurn={done}
        />
      </div>
    </div>
  )
}
