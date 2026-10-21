import type { MapShape, MapShapeKind } from '../../../shared/types'
import type { Point } from './worldMap'

/**
 * F-12: the geometry of shapes drawn on the world map — land masses, shaded
 * areas, borders. Pure, like the rest of the map's maths: jsdom lays nothing
 * out, so anything positional is tested here as numbers.
 *
 * Shapes are drawn point by point, by click. Freehand would be smoother and
 * wrong for the app: a 1-bit map is made of deliberate strokes, and a coast
 * of thirty clicks is a small file where a freehand one is thousands of
 * points that sync and diff badly.
 */

/** The fewest points a shape of each kind can have and still be one. */
export const MIN_POINTS: Record<MapShapeKind, number> = { land: 3, area: 3, border: 2 }

/** Whether the last point joins the first. */
export const isClosed = (kind: MapShapeKind): boolean => kind !== 'border'

/** How close, in screen pixels, a click must land to the first point to
 *  close the outline — measured on screen so it feels the same at any zoom. */
export const CLOSE_RADIUS = 12

/** What each kind is called, to the writer and to a screen reader. */
export const KIND_NAME: Record<MapShapeKind, string> = {
  land: 'Land',
  area: 'Area',
  border: 'Border'
}

/**
 * The SVG path through these points, shifted by `origin` (the map's
 * top-left, since the canvas is drawn from there). Closed shapes end in Z.
 */
export function shapePath(
  points: Point[],
  closed: boolean,
  origin: Point = { x: 0, y: 0 }
): string {
  if (points.length === 0) return ''
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - origin.x} ${p.y - origin.y}`)
  return `${d.join(' ')}${closed && points.length > 2 ? ' Z' : ''}`
}

/** Whether `p` is close enough to the first point to close the outline. */
export function closesOn(points: Point[], p: Point, zoom: number): boolean {
  if (points.length < 3) return false
  const first = points[0]
  return Math.hypot(first.x - p.x, first.y - p.y) * zoom <= CLOSE_RADIUS
}

/** A point rounded to a whole map pixel. */
export const roundPoint = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) })

/**
 * The middle of every edge, where a new point can be put in: each with the
 * index it would take. A closed shape's closing edge is included.
 */
export function midpoints(points: Point[], closed: boolean): (Point & { index: number })[] {
  const out: (Point & { index: number })[] = []
  const n = points.length
  const edges = closed && n > 2 ? n : n - 1
  for (let i = 0; i < edges; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    out.push({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), index: i + 1 })
  }
  return out
}

/** How long an edge must be on screen to carry a middle handle: a corner's
 *  half, a middle's width and some air, so the two never overlap. */
export const MIN_EDGE = 24

/** Whether the edge ending at point `index` (as `midpoints` numbers it) is
 *  long enough on screen, at this zoom, for a handle in its middle. */
export function edgeLongEnough(points: Point[], index: number, zoom: number): boolean {
  const a = points[index - 1]
  const b = points[index % points.length]
  return Math.hypot(b.x - a.x, b.y - a.y) * zoom >= MIN_EDGE
}

/** The points with one more, at `index`. */
export function insertPoint(points: Point[], index: number, p: Point): Point[] {
  return [...points.slice(0, index), roundPoint(p), ...points.slice(index)]
}

/** The points without the one at `index`, or null if that would leave too
 *  few for the shape to be a shape. */
export function removePoint(points: Point[], index: number, kind: MapShapeKind): Point[] | null {
  if (points.length - 1 < MIN_POINTS[kind]) return null
  return points.filter((_, i) => i !== index)
}

/** The points with the one at `index` moved. */
export function movePoint(points: Point[], index: number, p: Point): Point[] {
  return points.map((q, i) => (i === index ? roundPoint(p) : q))
}

/** What a shape is, for a screen reader: its kind and how many points. */
export function describeShape(shape: Pick<MapShape, 'kind' | 'points'>): string {
  return `${KIND_NAME[shape.kind]}, ${shape.points.length} points`
}

/**
 * The order shapes are drawn in, bottom to top: land first, so the sea and
 * the coast sit under everything; areas over land; borders over both.
 */
export const DRAW_ORDER: MapShapeKind[] = ['land', 'area', 'border']
