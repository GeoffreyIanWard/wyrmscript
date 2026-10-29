import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import type {
  BoardSticker,
  DocFile,
  StickerKind,
  StringColour,
  StringEnd
} from '../../../shared/types'
import { colourOf } from '../../../shared/types'
import { STICKER_SIZE } from '../lib/stickers'
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
  nearestCard,
  NUDGE,
  NUDGE_BIG,
  NUDGE_SETTLE,
  pinOffset,
  cardPin,
  directedLabel,
  facingPins,
  relationshipStrings,
  tagPlace,
  stackLayout,
  stringPath,
  stringPoints
} from '../lib/corkboard'
import type { Direction, PlacedCard, Point } from '../lib/corkboard'
import { AddCardDialog } from './AddCardDialog'
import { MapCardFace } from './MapCardFace'
import { CardCorner } from './CardCorner'
import { ColourSwatches, StickerGlyph, StickerOnBoard, StickerPicker } from './BoardStickers'
import { sheetsOf } from '../lib/mapSheets'
import { CardBack } from './CardBack'
import { afterKeysUp } from '../lib/keys'

interface Thread {
  key: string
  a: Point
  b: Point
  /** The cards `a`'s and `b`'s pins are in: focus goes to the first once the
   *  string is pulled, and a press on a pin drags its own card. */
  fromId: string
  toId: string
  /** The label as written, and as shown (a relationship's has a direction). */
  text?: string
  shown?: string
  /** Who it joins, for its pins, its tag and the status line: the arrow on a
   *  tag alone says nothing, and nothing else on it says who it joins. */
  named: string
  /** What Delete does to it, said wherever Delete is offered. */
  removal: string
  labelName: string
  /** Which side a short string's tag goes (`tagPlace`). */
  side?: -1 | 1
  pull: () => Promise<void>
  edit: { kind: 'string'; id: string } | { kind: 'relationship'; id: string }
  relationship?: boolean
  colour: StringColour
}

type Draft =
  | { kind: 'new'; from: StringEnd; to: StringEnd; between: 'characters' | 'cards' }
  | { kind: 'string'; id: string }
  | { kind: 'relationship'; id: string }

/**
 * Whether Esc is the chosen string's to let go of (I-23): one is chosen, and
 * the key is headed for the board, which hears it. Anywhere else nothing on
 * the board would, so the tool's and the sticker's Esc keep it.
 */
const chosenTakesEsc = (e: KeyboardEvent): boolean =>
  document.querySelector('.board-string.chosen') != null &&
  (e.target as Element | null)?.closest?.('.corkboard') != null

