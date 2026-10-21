import type { MapBounds, MapPin } from '../../../shared/types'

/**
 * F-12: the world map's geometry, pure, for the same reason the corkboard's
 * is — jsdom lays nothing out, so anything positional is tested here as
 * numbers rather than through a rendered page.
 */

export interface Point {
  x: number
  y: number
}

/**
 * The map a project starts with. Roomy enough to lay a continent out
 * without growing it; the old dialog's 640×380 sits in its top-left corner,
 * which is where every pin placed before this lives.
 */
export const DEFAULT_BOUNDS: MapBounds = { x: 0, y: 0, width: 2400, height: 1600 }

/** How much one press of a grow button adds to that side. */
export const GROW_STEP = 400

/** The zoom steps: half, actual size, double. Whole and half steps keep the
 *  dithers and the 1-bit strokes crisp; anything between blurs them. */
export const ZOOMS = [0.5, 1, 2] as const
export type Zoom = (typeof ZOOMS)[number]

export type Side = 'north' | 'south' | 'east' | 'west'

/** The map's extent, grown to take in any pin that sits outside it — a
 *  pin is never drawn somewhere the map does not reach. */
export function boundsOf(stored: MapBounds | undefined, pins: Point[] = []): MapBounds {
  const b = stored ?? DEFAULT_BOUNDS
  if (pins.length === 0) return b
  const x0 = Math.min(b.x, ...pins.map((p) => p.x))
  const y0 = Math.min(b.y, ...pins.map((p) => p.y))
  const x1 = Math.max(b.x + b.width, ...pins.map((p) => p.x))
  const y1 = Math.max(b.y + b.height, ...pins.map((p) => p.y))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The map with more room on one side. North and west move the origin;
 *  nothing already on the map moves. */
export function grow(b: MapBounds, side: Side, by = GROW_STEP): MapBounds {
  switch (side) {
    case 'north':
      return { ...b, y: b.y - by, height: b.height + by }
    case 'south':
      return { ...b, height: b.height + by }
    case 'west':
      return { ...b, x: b.x - by, width: b.width + by }
    case 'east':
      return { ...b, width: b.width + by }
  }
}

/** A point kept on the map. */
export function clampTo(b: MapBounds, p: Point): Point {
  return {
    x: Math.round(Math.min(b.x + b.width, Math.max(b.x, p.x))),
    y: Math.round(Math.min(b.y + b.height, Math.max(b.y, p.y)))
  }
}

/** A map point from a point in the scrolling view, at this zoom. */
export function toMap(b: MapBounds, zoom: number, view: Point): Point {
  return { x: b.x + view.x / zoom, y: b.y + view.y / zoom }
}

/** Where to scroll so a map point sits in the middle of a view this size. */
export function scrollToCentre(
  b: MapBounds,
  zoom: number,
  p: Point,
  view: { width: number; height: number }
): Point {
  return {
    x: Math.max(0, (p.x - b.x) * zoom - view.width / 2),
    y: Math.max(0, (p.y - b.y) * zoom - view.height / 2)
  }
}

/** The next zoom step in or out, staying put at either end. */
export function stepZoom(zoom: number, dir: 1 | -1): Zoom {
  const i = ZOOMS.findIndex((z) => z === zoom)
  const at = i < 0 ? 1 : i
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + dir))]
}

/** Where a fresh pin goes: the middle of what the writer is looking at,
 *  nudged so successive placements do not land on one another. */
export function placeAt(centre: Point, existing: Pick<MapPin, 'x' | 'y'>[]): Point {
  let p = { ...centre }
  for (let i = 0; i < 12 && existing.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 20); i++)
    p = { x: p.x + 24, y: p.y + 24 }
  return p
}
