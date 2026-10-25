import type {
  MapBounds,
  MapMark,
  MapPin,
  MapScale,
  MapShape,
  MapShapeKind
} from '../../../shared/types'
import { markSizeOf } from '../../../shared/types'
import { formatDistance, scaleBar } from './mapScale'
import {
  isStamp,
  labelAnchor,
  STAMP_ART,
  STAMP_H,
  STAMP_SCALE,
  STAMP_W,
  stampNameAt
} from './mapMarks'
import { DRAW_ORDER, pathFor } from './mapShapes'
import { boundsOf } from './worldMap'
import type { Point } from './worldMap'

/**
 * F-12: the map as a picture for the book — a standalone SVG in two inks,
 * black on white, whatever palette the app is in. Pure, like the rest of the
 * map's maths: everything the screen gets from CSS is written out here as
 * attributes, because a picture leaves the app and takes no stylesheet with
 * it. The screen's tools (handles, the cursor, a route) never appear.
 *
 * Names are set in a book serif rather than the chrome's bitmap face: an SVG
 * drawn as an image loads no web fonts, and a map at the front of a novel is
 * lettered like the novel.
 */

const INK = '#000'
const PAPER = '#fff'
const FONT = "Georgia, 'Times New Roman', serif"

/** Room left round what is drawn when the picture is trimmed to it. */
export const TRIM_MARGIN = 48

/** The border's width: a double rule, as an engraved map is framed. */
const FRAME = 10

export interface MapPictureInput {
  /** The map's stored extent (`ProjectData.mapBounds`). */
  mapBounds: MapBounds | undefined
  shapes: MapShape[]
  marks: MapMark[]
  pins: MapPin[]
  /** A place's name, by its entry's id. */
  nameOf: (entityId: string) => string
  scale?: MapScale
}

export interface MapPictureOptions {
  /** The surveyor's grid. */
  grid: boolean
  /** Only what is drawn, with a margin, rather than the whole extent. */
  trim: boolean
  /** The scale bar, when there is a scale. */
  scaleBar: boolean
}

export const DEFAULT_PICTURE_OPTIONS: MapPictureOptions = {
  grid: false,
  trim: true,
  scaleBar: true
}

export interface MapPicture {
  svg: string
  /** The picture's size in map pixels: what the SVG is drawn at. */
  width: number
  height: number
}

/**
 * Every point the map's contents reach: a pin's point; a stamp's whole box
 * and the name under it; a label's rough box; every point of every shape.
 * The map widens to take these in, and a trimmed picture is cut to them.
 */
export function drawnExtent(pins: MapPin[], shapes: MapShape[], marks: MapMark[]): Point[] {
  return [
    // A place drawn as a stamp is a box, like a stamp (below); a pin, its point.
    ...pins.flatMap((p) => {
      if (!p.stamp) return [p]
      const size = markSizeOf(p.size)
      const w = STAMP_W * size
      const h = STAMP_H * size
      return [
        { x: p.x - w / 2, y: p.y - h / 2 },
        { x: p.x + w / 2, y: p.y + h / 2 + 16 }
      ]
    }),
    ...shapes.flatMap((s) => s.points),
    // A stamp's whole drawing and the name under it, not just its centre:
    // an XL castle at the corner was otherwise half off the map.
    ...marks.flatMap((m) => {
      const size = markSizeOf(m.size)
      const w = (isStamp(m.kind) ? STAMP_W : 120) * size
      const h = (isStamp(m.kind) ? STAMP_H : 20) * size
      return [
        { x: m.x - w / 2, y: m.y - h / 2 },
        { x: m.x + w / 2, y: m.y + h / 2 + (isStamp(m.kind) && m.name ? 16 : 0) }
      ]
    })
  ]
}

/** Whether there is anything on the map to make a picture of. */
export function mapHasDrawing(input: Pick<MapPictureInput, 'shapes' | 'marks' | 'pins'>): boolean {
  return input.shapes.length + input.marks.length + input.pins.length > 0
}

/** A name on the map as the picture letters it, in map pixels; `at` is the
 *  middle of the line. */
export interface Lettering {
  at: Point
  words: string
  size: number
  italic?: boolean
  /** Letter-spacing, in pixels. */
  spacing?: number
}

/**
 * Every name the picture letters, and where — as the screen letters them:
 * land and areas in spaced capitals at their middle; a river in italics above
 * its water; roads, railways and borders small, above the line; a stamp's
 * name under it; a free label large, italic and widely spaced; a place's name
 * under its ring, or under its stamp. In drawing order: features, marks,
 * places.
 */
