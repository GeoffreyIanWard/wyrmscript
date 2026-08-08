import { TENSION_MAX, TENSION_MIN } from './plotGraph'

/**
 * F-35: reference dramatic shapes a writer can lay over their own plot
 * graph (F-03) to compare against a known pattern.
 *
 * The curves here are **authored from the plain prose descriptions of each
 * shape**, not traced from any published chart or dataset. "A protagonist
 * falls into trouble and climbs out better off" is generic narrative
 * theory, not anyone's copyrighted figure — so each preset below is a
 * handful of control points chosen to read as that shape, nothing more.
 *
 * Purely comparative: a preset is drawn on top and never written back to
 * `DocMeta.tension`. It is a reference, never the writer's data.
 */

export interface MasterPlot {
  id: string
  name: string
  /** One line explaining the shape, shown beside the picker. */
  blurb: string
  /**
   * Control points as `[position, tension]`, position 0–1 across the whole
   * story and tension on the same 0–10 scale as a real scene. Stored
   * normalized rather than per-scene because a preset is a fixed shape and
   * a manuscript has an arbitrary scene count — `sampleMasterPlot` stretches
   * it to whatever the writer actually has.
   */
  points: [number, number][]
}

export const MASTER_PLOTS: MasterPlot[] = [
  {
    id: 'man-in-a-hole',
    name: 'Man in a Hole',
    blurb: 'Trouble strikes, then is escaped — ending better off than the start.',
    points: [
      [0, 6],
      [0.35, 1],
      [0.6, 2],
      [1, 9]
    ]
  },
  {
    id: 'boy-meets-girl',
    name: 'Boy Meets Girl',
    blurb: 'Something good is found, then lost, then won back for good.',
    points: [
      [0, 5],
      [0.25, 9],
      [0.6, 1],
      [1, 10]
    ]
  },
  {
    id: 'rags-to-riches',
    name: 'Rags to Riches',
    blurb: 'A steady climb from a low start, never seriously reversed.',
    points: [
      [0, 1],
      [0.5, 5],
      [1, 10]
    ]
  },
  {
    id: 'icarus',
    name: 'Icarus',
    blurb: 'A rise to real height, then a fall that is not recovered from.',
    points: [
      [0, 4],
      [0.45, 10],
      [1, 1]
    ]
  },
  {
    id: 'freytag',
    name: "Freytag's Pyramid",
    blurb: 'Long rising action to a late climax, then a short fall to a close.',
    points: [
      [0, 2],
      [0.7, 10],
      [0.85, 5],
      [1, 3]
    ]
  }
]

export function findMasterPlot(id: string): MasterPlot | undefined {
  return MASTER_PLOTS.find((p) => p.id === id)
}

/**
 * Stretch a preset across `count` scenes, returning one tension value per
 * scene. A preset is a fixed shape and a manuscript has an arbitrary scene
 * count, so the shape is sampled by linear interpolation between its
 * control points rather than assuming any particular length.
 *
 * With a single scene there is no span to stretch across — the shape's
 * opening value is the only honest answer, since interpolating would
 * silently invent a position the writer's one scene does not have.
 */
export function sampleMasterPlot(plot: MasterPlot, count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [plot.points[0][1]]

  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const at = i / (count - 1)
    out.push(tensionAt(plot, at))
  }
  return out
}

/** The preset's tension at a normalized position, 0–1. */
function tensionAt(plot: MasterPlot, at: number): number {
  const pts = plot.points
  const clamped = Math.min(1, Math.max(0, at))

  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    if (clamped <= x1) {
      // A zero-width span would divide by zero; both endpoints describe the
      // same position, so either value is equally correct.
      if (x1 === x0) return y1
      const t = (clamped - x0) / (x1 - x0)
      return clamp(y0 + (y1 - y0) * t)
    }
  }
  return clamp(pts[pts.length - 1][1])
}

function clamp(value: number): number {
  return Math.min(TENSION_MAX, Math.max(TENSION_MIN, value))
}
