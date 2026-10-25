import type { MapScale } from '../../../shared/types'
import type { Point } from './worldMap'

/**
 * F-12: distance and travel on the map. Pure, like the rest of the map's
 * maths: the map is measured in map pixels, and a scale says what those are
 * in the story's own units. "How long does this journey take?" is a real
 * plotting question, and the map can answer it.
 */

/** A day's travel, in miles, before the writer says otherwise: an ordinary
 *  walking day, a riding day, a day under sail. */
export const DEFAULT_PER_DAY = { foot: 20, horse: 40, ship: 100 }

/** The scale offered before one is set: 100 map pixels to 20 miles. */
export const DEFAULT_SCALE: MapScale = {
  pixels: 100,
  distance: 20,
  unit: 'miles',
  perDay: DEFAULT_PER_DAY
}

/** The ways of travelling, in the order they are told. */
export const MODES = [
  { key: 'foot', name: 'on foot' },
  { key: 'horse', name: 'on horseback' },
  { key: 'ship', name: 'by ship' }
] as const

/** The length of a route through these points, in map pixels. */
export function routeLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return total
}

/** Map pixels as the scale's units. */
export function toUnits(pixels: number, scale: MapScale): number {
  return (pixels / scale.pixels) * scale.distance
}

/**
 * Whether a stored scale is usable: an object with a unit and a positive,
 * finite number in every place. Total — it takes anything, because a scale
 * comes from project.json, which a hand edit, another build or a sync merge
 * can leave half-formed; one that is not usable counts as no scale, rather
 * than crashing the map that would offer to set it again.
 */
export function validScale(scale: unknown): scale is MapScale {
  if (!scale || typeof scale !== 'object') return false
  const s = scale as Partial<MapScale>
  if (typeof s.unit !== 'string' || s.unit.trim() === '') return false
  const days = s.perDay as Partial<MapScale['perDay']> | undefined
  if (!days || typeof days !== 'object') return false
  return [s.pixels, s.distance, days.foot, days.horse, days.ship].every(
    (n) => typeof n === 'number' && Number.isFinite(n) && n > 0
  )
}

/**
 * A distance as a writer reads it: whole from ten up, two significant
 * figures below — so a town plan's 0.05 miles reads 0.05, never rounded to
 * 0.1 or to nothing.
 */
export function formatDistance(units: number, unit: string): string {
  const n = units >= 10 ? Math.round(units) : Number(units.toPrecision(2))
  return `${n.toLocaleString('en', { maximumFractionDigits: 6 })} ${unit}`
}

/**
 * Days of travel as a writer would say them: to the nearest half day, and
 * "under a day" below one — no one plots a journey to the hour.
 */
export function formatDays(days: number): string {
  if (!Number.isFinite(days) || days < 1) return 'under a day'
  const halves = Math.round(days * 2)
  const whole = Math.floor(halves / 2)
  const half = halves % 2 === 1 ? '½' : ''
  return `${whole.toLocaleString('en')}${half} ${whole === 1 && !half ? 'day' : 'days'}`
}

/** The route told in full: its length, and the time each way of travelling
 *  takes over it. */
export function describeRoute(pixels: number, scale: MapScale): string {
  const units = toUnits(pixels, scale)
  const times = MODES.map((m) => `${m.name} ${formatDays(units / scale.perDay[m.key])}`)
  return `${formatDistance(units, scale.unit)} — ${times.join(', ')}`
}

/**
 * The scale bar: a round length in the scale's units (1, 2 or 5 times a
 * power of ten) that draws close to `target` screen pixels at this zoom.
 */
export function scaleBar(
  scale: MapScale,
  zoom: number,
  target = 120
): { units: number; screen: number } {
  const unitsPerScreenPx = scale.distance / (scale.pixels * zoom)
  const want = target * unitsPerScreenPx
  const power = 10 ** Math.floor(Math.log10(want))
  const steps = [1, 2, 5, 10].map((k) => k * power)
  const units = steps.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best))
  return { units, screen: units / unitsPerScreenPx }
}