export function lettering(input: MapPictureInput): Lettering[] {
  const out: Lettering[] = []
  for (const shape of input.shapes) {
    if (!shape.name) continue
    const at = labelAnchor(shape)
    if (shape.kind === 'land' || shape.kind === 'area')
      out.push({ at, words: shape.name.toUpperCase(), size: 11, spacing: 2.2 })
    else if (shape.kind === 'river')
      out.push({ at: { x: at.x, y: at.y - 11 }, words: shape.name, size: 11, italic: true })
    else out.push({ at: { x: at.x, y: at.y - 11 }, words: shape.name, size: 10 })
  }
  for (const mark of input.marks) {
    if (!mark.name) continue
    const size = markSizeOf(mark.size)
    if (isStamp(mark.kind)) {
      // The name's top sits under the stamp; the text is set by its middle.
      const n = stampNameAt(mark, size)
      out.push({ at: { x: n.x, y: n.y + 5 }, words: mark.name, size: 10 })
    } else {
      const fs = 14 * size
      out.push({
        at: mark,
        words: mark.name.toUpperCase(),
        size: fs,
        italic: true,
        spacing: fs * 0.35
      })
    }
  }
  for (const pin of input.pins) {
    const name = input.nameOf(pin.entityId)
    if (!name) continue
    const n = pin.stamp ? stampNameAt(pin, markSizeOf(pin.size)) : { x: pin.x, y: pin.y + 6 }
    out.push({ at: { x: n.x, y: n.y + 5 }, words: name, size: 10 })
  }
  return out
}

/**
 * About how wide a line of lettering is drawn: a serif's capitals run near
 * three-quarters of an em, its lower case near three-fifths, and spacing is
 * added after every letter. An estimate on the generous side — it decides how
 * much room a trimmed picture leaves, and too little cuts a name in half.
 */
export function letteringWidth(l: Lettering): number {
  const caps = l.words === l.words.toUpperCase()
  return l.words.length * (l.size * (caps ? 0.75 : 0.6) + (l.spacing ?? 0))
}

/** The corners of each name's box. */
function letteringExtent(input: MapPictureInput): Point[] {
  return lettering(input).flatMap((l) => {
    const w = letteringWidth(l) / 2
    const h = l.size / 2 + 2
    return [
      { x: l.at.x - w, y: l.at.y - h },
      { x: l.at.x + w, y: l.at.y + h }
    ]
  })
}

/**
 * The part of the map the picture shows, in map pixels: the whole extent, or
 * what is drawn — and every name lettered on it, whole — with a margin round
 * it, never more than the extent, so a trimmed picture of a full map is the
 * whole map.
 */
