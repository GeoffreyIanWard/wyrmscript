import { useEffect, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { MapPin } from '../../../shared/types'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useWyrm } from '../store'

/**
 * F-12: World Book locations placed on a map. Placeable pins on a plain
 * dithered background only, per the design pass — no legends, borders, or
 * topography drawing tools in this pass (see the roadmap for what's
 * deferred). A location with no `MapPin` simply isn't on the map yet;
 * clicking "+ Place on Map" creates one, dragging repositions it, and a
 * pin's own "Remove" takes it off the map without touching the entity.
 */

const MAP_WIDTH = 640
const MAP_HEIGHT = 380
const CLICK_THRESHOLD_PX = 4

interface Drag {
  id: string
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  dx: number
  dy: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function WorldMapDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const entities = useWyrm((s) => s.entities)
  const mapPins = useWyrm((s) => s.mapPins)
  const loadMapPins = useWyrm((s) => s.loadMapPins)
  const setMapPin = useWyrm((s) => s.setMapPin)
  const removeMapPin = useWyrm((s) => s.removeMapPin)
  const showEntity = useWyrm((s) => s.showEntity)

  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)

  useEffect(() => {
    void loadMapPins()
  }, [loadMapPins])

  const locations = entities.filter((e) => e.type === 'world')
  const pinnedIds = new Set(mapPins.map((p) => p.entityId))
  const unplaced = locations.filter((e) => !pinnedIds.has(e.id))
  const nameOf = (entityId: string): string =>
    locations.find((e) => e.id === entityId)?.name ?? '(deleted)'

  const openLocation = (entityId: string): void => {
    onClose()
    showEntity(entityId)
  }

  const place = (entityId: string): void => {
    // Stagger fresh placements so successive clicks don't all land on the
    // same spot — dragging apart from there is the whole point of a map.
    const offset = (mapPins.length % 5) * 24
    void setMapPin(entityId, 80 + offset, 60 + offset)
  }

  const startDrag =
    (pin: MapPin) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const next: Drag = {
        id: pin.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: pin.x,
        startY: pin.y,
        dx: 0,
        dy: 0
      }
      dragRef.current = next
      setDrag(next)
    }

  const moveDrag =
    (id: string) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!dragRef.current || dragRef.current.id !== id) return
      const next: Drag = {
        ...dragRef.current,
        dx: e.clientX - dragRef.current.startClientX,
        dy: e.clientY - dragRef.current.startClientY
      }
      dragRef.current = next
      setDrag(next)
    }

  const endDrag =
    (pin: MapPin) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      const finished = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!finished || finished.id !== pin.id) return
      if (
        Math.abs(finished.dx) > CLICK_THRESHOLD_PX ||
        Math.abs(finished.dy) > CLICK_THRESHOLD_PX
      ) {
        const x = clamp(finished.startX + finished.dx, 0, MAP_WIDTH)
        const y = clamp(finished.startY + finished.dy, 0, MAP_HEIGHT)
        void setMapPin(pin.entityId, x, y)
      } else {
        openLocation(pin.entityId)
      }
    }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        className="dialog world-map-dialog"
        ref={trapRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">World Map</span>
        </div>
        <div className="dialog-body">
          {locations.length === 0 && (
            <div className="dialog-hint">
              No locations yet. Add one from Project → New World Entry… to place it here.
            </div>
          )}

          {locations.length > 0 && (
            <div className="world-map-canvas" style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}>
              {mapPins.map((pin) => {
                const dragging = drag?.id === pin.id
                const x = dragging ? clamp(drag.startX + drag.dx, 0, MAP_WIDTH) : pin.x
                const y = dragging ? clamp(drag.startY + drag.dy, 0, MAP_HEIGHT) : pin.y
                return (
                  <div
                    key={pin.id}
                    role="button"
                    tabIndex={0}
                    className={dragging ? 'world-map-pin dragging' : 'world-map-pin'}
                    style={{ left: x, top: y }}
                    onPointerDown={startDrag(pin)}
                    onPointerMove={moveDrag(pin.id)}
                    onPointerUp={endDrag(pin)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      openLocation(pin.entityId)
                    }}
                  >
                    <div className="world-map-pin-glyph" />
                    <div className="world-map-pin-label">{nameOf(pin.entityId)}</div>
                  </div>
                )
              })}
            </div>
          )}

          {unplaced.length > 0 && (
            <div className="world-map-list">
              <div className="field-name">UNPLACED</div>
              {unplaced.map((e) => (
                <div key={e.id} className="world-map-row">
                  <span>{e.name}</span>
                  <button type="button" className="btn small" onClick={() => place(e.id)}>
                    + Place on Map
                  </button>
                </div>
              ))}
            </div>
          )}

          {mapPins.length > 0 && (
            <div className="world-map-list">
              <div className="field-name">PLACED</div>
              {mapPins.map((pin) => (
                <div key={pin.id} className="world-map-row">
                  <span>{nameOf(pin.entityId)}</span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void removeMapPin(pin)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn default" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
