// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  CompileBlock,
  CompileOptions,
  Entity,
  MapMark,
  MapPin,
  MapScale,
  MapShape,
  ProjectInfo
} from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { api } from '../src/renderer/src/lib/api'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import { CompileDialog } from '../src/renderer/src/components/CompileDialog'
import {
  DEFAULT_PICTURE_OPTIONS,
  drawnExtent,
  lettering,
  letteringWidth,
  mapHasDrawing,
  mapPictureSvg,
  pictureFrame,
  pngRatio,
  PNG_LONG_SIDE,
  TRIM_MARGIN
} from '../src/renderer/src/lib/mapPicture'
import type { MapPictureInput } from '../src/renderer/src/lib/mapPicture'
// jsdom draws no canvas: a PNG stands in for the drawn picture.
vi.mock('../src/renderer/src/lib/mapPicture', async (actual) => ({
  ...(await actual<typeof import('../src/renderer/src/lib/mapPicture')>()),
  mapPicturePng: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])
}))
import {
  buildBlocks,
  DEFAULT_COMPILE_OPTIONS,
  renderHtml,
  renderText
} from '../src/renderer/src/lib/compile'
import { docxBytes } from '../src/renderer/src/lib/docx'
import { STAMP_ART, stampNameAt } from '../src/renderer/src/lib/mapMarks'

/**
 * F-12: the map for the book — Export Map Image, and the map at the front of
 * a compiled .docx or PDF. The picture is a standalone SVG in two inks with
 * every style written out, since it leaves the app and takes no stylesheet.
 */

const at = '2026-01-01T00:00:00.000Z'
const shape = (
  id: string,
  kind: MapShape['kind'],
  points: MapShape['points'],
  name?: string
): MapShape => ({
  id,
  kind,
  points,
  ...(name ? { name } : {}),
  created: at,
  modified: at
})
const mark = (
  id: string,
  kind: MapMark['kind'],
  x: number,
  y: number,
  extra: Partial<MapMark> = {}
): MapMark => ({
  id,
  kind,
  x,
  y,
  created: at,
  modified: at,
  ...extra
})
const pin = (
  id: string,
  entityId: string,
  x: number,
  y: number,
  extra: Partial<MapPin> = {}
): MapPin => ({
  id,
  entityId,
  x,
  y,
  created: at,
  modified: at,
  ...extra
})

const island = shape(
  's1',
  'land',
  [
    { x: 400, y: 400 },
    { x: 700, y: 400 },
    { x: 700, y: 600 },
    { x: 400, y: 600 }
  ],
  'Ash & Oak <Isle>'
)

function input(extra: Partial<MapPictureInput> = {}): MapPictureInput {
  return {
    mapBounds: undefined,
    shapes: [island],
    marks: [],
    pins: [],
    nameOf: () => '',
    ...extra
  }
}

const scale: MapScale = {
  pixels: 100,
  distance: 20,
  unit: 'miles',
  perDay: { foot: 20, horse: 40, ship: 100 }
}

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml')
}

