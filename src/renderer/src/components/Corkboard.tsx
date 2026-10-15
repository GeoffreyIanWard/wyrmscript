import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { DocFile } from '../../../shared/types'
import { api } from '../lib/api'
import { useWyrm } from '../store'
import { boardHeight, CARD_H, CARD_W, layoutCards, sceneCards } from '../lib/corkboard'
import type { PlacedCard } from '../lib/corkboard'

/**
 * The corkboard: every scene in the project as an index card (Phase 6).
 *
 * Cards are in **binder order**, and dragging one reorders the binder. That is
 * the distinction from the timeline, which F-02 deliberately gave its own
 * ordering because narrative order and chronology are different questions.
 * Rearranging index cards is how a writer reorders their manuscript, so the
 * board writes to the binder and the timeline keeps answering the other one.
 *
 * Reordering goes through `moveBinderNode` — the same action the binder's own
 * drag uses — rather than a second implementation, so a card and a binder row
 * can never disagree about what a move means.
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
  const [docs, setDocs] = useState<DocFile[] | null>(null)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const setCardPosition = useWyrm((s) => s.setCardPosition)
  const tidyBoard = useWyrm((s) => s.tidyBoard)
  const [dragging, setDragging] = useState<string | null>(null)

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
   * preview, and they survive the card's inner `<button>`.
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

  // Documents are read on demand rather than held in the store, the same as
  // the timeline and plot graph do. Re-reads when the binder changes, so a
  // card dragged to a new position redraws in its new place.
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

  // Derived during render rather than selected, per the house rule against
  // returning fresh objects from a zustand selector.
  const cards = useMemo(
    () => (project && docs ? sceneCards(docs, project.data.binder) : []),
    [docs, project]
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
   * following behind it.
   */
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({})

  const placed = useMemo(
    () =>
      layoutCards(
        cards.map((c) => {
          const local = localPos[c.id]
          return local ? { ...c, boardX: local.x, boardY: local.y } : c
        }),
        boardWidth
      ),
    [cards, boardWidth, localPos]
  )

  const tools = (
    // Pinned to the board rather than left in a menu: the timeline, the plot
    // graph and the map are the same scenes seen other ways, and the board is
    // where that is true. The binder is hidden in this view, so these are also
    // what replaces it.
    <div className="corkboard-tools">
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
      {/* Tidy is the way back. Free placement means a board can be left in a
          state only its author understands, and the binder is still the book:
          this returns every card to its slot in binder order by clearing the
          stored positions, rather than inventing a second ordering. */}
      <button
        type="button"
        className="board-tool"
        onClick={() => {
          // Re-read before clearing the local positions, and in that order:
          // the docs held here still carry the old positions until they are
          // re-read, so clearing first would show them again for a frame.
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
          <div>No scenes yet.</div>
          <div className="dialog-hint">
            A scene is any document tagged <strong>scene</strong>. Tag one from its header and it
            appears here as a card.
          </div>
        </div>
      </div>
    )
  }

  /** Past this many pixels a press becomes a drag rather than a click. */
  const DRAG_THRESHOLD = 4

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, card: PlacedCard): void => {
    if (e.button !== 0) return
    // Cleared on every fresh press, not left standing. A drag that ends over
    // a *different* card has no click to consume it — the browser fires that
    // click on the nearest common ancestor, the board — so a flag left set
    // would swallow the next real click instead, and the card after a move
    // would refuse to open.
    suppressClick.current = false
    drag.current = {
      id: card.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: card.x,
      originY: card.y,
      moved: false
    }
    // Capture is taken when the drag *starts*, not here. Capturing on the
    // press redirects the rest of the gesture to this wrapper, so a plain
    // click never reaches the card's own button and the scene will not open —
    // the press arrives and nothing else does.
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
    if (!d.moved) {
      d.moved = true
      setDragging(d.id)
      // Now that this is a drag, follow the pointer even when it leaves the
      // card — which it does immediately, since the card moves with it.
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    setOffset({ x: dx, y: dy })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragging(null)
    setOffset(null)
    if (!d.moved) return
    suppressClick.current = true
    // Clamped at the top-left corner only: a board scrolls, so a card dragged
    // past the right edge is a card further along the wall, not a mistake.
    const x = Math.round(Math.max(0, d.originX + (e.clientX - d.startX)))
    const y = Math.round(Math.max(0, d.originY + (e.clientY - d.startY)))
    setLocalPos((p) => ({ ...p, [d.id]: { x, y } }))
    void setCardPosition(d.id, x, y)
  }

  return (
    <div className="terminal corkboard">
      {tools}
      <div
        className="corkboard-board"
        ref={boardEl}
        style={{ height: boardHeight(placed) + CARD_H / 2 }}
      >
        {placed.map((card) => (
          <div
            key={card.id}
            className={`scene-card${dragging === card.id ? ' dragging' : ''}`}
            // Positioned on the board rather than flowed: a card sits where
            // the writer put it, and an unmoved one sits in its binder slot.
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
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* The pin. Decorative, so it is hidden from assistive tech — the
                card's own button carries the name and the action. */}
            <span className="scene-card-pin" aria-hidden="true" />
            <button
              type="button"
              className="scene-card-face"
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                void selectDoc(card.id)
              }}
              aria-label={`Open ${card.title}`}
            >
              <span className="scene-card-title">{card.title}</span>
              {card.folder !== '' && <span className="scene-card-folder">{card.folder}</span>}
              <span className="scene-card-excerpt">
                {card.empty ? <em>Not written yet.</em> : card.excerpt}
              </span>
              <span className="scene-card-foot">
                <span>{card.wordCount.toLocaleString()} words</span>
                {card.status != null && <span className="scene-card-status">{card.status}</span>}
                {card.label != null && <span className="scene-card-label">{card.label}</span>}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
