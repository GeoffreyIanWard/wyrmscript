/**
 * F-03: the plot graph. Tension is manual only — set by dragging a scene's
 * node — never derived from anything, so this is just the bounds/rounding
 * for that one number, not a scoring model.
 */

export const TENSION_MIN = 0
export const TENSION_MAX = 10

/** Where an untouched scene's node starts — the middle of the range reads
 *  as neutral, rather than implying "no tension yet" at either extreme. */
export const DEFAULT_TENSION = 5

/** A dragged node lands on a whole number, 0–10. */
export function clampTension(value: number): number {
  return Math.min(TENSION_MAX, Math.max(TENSION_MIN, Math.round(value)))
}
