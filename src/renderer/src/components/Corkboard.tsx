import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { DocFile } from '../../../shared/types'
import { api } from '../lib/api'
import { useWyrm } from '../store'
import { boardCards, boardHeight, CARD_H, CARD_W, layoutCards, stackLayout } from '../lib/corkboard'
import type { PlacedCard } from '../lib/corkboard'
import { AddCardDialog } from './AddCardDialog'

/**
 * The corkboard: the story's pieces as index cards, placed where the writer
 * puts them (Phase 6, F-45).
 *
 * Three kinds of card — scenes, characters, locations — all dragged, opened
 * and stacked the same way. Scenes are every scene-tagged document; the
 * other two are story-bible entries put on the board deliberately. Dragging
 * a card places it and nothing else: the binder is still how the manuscript
 * is ordered, and a card's position is the writer's thinking, not the book.
 */
export function Corkboard({
  onTimeline,
  onPlotGraph,
  onPlotlines,
  onCharacterGraph,
  onWorldMap
}: {
  onTimeline: () => void
  onPlotGraph: () => void
  onPlotlines: () => void
  onCharacterGraph: () => void
  onWorldMap: () => void
}): JSX.Element {
  const project = useWyrm((s) => s.project)
  const entities = useWyrm((s) => s.entities)
  const [docs, setDocs] = useState<DocFile[] | null>(null)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const showEntity = useWyrm((s) => s.showEntity)
  const setCardPosition = useWyrm((s) => s.setCardPosition)
  const setEntityPosition = useWyrm((s) => s.setEntityPosition)
  const removeEntityFromBoard = useWyrm((s) => s.removeEntityFromBoard)
  const tidyBoard = useWyrm((s) => s.tidyBoard)
  const [dragging, setDragging] = useState<string | null>(null)
  // Which project the Add Card dialog was opened for. Derived rather than
  // closed in an effect: the dialog shows only while that is the project in
  // front, so a change of project dismisses it the way App's own dialogs are
  // dismissed — otherwise it would stay open and quietly add its card to
  // whichever novel came to the front.
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const adding = addingFor != null && addingFor === project?.path
  const setAdding = (on: boolean): void => setAddingFor(on ? (project?.path ?? null) : null)

  /**
   * Dragging is **pointer events, not HTML5 drag-and-drop.**
   *
   * The board shipped on `draggable` + `dataTransfer` and cards would not drop
   * — picked up, then snapped back. Two rounds of fixing it failed because
   * native drag-and-drop cannot be driven by synthetic events *or* by the
   * remote-debugging mouse input the browser preview uses, so every check
   * short of launching Electron by hand reported success against a view that
   * did not work. Pointer events are the mechanism the project windows
   * already drag with (`windowGeometry.ts`), they are real input in the
   * preview, and they survive the card's inner `<button>`. See
   * `onPointerDown` for why the gesture is then tracked on the document.
   */
  const drag = useRef<{
    id: string
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  // Set on the pointerup that ends a real drag, so releasing a card does not
  // also count as a click and open the scene that was just moved.
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  // Removes the document listeners of the gesture in progress; declared up
  // here with the other hooks, because a hook below the early returns is a
  // hook React sees on some renders and not others, and the whole view dies.
  const stopTracking = useRef<(() => void) | null>(null)
  useEffect(() => () => stopTracking.current?.(), [])

  /**
   * Re-read the documents.
   *
   * Needed because positions live in the documents but writing one does not
   * change `project`, so nothing else ever re-reads them. Placement gets away
   * without it by holding the new position in `localPos`; **Tidy cannot**,
   * since it is the stored positions it clears — without this it wrote the
   * cleared values to disk and then fell back to the stale docs still held
   * here, springing every already-placed card back to where it had been.
   */
  const reloadDocs = async (): Promise<DocFile[] | null> => {
    const path = useWyrm.getState().project?.path
    if (!path) return null
    const all = await api.readAllDocs(path)
    setDocs(all)
    return all
  }

  useEffect(() => {
    if (!project) return
    let live = true
    void api.readAllDocs(project.path).then((all) => live && setDocs(all))
    return () => {
      live = false
    }
  }, [project])

  // Entities come from the store (they are per-project state already), so a
  // card added or taken off the board shows up without a re-read. Derived
  // during render rather than selected, per the house rule against returning
  // fresh objects from a zustand selector.
  const cards = useMemo(
    () => (project && docs ? boardCards(docs, project.data.binder, entities) : []),
    [docs, project, entities]
  )

  // The board's own width decides how many columns an untouched card falls
  // into. Measured rather than assumed, and guarded because jsdom has no
  // ResizeObserver — a bare `new ResizeObserver` throws there and would take
  // the whole view down in tests rather than failing one.
  const boardEl = useRef<HTMLDivElement | null>(null)
  const [boardWidth, setBoardWidth] = useState(0)
  useEffect(() => {
    const el = boardEl.current
    if (!el) return
    setBoardWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => setBoardWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [docs])

  /**
   * Positions this board has set but not yet read back.
   *
   * Documents are read on demand, and writing a card's position does not
   * change `project`, so nothing re-reads them — the card would return to its
   * old slot the instant the drag ended, which is exactly the snap-back this
   * view is supposed to have stopped doing. Holding the new position here
   * means the card stays put the moment it is dropped, with the file write
   * following behind it. Entity cards do not strictly need it (the store
   * updates `entities` on write) but are held the same way so a drop behaves
   * identically whatever the card is.
   */
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({})

  /**
   * Stacked is a way of looking, not an arrangement. Nothing is written while
   * the board is stacked; unstacking puts every card back where it was. A
   * card dragged *out* of a pile is the one exception — the writer meant to
   * move it, so it is placed like any other drop and stays out until the
   * board is unstacked.
   */
  const [stacked, setStacked] = useState(false)
  const [pulled, setPulled] = useState<Set<string>>(() => new Set())

  const placed = useMemo(() => {
    const laid = layoutCards(
      cards.map((c) => {
        const local = localPos[c.id]
        return local ? { ...c, boardX: local.x, boardY: local.y } : c
      }),
      boardWidth
    )
    if (!stacked) return laid
    const piles = stackLayout(cards)
    return laid.map((c) => {
      const at = pulled.has(c.id) ? null : piles.get(c.id)
      return at ? { ...c, x: at.x, y: at.y } : c
    })
  }, [cards, boardWidth, localPos, stacked, pulled])

  const unstack = (): void => {
    setStacked(false)
    setPulled(new Set())
  }

  const tools = (
    // Pinned to the board rather than left in a menu: the timeline, the plot
    // graph and the map are the same scenes seen other ways, and the board is
    // where that is true. The binder is hidden in this view, so these are also
    // what replaces it.
    <div className="corkboard-tools" data-help="board-tools">
      <button
        type="button"
        className="board-tool"
        data-help="board-add"
        onClick={() => setAdding(true)}
      >
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Add Card</span>
      </button>
      <button type="button" className="board-tool" onClick={onTimeline}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Timeline</span>
      </button>
      <button type="button" className="board-tool" onClick={onPlotGraph}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Plot Graph</span>
      </button>
      <button type="button" className="board-tool" onClick={onPlotlines}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Plotlines</span>
      </button>
      <button type="button" className="board-tool" onClick={onCharacterGraph}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Characters</span>
      </button>
      <button type="button" className="board-tool" onClick={onWorldMap}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>World Map</span>
      </button>
      {/* Stack gathers the cards into piles by kind; the same button unstacks.
          A view toggle, so it is never disabled — an unstacked board can
          always be stacked and a stacked one always put back. */}
      <button
        type="button"
        className={`board-tool${stacked ? ' on' : ''}`}
        data-help="board-stack"
        aria-pressed={stacked}
        onClick={() => (stacked ? unstack() : setStacked(true))}
        disabled={cards.length === 0}
      >
        <span className="board-tool-pin" aria-hidden="true" />
        <span>{stacked ? 'Unstack' : 'Stack'}</span>
      </button>
      {/* Tidy is the way back. Free placement means a board can be left in a
          state only its author understands, and the binder is still the book:
          this returns every card to its slot by clearing the stored
          positions, rather than inventing a second ordering. */}
      <button
        type="button"
        className="board-tool"
        data-help="board-tidy"
        onClick={() => {
          // A tidy board is not a stacked one either. Re-read before clearing
          // the local positions, and in that order: the docs held here still
          // carry the old positions until they are re-read, so clearing first
          // would show them again for a frame.
          unstack()
          void tidyBoard()
            .then(reloadDocs)
            .then(() => setLocalPos({}))
        }}
        disabled={!placed.some((c) => c.placed)}
      >
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Tidy</span>
      </button>
    </div>
  )

  if (!project) return <div className="terminal" />
  if (docs == null) return <div className="terminal corkboard" />

  if (cards.length === 0) {
    return (
      <div className="terminal corkboard">
        {tools}
        <div className="corkboard-empty">
          <div>No cards yet.</div>
          <div className="dialog-hint">
            Add a scene, a character or a location with <strong>Add Card</strong>. Any document
            tagged <strong>scene</strong> appears here on its own.
          </div>
        </div>
        {adding && <AddCardDialog onClose={() => setAdding(false)} />}
      </div>
    )
  }

  /** Past this many pixels a press becomes a drag rather than a click. */
  const DRAG_THRESHOLD = 4

  /**
   * The gesture is tracked on the **document** from the press onwards, not
   * on the card. Tracking it on the card meant the card had to receive the
   * first `pointermove` in order to take capture — and a fast flick, or any
   * pointer that jumps further than the card in one event, delivers that move
   * to whatever is under the pointer instead. The card then never hears
   * another thing: the press arrives, nothing follows, and the writer sees a
   * card that did not move. Listening on the document hears the move
   * wherever it lands. Capture is not taken at all, which is also what keeps
   * a plain click reaching the card's own button: capturing on the press
   * redirected the whole gesture to this wrapper and the button never saw
   * its click.
   */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, card: PlacedCard): void => {
    if (e.button !== 0) return
    // Cleared on every fresh press, not left standing. A drag that ends over
    // a *different* card has no click to consume it — the browser fires that
    // click on the nearest common ancestor, the board — so a flag left set
    // would swallow the next real click instead, and the card after a move
    // would refuse to open.
    suppressClick.current = false
    stopTracking.current?.()
    drag.current = {
      id: card.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: card.x,
      originY: card.y,
      moved: false
    }

    const onMove = (ev: PointerEvent): void => {
      const d = drag.current
      if (!d || d.pointerId !== ev.pointerId) return
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      if (!d.moved) {
        d.moved = true
        setDragging(d.id)
      }
      setOffset({ x: dx, y: dy })
    }

    const onUp = (ev: PointerEvent): void => {
      const d = drag.current
      if (!d || d.pointerId !== ev.pointerId) return
      stopTracking.current?.()
      drag.current = null
      setDragging(null)
      setOffset(null)
      if (!d.moved) return
      suppressClick.current = true
      // Clamped at the top-left corner only: a board scrolls, so a card
      // dragged past the right edge is a card further along the wall, not a
      // mistake.
      const x = Math.round(Math.max(0, d.originX + (ev.clientX - d.startX)))
      const y = Math.round(Math.max(0, d.originY + (ev.clientY - d.startY)))
      setLocalPos((p) => ({ ...p, [d.id]: { x, y } }))
      // Pulled out of its pile: it stays where it was dropped until the board
      // is unstacked, rather than snapping back into the stack.
      if (stacked) setPulled((p) => new Set(p).add(d.id))
      // Which file holds the position depends on what the card is.
      if (card.kind === 'scene') void setCardPosition(d.id, x, y)
      else void setEntityPosition(d.id, x, y)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    stopTracking.current = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      stopTracking.current = null
    }
  }

  const open = (card: PlacedCard): void => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    // A scene is an arrival, like picking it in the binder. An entry is a
    // detour, like opening it from anywhere else — so Esc comes back here.
    if (card.kind === 'scene') void selectDoc(card.id)
    else showEntity(card.id)
  }

  return (
    <div className="terminal corkboard" data-help="corkboard">
      {tools}
      <div
        className={`corkboard-board${stacked ? ' stacked' : ''}`}
        ref={boardEl}
        style={{ height: boardHeight(placed) + CARD_H / 2 }}
      >
        {placed.map((card) => (
          <div
            key={card.id}
            className={`scene-card kind-${card.kind}${dragging === card.id ? ' dragging' : ''}`}
            // Positioned on the board rather than flowed: a card sits where
            // the writer put it, and an unmoved one sits in its slot.
            style={{
              left: card.x,
              top: card.y,
              width: CARD_W,
              height: CARD_H,
              transform:
                dragging === card.id && offset
                  ? `translate(${offset.x}px, ${offset.y}px)`
                  : undefined
            }}
            onPointerDown={(e) => onPointerDown(e, card)}
          >
            {/* The pin. Decorative, so it is hidden from assistive tech — the
                card's own button carries the name and the action. */}
            <span className="scene-card-pin" aria-hidden="true" />
            {card.kind !== 'scene' && (
              // Takes the card off the board and nothing else: the entry stays
              // in its book. A sibling of the face, not a child — a button
              // inside a button is not HTML.
              <button
                type="button"
                className="scene-card-off"
                data-help="card-off"
                aria-label={`Take ${card.title} off the board`}
                title="Take off the board"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void removeEntityFromBoard(card.id)}
              >
                ×
              </button>
            )}
            {/* The help id is on the face rather than the card, and written
                out twice rather than computed: guided help's drift guard
                reads the source for literal `data-help="…"` strings, and an
                id built from an expression is invisible to it — the copy
                would then fail the guard as writing with no control. */}
            {card.kind === 'scene' ? (
              <button
                type="button"
                className="scene-card-face"
                data-help="scene-card"
                onClick={() => open(card)}
                aria-label={`Open ${card.title}`}
              >
                <CardFace card={card} />
              </button>
            ) : (
              <button
                type="button"
                className="scene-card-face"
                data-help="bible-card"
                onClick={() => open(card)}
                aria-label={`Open ${card.title}`}
              >
                <CardFace card={card} />
              </button>
            )}
          </div>
        ))}
      </div>
      {adding && <AddCardDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

/** What a card says: title, where it lives, its opening, and its foot. */
function CardFace({ card }: { card: PlacedCard }): JSX.Element {
  return (
    <>
      <span className="scene-card-title">{card.title}</span>
      {card.folder !== '' && <span className="scene-card-folder">{card.folder}</span>}
      <span className="scene-card-excerpt">
        {card.empty ? <em>Not written yet.</em> : card.excerpt}
      </span>
      <span className="scene-card-foot">
        <span>{card.wordCount.toLocaleString()} words</span>
        {card.kind !== 'scene' && <span className="scene-card-kind">{card.kind}</span>}
        {card.status != null && <span className="scene-card-status">{card.status}</span>}
        {card.label != null && <span className="scene-card-label">{card.label}</span>}
      </span>
    </>
  )
}