describe('the picture', () => {
  it('is a well-formed standalone SVG, with names escaped', () => {
    const { svg } = mapPictureSvg(input(), DEFAULT_PICTURE_OPTIONS)
    const doc = parse(svg)
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.documentElement.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    // Land is lettered in capitals, as on the screen.
    expect([...doc.querySelectorAll('text')].map((t) => t.textContent)).toContain(
      'ASH & OAK <ISLE>'
    )
  })

  it('is two inks, with no stylesheet, class or palette variable to lose', () => {
    const { svg } = mapPictureSvg(
      input({
        shapes: [
          island,
          shape('s2', 'road', [
            { x: 410, y: 410 },
            { x: 690, y: 590 }
          ]),
          shape('s3', 'area', [
            { x: 420, y: 420 },
            { x: 500, y: 420 },
            { x: 500, y: 500 }
          ]),
          shape('s4', 'rail', [
            { x: 420, y: 580 },
            { x: 680, y: 580 }
          ])
        ],
        marks: [
          mark('m1', 'castle', 500, 500, { name: 'Keep' }),
          mark('m2', 'label', 550, 450, { name: 'Sea' })
        ],
        pins: [pin('p1', 'e1', 600, 500)],
        nameOf: () => 'Harrowgate',
        scale
      }),
      { grid: true, trim: true, scaleBar: true }
    )
    expect(svg).not.toMatch(/var\(|class=|<style/)
    const colours = new Set([...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]))
    for (const c of colours)
      expect(['#000', '#fff', 'none', 'url(#sea)', 'url(#hatch)', 'url(#grid)']).toContain(c)
  })

  it('draws every road casing before any road, so junctions stay open', () => {
    const { svg } = mapPictureSvg(
      input({
        shapes: [
          shape('r1', 'road', [
            { x: 410, y: 410 },
            { x: 690, y: 590 }
          ]),
          shape('r2', 'road', [
            { x: 410, y: 590 },
            { x: 690, y: 410 }
          ])
        ]
      }),
      DEFAULT_PICTURE_OPTIONS
    )
    const strokes = [...svg.matchAll(/<path [^>]*stroke-width="(6|3)"/g)].map((m) => m[1])
    expect(strokes).toEqual(['6', '6', '3', '3'])
  })

  it('draws the grid and the scale bar only when asked, and the bar only with a scale', () => {
    const plain = mapPictureSvg(input({ scale }), { grid: false, trim: true, scaleBar: false }).svg
    expect(plain).not.toContain('url(#grid)')
    expect(plain).not.toContain('miles')
    const full = mapPictureSvg(input({ scale }), { grid: true, trim: true, scaleBar: true }).svg
    expect(full).toContain('fill="url(#grid)"')
    expect(full).toContain('>20 miles<')
    expect(mapPictureSvg(input(), { grid: false, trim: true, scaleBar: true }).svg).not.toContain(
      'miles'
    )
  })

  it('names places, and draws a place shown as a stamp as its stamp', () => {
    const names: Record<string, string> = { e1: 'Harrowgate', e2: 'Fenwick' }
    const { svg } = mapPictureSvg(
      input({
        pins: [pin('p1', 'e1', 500, 500), pin('p2', 'e2', 600, 500, { stamp: 'castle' })],
        nameOf: (id) => names[id]
      }),
      DEFAULT_PICTURE_OPTIONS
    )
    const doc = parse(svg)
    const words = [...doc.querySelectorAll('text')].map((t) => t.textContent)
    expect(words).toEqual(expect.arrayContaining(['Harrowgate', 'Fenwick']))
    // A pin is a ring and a dot; a stamped place has no ring, but its stamp.
    expect(doc.querySelectorAll('circle')).toHaveLength(2)
    const stamps = [...doc.querySelectorAll('g[transform^="translate("]')]
    expect(stamps).toHaveLength(1)
    expect(stamps[0].querySelectorAll('path')[1].getAttribute('d')).toBe(STAMP_ART.castle.lines)
    // Each name under what it names: the ring's below its point, the
    // stamp's below the stamp (origin: 400 - 48 - 10 on each side).
    const origin = 400 - TRIM_MARGIN - 10
    const y = (word: string): number =>
      Number(
        [...doc.querySelectorAll('text')].find((t) => t.textContent === word)!.getAttribute('y')
      )
    expect(y('Harrowgate')).toBe(500 + 11 - origin)
    expect(y('Fenwick')).toBe(stampNameAt({ x: 600, y: 500 }).y + 5 - origin)
  })

  it('letters marks’ names over everything drawn, a label in spaced italic capitals', () => {
    const { svg } = mapPictureSvg(
      input({
        shapes: [
          island,
          shape('r', 'road', [
            { x: 410, y: 410 },
            { x: 690, y: 590 }
          ])
        ],
        marks: [
          mark('m1', 'castle', 500, 500, { name: 'Keep' }),
          mark('m2', 'label', 550, 450, { name: 'Sea' })
        ]
      }),
      DEFAULT_PICTURE_OPTIONS
    )
    const texts = [...parse(svg).querySelectorAll('text')]
    expect(texts.map((t) => t.textContent)).toEqual(['ASH & OAK <ISLE>', 'Keep', 'SEA'])
    const sea = texts[2]
    expect(sea.getAttribute('font-style')).toBe('italic')
    expect(sea.getAttribute('letter-spacing')).toBe('4.9')
    // Every name after the last stamp and the last road, so none is covered.
    expect(svg.indexOf('<text')).toBeGreaterThan(svg.lastIndexOf('<g transform="translate('))
    expect(svg.indexOf('<text')).toBeGreaterThan(
      svg.lastIndexOf('fill="none" stroke="#fff" stroke-width="3"')
    )
  })

  it('lines its grid up with the map’s hundreds, wherever the picture starts', () => {
    const grid = (i: MapPictureInput, trim: boolean): Element =>
      parse(mapPictureSvg(i, { grid: true, trim, scaleBar: false }).svg).querySelector(
        'pattern#grid'
      )!
    // Trimmed: the picture starts at 400 - 48 - 10 = 342, so lines at 58.
    expect(grid(input(), true).getAttribute('x')).toBe('58')
    expect(grid(input(), true).getAttribute('y')).toBe('58')
    // A map grown west: it starts at -150 - 10 = -160, so lines at 60.
    const west = input({ mapBounds: { x: -150, y: 0, width: 1000, height: 800 } })
    expect(grid(west, false).getAttribute('x')).toBe('60')
    expect(grid(west, false).getAttribute('y')).toBe('10')
  })

  it('leaves room for a long name at the edge of what is drawn', () => {
    // A sea's name and a place's name each wider than the margin.
    const sea = mark('m', 'label', 700, 500, { name: 'The Sundering Sea' })
    const place = pin('p', 'e', 400, 600)
    const i = input({ marks: [sea], pins: [place], nameOf: () => 'Harrowgate-under-Wychwood' })
    const frame = pictureFrame(i, true)
    for (const l of lettering(i)) {
      const half = letteringWidth(l) / 2
      expect(l.at.x - half).toBeGreaterThanOrEqual(frame.x)
      expect(l.at.x + half).toBeLessThanOrEqual(frame.x + frame.width)
    }
    // The estimate is not short of the real thing: 17 capitals at 14px and
    // 4.9px spacing are some 240px in a serif.
    expect(
      letteringWidth(lettering(i).find((l) => l.words === 'THE SUNDERING SEA')!)
    ).toBeGreaterThanOrEqual(240)
  })

  it('fits the scale bar inside a small picture', () => {
    const one = input({ shapes: [], pins: [pin('p', 'e', 500, 500)], nameOf: () => 'X', scale })
    const pic = mapPictureSvg(one, DEFAULT_PICTURE_OPTIONS)
    const rects = [...parse(pic.svg).querySelectorAll('g > rect')]
    expect(rects.length).toBeGreaterThan(0)
    for (const r of rects)
      expect(Number(r.getAttribute('x')) + Number(r.getAttribute('width'))).toBeLessThanOrEqual(
        pic.width - 10
      )
    // Still a round length, just a shorter one.
    expect(pic.svg).toMatch(/>(1|2|5|10|20|50) miles</)
    // A scale whose nearest round length overshoots the room (the picture is
    // 124px wide, the room 56px, and 5 miles would be 61px): the next one
    // down, keeping 16px clear of the inner rule.
    const awkward = mapPictureSvg(
      { ...one, scale: { ...scale, distance: 8.25 } },
      DEFAULT_PICTURE_OPTIONS
    )
    const box = parse(awkward.svg).querySelector('g > rect')!
    expect(Number(box.getAttribute('x')) + Number(box.getAttribute('width'))).toBeLessThanOrEqual(
      awkward.width - 10 - 16
    )
  })

  it('is cut to what is drawn with a margin, or shows the whole map', () => {
    const trimmed = pictureFrame(input(), true)
    expect(trimmed).toEqual({
      x: 400 - TRIM_MARGIN,
      y: 400 - TRIM_MARGIN,
      width: 300 + 2 * TRIM_MARGIN,
      height: 200 + 2 * TRIM_MARGIN
    })
    // The whole map: the stored extent, widened to take in what is drawn.
    expect(
      pictureFrame(input({ mapBounds: { x: 0, y: 0, width: 800, height: 700 } }), false)
    ).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 700
    })
    // Never past the map's own edge: land at the corner is not given sea
    // that the map does not have.
    const corner = pictureFrame(
      input({
        mapBounds: { x: 0, y: 0, width: 800, height: 700 },
        shapes: [
          shape('c', 'land', [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 }
          ])
        ]
      }),
      true
    )
    expect(corner.x).toBe(0)
    expect(corner.y).toBe(0)
    // Nor past its far edges.
    const far = pictureFrame(
      input({
        mapBounds: { x: 0, y: 0, width: 800, height: 700 },
        shapes: [
          shape('c', 'land', [
            { x: 700, y: 600 },
            { x: 800, y: 600 },
            { x: 800, y: 700 }
          ])
        ]
      }),
      true
    )
    expect(far.x + far.width).toBe(800)
    expect(far.y + far.height).toBe(700)
    // The picture is the frame with its border round it.
    const pic = mapPictureSvg(input(), DEFAULT_PICTURE_OPTIONS)
    expect(pic.width).toBe(trimmed.width + 20)
    expect(pic.height).toBe(trimmed.height + 20)
  })

  it('reaches as far as a stamp and its name, not only its middle', () => {
    const maxY = (points: { y: number }[]): number => Math.max(...points.map((p) => p.y))
    const minX = (points: { x: number }[]): number => Math.min(...points.map((p) => p.x))
    // Half the stamp's height (30 × 2.2 / 2) and the name under it.
    const named = drawnExtent([], [], [mark('m', 'castle', 100, 100, { name: 'Keep', size: 2.2 })])
    expect(maxY(named)).toBeCloseTo(100 + 33 + 16)
    expect(maxY(drawnExtent([], [], [mark('m', 'castle', 100, 100, { size: 2.2 })]))).toBeCloseTo(
      133
    )
    // A place drawn as a stamp is a stamp's box with its name under it.
    const stamped = drawnExtent([pin('p', 'e', 100, 100, { stamp: 'castle', size: 2.2 })], [], [])
    expect(maxY(stamped)).toBeCloseTo(149)
    expect(minX(stamped)).toBeCloseTo(100 - (36 * 2.2) / 2)
    expect(mapHasDrawing({ shapes: [], marks: [], pins: [] })).toBe(false)
  })

  it('is drawn as a PNG at up to three times, and never longer than the cap', () => {
    expect(pngRatio(800, 600)).toBe(3)
    expect(pngRatio(4000, 1000)).toBe(PNG_LONG_SIDE / 4000)
  })
})

