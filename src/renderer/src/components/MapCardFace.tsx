import { useMemo } from 'react'
import type { JSX } from 'react'
import { useWyrm } from '../store'
import { mapHasDrawing, mapPictureSvg } from '../lib/mapPicture'
import { recordsOn, sheetOf } from '../lib/mapSheets'
import { validScale } from '../lib/mapScale'

/**
 * F-12: a minimap card's face — the whole map, shrunk to the card. Drawn by
 * the same writer as Export Map Image, so the card is the map and not a
 * likeness of it; the writer's black and white are turned into the
 * palette's two inks by CSS (`.map-card-mini`), and its patterns carry the
 * card's id so two minimaps on one board never share them.
 */
export function MapCardFace({ id, title }: { id: string; title: string }): JSX.Element {
  const data = useWyrm((s) => s.project?.data)
  const pins = useWyrm((s) => s.mapPins)
  const shapes = useWyrm((s) => s.mapShapes)
  const marks = useWyrm((s) => s.mapMarks)
  const entities = useWyrm((s) => s.entities)
  const svg = useMemo(() => {
    if (!data) return null
    const sheet = sheetOf(data, id)
    const places = new Map(
      entities.filter((e) => e.type === 'world').map((e) => [e.id, e.name] as const)
    )
    const input = {
      mapBounds: sheet.bounds,
      shapes: recordsOn(shapes, sheet.id, data),
      marks: recordsOn(marks, sheet.id, data),
      pins: recordsOn(pins, sheet.id, data).filter((p) => places.has(p.entityId)),
      nameOf: (entityId: string) => places.get(entityId) ?? '',
      scale: validScale(sheet.scale) ? sheet.scale : undefined
    }
    if (!mapHasDrawing(input)) return null
    return mapPictureSvg(
      input,
      { grid: false, trim: true, scaleBar: false },
      `minimap-${sheet.id}-`
    ).svg
  }, [data, id, pins, shapes, marks, entities])

  return (
    <>
      <span className="scene-card-head">
        <span className="scene-card-title">{title}</span>
      </span>
      <span className="scene-card-folder">Maps</span>
      {svg ? (
        // The writer's own SVG, from the project's own records: names are
        // escaped as it writes them.
        <span
          className="map-card-mini"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <span className="scene-card-excerpt">
          <em>Nothing drawn yet.</em>
        </span>
      )}
      <span className="scene-card-foot">
        <span className="scene-card-kind">map</span>
      </span>
    </>
  )
}
