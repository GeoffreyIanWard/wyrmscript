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

/**
 * F-42: acts on the plot graph. Act is an attribute, not a container — a
 * scene says which act it falls in, the binder still orders the book — so
 * grouping is a reading of the scenes in timeline order: each run of
 * neighbouring scenes in one act is a band, and an act whose scenes are not
 * all together has a band for each run. A scene with no act is in none.
 */
export interface ActBand {
  act: string
  /** Index of the first and last scene of the run, in the order given. */
  from: number
  to: number
}

/** An act as written, trimmed; nothing for an empty one. */
const actOf = (act: string | undefined): string | undefined => act?.trim() || undefined

export function actBands(scenes: { act?: string }[]): ActBand[] {
  const bands: ActBand[] = []
  scenes.forEach((scene, i) => {
    const act = actOf(scene.act)
    if (!act) return
    const last = bands[bands.length - 1]
    if (last && last.act === act && last.to === i - 1) last.to = i
    else bands.push({ act, from: i, to: i })
  })
  return bands
}

/**
 * How many scenes are in each act, in the order the acts first come, and how
 * many have none — the heavy acts and the thin ones at a glance.
 */
export function actCounts(scenes: { act?: string }[]): {
  acts: { act: string; count: number }[]
  none: number
} {
  const counts = new Map<string, number>()
  let none = 0
  for (const scene of scenes) {
    const act = actOf(scene.act)
    if (act) counts.set(act, (counts.get(act) ?? 0) + 1)
    else none += 1
  }
  return { acts: [...counts].map(([act, count]) => ({ act, count })), none }
}

/** An act's name as a heading: "Act II" for a bare numeral or number, the
 *  writer's own words otherwise ("Prologue", "Act One"). */
export function actHeading(act: string): string {
  return /^([IVXLC]+|\d+)$/i.test(act) ? `Act ${act}` : act
}