/* ---------- the book ---------- */

const projectData = { version: 1 as const, title: 'The Saltmarsh', binder: [], trash: [] }
const opts = (o: Partial<CompileOptions>): CompileOptions => ({ ...DEFAULT_COMPILE_OPTIONS, ...o })

describe('the map at the front', () => {
  it('comes first, before the title page, in the paged formats only', () => {
    for (const format of ['docx', 'pdf'] as const) {
      const blocks = buildBlocks(
        projectData,
        new Map(),
        opts({ format, frontispiece: true, titlePage: true })
      )
      expect(blocks.map((b) => b.kind)).toEqual(['map', 'titlePage'])
    }
    for (const format of ['txt', 'md'] as const) {
      const blocks = buildBlocks(projectData, new Map(), opts({ format, frontispiece: true }))
      expect(blocks.some((b) => b.kind === 'map')).toBe(false)
    }
    expect(
      buildBlocks(projectData, new Map(), opts({ format: 'pdf' })).some((b) => b.kind === 'map')
    ).toBe(false)
  })

  it('is previewed as a line, and drawn as SVG on a page of its own in the PDF', () => {
    const blocks: CompileBlock[] = [{ kind: 'map', alt: 'Map of "The Saltmarsh"' }]
    expect(renderText(blocks)).toContain('[ The map, on a page of its own ]')
    const html = renderHtml(blocks, {
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      width: 1,
      height: 1
    })
    expect(html).toContain('<section class="map-page"><img alt="Map of &quot;The Saltmarsh&quot;"')
    // Base64, not percent-encoded: the PDF path percent-encodes the whole
    // page again, and a percent-encoded picture would be encoded twice.
    const src = /src="data:image\/svg\+xml;base64,([^"]+)"/.exec(html)![1]
    expect(src).not.toContain('%')
    expect(new TextDecoder().decode(Uint8Array.from(atob(src), (c) => c.charCodeAt(0)))).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"/>'
    )
    // Names in any script survive the round trip.
    const named = renderHtml(blocks, {
      svg: '<svg><text>Ærøskøbing — 東京</text></svg>',
      width: 1,
      height: 1
    })
    const back = /base64,([^"]+)"/.exec(named)![1]
    expect(new TextDecoder().decode(Uint8Array.from(atob(back), (c) => c.charCodeAt(0)))).toContain(
      'Ærøskøbing — 東京'
    )
    expect(html).toMatch(/\.map-page \{[^}]*page-break-after: always/)
    // No picture: the book goes on without it rather than failing.
    expect(renderHtml(blocks)).not.toContain('map-page"><img')
  })

  it('is embedded in the .docx as a PNG, fitted inside the margins', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const files = unzip(
      docxBytes([{ kind: 'map', alt: 'Map' }], { svg: '', png, width: 2000, height: 1000 })
    )
    expect([...files['word/media/map.png']]).toEqual([...png])
    expect(text(files['[Content_Types].xml'])).toContain('Extension="png" ContentType="image/png"')
    expect(text(files['word/_rels/document.xml.rels'])).toContain('Id="rIdMap"')
    expect(text(files['word/_rels/document.xml.rels'])).toContain('Target="media/map.png"')
    const doc = text(files['word/document.xml'])
    expect(doc).toContain('r:embed="rIdMap"')
    // On a page of its own: a page break straight after it.
    expect(doc).toContain('</w:drawing></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    // 6.5in across, keeping its shape: twice as wide as tall.
    expect(doc).toContain(`<wp:extent cx="${6.5 * 914400}" cy="${3.25 * 914400}"/>`)
    expect(doc).toContain('xmlns:wp=')
    expect(
      new DOMParser().parseFromString(doc, 'application/xml').querySelector('parsererror')
    ).toBeNull()
  })

  it('fits a tall map to the page height instead', () => {
    const files = unzip(
      docxBytes([{ kind: 'map', alt: 'Map' }], {
        svg: '',
        png: new Uint8Array([1]),
        width: 500,
        height: 1000
      })
    )
    expect(text(files['word/document.xml'])).toContain(`cy="${Math.round(8.9 * 914400)}"`)
  })

  it('leaves the .docx as it was without a picture', () => {
    const files = unzip(docxBytes([{ kind: 'map', alt: 'Map' }]))
    expect(files['word/media/map.png']).toBeUndefined()
    expect(text(files['[Content_Types].xml'])).not.toContain('png')
    expect(text(files['word/document.xml'])).not.toContain('<w:drawing>')
  })
})

