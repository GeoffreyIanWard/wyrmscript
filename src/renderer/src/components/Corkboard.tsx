import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { DocFile } from '../../../shared/types'
import { api } from '../lib/api'
import { useWyrm } from '../store'
import { dropTargetAt, sceneCards } from '../lib/corkboard'
import type { CardBox, SceneCard } from '../lib/corkboard'

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
  onWorldMap
}: {
  onTimeline: () => void
  onPlotGraph: () => void
  onWorldMap: () => void
}): JSX.Element {
  const project = useWyrm((s) => s.project)
  const [docs, setDocs] = useState<DocFile[] | null>(null)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const moveBinderNode = useWyrm((s) => s.moveBinderNode)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)

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
    moved: boolean
  } | null>(null)
  // Set on the pointerup that ends a real drag, so releasing a card does not
  // also count as a click and open the scene that was just moved.
  const suppressClick = useRef(false)
  const cardEls = useRef(new Map<string, HTMLDivElement>())
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)

  // Documents are read on demand rather than held in the store, the same as
  // the timeline and plot graph do. Re-reads when the binder changes, so a
  // card dragged to a new position redraws in its new place.
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
      <button type="button" className="board-tool" onClick={onWorldMap}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>World Map</span>
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

  /**
   * The other cards' boxes, measured now.
   *
   * The dragged card is **excluded**, and that is load-bearing: it is drawn
   * translated under the pointer, so its own rect travels with the pointer and
   * would win every hit test against itself — leaving no target and no move,
   * which is the snap-back all over again.
   */
  const boxesNow = (exceptId: string): CardBox[] =>
    cards.flatMap((c) => {
      if (c.id === exceptId) return []
      const el = cardEls.current.get(c.id)
      if (!el) return []
      const b = el.getBoundingClientRect()
      return [{ id: c.id, left: b.left, top: b.top, width: b.width, height: b.height }]
    })

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, card: SceneCard): void => {
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
    setOver(dropTargetAt(boxesNow(d.id), e.clientX, e.clientY))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragging(null)
    setOffset(null)
    setOver(null)
    if (!d.moved) return
    suppressClick.current = true
    const target = dropTargetAt(boxesNow(d.id), e.clientX, e.clientY)
    if (!target) return
    void moveBinderNode(d.id, target.id, target.after ? 'after' : 'before')
  }

  return (
    <div className="terminal corkboard">
      {tools}
      <div className="corkboard-board">
        {cards.map((card) => (
          <div
            key={card.id}
            className={`scene-card${dragging === card.id ? ' dragging' : ''}${
              over?.id === card.id ? (over.after ? ' drop-after' : ' drop-before') : ''
            }`}
            ref={(el) => {
              if (el) cardEls.current.set(card.id, el)
              else cardEls.current.delete(card.id)
            }}
            // The card lifts under the pointer rather than leaving a native
            // drag image behind, so a moved card is the one being moved.
            style={
              dragging === card.id && offset
                ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
                : undefined
            }
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
