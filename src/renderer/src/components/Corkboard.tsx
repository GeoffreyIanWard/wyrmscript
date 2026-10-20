import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { DocFile, StringEnd } from '../../../shared/types'
import { api } from '../lib/api'
import { useWyrm } from '../store'
import {
  boardCards,
  boardHeight,
  boardOrder,
  boardOrderDiffers,
  CARD_H,
  CARD_W,
  layoutCards,
  pinOffset,
  stackLayout,
  stringPath,
  stringPoints
} from '../lib/corkboard'
import type { PlacedCard, Point } from '../lib/corkboard'
import { AddCardDialog } from './AddCardDialog'
import { CardBack } from './CardBack'

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
  const applyBoardOrder = useWyrm((s) => s.applyBoardOrder)
  const boardUndo = useWyrm((s) => s.boardUndo)
  const undoBoardOrder = useWyrm((s) => s.undoBoardOrder)
  const boardStrings = useWyrm((s) => s.boardStrings)
  const loadBoardStrings = useWyrm((s) => s.loadBoardStrings)
  const createBoardString = useWyrm((s) => s.createBoardString)
  const deleteBoardString = useWyrm((s) => s.deleteBoardString)
  const [dragging, setDragging] = useState<string | null>(null)
  // Which project the Add Card dialog was opened for. Derived rather than
  // closed in an effect: the dialog shows only while that is the project in
  // front, so a change of project dismisses it the way App's own dialogs are
  // dismissed — otherwise it would stay open and quietly add its card to
  // whichever novel came to the front.
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const adding = addingFor != null && addingFor === project?.path
  const setAdding = (on: boolean): void => setAddingFor(on ? (project?.path ?? null) : null)
  // F-42: the card turned over, and the project it was turned in. Derived
  // the same way as Add Card, for the same reason: the back writes to the
  // project in front, so it must not outlive that project being in front.
  const [turned, setTurned] = useState<{ path: string; id: string } | null>(null)
  const turnedId = turned != null && turned.path === project?.path ? turned.id : null

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

  // Strings are a project collection loaded by the view that shows them, the
  // way the map loads its pins — not on project open.
  useEffect(() => {
    void loadBoardStrings()
  }, [project, loadBoardStrings])

  /**
   * The string tool (F-46). On, a click on a card pushes a pin in where it
   * was clicked; the second pin, on a different card, makes the string. Esc
   * pulls a pin that is waiting for its partner, or puts the tool down. The
   * pending pin is held here rather than written anywhere, because a pin
   * with no string is not a thing the board has.
   */
  const [stringMode, setStringMode] = useState(false)
  const [pending, setPending] = useState<StringEnd | null>(null)
  useEffect(() => {
    if (!stringMode) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Stopped as well as handled: Esc is also "back", and putting the
      // string tool down should not also walk the writer off the board.
      e.preventDefault()
      e.stopPropagation()
      setPending((p) => {
        if (p == null) setStringMode(false)
        return null
      })
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [stringMode])

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

  /**
   * Portraits for the cards that have one (F-47), as data: URLs keyed by
   * card id. Read when the set of portrait files changes — the key is the
   * ids and filenames joined, so a changed or removed portrait re-reads and
   * an unchanged board does not. Drawn only while the card still names a
   * portrait, so a removed one never lingers from an earlier read.
   */
  const [portraits, setPortraits] = useState<Record<string, string>>({})
  const portraitKey = cards
    .filter((c) => c.portrait)
    .map((c) => `${c.id}:${c.portrait}`)
    .join('|')
  useEffect(() => {
    const path = project?.path
    if (!path || portraitKey === '') return
    let live = true
    for (const part of portraitKey.split('|')) {
      const id = part.slice(0, part.indexOf(':'))
      void api
        .readPortrait(path, id)
        .then(
          (url) => live && url && setPortraits((p) => (p[id] === url ? p : { ...p, [id]: url }))
        )
        .catch(() => undefined)
    }
    return () => {
      live = false
    }
  }, [project, portraitKey])

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

  /**
   * Apply the board's order, and freeze the board as it was when the writer
   * looked at it. Unmoved cards sit in grid slots dealt by binder position,
   * so once the binder changes they would be re-dealt and the board would
   * read differently from the order just applied — and the button would
   * light up again at once. Every unplaced scene is therefore placed at the
   * slot it was in, which is also what "apply this arrangement" means.
   */
  const applyOrder = async (): Promise<void> => {
    if (!project) return
    const frozen = placed.filter((c) => c.kind === 'scene' && !c.placed)
    // Pinned *before* the binder changes, not after the save lands: the new
    // project identity re-deals every unplaced card the moment it is set,
    // and a save is a real write, so otherwise there is a committed frame
    // in which every unmoved card has jumped to its new slot and back.
    setLocalPos((p) => {
      const next = { ...p }
      for (const c of frozen) next[c.id] = { x: c.x, y: c.y }
      return next
    })
    // One store call, binder and pins together: it captures the project
    // once, so the pins land in the novel the order was applied to even if
    // another window is focused before the save resolves. The store records
    // the way back itself, before it writes.
    const changed = await applyBoardOrder(
      boardOrder(placed),
      frozen.map((c) => ({ id: c.id, x: c.x, y: c.y }))
    )
    // Nothing applied (the binder changed under the board between the look
    // and the click), so nothing was pinned: let the cards go again.
    if (!changed) {
      setLocalPos((p) => {
        const next = { ...p }
        for (const c of frozen) delete next[c.id]
        return next
      })
    }
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
      {/* The board's order, written back to the book — the other half of
          free placement. Arrange, then apply; never on its own. Disabled when
          the board already reads in binder order, because a button that
          offers to apply an order the book already has is a button that lies
          about having something to do. */}
      <button
        type="button"
        className="board-tool"
        data-help="board-order"
        onClick={() => void applyOrder()}
        // Never while stacked: the piles are a way of looking and nothing
        // about them is written anywhere, and the order they would read in
        // is the cascade's geometry, not the writer's arrangement.
        disabled={stacked || !boardOrderDiffers(placed)}
      >
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Apply Order</span>
      </button>

      {/* The string tool. Toggled, like Stack, so it reads as a thing the
          board is in rather than a thing that happens once. */}
      <button
        type="button"
        className={`board-tool${stringMode ? ' on' : ''}`}
        data-help="board-string"
        aria-pressed={stringMode}
        onClick={() => {
          setPending(null)
          setStringMode((on) => !on)
        }}
        disabled={cards.length < 2}
      >
        <span className="board-tool-pin" aria-hidden="true" />
        <span>String</span>
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
      {/* Always present and disabled until there is something to undo, like
          Stack and Tidy: a button that appears on Apply would push the strip
          onto a new row and the whole board down with it at the moment of
          the click. */}
      <button
        type="button"
        className="board-tool"
        data-help="board-undo"
        onClick={() => void undoBoardOrder()}
        disabled={boardUndo == null}
      >
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Undo Apply</span>
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

  /** A click's position in board pixels, from the board's own box. */
  const boardPoint = (e: { clientX: number; clientY: number }): Point => {
    const box = boardEl.current?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }

  const open = (card: PlacedCard, e: { clientX: number; clientY: number }): void => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (stringMode) {
      // Pin where the card was clicked, not at its centre: a writer pushing
      // a pin into a corner of a card meant that corner.
      const end: StringEnd = { cardId: card.id, ...pinOffset(card, boardPoint(e)) }
      if (pending == null) {
        setPending(end)
        return
      }
      // The second pin on the same card is a mistake, not a string: it is
      // ignored and the first pin stays waiting.
      if (pending.cardId === card.id) return
      void createBoardString(pending, end)
      setPending(null)
      return
    }
    // A scene is an arrival, like picking it in the binder. An entry is a
    // detour, like opening it from anywhere else — so Esc comes back here.
    if (card.kind === 'scene') void selectDoc(card.id)
    else showEntity(card.id)
  }

  // Where every card is right now, including the one being carried — so a
  // string follows its card through the drag rather than catching up at the
  // drop.
  const livePositions = new Map<string, Point>(
    placed.map((c) => [
      c.id,
      dragging === c.id && offset ? { x: c.x + offset.x, y: c.y + offset.y } : { x: c.x, y: c.y }
    ])
  )
  const strings = boardStrings.flatMap((str) => {
    const pts = stringPoints(str, livePositions)
    return pts ? [{ id: str.id, a: pts[0], b: pts[1] }] : []
  })
  const pendingAt = pending
    ? (() => {
        const card = livePositions.get(pending.cardId)
        return card ? { x: card.x + pending.dx, y: card.y + pending.dy } : null
      })()
    : null

  return (
    <div className="terminal corkboard" data-help="corkboard">
      {tools}
      <div
        className={`corkboard-board${stacked ? ' stacked' : ''}${stringMode ? ' stringing' : ''}`}
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
            {card.kind === 'scene' && !stringMode && (
              // Turns the card over to its back (F-42). A sibling of the face
              // for the same reason as the take-off box, and it swallows the
              // press so turning a card over never starts a drag.
              <button
                type="button"
                className={`scene-card-turn${card.back ? ' written' : ''}`}
                data-help="card-turn"
                aria-label={`Turn ${card.title} over${card.back ? ', outlined' : ''}`}
                title="Turn over"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => project && setTurned({ path: project.path, id: card.id })}
              />
            )}
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
                onClick={(e) => open(card, e)}
                aria-label={`Open ${card.title}`}
                // What the front says from the back — the act and type, and
                // an unwritten scene's synopsis — is otherwise only seen.
                aria-describedby={
                  [
                    card.outline != null && `card-${card.id}-outline`,
                    card.empty && card.synopsis != null && `card-${card.id}-synopsis`
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              >
                <CardFace card={card} />
              </button>
            ) : (
              <button
                type="button"
                className="scene-card-face"
                data-help="bible-card"
                onClick={(e) => open(card, e)}
                aria-label={`Open ${card.title}`}
              >
                <CardFace card={card} portrait={card.portrait ? portraits[card.id] : undefined} />
              </button>
            )}
          </div>
        ))}
        {/* The strings, drawn over the cards. The layer itself takes no
            pointer events, so cards under it still drag; only the pin heads
            do, and only while the string tool is up, so a pin can be pulled
            without a pin being something you can accidentally pull. */}
        <svg
          className={`board-strings${stringMode ? ' live' : ''}`}
          aria-hidden={!stringMode}
          role={stringMode ? 'list' : undefined}
          aria-label={stringMode ? 'Strings' : undefined}
        >
          {strings.map((str) => (
            <g key={str.id} className="board-string" role="listitem">
              <path d={stringPath(str.a, str.b)} />
              {[str.a, str.b].map((pt, i) => (
                <circle
                  key={i}
                  className="board-pin"
                  data-help="board-pin"
                  cx={pt.x}
                  cy={pt.y}
                  r={5}
                  onClick={() => {
                    if (stringMode) void deleteBoardString(str.id)
                  }}
                >
                  <title>Pull this pin to remove the string</title>
                </circle>
              ))}
            </g>
          ))}
          {pendingAt && (
            <circle className="board-pin pending" cx={pendingAt.x} cy={pendingAt.y} r={5} />
          )}
        </svg>
      </div>
      {adding && <AddCardDialog onClose={() => setAdding(false)} />}
      {turned != null && turnedId != null && docs != null && (
        <CardBack
          path={turned.path}
          sceneIds={cards.filter((c) => c.kind === 'scene').map((c) => c.id)}
          startId={turnedId}
          docs={docs}
          onWritten={reloadDocs}
          onClose={() => setTurned(null)}
        />
      )}
    </div>
  )
}

/** What a card says: title, where it lives, its opening, and its foot. */
function CardFace({ card, portrait }: { card: PlacedCard; portrait?: string }): JSX.Element {
  return (
    <>
      <span className="scene-card-head">
        {portrait && (
          <span className="portrait-print scene-card-portrait-frame">
            <img className="scene-card-portrait" src={portrait} alt="" />
          </span>
        )}
        <span className="scene-card-title">{card.title}</span>
      </span>
      {card.folder !== '' && <span className="scene-card-folder">{card.folder}</span>}
      {card.outline != null && (
        <span className="scene-card-outline" id={`card-${card.id}-outline`}>
          {card.outline}
        </span>
      )}
      <span className="scene-card-excerpt">
        {!card.empty ? (
          card.excerpt
        ) : card.synopsis != null ? (
          // An outlined scene shows what it will be, from the back of the card.
          <span className="scene-card-synopsis" id={`card-${card.id}-synopsis`}>
            {card.synopsis}
          </span>
        ) : (
          <em>Not written yet.</em>
        )}
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