/** The entries of a stored (uncompressed) ZIP, by name. */
function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 0
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const extra = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength))
    const start = at + 30 + nameLength + extra
    out[name] = bytes.subarray(start, start + size)
    at = start + size
  }
  return out
}
const text = (b: Uint8Array): string => new TextDecoder().decode(b)

/* ---------- the store ---------- */

const place = (id: string, name: string): Entity =>
  ({
    id,
    type: 'world',
    name,
    aliases: [],
    created: at,
    modified: at,
    body: ''
  }) as unknown as Entity

const REAL = (({
  loadMapPins,
  loadMapShapes,
  loadMapMarks,
  exportMapImage,
  mapPicture,
  deleteMapShape,
  loadAllDocs
}) => ({
  loadAllDocs,
  deleteMapShape,
  loadMapPins,
  loadMapShapes,
  loadMapMarks,
  exportMapImage,
  mapPicture
}))(useWyrm.getState())

function project(mapScale?: MapScale): ProjectInfo {
  return {
    path: '/demo',
    data: {
      version: 1,
      title: 'The Saltmarsh',
      binder: [],
      trash: [],
      ...(mapScale ? { mapScale } : {})
    }
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ ...REAL, project: null, mainView: { kind: 'doc' } })
})

function mapOnDisk(): void {
  vi.spyOn(api, 'listMapPins').mockResolvedValue([])
  vi.spyOn(api, 'listMapShapes').mockResolvedValue([island])
  vi.spyOn(api, 'listMapMarks').mockResolvedValue([])
  vi.spyOn(api, 'listEntities').mockResolvedValue([])
}

