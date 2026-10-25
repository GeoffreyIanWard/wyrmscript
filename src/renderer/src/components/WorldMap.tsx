import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { MAP_MARK_KINDS, MAP_SHAPE_KINDS, MARK_SIZES, markSizeOf } from '../../../shared/types'
import type {
  MapSheet,
  ProjectData,
  MapMark,
  MapMarkKind,
  MapPin,
  MapShape,
  MapShapeKind,
  MapStampKind
} from '../../../shared/types'
import { useWyrm } from '../store'
import { StampGlyph, StampPalette } from './StampPalette'
import { MapScalePanel } from './MapScalePanel'
import { MapExportPanel } from './MapExportPanel'
import { drawnExtent } from '../lib/mapPicture'
import { hasSheet, recordsOn, sheetOf } from '../lib/mapSheets'
import { MapTabs } from './MapTabs'
import { describeRoute, formatDistance, routeLength, scaleBar, validScale } from '../lib/mapScale'
import { afterKeysUp } from '../lib/keys'
import {
  closesOn,
  describeShape,
  DRAW_ORDER,
  edgeLongEnough,
  insertPoint,
  isClosed,
  isSmooth,
  KIND_NAME,
  midpoints,
  MIN_POINTS,
  movePoint,
  removePoint,
  roundPoint,
  pathFor,
  shapePath,
  smoothPath
} from '../lib/mapShapes'
import {
  describeMark,
  isStamp,
  labelAnchor,
  MARK_NAME,
  STAMP_ART,
  STAMP_H,
  STAMP_ORDER,
  STAMP_SCALE,
  STAMP_W,
  stampNameAt
} from '../lib/mapMarks'
import {
  boundsOf,
  clampTo,
  grow,
  placeAt,
  scrollToCentre,
  stepZoom,
  toMap,
  ZOOMS,
  type Point,
  type Side
} from '../lib/worldMap'

/**
 * F-12: the world map, as a place rather than a dialog.
 *
 * It was a 640×380 dialog, which is room for a village. Now it takes the
 * window as the corkboard does, the binder hidden while it is up: a map
 * that scrolls, zooms in whole and half steps (anything between blurs the
 * 1-bit strokes), and grows on any side. Growing north or west moves the
 * map's origin rather than everything on it (`MapBounds`), so a pin placed
 * years ago is still exactly where it was.
 *
 * Opening a place is a detour, as a card on the board is: Esc comes back to
 * the map, scrolled and zoomed as it was, with that place's pin focused.
 */

const DRAG_THRESHOLD = 4
const NUDGE = 8
const NUDGE_BIG = 40
const NUDGE_SETTLE = 300
/** Two stamps on one spot this close together are one double-click. */
const DOUBLE_CLICK = 400
/** The desk showing round the map, matching `.map-scroll`'s padding. */
const GUTTER = 24
/** How far one arrow press moves the view, and with Shift. */
const PAN = 60
const PAN_BIG = 300

/** The map's tools: the hand moves the view and selects; the shape tools
 *  draw point by point; the mark tools put one thing down per click; the
 *  measure tool clicks out a route and says how far, and how long. */
type Tool = 'hand' | 'measure' | MapShapeKind | MapMarkKind

const isShapeKind = (t: Tool): t is MapShapeKind =>
  (MAP_SHAPE_KINDS as readonly string[]).includes(t)
const isMarkKind = (t: Tool): t is MapMarkKind => (MAP_MARK_KINDS as readonly string[]).includes(t)

/** A tool's name on its button. */
const toolName = (t: Tool): string =>
  t === 'hand' ? 'Hand' : t === 'measure' ? 'Measure' : isShapeKind(t) ? KIND_NAME[t] : MARK_NAME[t]

const TOOL_HELP: Record<Tool, string> = {
  hand: 'Drag to move the map. Click anything drawn on it to change it.',
  measure: 'Click along a route to measure it. Return finishes it; Esc clears it.',
  land: 'Click round a coast, point by point. Click the first point, or press Return, to close it.',
  area: 'Click round the area, point by point. Click the first point, or press Return, to close it.',
  border: 'Click along the border, point by point. Return finishes it.',
  river: 'Click along the river, point by point: it bends through them. Return finishes it.',
  road: 'Click along the road, point by point. Return finishes it.',
  rail: 'Click along the railway, point by point. Return finishes it.',
  label: 'Click where the words go, then type them.',
  ...(Object.fromEntries(
    STAMP_ORDER.map((k) => [
      k,
      `Stamping ${MARK_NAME[k].toLowerCase()}: every click puts one down. Size is at the right.`
    ])
  ) as Record<MapStampKind, string>)
}

/** The sizes' names, on their buttons and to a screen reader. */
const SIZE_LABEL = ['S', 'M', 'L', 'XL']
const SIZE_NAME = ['Small', 'Medium', 'Large', 'Extra large']

/** The line while a shape is part-drawn: short, so it stays one line. */
const DRAFT_HELP: Record<MapShapeKind, string> = {
  land: 'Click the first point, or Return, to close the coast.',
  area: 'Click the first point, or Return, to close the area.',
  border: 'Return finishes the border.',
  river: 'Return finishes the river.',
  road: 'Return finishes the road.',
  rail: 'Return finishes the railway.'
}

/** The drawing tools, in the bar's order: outlines, then lines. */
const TOOLS: Tool[] = ['hand', 'land', 'area', 'border', 'river', 'road', 'rail', 'measure']

/** A name being written: for a shape or a mark already on the map, or for
 *  a free label not yet made (made only once it has words). */
type Naming =
  | { what: 'shape' | 'mark'; id: string; at: Point; value: string }
  | { what: 'new-label'; at: Point; value: string; size: number }

const ARROWS: Record<string, Point | undefined> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }
}

/** Whether an element's focus came from the keyboard, as the browser
 *  judges it for :focus-visible (which jsdom may not parse). */
