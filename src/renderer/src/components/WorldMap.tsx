import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { MapPin } from '../../../shared/types'
import { useWyrm } from '../store'
import { afterKeysUp } from '../lib/keys'
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
/** The desk showing round the map, matching `.map-scroll`'s padding. */
const GUTTER = 24
/** How far one arrow press moves the view, and with Shift. */
const PAN = 60
const PAN_BIG = 300

const ARROWS: Record<string, Point | undefined> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }
}

export function WorldMap(): JSX.Element {
  const project = useWyrm((s) => s.project)
  const entities = useWyrm((s) => s.entities)
  const mapPins = useWyrm((s) => s.mapPins)
  const loadMapPins = useWyrm((s) => s.loadMapPins)
  const setMapPin = useWyrm((s) => s.setMapPin)
  const moveMapPinAt = useWyrm((s) => s.moveMapPinAt)
  const projectPath = useWyrm((s) => s.project?.path)
  const removeMapPin = useWyrm((s) => s.removeMapPin)
  const setMapBounds = useWyrm((s) => s.setMapBounds)
  const showEntity = useWyrm((s) => s.showEntity)
  const returnedTo = useWyrm((s) => (s.mainView.kind === 'map' ? s.mainView : null))
  const settleMapReturn = useWyrm((s) => s.settleMapReturn)

  // The pins are read as the map opens, so anything that needs them — the
  // return to a focused pin — waits for that read.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    void loadMapPins().then(() => live && setLoaded(true))
    return () => {
      live = false
    }
    // On the project's path, not its object: every save makes a new project
    // object (growing the map does), and a read issued then could land after
    // a pin placed a moment later and drop it.
  }, [projectPath, loadMapPins])

  // Pins held here while being moved, so they follow the pointer or the
  // keys without waiting on a write.
  const [localPos, setLocalPos] = useState<Record<string, Point>>({})
  const [zoom, setZoom] = useState<number>(() => returnedTo?.zoom ?? 1)
  const scrollEl = useRef<HTMLDivElement | null>(null)

  const bounds = boundsOf(project?.data.mapBounds, mapPins)
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

  const here = (
    pin?: MapPin
  ): { kind: 'map'; zoom: number; scrollLeft: number; scrollTop: number; focusPin?: string } => ({
    kind: 'map',
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
    const dir = ARROWS[e.key]
    if (dir && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const step = e.shiftKey ? NUDGE_BIG : NUDGE
      const at = posOf(pin)
      placePin(pin, { x: at.x + dir.x * step, y: at.y + dir.y * step }, NUDGE_SETTLE)
    }
  }

  /* ---------- panning ---------- */

  // Dragging the map itself moves the view, the way a hand moves a paper
  // map across a desk. Scroll bars and the trackpad work as well.
  const [panning, setPanning] = useState(false)
  const onMapDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    // On the map itself, not its scroll bars: grabbing a bar must only scroll.
    if (!(e.target as Element).closest?.('.map-sizer')) return
    const el = scrollEl.current
    if (!el) return
    stop.current?.()
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    setPanning(true)
    const move = (ev: PointerEvent): void => {
      el.scrollLeft = start.left - (ev.clientX - start.x)
      el.scrollTop = start.top - (ev.clientY - start.y)
    }
    const up = (): void => {
      stop.current?.()
      setPanning(false)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
    stop.current = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      stop.current = null
    }
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

  /** The map from the keyboard: arrows move the view, Shift further. */
  const onScrollKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    const dir = ARROWS[e.key]
    const el = scrollEl.current
    if (!dir || !el || e.altKey || e.metaKey || e.ctrlKey) return
    e.preventDefault()
    const step = e.shiftKey ? PAN_BIG : PAN
    el.scrollLeft += dir.x * step
    el.scrollTop += dir.y * step
  }

  if (!project) return <div className="terminal" />

  // The graticule is drawn in map coordinates, so its lines stay on the
  // same hundreds whichever way the map has grown.
  const gridX = ((-bounds.x % 100) + 100) % 100
  const gridY = ((-bounds.y % 100) + 100) % 100

  return (
    <div className="terminal world-map" data-help="world-map">
      <div className="map-tools">
        <span className="map-tools-group" data-help="map-zoom">
          <button
            type="button"
            className="board-tool"
            aria-label="Zoom out"
            // Not `disabled`: a disabled button drops focus to <body> the
            // moment it reaches the end of its range.
            aria-disabled={zoom === ZOOMS[0] ? true : undefined}
            onClick={() => zoomTo(stepZoom(zoom, -1))}
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
            onClick={() => zoomTo(stepZoom(zoom, 1))}
          >
            <span className="board-tool-pin" aria-hidden="true" />
            <span>+</span>
          </button>
        </span>
        <span className="map-tools-group" data-help="map-grow">
          <span className="map-tools-label">More map:</span>
          {(
            [
              ['north', '↑ North'],
              ['west', '← West'],
              ['east', 'East →'],
              ['south', '↓ South']
            ] as const
          ).map(([side, label]) => (
            <button
              key={side}
              type="button"
              className="board-tool"
              aria-label={`More map to the ${side}`}
              onClick={() => growMap(side)}
            >
              <span className="board-tool-pin" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </span>
      </div>

      <div className="map-body">
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
          // A place you can be in from the keyboard: Tab here, and the arrow
          // keys move the view (Shift further), as dragging does.
          tabIndex={0}
          role="region"
          aria-label="World map. Arrow keys move the view; Shift moves it further."
          onKeyDown={onScrollKey}
        >
          <div
            className="map-sizer"
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
              <svg
                className="map-art"
                width={bounds.width}
                height={bounds.height}
                aria-hidden="true"
              >
                <defs>
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
                <rect width={bounds.width} height={bounds.height} fill="url(#map-graticule)" />
              </svg>
            </div>
            {/* Pins sit outside the scaled drawing, placed at zoomed
                positions, so a name stays readable and a focus ring visible at
                every zoom — scaled with the art, at 50% they were smudges. */}
            {mapPins.map((pin) => {
              const at = posOf(pin)
              const name = nameOf(pin.entityId)
              return (
                <button
                  key={pin.id}
                  type="button"
                  data-pin={pin.id}
                  data-help="map-pin"
                  className="world-map-pin"
                  style={{ left: (at.x - bounds.x) * zoom, top: (at.y - bounds.y) * zoom }}
                  aria-label={`${name}. Return opens it; Option and the arrows move it.`}
                  onPointerDown={(e) => onPinDown(e, pin)}
                  onKeyDown={(e) => {
                    onPinKey(e, pin)
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openPlace(pin)
                    }
                  }}
                >
                  <span className="world-map-pin-glyph" aria-hidden="true" />
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