describe('the map in what the store writes', () => {
  it('writes a PNG, the default, as bytes under a .png name', async () => {
    mapOnDisk()
    const exportFile = vi.spyOn(api, 'exportFile').mockResolvedValue('/out/x.png')
    useWyrm.setState({ project: project() })
    await useWyrm.getState().exportMapImage('png', DEFAULT_PICTURE_OPTIONS)
    const [name, data] = exportFile.mock.calls[0]
    expect(name).toBe('The Saltmarsh map.png')
    expect(data).toBeInstanceOf(Uint8Array)
    expect([...(data as Uint8Array)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('draws the map at the front of a PDF and of a print', async () => {
    mapOnDisk()
    vi.spyOn(api, 'commit').mockResolvedValue(null as never)
    useWyrm.setState({ project: project(), loadAllDocs: async () => new Map() } as never)
    const renderPdf = vi.spyOn(api, 'renderPdf').mockResolvedValue(new Uint8Array([1]))
    vi.spyOn(api, 'exportFile').mockResolvedValue('/out/book.pdf')
    await useWyrm.getState().compileManuscript(opts({ format: 'pdf', frontispiece: true }))
    expect(renderPdf.mock.calls[0][0]).toContain('<section class="map-page"><img')
    expect(renderPdf.mock.calls[0][0]).toContain('data:image/svg+xml;base64,')
    const printHtml = vi.spyOn(api, 'printHtml').mockResolvedValue(true)
    await useWyrm.getState().printManuscript(opts({ format: 'pdf', frontispiece: true }))
    expect(printHtml.mock.calls[0][0]).toContain('<section class="map-page"><img')
    // Not asked for: not there.
    await useWyrm.getState().printManuscript(opts({ format: 'pdf' }))
    expect(printHtml.mock.calls[1][0]).not.toContain('map-page"><img')
  })
})

describe('reading the map for a picture', () => {
  it('reads every layer and the names from disk, leaving out places that are gone', async () => {
    vi.spyOn(api, 'listMapPins').mockResolvedValue([
      pin('p1', 'e1', 500, 500),
      pin('p2', 'gone', 520, 520)
    ])
    vi.spyOn(api, 'listMapShapes').mockResolvedValue([island])
    vi.spyOn(api, 'listMapMarks').mockResolvedValue([])
    vi.spyOn(api, 'listEntities').mockResolvedValue([place('e1', 'Harrowgate')])
    // The store's own copies are empty: the map has never been opened.
    useWyrm.setState({ project: project(), entities: [], mapPins: [], mapShapes: [], mapMarks: [] })
    const picture = await useWyrm.getState().mapPicture(DEFAULT_PICTURE_OPTIONS)
    const doc = parse(picture!.svg)
    expect([...doc.querySelectorAll('text')].map((t) => t.textContent)).toContain('Harrowgate')
    expect(doc.querySelectorAll('circle')).toHaveLength(2)
    expect(picture!.svg).not.toContain('deleted')
  })

  it('has no picture to make of an empty map', async () => {
    vi.spyOn(api, 'listMapPins').mockResolvedValue([])
    vi.spyOn(api, 'listMapShapes').mockResolvedValue([])
    vi.spyOn(api, 'listMapMarks').mockResolvedValue([])
    vi.spyOn(api, 'listEntities').mockResolvedValue([])
    useWyrm.setState({ project: project() })
    expect(await useWyrm.getState().mapPicture(DEFAULT_PICTURE_OPTIONS)).toBeNull()
  })

  it('writes an SVG through a save dialog named for the map', async () => {
    vi.spyOn(api, 'listMapPins').mockResolvedValue([])
    vi.spyOn(api, 'listMapShapes').mockResolvedValue([island])
    vi.spyOn(api, 'listMapMarks').mockResolvedValue([])
    vi.spyOn(api, 'listEntities').mockResolvedValue([])
    const exportFile = vi.spyOn(api, 'exportFile').mockResolvedValue('/out/The Saltmarsh map.svg')
    useWyrm.setState({ project: project() })
    const path = await useWyrm.getState().exportMapImage('svg', DEFAULT_PICTURE_OPTIONS)
    expect(path).toBe('/out/The Saltmarsh map.svg')
    const [name, data, dialog] = exportFile.mock.calls[0]
    expect(name).toBe('The Saltmarsh map.svg')
    expect(String(data)).toMatch(/^<svg /)
    expect(dialog).toEqual({ title: 'Export Map Image', buttonLabel: 'Export' })
  })
})

/* ---------- the map's Export panel ---------- */

async function renderMap(
  layers: { shapes?: MapShape[]; pins?: MapPin[]; entities?: Entity[] } = {},
  exportMapImage = vi.fn(async () => '/out/map.png' as string | null)
): Promise<typeof exportMapImage> {
  useWyrm.setState({
    project: project(),
    entities: layers.entities ?? [],
    mapPins: layers.pins ?? [],
    mapShapes: layers.shapes ?? [],
    mapMarks: [],
    mainView: { kind: 'map' },
    loadMapPins: vi.fn(async () => {}),
    loadMapShapes: vi.fn(async () => {}),
    loadMapMarks: vi.fn(async () => {}),
    exportMapImage
  })
  await act(async () => {
    render(<WorldMap />)
  })
  return exportMapImage
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1))
  })
}
const openExport = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }))
  })
}