const ARROWS: Record<string, Direction | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

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
  const showMapSheet = useWyrm((s) => s.showMapSheet)
  const setMapOnBoard = useWyrm((s) => s.setMapOnBoard)
  const placeMapCard = useWyrm((s) => s.placeMapCard)
  // A minimap card draws its map, so the maps' layers are read as the board
  // opens — as the map view reads them; settled, so a layer that will not
  // read leaves that card plain rather than the board down.
  const loadMapPins = useWyrm((s) => s.loadMapPins)
  const loadMapShapes = useWyrm((s) => s.loadMapShapes)
  const loadMapMarks = useWyrm((s) => s.loadMapMarks)
  const boardPath = project?.path
  useEffect(() => {
    if (!boardPath) return
    void Promise.allSettled([loadMapPins(), loadMapShapes(), loadMapMarks()])
  }, [boardPath, loadMapPins, loadMapShapes, loadMapMarks])
  const tidyBoard = useWyrm((s) => s.tidyBoard)
  const applyBoardOrder = useWyrm((s) => s.applyBoardOrder)
  const boardUndo = useWyrm((s) => s.boardUndo)
  const undoBoardOrder = useWyrm((s) => s.undoBoardOrder)
  const boardStrings = useWyrm((s) => s.boardStrings)
  const loadBoardStrings = useWyrm((s) => s.loadBoardStrings)
  const recolourBoardString = useWyrm((s) => s.recolourBoardString)
  const boardStickers = useWyrm((s) => s.boardStickers)
  const loadBoardStickers = useWyrm((s) => s.loadBoardStickers)
  const createBoardSticker = useWyrm((s) => s.createBoardSticker)
  const moveBoardSticker = useWyrm((s) => s.moveBoardSticker)
  const deleteBoardSticker = useWyrm((s) => s.deleteBoardSticker)
  const createBoardString = useWyrm((s) => s.createBoardString)
  const deleteBoardString = useWyrm((s) => s.deleteBoardString)
  const labelBoardString = useWyrm((s) => s.labelBoardString)
  const relationships = useWyrm((s) => s.relationships)
  const loadRelationships = useWyrm((s) => s.loadRelationships)
  const createRelationship = useWyrm((s) => s.createRelationship)
  const saveRelationship = useWyrm((s) => s.saveRelationship)
  const deleteRelationship = useWyrm((s) => s.deleteRelationship)
  const [dragging, setDragging] = useState<string | null>(null)
  // Which project the Add Card dialog was opened for. Derived rather than
  // closed in an effect: the dialog shows only while that is the project in
  // front, so a change of project dismisses it the way App's own dialogs are
  // dismissed — otherwise it would stay open and quietly add its card to
  // whichever novel came to the front.
  const addingFor = useWyrm((s) => s.addCardFor)
  const openAddCard = useWyrm((s) => s.openAddCard)
  const closeAddCard = useWyrm((s) => s.closeAddCard)
  const adding = addingFor != null && addingFor === project?.path
  const setAdding = (on: boolean): void => (on ? openAddCard() : closeAddCard())
  // Where the keyboard goes when Add Card closes: the card it made, once that
  // card is on the board, or back to the Add Card tool. Without this, a
  // dialog opened by ⌥⌘N from the page — whose focus had nowhere to return
  // to, the page being gone — left focus on <body>, where none of the
  // board's keys do anything.
  const focusAfterAdd = useRef<string | null>(null)
  const addToolRef = useRef<HTMLButtonElement | null>(null)
  const closeAdding = (cardId?: string): void => {
    focusAfterAdd.current = cardId ?? ''
    closeAddCard()
  }
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
  // Keyboard nudges waiting to be written, by card. Written at once if the
  // board goes away first — a nudge is never lost to leaving the board.
  const pendingWrites = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>()
  )
  useEffect(
    () => () => {
      for (const { timer, write } of pendingWrites.current.values()) {
        clearTimeout(timer)
        write()
      }
    },
    []
  )

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
    void loadBoardStickers()
  }, [project, loadBoardStrings, loadBoardStickers])
  // The Character Graph's relationships are drawn as string between the
  // characters on the board, so the board loads them the way the graph does.
  useEffect(() => {
    void loadRelationships()
  }, [project, loadRelationships])

  /**
   * The string tool (F-46). On, a click on a card pushes a pin in where it
   * was clicked; the second pin, on a different card, makes the string. Esc
   * pulls a pin that is waiting for its partner, or puts the tool down. The
   * pending pin is held here rather than written anywhere, because a pin
   * with no string is not a thing the board has.
   */
  const [stringMode, setStringMode] = useState(false)
  // The colour the next string or sticker takes, and the sticker in hand —
  // sticking is a mode the board is in, as stringing is, until it is put down.
  const [colour, setColour] = useState<StringColour>('red')
  const [stickerKind, setStickerKind] = useState<StickerKind | null>(null)
  const [pickingSticker, setPickingSticker] = useState(false)
  const stickerTool = useRef<HTMLButtonElement | null>(null)
  // Esc puts the sticker down, as it does the string tool (stopped: Esc is
  // also "back"); a dialog over the board, or the picker, has its own.
  useEffect(() => {
    if (!stickerKind) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // The merge screen over the board (F-51) has the Esc too: the board is
      // out of sight beneath it.
      if (document.querySelector('.dialog-overlay, .sticker-picker, .merge-screen')) return
      // A chosen string is let go first, as it is with the string tool up.
      if (chosenTakesEsc(e)) return
      e.preventDefault()
      e.stopPropagation()
      setStickerKind(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [stickerKind])
  const [pending, setPending] = useState<StringEnd | null>(null)
  // Whether the waiting pin came from the keyboard, which has no "where".
  const pendingByKeyboard = useRef(false)
  // A string being labelled: a new one between its two pins, or an existing
  // string's or relationship's label being changed. Held here until Return,
  // like the pending pin — a string half-made is not a thing the board has.
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftText, setDraftText] = useState('')
  const [draftProblem, setDraftProblem] = useState<string | null>(null)
  /**
   * The string chosen by a click on one of its pins or its tag (I-23), with
   * the tool up or down, the way a click chooses a shape on the map: Delete
   * then takes it down, Esc lets it go, and a second click on its tag
   * changes the label. Its key, not the thread: a string that goes (pulled
   * elsewhere, or its card off the board) leaves nothing chosen.
   */
  const [chosen, setChosen] = useState<string | null>(null)
  useEffect(() => {
    if (!stringMode) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // A dialog over the board (Add Card, the back of a card) has the Esc:
      // this listener runs first, in the capture phase, and would otherwise
      // take it, leaving the dialog impossible to close from the keyboard.
      // So does the merge screen (F-51), with the board out of sight beneath.
      if (document.querySelector('.dialog-overlay, .merge-screen')) return
      // The label field takes its own Esc (cancel the string), below.
      if ((e.target as Element | null)?.closest?.('.string-label-input')) return
      // A chosen string is let go first, by the board's own keys (below),
      // when the key is headed for the board: read from the page, as this
      // listener runs before anything changes it.
      if (chosenTakesEsc(e)) return
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
  // The open scene's text as the store holds it, not as it was read: the
  // board reads every document once, as it appears, and the editor's last
  // save can still be landing then — the card of the scene just left would
  // show the text from before it. Only the body: positions and the back of
  // the card are the board's own writes and are already in `docs`.
  const activeDoc = useWyrm((s) => s.activeDoc)
  const cards = useMemo(() => {
    if (!project || !docs) return []
    const fresh =
      activeDoc == null
        ? docs
        : docs.map((d) => (d.meta.id === activeDoc.meta.id ? { ...d, body: activeDoc.body } : d))
    return boardCards(fresh, project.data.binder, entities, sheetsOf(project.data))
  }, [docs, project, entities, activeDoc])

  // The board's own width decides how many columns an untouched card falls
  // into. Measured rather than assumed, and guarded because jsdom has no
  // ResizeObserver — a bare `new ResizeObserver` throws there and would take
  // the whole view down in tests rather than failing one.
  const boardEl = useRef<HTMLDivElement | null>(null)

  // Coming back from a scene or entry opened from a card (Esc): put the board
  // back where it was and the focus on that card, so the next card is one
  // keystroke or glance away. Once, when the cards first exist: the restore
  // clears the place from the view as it uses it (`settleBoardReturn`), so a
  // later re-read of the documents, or a later remount, finds nothing to do.
  const scrollEl = useRef<HTMLDivElement | null>(null)
  const returnedTo = useWyrm((s) => (s.mainView.kind === 'corkboard' ? s.mainView : null))
  const [boardWidth, setBoardWidth] = useState(0)
  // Whether the width above has been read from the board at all — 0 is a
  // real answer in some environments, so it cannot stand for "not yet".
  const [measured, setMeasured] = useState(false)
  useEffect(() => {
    const el = boardEl.current
    if (!el) return
    setBoardWidth(el.clientWidth)
    setMeasured(true)
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
  // Seeded from the view being returned to, so a card opened from a stacked
  // board comes back to the same piles — the layout its scroll was taken in.
  const [stacked, setStacked] = useState(() => returnedTo?.stacked ?? false)
  const [pulled, setPulled] = useState<Set<string>>(() => new Set(returnedTo?.pulled ?? []))

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

  useEffect(() => {
    const want = focusAfterAdd.current
    if (want == null || adding) return
    if (want === '') {
      // Nothing made: back to the tool, unless focus already went somewhere.
      focusAfterAdd.current = null
      const at = document.activeElement
      if (!at || at === document.body || !at.isConnected) addToolRef.current?.focus()
      return
    }
    // The card made: wait for it to be on the board — a new scene arrives
    // with the next read of the documents — then go to it.
    const face = boardEl.current?.querySelector<HTMLElement>(
      `[data-card="${want}"] .scene-card-face`
    )
    if (!face) return
    focusAfterAdd.current = null
    // Not while the key that closed the dialog is still down. Return made
    // the card, and moving focus onto the card's button while that Return
    // was still being delivered let Chromium activate the button with it —
    // the new card opened itself and the board was gone. Space activates on
    // release, so it is the release that is waited for.
    afterKeysUp(() => {
      face.focus()
      face.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    })
  }, [placed, adding])

  useEffect(() => {
    if (docs == null || returnedTo?.cardId == null) return
    // Wait until the board has measured its width, or unplaced cards are
    // still in the one-column layout of the first render and the scroll
    // lands somewhere else.
    if (!measured) return
    // A one-off: once used, the view forgets it, or the next remount of the
    // board (after stats, after another window) would snap back here again.
    useWyrm.getState().settleBoardReturn()
    const el = scrollEl.current
    if (!el) return
    el.scrollTop = returnedTo.scrollTop ?? 0
    const face = el.querySelector<HTMLElement>(
      `[data-card="${returnedTo.cardId}"] .scene-card-face`
    )
    // Gone since (untagged, trashed, taken off the board): the scroll alone
    // is still the right place to come back to.
    if (!face) return
    face.focus({ preventScroll: true })
    face.scrollIntoView?.({ block: 'nearest' })
  }, [docs, measured, returnedTo])

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
        ref={addToolRef}
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
          setStickerKind(null)
          setPickingSticker(false)
          setStringMode((on) => !on)
        }}
        disabled={cards.length < 2}
      >
        <span className="board-tool-pin" aria-hidden="true" />
        <span>String</span>
      </button>
      {/* Stickers: one picked from the drop-down is in hand until the button
          is pressed again or Esc; each click then sticks one down. */}
      <span className="sticker-tool">
        <button
          ref={stickerTool}
          type="button"
          className={`board-tool${stickerKind ? ' on' : ''}`}
          data-help="board-sticker-tool"
          aria-haspopup="dialog"
          aria-expanded={pickingSticker}
          aria-pressed={stickerKind != null}
          // As String is: on an empty board there is nothing to stick to yet.
          disabled={cards.length === 0}
          onClick={() => {
            if (stickerKind) {
              setStickerKind(null)
              setPickingSticker(false)
            } else setPickingSticker((o) => !o)
          }}
        >
          {/* The pin, or the sticker in hand in its place — one slot of one
              size, so the colours beside this button never move under the
              pointer when a sticker is picked. */}
          <span className={`sticker-in-hand colour-${colour}`} aria-hidden="true">
            {stickerKind ? (
              <StickerGlyph kind={stickerKind} size={14} />
            ) : (
              <span className="board-tool-pin" />
            )}
          </span>
          <span>Sticker ▾</span>
        </button>
        {pickingSticker && (
          <StickerPicker
            colour={colour}
            current={stickerKind}
            onPick={(kind) => {
              setStickerKind(kind)
              setPickingSticker(false)
              setStringMode(false)
              setPending(null)
            }}
            onClose={() => {
              setPickingSticker(false)
              afterKeysUp(() => stickerTool.current?.focus())
            }}
          />
        )}
      </span>
      <span className="board-colour" data-help="board-colour">
        <ColourSwatches
          value={colour}
          onChange={setColour}
          label="Colour of strings and stickers"
        />
      </span>
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
            Add a scene, a character, a location or a map with <strong>Add Card</strong>. Any
            document tagged <strong>scene</strong> appears here on its own.
          </div>
        </div>
        {adding && <AddCardDialog onClose={closeAdding} />}
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
  const onPointerDown = (e: ReactPointerEvent<Element>, card: PlacedCard): void => {
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
      placeCard(card, d.originX + (ev.clientX - d.startX), d.originY + (ev.clientY - d.startY))
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

  /**
   * Put a card down here — the one way a card is placed, by a drag or by
   * the keyboard. Clamped at the top-left corner only: a board scrolls, so a
   * card past the right edge is a card further along the wall, not a
   * mistake. A card moved out of a pile stays out until the board is
   * unstacked, rather than snapping back into the stack.
   */
  const placeCard = (card: PlacedCard, toX: number, toY: number, settle = 0): void => {
    const x = Math.round(Math.max(0, toX))
    const y = Math.round(Math.max(0, toY))
    setLocalPos((p) => ({ ...p, [card.id]: { x, y } }))
    if (stacked) setPulled((p) => new Set(p).add(card.id))
    // Which file holds the position depends on what the card is.
    const write = (): void => {
      pendingWrites.current.delete(card.id)
      if (card.kind === 'scene') void setCardPosition(card.id, x, y)
      else if (card.kind === 'map') void placeMapCard(card.id, { x, y })
      else void setEntityPosition(card.id, x, y)
    }
    clearTimeout(pendingWrites.current.get(card.id)?.timer)
    if (settle === 0) {
      write()
      return
    }
    // A held ⌥+arrow is dozens of nudges a second. The card moves on every
    // one; the file is written once it stops, so writes cannot pile up and
    // land out of order, leaving an older position on disk.
    pendingWrites.current.set(card.id, { timer: setTimeout(write, settle), write })
  }

  /** The face of a card, to move the keyboard's focus to. */
  const faceOf = (id: string): HTMLElement | null =>
    boardEl.current?.querySelector<HTMLElement>(`[data-card="${id}"] .scene-card-face`) ?? null

  /**
   * The board from the keyboard. Arrows go to the nearest card that way, as
   * the eye reads the board (Tab goes in binder order, which on a free-form
   * board can be anywhere on screen); ⌥+arrows nudge the card, ⇧⌥ a bigger
   * step; ⇧Return turns a scene card over. Return still opens, as a button.
   */
  const onCardKey = (e: ReactKeyboardEvent<HTMLDivElement>, card: PlacedCard): void => {
    const dir = ARROWS[e.key]
    if (dir) {
      if (e.metaKey || e.ctrlKey) return
      e.preventDefault()
      if (e.altKey) {
        const step = e.shiftKey ? NUDGE_BIG : NUDGE
        const [dx, dy] =
          dir === 'left'
            ? [-step, 0]
            : dir === 'right'
              ? [step, 0]
              : dir === 'up'
                ? [0, -step]
                : [0, step]
        placeCard(card, card.x + dx, card.y + dy, NUDGE_SETTLE)
        // The view follows the card, or a nudge off the edge loses it.
        requestAnimationFrame(() =>
          faceOf(card.id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
        )
        return
      }
      if (e.shiftKey) return
      const to = nearestCard(placed, card.id, dir)
      const face = to ? faceOf(to) : null
      face?.focus()
      face?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      return
    }
    if (e.key === 'Enter' && e.shiftKey && card.kind === 'scene' && !stringMode && project) {
      e.preventDefault()
      setTurned({ path: project.path, id: card.id })
    }
  }

  /** A click's position in board pixels, from the board's own box. */
  const boardPoint = (e: { clientX: number; clientY: number }): Point => {
    const box = boardEl.current?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }

  const open = (
    card: PlacedCard,
    e: { clientX: number; clientY: number; detail?: number }
  ): void => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (stickerKind) {
      // Stuck where the card was clicked; from the keyboard (no "where"), on
      // its top right corner, where a sticker on a card usually goes.
      const cardAt = livePositions.get(card.id) ?? { x: card.x, y: card.y }
      const at = e.detail === 0 ? { x: cardAt.x + CARD_W - 22, y: cardAt.y + 22 } : boardPoint(e)
      void createBoardSticker(stickerKind, colour, {
        cardId: card.id,
        x: at.x - cardAt.x,
        y: at.y - cardAt.y
      })
      return
    }
    if (stringMode) {
      // A string still being named takes the next click back to its field:
      // pinning another card under it would start a second string while the
      // first is unfinished.
      if (draft) {
        document.querySelector<HTMLInputElement>('.string-label-input')?.focus()
        return
      }
      // Pin where the card was clicked, not at its centre: a writer pushing
      // a pin into a corner of a card meant that corner. From the keyboard
      // there is no "where" (a click with no pointer has detail 0): the pin
      // waits at the card's own pin, top centre, and once the second card is
      // known both keyboard ends move to the edges that face each other, so
      // the string hangs between the cards rather than through one.
      const byKeyboard = e.detail === 0
      const at = byKeyboard ? cardPin(card) : boardPoint(e)
      const end: StringEnd = { cardId: card.id, ...pinOffset(card, at) }
      if (pending == null) {
        setPending(end)
        pendingByKeyboard.current = byKeyboard
        return
      }
      // The second pin on the same card is a mistake, not a string: it is
      // ignored and the first pin stays waiting.
      if (pending.cardId === card.id) return
      const first = placed.find((c) => c.id === pending.cardId)
      let from = pending
      let to = end
      if (first && (pendingByKeyboard.current || byKeyboard)) {
        const [p, q] = facingPins(first, card)
        if (pendingByKeyboard.current) from = { cardId: first.id, ...pinOffset(first, p) }
        if (byKeyboard) to = { cardId: card.id, ...pinOffset(card, q) }
      }
      // Not made yet: the string is labelled first, at its middle. Between
      // two characters it is a relationship, which needs its name.
      const between =
        first?.kind === 'character' && card.kind === 'character' ? 'characters' : 'cards'
      setDraft({ kind: 'new', from, to, between })
      setDraftText('')
      setDraftProblem(null)
      setPending(null)
      return
    }
    // Both are detours from the board: Esc comes back here, to this card,
    // scrolled to where the board was — the board→scene→board loop an
    // outline is worked through. (A scene used to be an arrival, like
    // picking it in the binder, which left Esc doing nothing.)
    const here = {
      kind: 'corkboard' as const,
      cardId: card.id,
      scrollTop: scrollEl.current?.scrollTop ?? 0,
      ...(stacked ? { stacked, pulled: [...pulled] } : {})
    }
    if (card.kind === 'scene') void selectDoc(card.id, here)
    else if (card.kind === 'map') showMapSheet(card.id, here)
    else showEntity(card.id, here)
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
  const titleOf = (id: string): string => placed.find((c) => c.id === id)?.title ?? 'a card'
  /**
   * Everything drawn as string: the board's own strings, and the Character
   * Graph's relationships between characters who are both on the board. One
   * list, so a pin, a label and the keyboard work the same on either.
   */
  const threads: Thread[] = [
    ...boardStrings.flatMap((str) => {
      const pts = stringPoints(str, livePositions)
      if (!pts) return []
      return [
        {
          key: str.id,
          a: pts[0],
          b: pts[1],
          fromId: str.from.cardId,
          toId: str.to.cardId,
          text: str.label,
          shown: str.label,
          // Named for the keyboard and screen readers: a pin is otherwise
          // only a dot, and "this pin" says nothing about which string.
          named: `string${str.label ? ` "${str.label}"` : ''} from ${titleOf(str.from.cardId)} to ${titleOf(str.to.cardId)}`,
          removal: 'Delete removes it',
          labelName: str.label
            ? `Change the label "${str.label}"`
            : `Label the string from ${titleOf(str.from.cardId)} to ${titleOf(str.to.cardId)}`,
          pull: () => deleteBoardString(str.id),
          edit: { kind: 'string' as const, id: str.id },
          colour: colourOf(str)
        }
      ]
    }),
    ...relationshipStrings(
      relationships,
      placed.map((c) => ({ ...c, ...(livePositions.get(c.id) ?? {}) }))
    ).map(({ relationship: rel, a, b, side }) => ({
      key: `rel-${rel.id}`,
      a,
      b,
      side,
      fromId: rel.fromId,
      toId: rel.toId,
      text: rel.label,
      shown: directedLabel(rel.label, a, b),
      named: `relationship "${rel.label}" from ${titleOf(rel.fromId)} to ${titleOf(rel.toId)}`,
      removal: 'Delete removes it, from the Character Graph too',
      labelName: `Change the relationship "${rel.label}" from ${titleOf(rel.fromId)} to ${titleOf(rel.toId)}`,
      pull: () => deleteRelationship(rel),
      edit: { kind: 'relationship' as const, id: rel.id },
      relationship: true,
      colour: colourOf(rel)
    }))
  ]

  const chosenThread = threads.find((t) => t.key === chosen) ?? null

  /**
   * A press on a pin or a tag chooses its string, and takes focus with it,
   * so the board's keys hear Delete and Esc whatever the pointer pressed.
   */
  const choose = (t: Thread, el: HTMLElement | SVGElement): void => {
    // Focus first: its own handler lets go of any other string, and must
    // not undo this choice by running after it.
    el.focus()
    setChosen(t.key)
  }

  /** Tab onto another string's pin or tag: only one string is ever chosen. */
  const letGoOfOthers = (t: Thread): void => {
    if (chosen != null && chosen !== t.key) setChosen(null)
  }

  const removeThread = (t: Thread): void => {
    setChosen(null)
    // The pin or tag is about to go, and focus with it to <body>: land on
    // the card the string ran from instead.
    faceOf(t.fromId)?.focus()
    void t.pull()
  }

  /**
   * The board's own keys, heard wherever focus is on it — a click on a pin
   * with the tool down gives it focus, but on a card or a tool the chosen
   * string is still the one Delete means, as on the map (I-19).
   */
  const onBoardKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as Element
    // A field, a dialog or the picker over the board has its own keys.
    if (
      target.closest?.(
        'input, textarea, [contenteditable="true"], .dialog-overlay, .sticker-picker'
      )
    )
      return
    if (e.key === 'Escape' && chosenThread) {
      // Stopped as well as handled: Esc is also "back", and letting go of a
      // string should not also walk the writer off the board.
      e.preventDefault()
      e.stopPropagation()
      setChosen(null)
      return
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // A pin with focus means its own string, chosen or not — it is drawn
    // thickened — and anywhere else, the chosen one.
    const key = target.closest?.('.board-pin')?.getAttribute('data-thread') ?? chosen
    const t = threads.find((x) => x.key === key)
    if (!t) return
    e.preventDefault()
    e.stopPropagation()
    removeThread(t)
  }

  /** Where the label field sits, and the string it belongs to. */
  const draftAt = ((): { a: Point; b: Point } | null => {
    if (!draft) return null
    if (draft.kind === 'new') {
      const p = livePositions.get(draft.from.cardId)
      const q = livePositions.get(draft.to.cardId)
      if (!p || !q) return null
      return {
        a: { x: p.x + draft.from.dx, y: p.y + draft.from.dy },
        b: { x: q.x + draft.to.dx, y: q.y + draft.to.dy }
      }
    }
    const t = threads.find((x) => x.edit.kind === draft.kind && x.edit.id === draft.id)
    return t ? { a: t.a, b: t.b } : null
  })()

  const closeDraft = (restore = true): void => {
    const was = draft
    setDraft(null)
    setDraftProblem(null)
    // Back to a card, not dropped to <body> with the field — unless the
    // writer has already put focus somewhere on purpose (clicked the next
    // card), which must not be pulled back to the last one.
    if (!restore) return
    const id =
      was?.kind === 'new'
        ? was.to.cardId
        : threads.find((x) => was && x.edit.kind === was.kind && x.edit.id === was.id)?.fromId
    if (id) afterKeysUp(() => faceOf(id)?.focus())
  }

  /** Return in the label field, or leaving it. False when it cannot be kept. */
  const commitDraft = (restore = true): boolean => {
    if (!draft) return true
    const text = draftText.trim()
    const named =
      draft.kind === 'relationship' || (draft.kind === 'new' && draft.between === 'characters')
    if (named && !text) {
      // Said, not silently refused: a relationship is a named thing.
      setDraftProblem(
        'Name the relationship ("sister of", "owes") — it goes in the Character Graph too.'
      )
      return false
    }
    if (draft.kind === 'new' && draft.between === 'characters') {
      // The same relationship twice, one way, is one relationship the
      // writer cannot see the second of. The other direction is a new one.
      const same = relationships.find(
        (r) =>
          r.fromId === draft.from.cardId &&
          r.toId === draft.to.cardId &&
          r.label.trim().toLowerCase() === text.toLowerCase()
      )
      if (same) {
        setDraftProblem(
          `${titleOf(same.fromId)} is already "${same.label}" ${titleOf(same.toId)} — change that one from its tag.`
        )
        return false
      }
    }
    if (draft.kind === 'new') {
      if (draft.between === 'characters')
        void createRelationship(draft.from.cardId, draft.to.cardId, text, colour)
      else void createBoardString(draft.from, draft.to, text, colour)
    } else if (draft.kind === 'string') {
      // An unchanged label writes nothing — the store's rule, held there so
      // every caller gets it.
      void labelBoardString(draft.id, text)
    } else {
      const rel = relationships.find((r) => r.id === draft.id)
      if (rel && rel.label !== text) void saveRelationship({ ...rel, label: text })
    }
    closeDraft(restore)
    return true
  }

  /** A place on the cork, kept on the board: in the margin round it, or
   *  above it, a sticker would be out of reach. */
  const onCork = (p: Point): Point => ({
    x: Math.max(STICKER_SIZE / 2, p.x),
    y: Math.max(STICKER_SIZE / 2, p.y)
  })

  /**
   * A sticker let go with its centre at `centre` (board coordinates): stuck
   * to the card on top there, at its place on that card, or else on the
   * cork. The last card in the board's order is the one on top.
   */
  const dropSticker = (st: BoardSticker, centre: Point): void => {
    const on = [...placed].reverse().find((c) => {
      const at = livePositions.get(c.id) ?? c
      return (
        centre.x >= at.x &&
        centre.x <= at.x + CARD_W &&
        centre.y >= at.y &&
        centre.y <= at.y + CARD_H
      )
    })
    if (on) {
      const at = livePositions.get(on.id) ?? on
      void moveBoardSticker(st.id, { cardId: on.id, x: centre.x - at.x, y: centre.y - at.y })
    } else void moveBoardSticker(st.id, onCork(centre))
  }

  /** Off it comes; the keyboard goes back to the card it was on, or the board. */
  const removeSticker = (st: BoardSticker): void => {
    if (st.cardId) afterKeysUp(() => faceOf(st.cardId!)?.focus())
    else afterKeysUp(() => scrollEl.current?.focus())
    void deleteBoardSticker(st.id)
  }

  const pendingAt = pending
    ? (() => {
        const card = livePositions.get(pending.cardId)
        return card ? { x: card.x + pending.dx, y: card.y + pending.dy } : null
      })()
    : null

  return (
    <div
      className="terminal corkboard"
      data-help="corkboard"
      ref={scrollEl}
      onClick={(e) => {
        // With a sticker in hand, a click on the cork sticks it there — anywhere
        // on it, not only as far down as the cards reach. A
        // click that ends a drag over the cork is the drag's, not a click.
        if (!stickerKind) return
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        // Only a click on the cork itself: the view, or the board where no
        // card is. Anything drawn over it — a card, a tag, the Add Card
        // dialog or the back of a card, which are children here too — is
        // not somewhere to stick one.
        if (e.target !== e.currentTarget && e.target !== boardEl.current) return
        void createBoardSticker(stickerKind, colour, onCork(boardPoint(e)))
      }}
      onKeyDown={onBoardKey}
      // A press anywhere but on a string lets go of the chosen one: the cork,
      // a card, a tool.
      onPointerDownCapture={(e) => {
        if (!(e.target as Element).closest?.('.board-pin, .string-label, .string-label-field'))
          setChosen(null)
      }}
      // So does focus leaving the board — but not the window losing it
      // (Cmd-Tab, a menu), which is not the writer going anywhere.
      onBlur={(e) => {
        const to = e.relatedTarget
        if (to instanceof Node && e.currentTarget.contains(to)) return
        if (to == null && !document.hasFocus()) return
        setChosen(null)
      }}
    >
      {tools}
      {/* Said aloud, not shown: the waiting pin and the chosen string are on
          screen already, but a keyboard writer who pinned with Return has
          nothing else telling them the board is waiting for a second card,
          nor anyone what Delete will do. */}
      <span className="sr-only" role="status">
        {chosenThread
          ? `Selected the ${chosenThread.named}. ${chosenThread.removal}; Esc lets go.`
          : stringMode && pending
            ? `Pinned to ${placed.find((c) => c.id === pending.cardId)?.title ?? 'a card'}. Choose a second card to run the string, or Esc to pull the pin.`
            : ''}
      </span>
      <div
        className={`corkboard-board${stacked ? ' stacked' : ''}${stringMode ? ' stringing' : ''}${stickerKind ? ' sticking' : ''}`}
        ref={boardEl}
        style={{ height: boardHeight(placed) + CARD_H / 2 }}
      >
        {/* Stickers on the cork, under the cards: a card put down over one
            covers it, as it would. */}
        {boardStickers
          .filter((st) => !st.cardId)
          .map((st) => (
            <StickerOnBoard
              key={st.id}
              sticker={st}
              where="on the cork"
              left={st.x}
              top={st.y}
              onMoved={(dx, dy) => dropSticker(st, { x: st.x + dx, y: st.y + dy })}
              onRemove={() => removeSticker(st)}
            />
          ))}
        {placed.map((card) => (
          <div
            key={card.id}
            className={`scene-card kind-${card.kind}${dragging === card.id ? ' dragging' : ''}`}
            data-card={card.id}
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
            onKeyDown={(e) => onCardKey(e, card)}
          >
            {/* The pin. Decorative, so it is hidden from assistive tech — the
                card's own button carries the name and the action. */}
            <span className="scene-card-pin" aria-hidden="true" />
            {card.kind === 'scene' && !stringMode && (
              // Turns the card over to its back (F-42). A sibling of the face
              // for the same reason as the take-off box, and it swallows the
              // press so turning a card over never starts a drag.
              <CardCorner
                className="scene-card-turn"
                side="front"
                written={card.back}
                label={`Turn ${card.title} over${card.back ? ', outlined' : ''}`}
                onTurn={() => project && setTurned({ path: project.path, id: card.id })}
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
                onClick={() =>
                  void (card.kind === 'map'
                    ? setMapOnBoard(card.id, false)
                    : removeEntityFromBoard(card.id))
                }
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
            ) : card.kind === 'map' ? (
              <button
                type="button"
                className="scene-card-face map-card-face"
                data-help="map-card"
                onClick={(e) => open(card, e)}
                aria-label={`Open the map ${card.title}`}
              >
                <MapCardFace id={card.id} title={card.title} />
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
            {/* Stuck on this card, so they go where it goes: dragged,
                nudged, stacked or tidied. */}
            {boardStickers
              .filter((st) => st.cardId === card.id)
              .map((st) => (
                <StickerOnBoard
                  key={st.id}
                  sticker={st}
                  where={`on ${card.title}`}
                  left={st.x}
                  top={st.y}
                  onMoved={(dx, dy) => {
                    const at = livePositions.get(card.id) ?? { x: card.x, y: card.y }
                    dropSticker(st, { x: at.x + st.x + dx, y: at.y + st.y + dy })
                  }}
                  onRemove={() => removeSticker(st)}
                />
              ))}
          </div>
        ))}
        {/* The strings, drawn over the cards. The layer itself takes no
            pointer events, so cards under it still drag; only the pin heads
            do, tool up or down, and a click on one only chooses its string
            (I-23) — taking it down is Delete, never a slip of the pointer. */}
        <svg
          className={`board-strings${stringMode ? ' live' : ''}`}
          aria-hidden={!stringMode}
          role={stringMode ? 'list' : undefined}
          aria-label={stringMode ? 'Strings' : undefined}
        >
          {threads.map((t) => (
            <g
              key={t.key}
              className={`board-string colour-${t.colour}${t.relationship ? ' relationship' : ''}${chosenThread === t ? ' chosen' : ''}`}
              role="listitem"
            >
              <path d={stringPath(t.a, t.b)} />
              {[t.a, t.b].map((pt, i) => (
                <circle
                  key={i}
                  className="board-pin"
                  data-help="board-pin"
                  data-thread={t.key}
                  cx={pt.x}
                  cy={pt.y}
                  r={5}
                  // In the tab order only while the tool is up, where the
                  // keyboard works the strings; with it down Tab goes card to
                  // card, but a pin still takes the focus a click gives it, so
                  // the Delete after the click reaches its string.
                  tabIndex={stringMode ? 0 : -1}
                  role={stringMode ? 'button' : undefined}
                  aria-label={
                    stringMode
                      ? `The ${t.named}${chosenThread === t ? `, selected. ${t.removal}.` : `. Return selects it; ${t.removal}.`}`
                      : undefined
                  }
                  onFocus={() => letGoOfOthers(t)}
                  // The pin is in a card: pressed and dragged, the card comes
                  // with it, as it would from anywhere else on its face.
                  onPointerDown={(e) => {
                    const card = placed.find((c) => c.id === (i === 0 ? t.fromId : t.toId))
                    if (card) onPointerDown(e, card)
                  }}
                  onClick={(e) => {
                    // The end of a drag that began on the pin is the drag's.
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    choose(t, e.currentTarget)
                  }}
                  onKeyDown={(e) => {
                    // Delete is the board's (above), as it is for a tag.
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    choose(t, e.currentTarget)
                  }}
                >
                  <title>
                    {t.relationship
                      ? 'Click to select the relationship; Delete removes it'
                      : 'Click to select the string; Delete removes it'}
                  </title>
                </circle>
              ))}
            </g>
          ))}
          {draft?.kind === 'new' && draftAt && (
            <path
              className={`board-string-draft colour-${colour}`}
              d={stringPath(draftAt.a, draftAt.b)}
            />
          )}
          {pendingAt && (
            <circle
              className={`board-pin pending colour-${colour}`}
              cx={pendingAt.x}
              cy={pendingAt.y}
              r={5}
            />
          )}
        </svg>
        {/* Labels are HTML over the string layer, not SVG text: a tag sized
            to its words, and a real button. A written tag chooses its
            string first, as a pin does, and changes the label once chosen;
            an empty one, shown only with the tool up, is there to be
            written on. In the tab order only with the tool up, as pins are. */}
        <div className="board-labels">
          {threads.map((t) => {
            if (
              draft &&
              draft.kind !== 'new' &&
              t.edit.kind === draft.kind &&
              t.edit.id === draft.id
            )
              return null
            const at = tagPlace(t.a, t.b, t.side)
            const style = { left: at.x, top: at.y }
            if (!t.shown && !stringMode) return null
            const isChosen = chosenThread === t
            const choosing = !!t.shown && !isChosen
            return (
              <button
                key={t.key}
                type="button"
                className={`string-label colour-${t.colour} at-${at.anchor}${t.shown ? '' : ' empty'}${t.relationship ? ' relationship' : ''}${isChosen ? ' chosen' : ''}`}
                data-help="string-label"
                data-thread={t.key}
                style={style}
                tabIndex={stringMode ? undefined : -1}
                aria-label={choosing ? `Select the ${t.named}` : t.labelName}
                title={
                  choosing
                    ? `Click to select the ${t.relationship ? 'relationship' : 'string'}`
                    : isChosen
                      ? `Click to change the label; ${t.removal}`
                      : 'Click to label the string'
                }
                onFocus={() => letGoOfOthers(t)}
                onClick={(e) => {
                  if (choosing) {
                    choose(t, e.currentTarget)
                    return
                  }
                  setChosen(null)
                  setDraft(t.edit)
                  setDraftText(t.text ?? '')
                  setDraftProblem(null)
                }}
              >
                {t.shown ?? '+ label'}
              </button>
            )
          })}
          {draft && draftAt && (
            <div
              className={`string-label-field at-${tagPlace(draftAt.a, draftAt.b).anchor}`}
              style={{
                left: tagPlace(draftAt.a, draftAt.b).x,
                top: tagPlace(draftAt.a, draftAt.b).y
              }}
            >
              <input
                className="text-field string-label-input"
                autoFocus
                value={draftText}
                aria-label={
                  draft.kind === 'relationship' ||
                  (draft.kind === 'new' && draft.between === 'characters')
                    ? 'Name the relationship'
                    : 'Label the string, or leave it blank'
                }
                aria-invalid={draftProblem != null}
                aria-describedby={draftProblem != null ? 'string-label-problem' : undefined}
                placeholder={
                  draft.kind === 'relationship' ||
                  (draft.kind === 'new' && draft.between === 'characters')
                    ? 'sister of, owes…'
                    : 'Label (optional)'
                }
                onChange={(e) => {
                  setDraftText(e.target.value)
                  setDraftProblem(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitDraft()
                  } else if (e.key === 'Escape') {
                    // The string is not made (or the label not changed), and
                    // Esc goes no further — not the tool, not "back".
                    e.preventDefault()
                    e.stopPropagation()
                    closeDraft()
                  }
                }}
                onBlur={(e) => {
                  // The window losing focus (Cmd-Tab, a menu, a native
                  // dialog) is not the writer leaving the field: nothing is
                  // kept or thrown away, and the field has the caret back
                  // when the window does.
                  if (!document.hasFocus()) return
                  // Onto the field's own colours: still in the field.
                  if (
                    e.relatedTarget instanceof Element &&
                    e.relatedTarget.closest('.string-label-field')
                  )
                    return
                  // Clicking away keeps what was written. One that cannot be
                  // kept (a relationship with no name) stays open with the
                  // reason, rather than taking both pins with it unannounced.
                  const away = e.relatedTarget instanceof HTMLElement
                  if (draft) commitDraft(!away)
                }}
              />
              {/* Its colour: for a new string, the one it will be made in; for
                  one already up, changed at once. Pressing a swatch keeps
                  the caret in the label. */}
              <ColourSwatches
                keepFocus
                label="Colour of this string"
                value={
                  draft.kind === 'new'
                    ? colour
                    : (threads.find((x) => x.edit.kind === draft.kind && x.edit.id === draft.id)
                        ?.colour ?? 'red')
                }
                onChange={(c) => {
                  if (draft.kind === 'new') setColour(c)
                  else if (draft.kind === 'string') void recolourBoardString(draft.id, c)
                  else {
                    const rel = relationships.find((r) => r.id === draft.id)
                    if (!rel || colourOf(rel) === c) return
                    const rest = { ...rel }
                    delete rest.colour
                    void saveRelationship(c === 'red' ? rest : { ...rest, colour: c })
                  }
                }}
              />
              {draftProblem != null && (
                <div id="string-label-problem" className="string-label-problem" role="alert">
                  {draftProblem}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {adding && <AddCardDialog onClose={closeAdding} />}
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