export function pictureFrame(input: MapPictureInput, trim: boolean): MapBounds {
  const drawn = drawnExtent(input.pins, input.shapes, input.marks)
  const whole = boundsOf(input.mapBounds, drawn)
  if (!trim || drawn.length === 0) return whole
  const points = [...drawn, ...letteringExtent(input)]
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x0 = Math.max(whole.x, Math.floor(Math.min(...xs) - TRIM_MARGIN))
  const y0 = Math.max(whole.y, Math.floor(Math.min(...ys) - TRIM_MARGIN))
  const x1 = Math.min(whole.x + whole.width, Math.ceil(Math.max(...xs) + TRIM_MARGIN))
  const y1 = Math.min(whole.y + whole.height, Math.ceil(Math.max(...ys) + TRIM_MARGIN))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A number for an attribute, to a tenth. */
const n1 = (v: number): number => Math.round(v * 10) / 10

/** How each kind of shape is drawn: the screen's `.map-shape.<kind>` rules. */
const SHAPE_STYLE: Record<MapShapeKind, string> = {
  land: `fill="${PAPER}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"`,
  area: `fill="url(#HATCH)" stroke="${INK}" stroke-width="1.5" stroke-dasharray="6 3"`,
  border: `fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="12 4 2 4"`,
  river: `fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`,
  road: `fill="none" stroke="${PAPER}" stroke-width="3" stroke-linejoin="round"`,
  rail: `fill="none" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"`
}

/**
 * A line of lettering: ink with a paper halo, so a name reads over hatching,
 * sea dots and roads alike — the screen's text-shadow, as a stroke drawn
 * under the fill.
 */
function text(
  at: Point,
  words: string,
  { size, italic = false, spacing = 0 }: { size: number; italic?: boolean; spacing?: number }
): string {
  return (
    `<text x="${n1(at.x)}" y="${n1(at.y)}" font-family="${FONT}" font-size="${size}"` +
    `${italic ? ' font-style="italic"' : ''}${spacing ? ` letter-spacing="${n1(spacing)}"` : ''}` +
    ` text-anchor="middle" dominant-baseline="central" fill="${INK}" stroke="${PAPER}"` +
    ` stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(words)}</text>`
  )
}

/** A stamp's art, centred on `at`. */
function stamp(kind: keyof typeof STAMP_ART, at: Point, size: number): string {
  const art = STAMP_ART[kind]
  const w = STAMP_W * size
  const h = STAMP_H * size
  return (
    `<g transform="translate(${n1(at.x - w / 2)} ${n1(at.y - h / 2)}) scale(${n1(STAMP_SCALE * size * 100) / 100})">` +
    (art.body
      ? `<path d="${art.body}" fill="${PAPER}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>`
      : '') +
    `<path d="${art.lines}" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>` +
    (art.solid ? `<path d="${art.solid}" fill="${INK}"/>` : '') +
    `</g>`
  )
}

/**
 * The map as a standalone SVG: the sea, the grid if asked for, every shape
 * in drawing order (all road casings before any road, or junctions close),
 * stamps, places, names, the scale bar, and a double-ruled border.
 */
export function mapPictureSvg(
  input: MapPictureInput,
  options: MapPictureOptions,
  /** Put before the patterns' ids: several pictures drawn into one page (the
   *  board's minimap cards) must not share ids, or one card's sea would be
   *  painted with another's pattern, and with none once that card goes. */
  idPrefix = ''
): MapPicture {
  const id = (name: string): string => `${idPrefix}${name}`
  const frame = pictureFrame(input, options.trim)
  // Drawn at the frame's size with a border round it.
  const width = frame.width + FRAME * 2
  const height = frame.height + FRAME * 2
  const origin = { x: frame.x - FRAME, y: frame.y - FRAME }
  const parts: string[] = []

  // The grid lines fall where they fall on the map: every hundred map pixels.
  const gx = (((-origin.x % 100) + 100) % 100).toString()
  const gy = (((-origin.y % 100) + 100) % 100).toString()
  parts.push(
    `<defs>` +
      `<pattern id="${id('sea')}" width="6" height="6" patternUnits="userSpaceOnUse">` +
      `<rect x="0" y="0" width="1" height="1" fill="${INK}"/><rect x="3" y="3" width="1" height="1" fill="${INK}"/>` +
      `</pattern>` +
      `<pattern id="${id('hatch')}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<path d="M 0 0 V 8" stroke="${INK}" stroke-width="1"/>` +
      `</pattern>` +
      `<pattern id="${id('grid')}" width="100" height="100" patternUnits="userSpaceOnUse" x="${gx}" y="${gy}">` +
      `<path d="M 0 0 H 100 M 0 0 V 100" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="1 5"/>` +
      `</pattern>` +
      `</defs>`
  )
  parts.push(`<rect width="${width}" height="${height}" fill="${PAPER}"/>`)
  parts.push(`<rect width="${width}" height="${height}" fill="url(#${id('sea')})"/>`)
  if (options.grid)
    parts.push(`<rect width="${width}" height="${height}" fill="url(#${id('grid')})"/>`)

  for (const kind of DRAW_ORDER) {
    const ofKind = input.shapes.filter((s) => s.kind === kind)
    if (kind === 'road') {
      for (const s of ofKind)
        parts.push(
          `<path d="${pathFor(kind, s.points, origin)}" fill="none" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`
        )
    }
    for (const s of ofKind) {
      const d = pathFor(kind, s.points, origin)
      // The coast's ripple: a dotted halo under the land, whose fill hides
      // the inner half, leaving hachures offshore.
      if (kind === 'land')
        parts.push(
          `<path d="${d}" fill="none" stroke="${INK}" stroke-width="12" stroke-dasharray="1 3" stroke-linecap="butt" stroke-linejoin="miter"/>`
        )
      parts.push(`<path d="${d}" ${SHAPE_STYLE[kind].replace('#HATCH', `#${id('hatch')}`)}/>`)
      if (kind === 'rail')
        parts.push(
          `<path d="${d}" fill="none" stroke="${INK}" stroke-width="7" stroke-dasharray="1.5 5" stroke-linecap="butt"/>`
        )
    }
  }

  const shift = (p: Point): Point => ({ x: p.x - origin.x, y: p.y - origin.y })
  for (const mark of input.marks)
    if (isStamp(mark.kind)) parts.push(stamp(mark.kind, shift(mark), markSizeOf(mark.size)))

  // Places: a stamp where the writer drew one as a stamp; otherwise the
  // engraver's ring-and-dot.
  for (const pin of input.pins) {
    const at = shift(pin)
    if (pin.stamp) parts.push(stamp(pin.stamp, at, markSizeOf(pin.size)))
    else
      parts.push(
        `<circle cx="${n1(at.x)}" cy="${n1(at.y)}" r="3.5" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/>` +
          `<circle cx="${n1(at.x)}" cy="${n1(at.y)}" r="1.3" fill="${INK}"/>`
      )
  }

  // Names over everything drawn, so no stamp or road covers one.
  for (const l of lettering(input)) parts.push(text(shift(l.at), l.words, l))

  // The scale bar, in the corner, sized to fit the picture it sits in: a
  // small picture gets a shorter round length, and one too small for any
  // goes without rather than have the bar run off its edge.
  const room = width - FRAME * 2 - 48
  const bar =
    options.scaleBar && input.scale && room >= 24
      ? [Math.min(120, room * 0.8), room * 0.5]
          .map((target) => scaleBar(input.scale!, 1, target))
          .find((b) => b.screen <= room)
      : undefined
  if (bar && input.scale) {
    const x = FRAME + 16
    const y = height - FRAME - 30
    const half = bar.screen / 2
    parts.push(
      `<g>` +
        `<rect x="${x}" y="${y - 2}" width="${n1(bar.screen) + 16}" height="30" fill="${PAPER}"/>` +
        `<rect x="${x + 8}" y="${y + 4}" width="${n1(half)}" height="4" fill="${INK}" stroke="${INK}" stroke-width="1"/>` +
        `<rect x="${n1(x + 8 + half)}" y="${y + 4}" width="${n1(half)}" height="4" fill="${PAPER}" stroke="${INK}" stroke-width="1"/>` +
        text(
          { x: x + 8 + bar.screen / 2, y: y + 18 },
          formatDistance(bar.units, input.scale.unit),
          { size: 10 }
        ) +
        `</g>`
    )
  }

  // The border: a heavy outer rule and a fine inner one, with paper between.
  parts.push(
    `<rect x="0" y="0" width="${width}" height="${FRAME}" fill="${PAPER}"/>` +
      `<rect x="0" y="${height - FRAME}" width="${width}" height="${FRAME}" fill="${PAPER}"/>` +
      `<rect x="0" y="0" width="${FRAME}" height="${height}" fill="${PAPER}"/>` +
      `<rect x="${width - FRAME}" y="0" width="${FRAME}" height="${height}" fill="${PAPER}"/>` +
      `<rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" fill="none" stroke="${INK}" stroke-width="3"/>` +
      `<rect x="${FRAME - 0.5}" y="${FRAME - 0.5}" width="${width - FRAME * 2 + 1}" height="${height - FRAME * 2 + 1}" fill="none" stroke="${INK}" stroke-width="1"/>`
  )

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    parts.join('') +
    `</svg>`
  return { svg, width, height }
}

/** The longest side, in pixels, a PNG of the map is drawn at: print quality
 *  for a page, without a canvas the size of a wall. */
export const PNG_LONG_SIDE = 4800

/** How many PNG pixels to a map pixel: up to three, as long as the long side
 *  stays within `PNG_LONG_SIDE`. */
export function pngRatio(width: number, height: number): number {
  return Math.min(3, PNG_LONG_SIDE / Math.max(width, height, 1))
}

/**
 * The picture as PNG bytes, by drawing the SVG on a canvas. Browser-only (a
 * canvas and an image decoder), so it is kept apart from the pure writer.
 */
export async function mapPicturePng(picture: MapPicture): Promise<Uint8Array> {
  const ratio = pngRatio(picture.width, picture.height)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(picture.width * ratio)
  canvas.height = Math.round(picture.height * ratio)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The map could not be drawn as a picture.')
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The map could not be drawn as a picture.')
  return new Uint8Array(await blob.arrayBuffer())
}

/** The PNG's size in pixels, which the .docx needs to lay the picture out. */
export function pngSize(picture: MapPicture): { width: number; height: number } {
  const ratio = pngRatio(picture.width, picture.height)
  return { width: Math.round(picture.width * ratio), height: Math.round(picture.height * ratio) }
}