describe('Export Map Image', () => {
  it('writes the picture in the format and with the parts chosen, and says where', async () => {
    const exportMapImage = await renderMap({ shapes: [island] })
    await openExport()
    const panel = screen.getByRole('dialog', { name: 'Export map image' })
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /^PNG/ }))
    fireEvent.click(screen.getByRole('radio', { name: /^SVG/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'The grid' }))
    // No scale yet: no scale bar to offer.
    expect(screen.queryByRole('checkbox', { name: 'The scale bar' })).toBeNull()
    await act(async () => {
      fireEvent.click(panel.querySelector('.btn.default')!)
    })
    expect(exportMapImage).toHaveBeenCalledWith('svg', { grid: true, trim: true, scaleBar: false })
    expect(screen.queryByRole('dialog', { name: 'Export map image' })).toBeNull()
    expect(document.querySelector('.map-hint')?.textContent).toBe('Map written: map.png.')
    await settle()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Export…' }))
  })

  it('writes a PNG of what is drawn, unless told otherwise', async () => {
    const exportMapImage = await renderMap({ shapes: [island] })
    await openExport()
    await act(async () => {
      fireEvent.click(screen.getByRole('dialog').querySelector('.btn.default')!)
    })
    expect(exportMapImage).toHaveBeenCalledWith('png', { grid: false, trim: true, scaleBar: false })
  })

  it('closes when a tool is chosen, and is never open beside the scale', async () => {
    await renderMap({ shapes: [island] })
    await openExport()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
    })
    expect(screen.queryByRole('dialog', { name: 'Export map image' })).toBeNull()
    await openExport()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Set Scale/ }))
    })
    expect(screen.queryByRole('dialog', { name: 'Export map image' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Map scale' })).toBeTruthy()
    await openExport()
    expect(screen.queryByRole('dialog', { name: 'Map scale' })).toBeNull()
  })

  it('closes on a press elsewhere, leaving focus to what was pressed', async () => {
    await renderMap({ shapes: [island] })
    await openExport()
    // A press that moves no focus — on the drawing — still closes it.
    await act(async () => {
      fireEvent.pointerDown(document.querySelector('.map-sizer')!)
    })
    expect(screen.queryByRole('dialog', { name: 'Export map image' })).toBeNull()
    await openExport()
    const zoom = screen.getByRole('button', { name: 'Zoom in' })
    await act(async () => {
      fireEvent.pointerDown(zoom)
      zoom.focus()
    })
    expect(screen.queryByRole('dialog', { name: 'Export map image' })).toBeNull()
    await settle()
    expect(document.activeElement).toBe(zoom)
    // Its own button is not "elsewhere": it toggles.
    await openExport()
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Export…' }))
    })
    expect(screen.getByRole('dialog', { name: 'Export map image' })).toBeTruthy()
  })

  it('hangs from the bar, and leaves its controls out of the button’s help', async () => {
    await renderMap({ shapes: [island] })
    await openExport()
    const panel = screen.getByRole('dialog', { name: 'Export map image' })
    expect(panel.parentElement?.classList.contains('map-tools')).toBe(true)
    // In guided help a click on a marked control is swallowed: the panel's
    // own controls must not sit inside the button's mark.
    expect(panel.closest('[data-help]')?.getAttribute('data-help')).toBe('world-map')
    expect(screen.getByRole('button', { name: 'Export…' }).getAttribute('data-help')).toBe(
      'map-export'
    )
  })

  it('stays open, saying nothing, when the save dialog is cancelled', async () => {
    await renderMap(
      { shapes: [island] },
      vi.fn(async () => null)
    )
    await openExport()
    await act(async () => {
      fireEvent.click(screen.getByRole('dialog').querySelector('.btn.default')!)
    })
    expect(screen.getByRole('dialog', { name: 'Export map image' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says why, rather than doing nothing, when nothing is drawn', async () => {
    // A pin for a place that is gone is not drawn in the picture.
    const exportMapImage = await renderMap({ pins: [pin('p', 'gone', 10, 10)] })
    await openExport()
    await act(async () => {
      fireEvent.click(screen.getByRole('dialog').querySelector('.btn.default')!)
    })
    expect(exportMapImage).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/Nothing is drawn on the map yet/)
  })

  it('says what went wrong when the picture cannot be written', async () => {
    await renderMap(
      { shapes: [island] },
      vi.fn(async () => Promise.reject(new Error('Disk full')))
    )
    await openExport()
    await act(async () => {
      fireEvent.click(screen.getByRole('dialog').querySelector('.btn.default')!)
    })
    expect(screen.getByRole('alert').textContent).toBe('Disk full')
  })

  it('closes on Esc without leaving the map, and gives focus back to its button', async () => {
    await renderMap({ shapes: [island] })
    const back = vi.fn()
    window.addEventListener('keydown', back)
    await openExport()
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('radio', { name: /^PNG/ }), { key: 'Escape' })
      fireEvent.keyUp(document.body, { key: 'Escape' })
    })
    window.removeEventListener('keydown', back)
    expect(back).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    await settle()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Export…' }))
  })

  it('keeps its keys its own: Delete on its buttons does not take the chosen shape off the map', async () => {
    await renderMap({ shapes: [island] })
    const deleteMapShape = vi.fn(async () => {})
    useWyrm.setState({ deleteMapShape })
    // Choose the island with the hand, by keyboard.
    const body = document.querySelector<SVGElement>('[data-shape="s1"] .map-shape-body')!
    await act(async () => {
      fireEvent.keyDown(body, { key: 'Enter' })
    })
    await openExport()
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('radio', { name: /^PNG/ }), { key: 'Delete' })
      fireEvent.keyDown(screen.getByRole('radio', { name: /^PNG/ }), { key: 'Backspace' })
    })
    expect(deleteMapShape).not.toHaveBeenCalled()
    expect(document.querySelector('[data-shape="s1"]')).not.toBeNull()
  })
})

