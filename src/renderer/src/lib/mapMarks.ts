import type { MapMarkKind, MapShape, MapStampKind } from '../../../shared/types'
import { isClosedShape } from '../../../shared/types'
import type { Point } from './worldMap'

/**
 * F-12 part 4: the map's marks — stamps and labels — and where names go.
 * Pure, like the rest of the map's maths.
 *
 * The stamps are drawn the way an engraved map draws them: an outline in
 * ink over paper, shaded with ink lines rather than a tint, so they are two
 * colours in every palette. Each is shown in a STAMP_W × STAMP_H box whose
 * middle is the point the writer clicked.
 */

/** The art is drawn on a 24 × 20 grid and shown half as large again: at
 *  the grid's own size a mountain was a speck beside its name. */
export const STAMP_SCALE = 1.5
export const STAMP_W = 24 * STAMP_SCALE
export const STAMP_H = 20 * STAMP_SCALE

/** What each mark is called, to the writer and to a screen reader. */
export const MARK_NAME: Record<MapMarkKind, string> = {
  mountain: 'Mountain',
  hills: 'Hills',
  forest: 'Forest',
  marsh: 'Marsh',
  town: 'Town',
  label: 'Label'
}

/**
 * A stamp's art: `body` is outlined in ink and filled with paper (so a stamp
 * over the sea or a road is not see-through); `lines` is ink only, the
 * shading and detail; `solid` is filled with ink.
 */
export interface StampArt {
  body: string
  lines: string
  solid?: string
}

export const STAMP_ART: Record<MapStampKind, StampArt> = {
  // Two peaks, the near one hachured down its shadowed flank.
  mountain: {
    body: 'M 11 18 L 17 7 L 23 18 Z M 1 18 L 9 3 L 17 18 Z',
    lines: 'M 9 3 L 11 18 M 10.5 7 L 13 18 M 12 10.5 L 15 18 M 18.5 10 L 20 18'
  },
  // Two soft humps with a stroke of shade under each crest.
  hills: {
    body: 'M 1 17 Q 7 7 13 17 Z M 9 17 Q 16 5 23 17 Z',
    lines: 'M 9 13 Q 10 15 11 17 M 18 11 Q 19.5 14 20.5 17'
  },
  // Three round-topped trees on trunks, the back one taller.
  forest: {
    body: 'M 9.5 6 A 3.5 3.5 0 1 1 9.49 6 Z M 15.5 3 A 3.5 3.5 0 1 1 15.49 3 Z M 21.5 6 A 3.5 3.5 0 1 1 21.49 6 Z',
    lines: 'M 6 13 V 18 M 12 10 V 18 M 18 13 V 18 M 4 18 H 20'
  },
  // Reed tufts over broken water lines.
  marsh: {
    body: '',
    lines:
      'M 5 13 V 7 M 3 13 L 4 9 M 7 13 L 6 9 ' +
      'M 13 12 V 5 M 11 12 L 12 8 M 15 12 L 14 8 ' +
      'M 20 13 V 8 M 18 13 L 19 10 M 22 13 L 21 10 ' +
      'M 1 15 H 9 M 11 15 H 17 M 19 15 H 24 M 4 18 H 12 M 14 18 H 21'
  },
  // Two houses and a church spire.
  town: {
    body: 'M 2 18 V 11 L 6 7 L 10 11 V 18 Z M 10 18 V 9 L 14 5 L 18 9 V 18 Z M 18 18 V 10 H 22 V 18 Z',
    lines: 'M 20 10 V 3 M 18.5 4.5 H 21.5',
    solid: 'M 5 14 H 7 V 18 H 5 Z M 13 12 H 15 V 14 H 13 Z'
  }
}

/** The kinds that are stamps, in the toolbar's order. */
export const STAMP_ORDER: MapStampKind[] = ['mountain', 'hills', 'forest', 'marsh', 'town']

export const isStamp = (kind: MapMarkKind): kind is MapStampKind => kind !== 'label'

/** Where a stamp's name sits: centred just under the stamp. */
export function stampNameAt(at: Point): Point {
  return { x: at.x, y: at.y + STAMP_H / 2 + 2 }
}

/**
 * Where a shape's name goes. An outline is named at its middle (the centroid
 * of its area, so a long crescent of coast is named inside the land rather
 * than at the average of its points, which can fall in the sea). A line is
 * named halfway along it.
 */
export function labelAnchor(shape: Pick<MapShape, 'kind' | 'points'>): Point {
  const pts = shape.points
  if (pts.length === 0) return { x: 0, y: 0 }
  if (isClosedShape(shape.kind) && pts.length > 2) {
    let area = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const cross = a.x * b.y - b.x * a.y
      area += cross
      cx += (a.x + b.x) * cross
      cy += (a.y + b.y) * cross
    }
    // A shape with no area (every point on one line) has no centroid.
    if (Math.abs(area) > 1e-9)
      return { x: Math.round(cx / (3 * area)), y: Math.round(cy / (3 * area)) }
    return average(pts)
  }
  return alongHalfway(pts)
}

function average(pts: Point[]): Point {
  const sum = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 })
  return { x: Math.round(sum.x / pts.length), y: Math.round(sum.y / pts.length) }
}

/** The point halfway along a line, by its length, not by its points. */
function alongHalfway(pts: Point[]): Point {
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
  const total = lengths.reduce((s, l) => s + l, 0)
  if (total === 0) return { ...pts[0] }
  let left = total / 2
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : left / lengths[i]
      const a = pts[i]
      const b = pts[i + 1]
      return { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) }
    }
    left -= lengths[i]
  }
  return { ...pts[pts.length - 1] }
}

/** What a mark is, for a screen reader. */
export function describeMark(kind: MapMarkKind, name?: string): string {
  if (kind === 'label') return `Label “${name ?? ''}”`
  return name ? `${MARK_NAME[kind]}, “${name}”` : MARK_NAME[kind]
}