function focusedByKeyboard(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/**
 * The map in view: the tools, the drawing, the places. Mounted afresh for
 * each map (keyed by its id), so nothing half-done on one — a coast being
 * drawn, a route, a choice, a name being typed — carries over to another.
 */
/** Where the writer was looking on a map: kept while they look at another. */
interface MapView {
  zoom: number
  scrollLeft: number
  scrollTop: number
}

function MapSheetView({
  sheet,
  views
}: {
  sheet: MapSheet
  /** Where each map was being looked at, the last time it was in view —
   *  read as this one is shown, and written as it goes. */
  views: Map<string, MapView>
}): JSX.Element {
  const [lastView] = useState(() => views.get(sheet.id))
  const project = useWyrm((s) => s.project)
  const entities = useWyrm((s) => s.entities)
  const data = useWyrm((s) => s.project?.data) as ProjectData
  // Everything on every map is loaded; this map draws its own.
  const allPins = useWyrm((s) => s.mapPins)
  const mapPins = useMemo(() => recordsOn(allPins, sheet.id, data), [allPins, sheet.id, data])
  const loadMapPins = useWyrm((s) => s.loadMapPins)
  const setMapPin = useWyrm((s) => s.setMapPin)
  const moveMapPinAt = useWyrm((s) => s.moveMapPinAt)
  const projectPath = useWyrm((s) => s.project?.path)
  const removeMapPin = useWyrm((s) => s.removeMapPin)
  const setMapBounds = useWyrm((s) => s.setMapBounds)
  const setMapScale = useWyrm((s) => s.setMapScale)
  const exportMapImage = useWyrm((s) => s.exportMapImage)
  const showEntity = useWyrm((s) => s.showEntity)
  const allShapes = useWyrm((s) => s.mapShapes)
  const mapShapes = useMemo(() => recordsOn(allShapes, sheet.id, data), [allShapes, sheet.id, data])
  const loadMapShapes = useWyrm((s) => s.loadMapShapes)
  const createMapShape = useWyrm((s) => s.createMapShape)
  const updateMapShapeAt = useWyrm((s) => s.updateMapShapeAt)
  const deleteMapShape = useWyrm((s) => s.deleteMapShape)
  const renameMapShapeAt = useWyrm((s) => s.renameMapShapeAt)
  const allMarks = useWyrm((s) => s.mapMarks)
  const mapMarks = useMemo(() => recordsOn(allMarks, sheet.id, data), [allMarks, sheet.id, data])
  const loadMapMarks = useWyrm((s) => s.loadMapMarks)
  const createMapMarkAt = useWyrm((s) => s.createMapMarkAt)
  const updateMapMarkAt = useWyrm((s) => s.updateMapMarkAt)
  const deleteMapMark = useWyrm((s) => s.deleteMapMark)
  const styleMapPinAt = useWyrm((s) => s.styleMapPinAt)
  const returnedTo = useWyrm((s) => (s.mainView.kind === 'map' ? s.mainView : null))
  const settleMapReturn = useWyrm((s) => s.settleMapReturn)

  // The pins are read as the map opens, so anything that needs them — the
  // return to a focused pin — waits for that read.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    // Settled, not all-or-nothing: a read that fails leaves that layer empty
    // rather than taking the map down with an unhandled rejection.
    void Promise.allSettled([loadMapPins(), loadMapShapes(), loadMapMarks()]).then(
      () => live && setLoaded(true)
    )
    return () => {
      live = false
    }
    // On the project's path, not its object: every save makes a new project
    // object (growing the map does), and a read issued then could land after
    // a pin placed a moment later and drop it.
  }, [projectPath, loadMapPins, loadMapShapes, loadMapMarks])

  // Pins held here while being moved, so they follow the pointer or the
  // keys without waiting on a write.
  const [localPos, setLocalPos] = useState<Record<string, Point>>({})
  const [zoom, setZoom] = useState<number>(() => returnedTo?.zoom ?? lastView?.zoom ?? 1)
  const scrollEl = useRef<HTMLDivElement | null>(null)

  // Everything on the map widens it, shapes as well as pins: a pin taken
  // off must never shrink the map under land drawn out beside it.
  const extent = useMemo(
    () => drawnExtent(mapPins, mapShapes, mapMarks),
    [mapPins, mapShapes, mapMarks]
  )
  const bounds = boundsOf(sheet.bounds, extent)
  const locations = entities
    .filter((e) => e.type === 'world')
    .sort((a, b) => a.name.localeCompare(b.name))
  const pinFor = new Map(mapPins.map((p) => [p.entityId, p]))
  const placeIds = new Set(locations.map((e) => e.id))
  const unplaced = locations.filter((e) => !pinFor.has(e.id))
  // Every pin has a row, including one whose place has since gone from the
  // World Book: it is still on the map, so it must still be removable.
  const onMap = [...mapPins].sort((a, b) => nameOf(a.entityId).localeCompare(nameOf(b.entityId)))
  const posOf = (pin: MapPin): Point => localPos[pin.id] ?? { x: pin.x, y: pin.y }
  function nameOf(entityId: string): string {
    return (placeIds.has(entityId) && entities.find((e) => e.id === entityId)?.name) || '(deleted)'
  }
  const isOrphan = (pin: MapPin): boolean => !placeIds.has(pin.entityId)

  /* ---------- where the writer is looking ---------- */

  const viewCentre = (): Point => {
    const el = scrollEl.current
    if (!el) return { x: bounds.x + 200, y: bounds.y + 150 }
    return toMap(bounds, zoom, {
      x: el.scrollLeft + el.clientWidth / 2 - GUTTER,
      y: el.scrollTop + el.clientHeight / 2 - GUTTER
    })
  }

  const centreOn = (p: Point): void => {
    const el = scrollEl.current
    if (!el) return
    const to = scrollToCentre(bounds, zoom, p, { width: el.clientWidth, height: el.clientHeight })
    el.scrollLeft = to.x + GUTTER
    el.scrollTop = to.y + GUTTER
  }

  // A zoom keeps the middle of the view where it was, rather than flinging
  // the writer back to the map's corner. The centre is taken before the
  // zoom changes and restored once the map has its new size.
  const keepCentre = useRef<Point | null>(null)
  const zoomTo = (next: number): void => {
    if (next === zoom) return
    keepCentre.current = viewCentre()
    setZoom(next)
  }
  useLayoutEffect(() => {
    const p = keepCentre.current
    if (!p) return
    keepCentre.current = null
    centreOn(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a zoom change only
  }, [zoom])

  // Growing north or west moves the origin, so the same scroll offset now
  // shows a different part of the map: the view is moved by the same amount
  // and nothing seems to move.
  const keepScroll = useRef<Point | null>(null)
  const growMap = (side: Side): void => {
    const next = grow(bounds, side)
    keepScroll.current = { x: (bounds.x - next.x) * zoom, y: (bounds.y - next.y) * zoom }
    void setMapBounds(next)
  }
  useLayoutEffect(() => {
    const d = keepScroll.current
    const el = scrollEl.current
    if (!d || !el) return
    keepScroll.current = null
    el.scrollLeft += d.x
    el.scrollTop += d.y
  }, [bounds.x, bounds.y])

  // Back from a place opened on the map: scrolled where it was, the pin
  // focused. Used once, then dropped from the view.
  useEffect(() => {
    if (!loaded || !returnedTo || returnedTo.scrollLeft == null) return
    const el = scrollEl.current
    if (!el) return
    el.scrollLeft = returnedTo.scrollLeft
    el.scrollTop = returnedTo.scrollTop ?? 0
    const pin = returnedTo.focusPin
    settleMapReturn()
    if (pin) el.querySelector<HTMLElement>(`[data-pin="${pin}"]`)?.focus({ preventScroll: true })
  }, [loaded, returnedTo, settleMapReturn])

  // Back to another map, where it was left: scrolled as it was (the zoom is
  // taken as the view is made). Not when coming back from a place, which
  // carries its own.
  useLayoutEffect(() => {
    if (returnedTo?.scrollLeft != null || !lastView) return
    const el = scrollEl.current
    if (!el) return
    el.scrollLeft = lastView.scrollLeft
    el.scrollTop = lastView.scrollTop
    // Once, as the map is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // And kept as it goes, so a change of tab can leave it where it was.
  const zoomNow = useRef(zoom)
  useEffect(() => {
    zoomNow.current = zoom
  }, [zoom])
  useEffect(() => {
    const el = scrollEl.current
    const id = sheet.id
    return () => {
      if (el)
        views.set(id, { zoom: zoomNow.current, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop })
    }
  }, [views, sheet.id])

  const here = (
    pin?: MapPin
  ): {
    kind: 'map'
    mapId: string
    zoom: number
    scrollLeft: number
    scrollTop: number
    focusPin?: string
  } => ({
    kind: 'map',
    // The map it was, so coming back is to this map, not whichever is chosen.
    mapId: sheet.id,
    zoom,
    scrollLeft: scrollEl.current?.scrollLeft ?? 0,
    scrollTop: scrollEl.current?.scrollTop ?? 0,
    ...(pin ? { focusPin: pin.id } : {})
  })

  const openPlace = (pin: MapPin): void => {
    // A pin for a place since deleted has nothing to open.
    if (isOrphan(pin)) return
    showEntity(pin.entityId, here(pin))
  }

  /* ---------- moving pins ---------- */

  const writes = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>()
  )
  useEffect(
    () => () => {
      for (const { timer, write } of writes.current.values()) {
        clearTimeout(timer)
        write()
      }
    },
    []
  )

  /**
   * Put a pin down — by a drag at once, by the keys once they stop. Written
   * to the project it was moved in, captured now: the write can come after
   * a focus change (it is flushed when the map goes away), and resolved
   * then it went into whichever novel had come to the front.
   */
  const placePin = (pin: MapPin, to: Point, settle = 0): void => {
    const at = clampTo(bounds, to)
    const path = projectPath
    setLocalPos((p) => ({ ...p, [pin.id]: at }))
    const write = (): void => {
      writes.current.delete(pin.id)
      if (path) void moveMapPinAt(path, pin.id, at.x, at.y)
    }
    clearTimeout(writes.current.get(pin.id)?.timer)
    if (settle === 0) write()
    else writes.current.set(pin.id, { timer: setTimeout(write, settle), write })
  }

  // The gesture is followed on the document from the press, as on the
  // board: a first move landing off the pin is otherwise never heard.
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  const onPinDown = (e: ReactPointerEvent<HTMLButtonElement>, pin: MapPin): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    stop.current?.()
    const start = { x: e.clientX, y: e.clientY }
    const origin = posOf(pin)
    let moved = false
    const move = (ev: PointerEvent): void => {
      const dx = (ev.clientX - start.x) / zoom
      const dy = (ev.clientY - start.y) / zoom
      if (!moved && Math.hypot(dx * zoom, dy * zoom) < DRAG_THRESHOLD) return
      moved = true
      setLocalPos((p) => ({
        ...p,
        [pin.id]: clampTo(bounds, { x: origin.x + dx, y: origin.y + dy })
      }))
    }
    const up = (ev: PointerEvent): void => {
      stop.current?.()
      if (!moved) {
        openPlace(pin)
        return
      }
      placePin(pin, {
        x: origin.x + (ev.clientX - start.x) / zoom,
        y: origin.y + (ev.clientY - start.y) / zoom
      })
    }
    // A cancelled gesture (the system took the pointer) is neither a click
    // nor a drop: the pin goes back and nothing opens.
    const cancel = (): void => {
      stop.current?.()
      setLocalPos((p) => {
        const next = { ...p }
        delete next[pin.id]
        return next
      })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    stop.current = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      stop.current = null
    }
  }

  const onPinKey = (e: KeyboardEvent<HTMLButtonElement>, pin: MapPin): void => {
    if (pin.stamp && (e.key === '[' || e.key === ']')) {
      e.preventDefault()
      e.stopPropagation()
      const sizes = MARK_SIZES as readonly number[]
      const at = sizes.indexOf(markSizeOf(pin.size))
      const to = Math.max(0, Math.min(sizes.length - 1, at + (e.key === '[' ? -1 : 1)))
      if (to === at) {
        setNotice(
          `Already ${SIZE_NAME[at].toLowerCase()}, the ${to === 0 ? 'smallest' : 'largest'} size.`
        )
        return
      }
      if (projectPath)
        void styleMapPinAt(projectPath, pin.id, { size: sizes[to] }).then(() =>
          setNotice(`${nameOf(pin.entityId)}: ${SIZE_NAME[to].toLowerCase()}.`)
        )
      return
    }
    const dir = ARROWS[e.key]
    if (dir && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const step = e.shiftKey ? NUDGE_BIG : NUDGE
      const at = posOf(pin)
      placePin(pin, { x: at.x + dir.x * step, y: at.y + dir.y * step }, NUDGE_SETTLE)
    }
  }

  /* ---------- the map under the pointer ---------- */

  const sizerEl = useRef<HTMLDivElement | null>(null)
  /** A pointer position as a point on the map. */
  const mapPoint = (e: { clientX: number; clientY: number }): Point => {
    const box = sizerEl.current?.getBoundingClientRect()
    return roundPoint(
      clampTo(bounds, {
        x: bounds.x + (e.clientX - (box?.left ?? 0)) / zoom,
        y: bounds.y + (e.clientY - (box?.top ?? 0)) / zoom
      })
    )
  }

  /* ---------- drawing ---------- */

  const [tool, setTool] = useState<Tool>('hand')
  // The stamp in hand, if the tool in hand is a stamp.
  const stampTool: MapStampKind | null = isMarkKind(tool) && isStamp(tool) ? tool : null
  // The shape being drawn: points placed so far, and where the pointer is,
  // for the line to the next point. Not stored until it is finished.
  const [draft, setDraft] = useState<Point[]>([])
  const [hover, setHover] = useState<Point | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // What just happened, for the hint line until the next thing does.
  const [notice, setNotice] = useState<string | null>(null)
  // The size new stamps and labels are made at, until it is changed.
  const [stampSize, setStampSize] = useState(1)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // The route being measured, and whether it is finished (the next click
  // then starts another). Never stored: a measurement is a question asked
  // of the map, not something drawn on it.
  const [route, setRoute] = useState<Point[]>([])
  const [routeDone, setRouteDone] = useState(false)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const exportButton = useRef<HTMLButtonElement | null>(null)
  // The route's length in map pixels, out to the pointer — null until there
  // are two points to measure between.
  const routeNow = !routeDone && hover && route.length > 0 ? [...route, hover] : route
  const measured = routeNow.length > 1 ? routeLength(routeNow) : null
  // The route at its placed points only.
  const placed = route.length > 1 ? routeLength(route) : null
  const scaleButton = useRef<HTMLButtonElement | null>(null)
  /** Close the scale panel and give the keyboard back to its button (or the
   *  map), once the key that closed it is up — dropped to <body>, the next
   *  Esc left the map instead of clearing the route. */
  const closeScale = (): void => {
    setScaleOpen(false)
    afterKeysUp(() => (scaleButton.current ?? scrollEl.current)?.focus({ preventScroll: true }))
  }
  // The place whose look is being chosen, and where its palette opens: by
  // its row in the side panel, measured against the map view (the panel
  // scrolls and would clip a palette opened inside it).
  const [placeStyle, setPlaceStyle] = useState<{ pinId: string; top: number; left: number } | null>(
    null
  )
  // Measured once against its row, so it closes when the row moves away
  // under it — the side panel scrolled, the window resized — rather than
  // hang beside a different place while still changing this one.
  const placeOpen = placeStyle != null
  useEffect(() => {
    if (!placeOpen) return
    const close = (): void => setPlaceStyle(null)
    const panel = document.querySelector('.map-places')
    panel?.addEventListener('scroll', close, { passive: true })
    window.addEventListener('resize', close)
    return () => {
      panel?.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    }
  }, [placeOpen])
  const paletteToggle = useRef<HTMLButtonElement | null>(null)
  // Where the keyboard draws: a cursor moved by Option and the arrows, which
  // Space puts a point down at. Shown only when the map has keyboard focus.
  const [cursor, setCursor] = useState<Point | null>(null)
  // Whether the pointer is the one drawing. A Return pressed mid-coast makes
  // Chromium treat the map's focus as keyboard focus, which would show the
  // cursor to a writer drawing with the mouse; the keyboard's own drawing
  // keys bring it back.
  const [pointerDrawing, setPointerDrawing] = useState(false)

  const chooseTool = (next: Tool): void => {
    setTool(next)
    setScaleOpen(false)
    setExportOpen(false)
    setRoute([])
    setRouteDone(false)
    setPaletteOpen(false)
    setNaming(null)
    setNotice(null)
    setDraft([])
    setHover(null)
    setProblem(null)
    setCursor(next === 'hand' ? null : roundPoint(clampTo(bounds, viewCentre())))
    if (next !== 'hand') setSelected(null)
  }

  /** Scroll just enough to keep a point in view, as a caret is kept. */
  const keepInView = (p: Point): void => {
    const el = scrollEl.current
    if (!el) return
    const margin = 40
    const sx = (p.x - bounds.x) * zoom + GUTTER
    const sy = (p.y - bounds.y) * zoom + GUTTER
    if (sx < el.scrollLeft + margin) el.scrollLeft = sx - margin
    else if (sx > el.scrollLeft + el.clientWidth - margin)
      el.scrollLeft = sx - el.clientWidth + margin
    if (sy < el.scrollTop + margin) el.scrollTop = sy - margin
    else if (sy > el.scrollTop + el.clientHeight - margin)
      el.scrollTop = sy - el.clientHeight + margin
  }

  /** Make the shape being drawn, if it has enough points to be one. */
  const finishDraft = (points = draft): void => {
    if (!isShapeKind(tool)) return
    if (points.length < MIN_POINTS[tool]) {
      // Said, not silently refused (the house rule for dead buttons).
      setProblem(
        `${KIND_NAME[tool]} needs at least ${MIN_POINTS[tool]} points — ${points.length} so far.`
      )
      return
    }
    setDraft([])
    setHover(null)
    setProblem(null)
    void createMapShape(tool, points)
  }

  const addPoint = (p: Point): void => {
    if (!isShapeKind(tool)) return
    setProblem(null)
    if (isClosed(tool) && closesOn(draft, p, zoom)) {
      finishDraft()
      return
    }
    // A second click on the same spot (a double-click) is not a new point:
    // a curve through a repeated point curls back on itself.
    const last = draft[draft.length - 1]
    if (last && last.x === p.x && last.y === p.y) return
    setDraft((d) => [...d, p])
    // The line to the next point starts from this one, not from wherever
    // the pointer last was.
    setHover(p)
  }

  /** A point on the route being measured; a click after it is finished
   *  starts another. A second click on the same spot is the same click. */
  const addRoutePoint = (p: Point): void => {
    setProblem(null)
    if (routeDone) {
      setRoute([p])
      setRouteDone(false)
      setHover(p)
      return
    }
    const last = route[route.length - 1]
    if (last && last.x === p.x && last.y === p.y) return
    setRoute((r) => [...r, p])
    setHover(p)
  }

  /* ---------- changing a shape ---------- */

  const [selected, setSelected] = useState<string | null>(null)
  // The shape with keyboard focus, if any.
  const [keyFocus, setKeyFocus] = useState<string | null>(null)
  // Points held here while a corner is dragged or nudged, as pins are.
  const [localShape, setLocalShape] = useState<Record<string, Point[]>>({})
  const pointsOf = (shape: MapShape): Point[] => localShape[shape.id] ?? shape.points
  const selectedShape = mapShapes.find((s) => s.id === selected) ?? null

  const shapeWrites = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>()
  )
  useEffect(
    () => () => {
      for (const { timer, write } of shapeWrites.current.values()) {
        clearTimeout(timer)
        write()
      }
    },
    []
  )

  /** New points for a shape — written at once, or once the keys stop.
   *  Addressed to the project it was changed in, captured now. */
  const reshape = (shape: MapShape, points: Point[], settle = 0): void => {
    const path = projectPath
    setLocalShape((l) => ({ ...l, [shape.id]: points }))
    const write = (): void => {
      shapeWrites.current.delete(shape.id)
      if (path) void updateMapShapeAt(path, shape.id, points)
    }
    clearTimeout(shapeWrites.current.get(shape.id)?.timer)
    if (settle === 0) write()
    else shapeWrites.current.set(shape.id, { timer: setTimeout(write, settle), write })
  }

  const removeShape = (shape: MapShape): void => {
    clearTimeout(shapeWrites.current.get(shape.id)?.timer)
    shapeWrites.current.delete(shape.id)
    setSelected(null)
    void deleteMapShape(shape)
    scrollEl.current?.focus({ preventScroll: true })
  }

  const onCornerDown = (
    e: ReactPointerEvent<HTMLButtonElement>,
    shape: MapShape,
    index: number
  ): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    stop.current?.()
    const start = { x: e.clientX, y: e.clientY }
    const origin = pointsOf(shape)[index]
    let moved = false
    let latest = pointsOf(shape)
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return
      moved = true
      latest = movePoint(
        pointsOf(shape),
        index,
        clampTo(bounds, {
          x: origin.x + (ev.clientX - start.x) / zoom,
          y: origin.y + (ev.clientY - start.y) / zoom
        })
      )
      setLocalShape((l) => ({ ...l, [shape.id]: latest }))
    }
    const up = (): void => {
      stop.current?.()
      if (moved) reshape(shape, latest)
    }
    const cancel = (): void => {
      stop.current?.()
      setLocalShape((l) => {
        const next = { ...l }
        delete next[shape.id]
        return next
      })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    stop.current = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      stop.current = null
    }
  }

  const onCornerKey = (
    e: KeyboardEvent<HTMLButtonElement>,
    shape: MapShape,
    index: number
  ): void => {
    const dir = ARROWS[e.key]
    if (dir && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      const step = e.shiftKey ? NUDGE_BIG : NUDGE
      const at = pointsOf(shape)[index]
      reshape(
        shape,
        movePoint(
          pointsOf(shape),
          index,
          clampTo(bounds, { x: at.x + dir.x * step, y: at.y + dir.y * step })
        ),
        NUDGE_SETTLE
      )
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      const fewer = removePoint(pointsOf(shape), index, shape.kind)
      if (!fewer) {
        setProblem(
          `${KIND_NAME[shape.kind]} needs at least ${MIN_POINTS[shape.kind]} points. Delete the whole shape instead.`
        )
        return
      }
      setProblem(null)
      // Taking out the last point unmounts its handle: the keyboard goes to
      // the corner now at its place, never to <body>.
      focusCorner.current = Math.min(index, fewer.length - 1)
      reshape(shape, fewer)
    }
  }

  const focusCorner = useRef<number | null>(null)
  useEffect(() => {
    const i = focusCorner.current
    if (i == null) return
    focusCorner.current = null
    scrollEl.current?.querySelector<HTMLElement>(`[data-corner="${i}"]`)?.focus()
  })

  /* ---------- stamps and labels ---------- */

  const selectedMark = mapMarks.find((m) => m.id === selected) ?? null
  // Marks held here while being moved, as pins are.
  const [localMark, setLocalMark] = useState<Record<string, Point>>({})
  const markAt = (mark: MapMark): Point => localMark[mark.id] ?? { x: mark.x, y: mark.y }

  const markWrites = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>()
  )
  useEffect(
    () => () => {
      for (const { timer, write } of markWrites.current.values()) {
        clearTimeout(timer)
        write()
      }
    },
    []
  )

  /** Put a mark somewhere — by a drag at once, by the keys once they stop —
   *  written to the project it was moved in, as pins are. */
  const moveMark = (mark: MapMark, to: Point, settle = 0): void => {
    const at = roundPoint(clampTo(bounds, to))
    const path = projectPath
    setLocalMark((l) => ({ ...l, [mark.id]: at }))
    const write = (): void => {
      markWrites.current.delete(mark.id)
      if (path) void updateMapMarkAt(path, mark.id, { x: at.x, y: at.y })
    }
    clearTimeout(markWrites.current.get(mark.id)?.timer)
    if (settle === 0) write()
    else markWrites.current.set(mark.id, { timer: setTimeout(write, settle), write })
  }

  const removeMark = (mark: MapMark): void => {
    clearTimeout(markWrites.current.get(mark.id)?.timer)
    markWrites.current.delete(mark.id)
    setSelected(null)
    void deleteMapMark(mark)
    scrollEl.current?.focus({ preventScroll: true })
  }

  const lastStamp = useRef<{ at: Point; time: number } | null>(null)

  /** A click (or Space) with a mark tool: a stamp goes down at once; a label
   *  asks for its words first, and is made only once it has some. */
  const putMark = (at: Point, when: number): void => {
    if (!isMarkKind(tool)) return
    setProblem(null)
    if (!isStamp(tool)) {
      openNaming({ what: 'new-label', at, value: '', size: stampSize })
      return
    }
    const kind = tool
    // The second click of a double-click is the same click, not another
    // stamp stacked exactly on the first.
    const last = lastStamp.current
    lastStamp.current = { at, time: when }
    if (
      last &&
      when - last.time < DOUBLE_CLICK &&
      Math.hypot(at.x - last.at.x, at.y - last.at.y) < 4
    )
      return
    setNotice(null)
    if (projectPath)
      void createMapMarkAt(projectPath, kind, at.x, at.y, undefined, stampSize).then(
        // Said, so a writer at the keyboard (or a screen reader) knows it went
        // down and does not press again, stacking a second on the first.
        (made) => made && setNotice(`${MARK_NAME[kind]} put down. The Hand moves it.`)
      )
  }

  /* ---------- names ---------- */

  const [naming, setNaming] = useState<Naming | null>(null)
  // Set once a name has been kept or dropped, so the blur that follows
  // (the field going away) does not keep it a second time.
  const namingDone = useRef(false)

  /** Open the name field. Every way in goes through here, so a field is
   *  never born already marked as kept by the one before it. */
  const openNaming = (n: Naming): void => {
    namingDone.current = false
    setProblem(null)
    setNaming(n)
  }

  const startNaming = (target: { shape: MapShape } | { mark: MapMark }): void => {
    if ('shape' in target) {
      const { shape } = target
      openNaming({
        what: 'shape',
        id: shape.id,
        at: labelAnchor({ kind: shape.kind, points: pointsOf(shape) }),
        value: shape.name ?? ''
      })
    } else {
      const { mark } = target
      const at = markAt(mark)
      openNaming({
        what: 'mark',
        id: mark.id,
        at: isStamp(mark.kind) ? stampNameAt(at, markSizeOf(mark.size)) : at,
        value: mark.name ?? ''
      })
    }
  }

  // Set while the keyboard is handed back to the map after a name, so the
  // map's focus handler leaves the cursor where the writer was labelling
  // rather than sending it back to the middle of the view.
  const returningFocus = useRef(false)

  /** Give the keyboard back to what was being named, or to the map. */
  const focusAfterNaming = (id: string | null): void =>
    afterKeysUp(() => {
      const item =
        id &&
        scrollEl.current?.querySelector<HTMLElement | SVGElement>(
          `[data-shape="${id}"] .map-shape-body, [data-mark="${id}"]`
        )
      if (item) item.focus({ preventScroll: true })
      else {
        returningFocus.current = true
        scrollEl.current?.focus({ preventScroll: true })
        returningFocus.current = false
      }
    })

  /**
   * Keep what was typed. Every way of leaving the field keeps it, as on the
   * back of a card — except a new label left empty, which is dropped on a
   * blur and refused, with a reason, on Return.
   */
  const keepName = (how: 'enter' | 'blur'): void => {
    const n = naming
    if (!n || namingDone.current) return
    const value = n.value.trim()
    const path = projectPath
    if (n.what === 'new-label') {
      if (!value) {
        if (how === 'enter') {
          setProblem('A label needs some words — type them, or Esc to drop it.')
          return
        }
      } else if (path) void createMapMarkAt(path, 'label', n.at.x, n.at.y, value, n.size)
    } else if (n.what === 'shape') {
      if (path) void renameMapShapeAt(path, n.id, value)
    } else {
      const mark = mapMarks.find((m) => m.id === n.id)
      if (mark?.kind === 'label' && !value) {
        if (how === 'enter') {
          setProblem('A label needs some words. Delete it to take it off the map.')
          return
        }
      } else if (path) void updateMapMarkAt(path, n.id, { name: value })
    }
    namingDone.current = true
    setNaming(null)
    setProblem(null)
    if (n.what === 'new-label' && cursor) setCursor(n.at)
    if (how === 'enter') focusAfterNaming(n.what === 'new-label' ? null : n.id)
  }

  // The field as it stands, and the project it was opened in, for keeping
  // it if the map goes away under it — a ⌥⌘B, or another window raised by
  // its title bar, unmounts the map without the field ever losing focus.
  // Every way of closing keeps it, as on the back of a card.
  const openName = useRef<{ naming: Naming; path: string } | null>(null)
  useEffect(() => {
    openName.current = naming && projectPath ? { naming, path: projectPath } : null
  })
  useEffect(
    () => () => {
      const open = openName.current
      if (!open || namingDone.current) return
      namingDone.current = true
      const { naming: n, path } = open
      const value = n.value.trim()
      const state = useWyrm.getState()
      if (n.what === 'new-label') {
        if (value) void state.createMapMarkAt(path, 'label', n.at.x, n.at.y, value, n.size)
      } else if (n.what === 'shape') void state.renameMapShapeAt(path, n.id, value)
      // The store refuses an empty label, so nothing is lost there either.
      else void state.updateMapMarkAt(path, n.id, { name: value })
    },
    []
  )
  const dropName = (): void => {
    const n = naming
    namingDone.current = true
    setNaming(null)
    setProblem(null)
    if (n?.what === 'new-label' && cursor) setCursor(n.at)
    focusAfterNaming(n && n.what !== 'new-label' ? n.id : null)
  }

  /** Return on something already chosen names it; on anything else, chooses it. */
  const chooseOrName = (target: { shape: MapShape } | { mark: MapMark }): void => {
    const id = 'shape' in target ? target.shape.id : target.mark.id
    if (selected === id) startNaming(target)
    else {
      setSelected(id)
      setProblem(null)
    }
  }

  /**
   * The size a stamp is drawn at: its own, but never so small on screen that
   * it smudges. At 50% a small stamp was about eleven pixels of sub-pixel
   * strokes, and a ship and a rock could not be told apart; below the
   * smallest size on screen, it is drawn at that.
   */
  const drawnSize = (mark: MapMark): number => Math.max(markSizeOf(mark.size), MARK_SIZES[0] / zoom)
  /** A mark's size in words, for a screen reader, when it is not the usual. */
  const sizeWords = (mark: MapMark): string => {
    const i = (MARK_SIZES as readonly number[]).indexOf(markSizeOf(mark.size))
    return i === 1 ? '' : `, ${SIZE_NAME[i].toLowerCase()}`
  }

  /** A chosen mark's size, or the size new ones are made at. */
  const sizeTarget = tool === 'hand' ? selectedMark : null
  const currentSize = sizeTarget ? markSizeOf(sizeTarget.size) : stampSize
  const setSize = (size: number): void => {
    if (!sizeTarget) {
      setStampSize(size)
      // A label being typed is made at the size shown when it is kept.
      if (naming?.what === 'new-label') setNaming({ ...naming, size })
      return
    }
    if (projectPath)
      void updateMapMarkAt(projectPath, sizeTarget.id, { size }).then(() =>
        setNotice(
          `${describeMark(sizeTarget.kind, sizeTarget.name)}: ${SIZE_NAME[MARK_SIZES.indexOf(size as never)].toLowerCase()}.`
        )
      )
  }
  /** [ and ] step a size down and up. */
  const stepSize = (mark: MapMark, dir: -1 | 1): void => {
    const sizes = MARK_SIZES as readonly number[]
    const at = sizes.indexOf(markSizeOf(mark.size))
    const to = Math.max(0, Math.min(sizes.length - 1, at + dir))
    // Said, so a writer at the keyboard (or a screen reader) hears each step
    // land — and hears that the last press did nothing, at either end.
    if (to === at) {
      setNotice(
        `Already ${SIZE_NAME[at].toLowerCase()}, the ${dir < 0 ? 'smallest' : 'largest'} size.`
      )
      return
    }
    if (projectPath)
      void updateMapMarkAt(projectPath, mark.id, { size: sizes[to] }).then(() =>
        setNotice(`${describeMark(mark.kind, mark.name)}: ${SIZE_NAME[to].toLowerCase()}.`)
      )
  }

  const onMarkKey = (e: KeyboardEvent<Element>, mark: MapMark): void => {
    if (tool !== 'hand') return
    if (e.key === '[' || e.key === ']') {
      e.preventDefault()
      e.stopPropagation()
      stepSize(mark, e.key === '[' ? -1 : 1)
      return
    }
    const dir = ARROWS[e.key]
    if (dir && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      const step = e.shiftKey ? NUDGE_BIG : NUDGE
      const at = markAt(mark)
      moveMark(mark, { x: at.x + dir.x * step, y: at.y + dir.y * step }, NUDGE_SETTLE)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      chooseOrName({ mark })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      removeMark(mark)
    }
  }

  /* ---------- panning, and clicks on the map ---------- */

  // Dragging the map moves the view, the way a hand moves a paper map
  // across a desk — in every tool, so drawing a long coast never strands
  // the writer at the edge of the view. A press that does not move is a
  // click: a point in a drawing tool, or letting go of a shape with the hand.
  const [panning, setPanning] = useState(false)
  const onMapDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    // The press that dismisses the palette only dismisses it: with a stamp in
    // hand it otherwise also put one down where the writer clicked away.
    if (paletteOpen) {
      setPaletteOpen(false)
      return
    }
    // On the map itself, not its scroll bars: grabbing a bar must only scroll.
    if (!(e.target as Element).closest?.('.map-sizer')) return
    const el = scrollEl.current
    if (!el) return
    stop.current?.()
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    const at = mapPoint(e)
    setPointerDrawing(true)
    // The shape the press began on: chosen on a still click, so a drag that
    // starts on land pans like any other — a map that is mostly land must
    // still move.
    const target = e.target as Element
    const hit =
      target.closest?.('[data-shape], [data-mark]')?.getAttribute('data-shape') ??
      target.closest?.('[data-mark]')?.getAttribute('data-mark') ??
      null
    // A mark, unlike a shape, is small and is moved by dragging it, as a pin
    // is: a press on one with the hand moves it rather than the map.
    const markId =
      tool === 'hand' ? target.closest?.('[data-mark]')?.getAttribute('data-mark') : null
    const mark = markId ? mapMarks.find((m) => m.id === markId) : undefined
    const markFrom = mark ? markAt(mark) : null
    let moved = false
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return
      if (mark && markFrom) {
        moved = true
        setLocalMark((l) => ({
          ...l,
          [mark.id]: roundPoint(
            clampTo(bounds, {
              x: markFrom.x + (ev.clientX - start.x) / zoom,
              y: markFrom.y + (ev.clientY - start.y) / zoom
            })
          )
        }))
        return
      }
      if (!moved) setPanning(true)
      moved = true
      el.scrollLeft = start.left - (ev.clientX - start.x)
      el.scrollTop = start.top - (ev.clientY - start.y)
    }
    const up = (ev: PointerEvent): void => {
      stop.current?.()
      setPanning(false)
      if (moved) {
        if (mark && markFrom)
          moveMark(mark, {
            x: markFrom.x + (ev.clientX - start.x) / zoom,
            y: markFrom.y + (ev.clientY - start.y) / zoom
          })
        return
      }
      if (!isMarkKind(tool)) setNotice(null)
      if (tool === 'hand') {
        setSelected(hit)
        setProblem(null)
      } else if (isMarkKind(tool)) putMark(at, ev.timeStamp)
      else if (tool === 'measure') addRoutePoint(at)
      else addPoint(at)
    }
    const cancel = (): void => {
      stop.current?.()
      setPanning(false)
      if (mark)
        setLocalMark((l) => {
          const next = { ...l }
          delete next[mark.id]
          return next
        })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    stop.current = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      stop.current = null
    }
  }

  // Followed whenever a drawing tool is up, so the line to the next point
  // is never left over from before.
  const onMapMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!isShapeKind(tool) && tool !== 'measure') return
    setHover(mapPoint(e))
  }

  /* ---------- places ---------- */

  const focusPin = (pinId: string): void => {
    scrollEl.current
      ?.querySelector<HTMLElement>(`[data-pin="${pinId}"]`)
      ?.focus({ preventScroll: true })
  }

  // After Place, the keyboard goes to the new pin — Option and the arrows
  // can move it at once — rather than to <body> with the vanished button.
  const focusAfterPlace = useRef<string | null>(null)
  const place = async (entityId: string): Promise<void> => {
    const at = clampTo(bounds, placeAt(viewCentre(), mapPins))
    focusAfterPlace.current = entityId
    await setMapPin(entityId, at.x, at.y)
  }
  useEffect(() => {
    const want = focusAfterPlace.current
    const pin = want ? pinFor.get(want) : undefined
    if (!pin) return
    focusAfterPlace.current = null
    afterKeysUp(() => focusPin(pin.id))
  })

  const remove = (pin: MapPin): void => {
    // A nudge still waiting to be written would put the pin straight back.
    clearTimeout(writes.current.get(pin.id)?.timer)
    writes.current.delete(pin.id)
    // Focus to the row that takes this one's place, or the list itself.
    const rows = [...document.querySelectorAll<HTMLElement>('.map-places .map-place-row')]
    const at = rows.findIndex((r) => r.dataset.pin === pin.id)
    const next = rows[at + 1] ?? rows[at - 1]
    void removeMapPin(pin).then(() =>
      afterKeysUp(() =>
        (
          next?.querySelector<HTMLElement>('button') ??
          document.querySelector<HTMLElement>('.map-places')
        )?.focus()
      )
    )
  }

  const goTo = (pin: MapPin): void => {
    centreOn(posOf(pin))
    focusPin(pin.id)
  }

  /**
   * The drawing's keys, for the whole map view — tools, hint and map — not
   * only the scroll area: a writer who zooms mid-coast has focus on a zoom
   * button, and Esc there must drop the coast, not leave the map. They are
   * the map's own, so they stop here: Esc is also "back".
   */
  const onMapKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    // A panel open over the map (the scale, the export) has its own keys: a
    // Backspace or a Delete on its buttons is not one aimed at the map, and
    // must not take a point off the route or the chosen shape off the map.
    if ((e.target as Element).closest?.('[role="dialog"]')) return
    // A route being measured: Esc clears it (and stops there — Esc is also
    // "back"), Backspace takes the last point back, Return finishes it.
    if (tool === 'measure' && route.length > 0) {
      const inField = (e.target as Element).closest?.('input, textarea')
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setRoute([])
        setRouteDone(false)
        setHover(null)
        return
      }
      if (!inField && e.key === 'Backspace' && !routeDone) {
        e.preventDefault()
        setRoute((r) => r.slice(0, -1))
        // The line drops back with the point: the pointer, or the keyboard's
        // cursor, gives the next leg again when it moves.
        setHover(null)
        return
      }
      if (!inField && e.key === 'Enter' && !(e.target as Element).closest?.('button')) {
        e.preventDefault()
        setRouteDone(true)
        setHover(null)
        return
      }
    }
    if (draft.length === 0 && !selected) return
    // Delete takes off whatever is chosen, wherever focus is on the map. A
    // click chooses a shape or a stamp without always giving it focus — a
    // road or a border is usually caught by its hit band, which cannot take
    // focus — so a Delete handled only on the focused item did nothing.
    if (draft.length === 0 && selectedMark && tool === 'hand' && (e.key === '[' || e.key === ']')) {
      if ((e.target as Element).closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      stepSize(selectedMark, e.key === '[' ? -1 : 1)
      return
    }
    if (draft.length === 0 && selected && (e.key === 'Delete' || e.key === 'Backspace')) {
      if ((e.target as Element).closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      if (selectedShape) removeShape(selectedShape)
      else if (selectedMark) removeMark(selectedMark)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setProblem(null)
      if (draft.length > 0) {
        setDraft([])
        setHover(null)
        return
      }
      // Letting go unmounts the handles; one that held focus hands it to its
      // shape, or the next Esc would start from <body> and leave the map.
      const id = selected
      const onHandle = (e.target as Element).closest?.('.map-handle')
      setSelected(null)
      if (onHandle)
        afterKeysUp(() =>
          (
            scrollEl.current?.querySelector<SVGElement>(`[data-shape="${id}"] .map-shape-body`) ??
            scrollEl.current
          )?.focus({ preventScroll: true })
        )
      return
    }
    if (draft.length === 0) return
    // A focused button keeps its own Return: Zoom in zooms.
    if (e.key === 'Enter' && !(e.target as Element).closest?.('button')) {
      e.preventDefault()
      finishDraft()
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      const fewer = draft.slice(0, -1)
      setDraft(fewer)
      if (fewer.length === 0) setHover(null)
      setProblem(null)
    }
  }

  /** The map from the keyboard: arrows move the view, Shift further; with a
   *  drawing tool, Option and the arrows move the cursor and Space puts a
   *  point down at it. */
  const onScrollKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    const dir = ARROWS[e.key]
    const el = scrollEl.current
    if (!el || e.metaKey || e.ctrlKey) return
    if (tool !== 'hand' && cursor) {
      if (dir && e.altKey) {
        e.preventDefault()
        const step = e.shiftKey ? NUDGE_BIG : NUDGE
        const next = roundPoint(
          clampTo(bounds, { x: cursor.x + dir.x * step, y: cursor.y + dir.y * step })
        )
        setCursor(next)
        setPointerDrawing(false)
        // The line to the next point follows the keyboard's cursor, as it
        // follows the pointer — drafting a shape or measuring a route.
        if (draft.length > 0 || (tool === 'measure' && route.length > 0 && !routeDone))
          setHover(next)
        keepInView(next)
        return
      }
      // Return closes once there is something to close; before that it puts
      // the first point down, rather than doing nothing.
      if (e.key === ' ' || (e.key === 'Enter' && draft.length === 0 && route.length === 0)) {
        e.preventDefault()
        setPointerDrawing(false)
        if (isMarkKind(tool)) putMark(cursor, e.timeStamp)
        else if (tool === 'measure') addRoutePoint(cursor)
        else addPoint(cursor)
        return
      }
    }
    if (!dir || e.altKey) return
    e.preventDefault()
    const step = e.shiftKey ? PAN_BIG : PAN
    el.scrollLeft += dir.x * step
    el.scrollTop += dir.y * step
  }

  /** A double-click with the hand names what it lands on. */
  const onMapDoubleClick = (e: { target: EventTarget }): void => {
    if (tool === 'measure' && route.length > 1) {
      setRouteDone(true)
      setHover(null)
      return
    }
    if (tool !== 'hand') return
    const t = e.target as Element
    const shapeId = t.closest?.('[data-shape]')?.getAttribute('data-shape')
    const markId = t.closest?.('[data-mark]')?.getAttribute('data-mark')
    const shape = shapeId ? mapShapes.find((s) => s.id === shapeId) : undefined
    const mark = markId ? mapMarks.find((m) => m.id === markId) : undefined
    if (shape) {
      setSelected(shape.id)
      startNaming({ shape })
    } else if (mark) {
      setSelected(mark.id)
      startNaming({ mark })
    }
  }

  /** A zoom or a grow clicked mid-shape gives the keyboard back to the map,
   *  so the Return the hint asks for closes the shape rather than pressing
   *  the button again. Not from the keyboard: that writer may press it twice. */
  const backToDraft = (e: { detail: number }): void => {
    if (draft.length > 0 && e.detail > 0) scrollEl.current?.focus({ preventScroll: true })
  }

  /** The hint line, when nothing has gone wrong: what the tool does, or
   *  what can be done with what is drawn, chosen or being named. */
  const hintLine = (placedOnly = false): string => {
    if (naming)
      return naming.what === 'new-label'
        ? 'Type the label. Return keeps it; Esc drops it.'
        : 'Type the name. Return keeps it; Esc leaves it as it was.'
    if (draft.length > 0 && isShapeKind(tool))
      return `${DRAFT_HELP[tool]} Backspace: undo a point. Esc: drop it.`
    const told = placedOnly ? placed : measured
    if (tool === 'measure' && told != null) {
      const scale = sheet.scale
      return validScale(scale)
        ? describeRoute(told, scale)
        : `${Math.round(told).toLocaleString('en')} map pixels. Set the scale to see miles and days.`
    }
    if (tool === 'hand' && selectedShape)
      return 'Drag a corner to move it; click a dot to add one. Return names it; Delete removes it.'
    if (tool === 'hand' && selectedMark)
      return selectedMark.kind === 'label'
        ? 'Drag it to move it. [ and ] size it. Return changes the words; Delete removes it.'
        : 'Drag it to move it. [ and ] size it. Return names it; Delete removes it.'
    return TOOL_HELP[tool]
  }

  /** The region's name for a screen reader: how to use the tool in hand. */
  const regionLabel = (): string => {
    if (tool === 'hand') return 'World map. Arrow keys move the view; Shift moves it further.'
    const how = 'Option and the arrows move the cursor;'
    if (tool === 'measure')
      return `World map. Measuring: ${how} Space puts a point of the route down; Return finishes it; Esc clears it.`
    if (isShapeKind(tool))
      return `World map. Drawing ${KIND_NAME[tool].toLowerCase()}: ${how} Space puts a point down; ${isClosed(tool) ? 'Return closes the shape.' : `Return finishes the ${KIND_NAME[tool].toLowerCase()}.`}`
    return tool === 'label'
      ? `World map. Labelling: ${how} Space starts a label there.`
      : `World map. Stamping ${MARK_NAME[tool].toLowerCase()}: ${how} Space puts one down.`
  }

  if (!project) return <div className="terminal" />

  // The graticule is drawn in map coordinates, so its lines stay on the
  // same hundreds whichever way the map has grown.
  const gridX = ((-bounds.x % 100) + 100) % 100
  const gridY = ((-bounds.y % 100) + 100) % 100
  // The shape being drawn, out to the pointer, open until it is finished.
  const drafted = hover ? [...draft, hover] : draft
  // The route, out to the pointer until it is finished.
  const routed = !routeDone && hover && route.length > 0 ? [...route, hover] : route
  const scale = validScale(sheet.scale) ? sheet.scale : undefined
  const bar = scale ? scaleBar(scale, zoom) : null

  return (
    // Laid out as if its children were the map root's own (display:
    // contents): the root holds the tabs above them.
    <div
      className="map-sheet"
      id="map-tab-panel"
      role="tabpanel"
      aria-labelledby={`map-tab-${sheet.id}`}
      onKeyDown={onMapKey}
    >
      <div className="map-tools">
        <span className="map-tools-group" data-help="map-zoom">
          <button
            type="button"
            className="board-tool"
            aria-label="Zoom out"
            // Not `disabled`: a disabled button drops focus to <body> the
            // moment it reaches the end of its range.
            aria-disabled={zoom === ZOOMS[0] ? true : undefined}
            onClick={(e) => {
              zoomTo(stepZoom(zoom, -1))
              backToDraft(e)
            }}
          >
            <span className="board-tool-pin" aria-hidden="true" />
            <span>−</span>
          </button>
          <span className="map-zoom" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="board-tool"
            aria-label="Zoom in"
            aria-disabled={zoom === ZOOMS[ZOOMS.length - 1] ? true : undefined}
            onClick={(e) => {
              zoomTo(stepZoom(zoom, 1))
              backToDraft(e)
            }}
          >
            <span className="board-tool-pin" aria-hidden="true" />
            <span>+</span>
          </button>
        </span>
        <span className="map-tools-group" data-help="map-draw" role="group" aria-label="Map tools">
          {TOOLS.map((t) => (
            <button
              key={t}
              type="button"
              className={`board-tool${tool === t ? ' on' : ''}`}
              aria-pressed={tool === t}
              onClick={() => chooseTool(t)}
            >
              <span className="board-tool-pin" aria-hidden="true" />
              <span>{toolName(t)}</span>
            </button>
          ))}
        </span>
        <span
          className="map-tools-group"
          data-help="map-marks"
          role="group"
          aria-label="Stamps and labels"
        >
          <span className="stamp-palette-anchor">
            <button
              ref={paletteToggle}
              type="button"
              className={`board-tool stamp-palette-toggle${stampTool ? ' on' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={paletteOpen}
              aria-controls={paletteOpen ? 'stamp-palette' : undefined}
              onKeyDown={(e) => {
                // Esc on the toggle closes an open palette, not the map.
                if (e.key === 'Escape' && paletteOpen) {
                  e.preventDefault()
                  e.stopPropagation()
                  setPaletteOpen(false)
                }
              }}
              aria-label={stampTool ? `Stamps: ${MARK_NAME[stampTool]}` : 'Stamps'}
              onClick={() => setPaletteOpen((open) => !open)}
            >
              {stampTool && <StampGlyph kind={stampTool} scale={0.75} />}
              <span>{stampTool ? MARK_NAME[stampTool] : 'Stamps'}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {paletteOpen && (
              <StampPalette
                id="stamp-palette"
                current={stampTool}
                onPick={(kind) => kind !== 'pin' && chooseTool(kind)}
                onClose={(focus) => {
                  setPaletteOpen(false)
                  if (focus === 'toggle') afterKeysUp(() => paletteToggle.current?.focus())
                  else if (focus === 'map') scrollEl.current?.focus({ preventScroll: true })
                }}
              />
            )}
          </span>
          <button
            type="button"
            className={`board-tool${tool === 'label' ? ' on' : ''}`}
            aria-pressed={tool === 'label'}
            onClick={() => chooseTool('label')}
          >
            <span className="board-tool-pin" aria-hidden="true" />
            <span>{toolName('label')}</span>
          </button>
        </span>
        <span className="map-tools-group" data-help="map-grow">
          <span className="map-tools-label">More map:</span>
          {(
            [
              ['north', '↑'],
              ['west', '←'],
              ['east', '→'],
              ['south', '↓']
            ] as const
          ).map(([side, label]) => (
            <button
              key={side}
              type="button"
              className="board-tool"
              aria-label={`More map to the ${side}`}
              onClick={(e) => {
                growMap(side)
                backToDraft(e)
              }}
            >
              <span className="board-tool-pin" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </span>
        <span className="map-tools-group">
          <button
            ref={exportButton}
            type="button"
            className="board-tool map-export-toggle"
            data-help="map-export"
            aria-haspopup="dialog"
            aria-expanded={exportOpen}
            onClick={() => {
              setScaleOpen(false)
              setExportOpen((o) => !o)
            }}
          >
            <span className="board-tool-pin" aria-hidden="true" />
            <span>Export…</span>
          </button>
        </span>
        {/* Hung from the bar, not from its button: the bar wraps, and a
            panel hung from a button at the start of a row ran off the left. */}
        {exportOpen && (
          <MapExportPanel
            hasScale={scale != null}
            // What the picture would draw: a place whose entry has gone is
            // left out of it, so it does not count.
            empty={
              mapShapes.length + mapMarks.length === 0 &&
              !mapPins.some((p) => placeIds.has(p.entityId))
            }
            toggle=".map-export-toggle"
            onExport={exportMapImage}
            onClose={(written, focus) => {
              setExportOpen(false)
              // The hint is one line: the file's name, not a path it cuts off.
              if (written) setNotice(`Map written: ${written.split(/[\\/]/).pop()}.`)
              if (focus) afterKeysUp(() => exportButton.current?.focus({ preventScroll: true }))
            }}
          />
        )}
      </div>

      {(() => {
        const pin = placeStyle ? mapPins.find((p) => p.id === placeStyle.pinId) : undefined
        if (!placeStyle || !pin) return null
        const focusToggle = (): void =>
          document
            .querySelector<HTMLElement>(`[data-style-pin="${pin.id}"]`)
            ?.focus({ preventScroll: true })
        return (
          <div
            // Its own palette per place: switching rows starts afresh —
            // fitted to the new row, opened on that place's choice.
            key={pin.id}
            className="place-palette-anchor"
            style={{ top: placeStyle.top, left: placeStyle.left }}
          >
            <StampPalette
              id="place-palette"
              label={`Show ${nameOf(pin.entityId)} as`}
              current={pin.stamp ?? 'pin'}
              allowPin
              toggle=".place-style-toggle"
              closeOnPick={false}
              sizes={
                pin.stamp
                  ? {
                      current: markSizeOf(pin.size),
                      names: SIZE_NAME,
                      labels: SIZE_LABEL,
                      values: MARK_SIZES,
                      onSize: (size) =>
                        projectPath && void styleMapPinAt(projectPath, pin.id, { size })
                    }
                  : undefined
              }
              onPick={(kind) =>
                projectPath &&
                void styleMapPinAt(projectPath, pin.id, { stamp: kind === 'pin' ? null : kind })
              }
              onClose={(focus) => {
                setPlaceStyle(null)
                if (focus === 'toggle') afterKeysUp(focusToggle)
              }}
            />
          </div>
        )
      })()}
      <div className="map-hint-row">
        <div className="map-hint">{(!naming && problem) || notice || hintLine()}</div>
        {/* What a screen reader hears: the same line, except that a route is
            told as it stands at its placed points — the figure that runs to
            the pointer would otherwise be read out on every move. */}
        <span className="sr-only" role="status">
          {(!naming && problem) || notice || hintLine(true)}
        </span>
        {tool === 'measure' && (
          <button
            type="button"
            ref={scaleButton}
            className="btn small map-scale-button"
            data-help="map-scale"
            aria-haspopup="dialog"
            aria-expanded={scaleOpen}
            onClick={() => {
              setExportOpen(false)
              setScaleOpen((o) => !o)
            }}
          >
            {scale ? 'Scale…' : 'Set Scale…'}
          </button>
        )}
        {scaleOpen && (
          <MapScalePanel
            scale={scale}
            routePixels={route.length > 1 ? routeLength(route) : null}
            onSave={(next) => {
              closeScale()
              void setMapScale(next)
              // With a route on the map, it is told at once in the new
              // scale; without one, the hint says what happened.
              if (!next || route.length < 2) setNotice(next ? 'Scale set.' : 'Scale taken off.')
            }}
            onClose={closeScale}
          />
        )}
        {(isMarkKind(tool) || sizeTarget != null) && (
          <span className="map-size" role="group" aria-label="Size" data-help="map-size">
            {MARK_SIZES.map((size, i) => (
              <button
                key={size}
                type="button"
                className={`map-size-step${size === currentSize ? ' on' : ''}`}
                aria-pressed={size === currentSize}
                aria-label={`${SIZE_NAME[i]} (${SIZE_LABEL[i]})`}
                // Pressing one must not take focus from a name being typed:
                // the blur kept the name (or dropped an empty label) at the
                // old size before the click could change it.
                onMouseDown={(e) => {
                  if (naming) e.preventDefault()
                }}
                onClick={() => setSize(size)}
              >
                {SIZE_LABEL[i]}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="map-body">
        {/* The scale bar, in the map's corner, unscaled: a round length in
            the story's own units at the zoom of the moment. */}
        {bar && scale && (
          <button
            type="button"
            className="map-scale-bar"
            data-help="map-scale"
            aria-label={`Scale: this bar is ${formatDistance(bar.units, scale.unit)}. Change the scale`}
            onClick={() => {
              // Measure first: choosing a tool closes the scale panel.
              if (tool !== 'measure') chooseTool('measure')
              setExportOpen(false)
              setScaleOpen(true)
            }}
          >
            <span className="map-scale-ruler" style={{ width: bar.screen }} aria-hidden="true">
              <span />
              <span />
            </span>
            <span className="map-scale-label">{formatDistance(bar.units, scale.unit)}</span>
          </button>
        )}
        <aside className="map-places" data-help="map-places" aria-label="Places" tabIndex={-1}>
          {locations.length === 0 ? (
            <div className="dialog-hint">
              No places yet. A World Book entry is a place: add one, and it waits here to be put on
              the map.
            </div>
          ) : (
            <>
              {unplaced.length > 0 && (
                <>
                  <div className="field-name">NOT ON THE MAP</div>
                  {unplaced.map((e) => (
                    <div key={e.id} className="map-place-row">
                      <span className="map-place-name">{e.name}</span>
                      <button
                        type="button"
                        className="btn small"
                        aria-label={`Put ${e.name} on the map`}
                        onClick={() => place(e.id)}
                      >
                        Place
                      </button>
                    </div>
                  ))}
                </>
              )}
              {onMap.length > 0 && (
                <>
                  <div className="field-name">ON THE MAP</div>
                  {onMap.map((pin) => {
                    const name = nameOf(pin.entityId)
                    return (
                      <div key={pin.id} className="map-place-row" data-pin={pin.id}>
                        {isOrphan(pin) ? (
                          <span className="map-place-name">{name}</span>
                        ) : (
                          <button
                            type="button"
                            className="map-place-name link"
                            aria-label={`Find ${name} on the map`}
                            onClick={() => goTo(pin)}
                          >
                            {name}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`place-style-toggle${placeStyle?.pinId === pin.id ? ' on' : ''}`}
                          data-help="map-place-style"
                          data-style-pin={pin.id}
                          title="Show as…"
                          aria-label={`Show ${name} as… (now ${pin.stamp ? MARK_NAME[pin.stamp].toLowerCase() : 'a pin'})`}
                          aria-haspopup="dialog"
                          aria-expanded={placeStyle?.pinId === pin.id}
                          onClick={(e) => {
                            if (placeStyle?.pinId === pin.id) {
                              setPlaceStyle(null)
                              return
                            }
                            const frame = e.currentTarget
                              .closest('.world-map')
                              ?.getBoundingClientRect()
                            const box = e.currentTarget.getBoundingClientRect()
                            setPlaceStyle({
                              pinId: pin.id,
                              top: box.bottom - (frame?.top ?? 0) + 4,
                              left: box.left - (frame?.left ?? 0)
                            })
                          }}
                        >
                          {pin.stamp ? (
                            <StampGlyph kind={pin.stamp} scale={0.75} />
                          ) : (
                            <span className="world-map-pin-glyph" aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Take ${name} off the map`}
                          onClick={() => remove(pin)}
                        >
                          Remove
                        </button>
                      </div>
                    )
                  })}
                </>
              )}
            </>
          )}
        </aside>

        <div
          className={`map-scroll${panning ? ' panning' : ''}`}
          ref={scrollEl}
          onPointerDown={onMapDown}
          onPointerMove={onMapMove}
          onPointerLeave={() =>
            setHover(
              cursor &&
                !pointerDrawing &&
                (draft.length > 0 || (tool === 'measure' && route.length > 0 && !routeDone))
                ? cursor
                : null
            )
          }
          onFocus={(e) => {
            if (e.target !== e.currentTarget || tool === 'hand') return
            if (!returningFocus.current) setCursor(roundPoint(clampTo(bounds, viewCentre())))
            // Arrived by keyboard (Tab), not by a click: show the cursor.
            if (focusedByKeyboard(e.currentTarget)) setPointerDrawing(false)
          }}
          data-tool={tool}
          // A place you can be in from the keyboard: Tab here, and the arrow
          // keys move the view (Shift further), as dragging does.
          tabIndex={0}
          role="region"
          aria-label={regionLabel()}
          onDoubleClick={onMapDoubleClick}
          onKeyDown={onScrollKey}
        >
          <div
            className="map-sizer"
            ref={sizerEl}
            style={{ width: bounds.width * zoom, height: bounds.height * zoom }}
          >
            <div
              className="map-canvas"
              style={{
                width: bounds.width,
                height: bounds.height,
                transform: `scale(${zoom})`
              }}
            >
              <svg className="map-art" width={bounds.width} height={bounds.height}>
                <defs>
                  <pattern id="map-sea" width={6} height={6} patternUnits="userSpaceOnUse">
                    <rect className="map-sea-dot" x={0} y={0} width={1} height={1} />
                    <rect className="map-sea-dot" x={3} y={3} width={1} height={1} />
                  </pattern>
                  {/* Hatching for an area: diagonal ink lines, two-colour by
                      being lines rather than a tint. */}
                  <pattern
                    id="map-hatch"
                    width={8}
                    height={8}
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <path d="M 0 0 V 8" className="map-hatch" />
                  </pattern>
                  <pattern
                    id="map-graticule"
                    width={100}
                    height={100}
                    patternUnits="userSpaceOnUse"
                    x={gridX}
                    y={gridY}
                  >
                    <path d="M 0 0 H 100 M 0 0 V 100" className="map-graticule" />
                  </pattern>
                </defs>
                <rect
                  width={bounds.width}
                  height={bounds.height}
                  fill="url(#map-sea)"
                  aria-hidden="true"
                />
                <rect
                  width={bounds.width}
                  height={bounds.height}
                  fill="url(#map-graticule)"
                  aria-hidden="true"
                />
                {DRAW_ORDER.flatMap((kind) => {
                  const ofKind = mapShapes.filter((shape) => shape.kind === kind)
                  // Every road's casing first, then every road's paper: cased
                  // one road at a time, a road meeting another drew an ink
                  // line across it, and every junction looked closed.
                  const casings =
                    kind === 'road' && ofKind.length > 0 ? (
                      <g key="road-casings" className="map-road-casings" aria-hidden="true">
                        {ofKind.map((shape) => (
                          <path
                            key={shape.id}
                            className={`map-road-casing${selected === shape.id ? ' selected' : ''}${keyFocus === shape.id ? ' focused' : ''}`}
                            data-casing={shape.id}
                            d={pathFor(kind, pointsOf(shape), bounds)}
                          />
                        ))}
                      </g>
                    ) : null
                  const groups = ofKind.map((shape, n) => {
                    const d = pathFor(kind, pointsOf(shape), bounds)
                    const isSelected = selected === shape.id
                    return (
                      <g
                        key={shape.id}
                        className={`map-shape ${kind}${isSelected ? ' selected' : ''}`}
                        data-shape={shape.id}
                      >
                        {/* The coast's ripple: a dotted halo drawn under
                              the land, whose fill hides the inner half. */}
                        {kind === 'land' && (
                          <path className="map-ripple" d={d} aria-hidden="true" />
                        )}
                        <path
                          className="map-shape-body"
                          d={d}
                          // Shapes are choosable with the hand, by pointer or
                          // by Tab; with a drawing tool they are only drawing.
                          tabIndex={tool === 'hand' ? 0 : undefined}
                          role={tool === 'hand' ? 'button' : undefined}
                          aria-pressed={tool === 'hand' ? isSelected : undefined}
                          // Numbered, so three islands are not three of the
                          // same thing to a screen reader.
                          aria-label={
                            tool === 'hand'
                              ? `${describeShape({ kind, points: pointsOf(shape) })}${shape.name ? `, “${shape.name}”` : ''}, ${n + 1} of ${ofKind.length}. ${isSelected ? 'Selected: its points follow. Return names it' : 'Return selects it'}; Delete removes it.`
                              : undefined
                          }
                          // Known here, not by CSS, because a road's casing is
                          // drawn apart from its body and shows its focus.
                          onFocus={(e) =>
                            focusedByKeyboard(e.currentTarget) && setKeyFocus(shape.id)
                          }
                          onBlur={() => setKeyFocus((f) => (f === shape.id ? null : f))}
                          onKeyDown={(e) => {
                            if (tool !== 'hand') return
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              chooseOrName({ shape })
                            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                              e.preventDefault()
                              e.stopPropagation()
                              removeShape(shape)
                            }
                          }}
                        />
                        {/* What the hand grabs: the outline widened to the
                              same size on screen at every zoom, so a border
                              is not a 1px hairline to hit at 50%. */}
                        <path
                          className="map-shape-hit"
                          d={d}
                          style={{ strokeWidth: 14 / zoom }}
                          aria-hidden="true"
                        />
                        {/* A railway's sleepers: a wide stroke dashed so
                            thin that each dash is a tie across the line. */}
                        {kind === 'rail' && (
                          <path className="map-rail-ties" d={d} aria-hidden="true" />
                        )}
                      </g>
                    )
                  })
                  return casings ? [casings, ...groups] : groups
                })}
                {/* Stamps, over everything drawn: engraved in ink on paper,
                    scaled with the map like the rest of the art. */}
                {mapMarks.map((mark) => {
                  if (!isStamp(mark.kind)) return null
                  const at = markAt(mark)
                  const art = STAMP_ART[mark.kind]
                  const size = drawnSize(mark)
                  const w = STAMP_W * size
                  const h = STAMP_H * size
                  return (
                    <g
                      key={mark.id}
                      className={`map-mark stamp ${mark.kind}${selected === mark.id ? ' selected' : ''}`}
                      data-mark={mark.id}
                      transform={`translate(${at.x - bounds.x - w / 2} ${at.y - bounds.y - h / 2})`}
                      tabIndex={tool === 'hand' ? 0 : undefined}
                      role={tool === 'hand' ? 'button' : undefined}
                      aria-pressed={tool === 'hand' ? selected === mark.id : undefined}
                      aria-label={
                        tool === 'hand'
                          ? `${describeMark(mark.kind, mark.name)}${sizeWords(mark)}. ${selected === mark.id ? 'Return names it' : 'Return selects it'}; [ and ] size it; Option and the arrows move it; Delete removes it.`
                          : undefined
                      }
                      onKeyDown={(e) => onMarkKey(e, mark)}
                    >
                      <rect className="map-mark-hit" width={w} height={h} />
                      <g transform={`scale(${STAMP_SCALE * size})`}>
                        {art.body && <path className="map-stamp-body" d={art.body} />}
                        <path className="map-stamp-lines" d={art.lines} />
                        {art.solid && <path className="map-stamp-solid" d={art.solid} />}
                      </g>
                    </g>
                  )
                })}
                {tool === 'measure' && routed.length > 0 && (
                  <g className="map-measure" aria-hidden="true">
                    <path d={shapePath(routed, false, bounds)} />
                    {route.map((p, i) => (
                      <circle key={i} cx={p.x - bounds.x} cy={p.y - bounds.y} r={3 / zoom} />
                    ))}
                  </g>
                )}
                {draft.length > 0 && isShapeKind(tool) && (
                  <path
                    className={`map-draft ${tool}`}
                    d={
                      isSmooth(tool)
                        ? smoothPath(drafted, bounds)
                        : shapePath(drafted, false, bounds)
                    }
                    aria-hidden="true"
                  />
                )}
              </svg>
            </div>
            {/* The drawing's own points, unscaled like the pins so they stay
                the same size to grab at every zoom: the first point of a
                shape being drawn (click it to close), and the corners and
                edge middles of the selected shape. */}
            {draft.length > 0 && isShapeKind(tool) && (
              <span
                className={`map-handle first${isClosed(tool) && draft.length >= 3 ? ' closes' : ''}`}
                style={{
                  left: (draft[0].x - bounds.x) * zoom,
                  top: (draft[0].y - bounds.y) * zoom
                }}
                aria-hidden="true"
              />
            )}
            {/* Middles before corners, so a corner wins where they meet. */}
            {selectedShape &&
              tool === 'hand' &&
              midpoints(
                pointsOf(selectedShape),
                isClosed(selectedShape.kind),
                isSmooth(selectedShape.kind)
              )
                .filter((m) => edgeLongEnough(pointsOf(selectedShape), m.index, zoom))
                .map((m) => (
                  <button
                    key={`m${m.index}`}
                    type="button"
                    className="map-handle middle"
                    style={{ left: (m.x - bounds.x) * zoom, top: (m.y - bounds.y) * zoom }}
                    aria-label={`Add a point between ${m.index} and ${m.index + 1 > pointsOf(selectedShape).length ? 1 : m.index + 1}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() =>
                      reshape(selectedShape, insertPoint(pointsOf(selectedShape), m.index, m))
                    }
                  />
                ))}
            {selectedShape &&
              tool === 'hand' &&
              pointsOf(selectedShape).map((p, i) => (
                <button
                  key={`c${i}`}
                  type="button"
                  className="map-handle corner"
                  data-corner={i}
                  style={{ left: (p.x - bounds.x) * zoom, top: (p.y - bounds.y) * zoom }}
                  aria-label={`Point ${i + 1} of ${pointsOf(selectedShape).length}. Drag, or Option and the arrows, to move it; Delete takes it out.`}
                  onPointerDown={(e) => onCornerDown(e, selectedShape, i)}
                  onKeyDown={(e) => onCornerKey(e, selectedShape, i)}
                />
              ))}
            {/* Names, unscaled like the pins so they read at every zoom, and
                inert: a click on a name is a click on what it names. */}
            {mapShapes.map((shape) => {
              if (!shape.name || (naming?.what === 'shape' && naming.id === shape.id)) return null
              const at = labelAnchor({ kind: shape.kind, points: pointsOf(shape) })
              return (
                <span
                  key={`n${shape.id}`}
                  className={`map-label feature ${shape.kind}`}
                  style={{ left: (at.x - bounds.x) * zoom, top: (at.y - bounds.y) * zoom }}
                  aria-hidden="true"
                >
                  {shape.name}
                </span>
              )
            })}
            {mapMarks.map((mark) => {
              if (naming?.what === 'mark' && naming.id === mark.id) return null
              const at = markAt(mark)
              if (isStamp(mark.kind)) {
                if (!mark.name) return null
                const n = stampNameAt(at, drawnSize(mark))
                return (
                  <span
                    key={`n${mark.id}`}
                    className="map-label stamp-name"
                    style={{ left: (n.x - bounds.x) * zoom, top: (n.y - bounds.y) * zoom }}
                    aria-hidden="true"
                  >
                    {mark.name}
                  </span>
                )
              }
              // A free label is itself the thing on the map: chosen, moved
              // and named with the hand, like a stamp.
              return (
                <span
                  key={mark.id}
                  className={`map-label free${selected === mark.id ? ' selected' : ''}`}
                  data-mark={mark.id}
                  style={{
                    left: (at.x - bounds.x) * zoom,
                    top: (at.y - bounds.y) * zoom,
                    fontSize: 14 * markSizeOf(mark.size)
                  }}
                  tabIndex={tool === 'hand' ? 0 : -1}
                  role="button"
                  aria-hidden={tool === 'hand' ? undefined : true}
                  aria-pressed={selected === mark.id}
                  aria-label={`${describeMark(mark.kind, mark.name)}${sizeWords(mark)}. ${selected === mark.id ? 'Return changes the words' : 'Return selects it'}; [ and ] size it; Option and the arrows move it; Delete removes it.`}
                  onKeyDown={(e) => onMarkKey(e, mark)}
                >
                  {mark.name}
                </span>
              )
            })}
            {naming && (
              <input
                className={`map-name-field${naming.what === 'new-label' || mapMarks.find((m) => naming.what === 'mark' && m.id === naming.id)?.kind === 'label' ? ' free' : ''}`}
                style={{
                  left: (naming.at.x - bounds.x) * zoom,
                  top: (naming.at.y - bounds.y) * zoom
                }}
                aria-label={naming.what === 'new-label' ? 'Label' : 'Name'}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? 'map-name-problem' : undefined}
                autoFocus
                value={naming.value}
                spellCheck={false}
                onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                // Its own, not the map's: a press here is not a click on the
                // map (which, with Label up, would start another label).
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    keepName('enter')
                  } else if (e.key === 'Escape') {
                    // Esc is also "back": it must not leave the map.
                    e.preventDefault()
                    e.stopPropagation()
                    dropName()
                  } else if (e.key === 'Backspace' || e.key === 'Delete') {
                    e.stopPropagation()
                  }
                }}
                // A window losing focus (⌘Tab, a menu, a native dialog) is not
                // the writer leaving the field: it is still there, half-typed,
                // when they come back.
                onBlur={() => {
                  if (document.hasFocus()) keepName('blur')
                }}
              />
            )}
            {naming && problem && (
              <div
                id="map-name-problem"
                className="map-name-problem"
                role="alert"
                style={{
                  left: (naming.at.x - bounds.x) * zoom,
                  top: (naming.at.y - bounds.y) * zoom
                }}
              >
                {problem}
              </div>
            )}
            {cursor && tool !== 'hand' && !pointerDrawing && (
              <span
                className="map-cursor"
                style={{ left: (cursor.x - bounds.x) * zoom, top: (cursor.y - bounds.y) * zoom }}
                aria-hidden="true"
              />
            )}
            {/* Pins sit outside the scaled drawing, placed at zoomed
                positions, so a name stays readable and a focus ring visible at
                every zoom — scaled with the art, at 50% they were smudges. */}
            {mapPins.map((pin) => {
              const at = posOf(pin)
              const name = nameOf(pin.entityId)
              // A place drawn as its stamp: at the stamp's size, scaled with
              // the map like any stamp, with a floor so it never smudges,
              // and centred on its point (a pin hangs from it instead).
              const size = pin.stamp ? Math.max(markSizeOf(pin.size), MARK_SIZES[0] / zoom) : 1
              const glyph = STAMP_SCALE * size * zoom
              return (
                <button
                  key={pin.id}
                  type="button"
                  data-pin={pin.id}
                  data-help="map-pin"
                  className={`world-map-pin${pin.stamp ? ` stamped ${pin.stamp}` : ''}`}
                  // While drawing, a pin is only part of the map: a click on a
                  // town is a point of the coast, not a trip to the World Book.
                  tabIndex={tool === 'hand' ? undefined : -1}
                  aria-hidden={tool === 'hand' ? undefined : true}
                  style={{
                    left: (at.x - bounds.x) * zoom,
                    top: (at.y - bounds.y) * zoom,
                    ...(pin.stamp ? { transform: `translate(-50%, -${(20 * glyph) / 2}px)` } : {})
                  }}
                  aria-label={`${name}${pin.stamp ? `, shown as ${MARK_NAME[pin.stamp].toLowerCase()}` : ''}. Return opens it; Option and the arrows move it${pin.stamp ? '; [ and ] size it' : ''}.`}
                  onPointerDown={(e) => tool === 'hand' && onPinDown(e, pin)}
                  onKeyDown={(e) => {
                    if (tool !== 'hand') return
                    onPinKey(e, pin)
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openPlace(pin)
                    }
                  }}
                >
                  {pin.stamp ? (
                    <StampGlyph kind={pin.stamp} scale={glyph} />
                  ) : (
                    <span className="world-map-pin-glyph" aria-hidden="true" />
                  )}
                  <span className="world-map-pin-label">{name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * F-12: the maps, as a place rather than a dialog — tabs along the top, like
 * a drawer of folders, and the map chosen below them.
 */
export function WorldMap(): JSX.Element {
  const data = useWyrm((s) => s.project?.data)
  const mapId = useWyrm((s) => s.mapId)
  const chooseMap = useWyrm((s) => s.chooseMap)
  // Coming back from a place: to the map it was opened on, whichever map has
  // been chosen since (a minimap card, say). Shown at once, chosen after.
  const backTo = useWyrm((s) => (s.mainView.kind === 'map' ? s.mainView.mapId : undefined))
  const shown = data && backTo && hasSheet(data, backTo) ? backTo : mapId
  useEffect(() => {
    if (shown !== mapId) chooseMap(shown)
  }, [shown, mapId, chooseMap])
  // Where each map was being looked at, so flipping between two keeps both.
  const [views] = useState(() => new Map<string, MapView>())
  const sheet = data ? sheetOf(data, shown) : null
  if (!data || !sheet) return <div className="terminal" />
  return (
    <div className="terminal world-map" data-help="world-map">
      <MapTabs />
      <MapSheetView key={sheet.id} sheet={sheet} views={views} />
    </div>
  )
}