/* ---------- Compile ---------- */

describe('Compile: Map at the front', () => {
  async function openCompile(): Promise<void> {
    const path = (await api.getLastProjectPath())!
    const info = (await api.openProjectPath(path))!
    useWyrm.setState({ project: info, booted: true, saveState: 'saved' })
    render(<CompileDialog onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Notes' })).toBeTruthy())
  }
  const box = (): HTMLElement => screen.getByRole('checkbox', { name: /^Map at the front/ })

  it('is offered for .docx and PDF, and says so for the others', async () => {
    await openCompile()
    // The demo project has a place on its map.
    await waitFor(() => expect(box().textContent).toBe('Map at the front (.docx and PDF)'))
    expect(box()).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('radio', { name: 'PDF (.pdf)' }))
    expect(box().textContent).toBe('Map at the front')
    expect(box()).toHaveProperty('disabled', false)
    fireEvent.click(box())
    expect(box().getAttribute('aria-checked')).toBe('true')
    await waitFor(() =>
      expect(document.querySelector('.compile-preview')?.textContent).toMatch(
        /^\[ The map, on a page of its own \]/
      )
    )
    // Back to plain text: not offered, and not carried.
    fireEvent.click(screen.getByRole('radio', { name: 'Plain text (.txt)' }))
    expect(box().getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('.compile-preview')?.textContent).not.toContain('The map')
  })

  it('says it is reading the map, and says when the map cannot be read', async () => {
    let fail: (e: Error) => void = () => {}
    vi.spyOn(api, 'listMapShapes').mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      })
    )
    await openCompile()
    fireEvent.click(screen.getByRole('radio', { name: 'PDF (.pdf)' }))
    expect(box().textContent).toBe('Map at the front (reading the map…)')
    await act(async () => fail(new Error('unreadable')))
    await waitFor(() =>
      expect(box().textContent).toBe('Map at the front (the map could not be read)')
    )
    expect(box()).toHaveProperty('disabled', true)
  })

  it('says when there is nothing on the map to put there', async () => {
    vi.spyOn(api, 'listMapPins').mockResolvedValue([])
    await openCompile()
    fireEvent.click(screen.getByRole('radio', { name: 'Word (.docx)' }))
    await waitFor(() =>
      expect(box().textContent).toBe('Map at the front (nothing is drawn on the map)')
    )
    expect(box()).toHaveProperty('disabled', true)
  })

  it('puts the map in the .docx it writes', async () => {
    const exportFile = vi.spyOn(api, 'exportFile').mockResolvedValue('/out/book.docx')
    await openCompile()
    fireEvent.click(screen.getByRole('radio', { name: 'Word (.docx)' }))
    await waitFor(() => expect(box()).toHaveProperty('disabled', false))
    fireEvent.click(box())
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }))
    await waitFor(() => expect(exportFile).toHaveBeenCalled())
    const files = unzip(exportFile.mock.calls[0][1] as Uint8Array)
    expect([...files['word/media/map.png']]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})
