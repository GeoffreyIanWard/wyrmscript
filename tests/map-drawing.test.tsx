// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MapBounds, MapPin, MapShape, ProjectInfo } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import {
  CLOSE_RADIUS,
  closesOn,
  describeShape,
  edgeLongEnough,
  insertPoint,
  midpoints,
  movePoint,
  MIN_POINTS,
  pathFor,
  isSmooth,
  removePoint,
  shapePath,
  smoothPath,
  withoutRepeats
} from '../src/renderer/src/lib/mapShapes'

/**
 * F-12, part 2: drawing land, areas and borders on the world map, point by
 * point, and changing them with the hand. jsdom lays nothing out, so the
 * map's box sits at (0, 0) and a click at a client point is that map point
 * at 100%.
 */

describe('shape geometry', () => {
  const tri = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 }
  ]

  it('draws a path from the map’s origin, closed or open', () => {
    expect(shapePath(tri, true)).toBe('M 0 0 L 100 0 L 100 100 Z')
    expect(shapePath(tri, false)).toBe('M 0 0 L 100 0 L 100 100')
    expect(shapePath(tri, true, { x: -50, y: 10 })).toBe('M 50 -10 L 150 -10 L 150 90 Z')
  })

  it('closes on the first point within a screen-sized radius, at any zoom', () => {
    expect(closesOn(tri, { x: 3, y: 4 }, 1)).toBe(true)
    expect(closesOn(tri, { x: CLOSE_RADIUS + 1, y: 0 }, 1)).toBe(false)
    // At 200% the same map distance is twice as far on screen.
    expect(closesOn(tri, { x: 8, y: 0 }, 2)).toBe(false)
    // Two points are not yet an outline to close.
    expect(closesOn(tri.slice(0, 2), { x: 0, y: 0 }, 1)).toBe(false)
  })

  it('finds the middle of every edge, the closing edge only for a closed shape', () => {
    expect(midpoints(tri, true)).toEqual([
      { x: 50, y: 0, index: 1 },
      { x: 100, y: 50, index: 2 },
      { x: 50, y: 50, index: 3 }
    ])
    expect(midpoints(tri, false)).toHaveLength(2)
  })

  it('adds, moves and takes out points, never below a shape’s fewest', () => {
    expect(insertPoint(tri, 1, { x: 50.4, y: 0.6 })[1]).toEqual({ x: 50, y: 1 })
    expect(movePoint(tri, 2, { x: 90.5, y: 90 })[2]).toEqual({ x: 91, y: 90 })
    expect(removePoint(tri, 0, 'land')).toBeNull()
    expect(removePoint(tri, 0, 'border')).toEqual(tri.slice(1))
  })

  it('puts a middle handle only on an edge long enough on screen to hold one', () => {
    const short = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 100 }
    ]
    expect(edgeLongEnough(short, 1, 1)).toBe(false)
    expect(edgeLongEnough(short, 1, 2)).toBe(true)
    // The closing edge, from the last point back to the first.
    expect(edgeLongEnough(short, 3, 0.5)).toBe(true)
  })

  it('bends a river through every point it was given', () => {
    const river = [
      { x: 0, y: 0 },
      { x: 60, y: 30 },
      { x: 120, y: 0 }
    ]
    const d = smoothPath(river)
    expect(d).toBe('M 0 0 C 10 5 40 30 60 30 C 80 30 110 5 120 0')
    // Through the middle point: a corner handle sits on the river.
    expect(d).toContain(' 60 30 ')
    expect(smoothPath(river, { x: -10, y: 0 })).toMatch(/^M 10 0 C 20 5 /)
    // Two points are a straight reach.
    expect(smoothPath(river.slice(0, 2))).toBe('M 0 0 L 60 30')
  })

  it('never curls a river back on a repeated point', () => {
    const river = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 }
    ]
    expect(withoutRepeats(river)).toEqual([river[0], river[1], river[3]])
    expect(smoothPath(river)).toBe(smoothPath(withoutRepeats(river)))
    // The line to the pointer just after a click ends on that same point.
    expect(smoothPath([...river.slice(0, 2), river[1]])).toBe('M 0 0 L 100 0')
  })

  it('puts a river’s middle handles on the curve, not on the chord', () => {
    const river = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 }
    ]
    expect(midpoints(river, false, true)).toEqual([
      { x: 50, y: -6, index: 1 },
      { x: 106, y: 50, index: 2 }
    ])
    // Two points are a straight reach: the chord is the curve.
    expect(midpoints(river.slice(0, 2), false, true)).toEqual([{ x: 50, y: 0, index: 1 }])
  })

  it('draws each kind as an outline, a straight line or a curve', () => {
    expect(pathFor('land', tri)).toMatch(/ Z$/)
    // Surveyed lines stay straight; only a river meanders.
    for (const kind of ['road', 'rail', 'border'] as const) {
      expect(pathFor(kind, tri)).toBe('M 0 0 L 100 0 L 100 100')
      expect(isSmooth(kind)).toBe(false)
    }
    expect(pathFor('river', tri)).toContain(' C ')
    expect(MIN_POINTS).toEqual({ land: 3, area: 3, border: 2, river: 2, road: 2, rail: 2 })
  })

  it('says what a shape is', () => {
    expect(describeShape({ kind: 'land', points: tri })).toBe('Land, 3 points')
  })
})

/* ---------- the tools ---------- */

const now = new Date().toISOString()
const land = (
  points = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 300 }
  ]
): MapShape => ({ id: 'shape-1', kind: 'land', points, created: now, modified: now })

function project(mapBounds?: MapBounds): ProjectInfo {
  return {
    path: '/demo',
    data: { version: 1, title: 'T', binder: [], trash: [], ...(mapBounds ? { mapBounds } : {}) }
  }
}

const REAL = (({
  createMapShape,
  updateMapShapeAt,
  deleteMapShape,
  loadMapShapes,
  loadMapPins,
  showEntity
}) => ({
  createMapShape,
  updateMapShapeAt,
  deleteMapShape,
  loadMapShapes,
  loadMapPins,
  showEntity
}))(useWyrm.getState())

async function renderMap(
  shapes: MapShape[] = [],
  extra: Partial<{
    createMapShape: ReturnType<typeof vi.fn>
    updateMapShapeAt: ReturnType<typeof vi.fn>
    deleteMapShape: ReturnType<typeof vi.fn>
    showEntity: ReturnType<typeof vi.fn>
    mapBounds: MapBounds
    pins: MapPin[]
  }> = {}
): Promise<ReturnType<typeof render>> {
  useWyrm.setState({
    project: project(extra.mapBounds),
    entities: extra.pins
      ? extra.pins.map((p) => ({
          id: p.entityId,
          type: 'world' as const,
          name: `Place ${p.entityId}`,
          aliases: [],
          created: now,
          modified: now
        }))
      : [],
    mapPins: extra.pins ?? [],
    ...(extra.showEntity ? { showEntity: extra.showEntity } : {}),
    mapShapes: [],
    mainView: { kind: 'map' },
    loadMapPins: vi.fn(async () => {}),
    loadMapShapes: vi.fn(async () => {
      useWyrm.setState({ mapShapes: shapes })
    }),
    createMapShape: extra.createMapShape ?? vi.fn(async () => null),
    updateMapShapeAt: extra.updateMapShapeAt ?? vi.fn(async () => {}),
    deleteMapShape: extra.deleteMapShape ?? vi.fn(async () => {})
  })
  let r!: ReturnType<typeof render>
  await act(async () => {
    r = render(<WorldMap />)
  })
  return r
}

function pointer(el: Element, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}

const sizer = (): Element => document.querySelector('.map-sizer')!
/** A click on the map: a press and a release without moving. */
const clickMap = async (x: number, y: number): Promise<void> => {
  await act(async () => pointer(sizer(), 'pointerdown', x, y))
  await act(async () => pointer(sizer(), 'pointerup', x, y))
}
const tool = async (name: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
const region = (): HTMLElement => screen.getByRole('region', { name: /^World map\./ })
const key = async (
  k: string,
  on: Element = region(),
  mods: { altKey?: boolean } = {}
): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(on, { key: k, code: k, ...mods })
    fireEvent.keyUp(on, { key: k, code: k, ...mods })
  })
}
/** Lets an `afterKeysUp` focus move run. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1))
  })
}
/** Listens for an Esc reaching the window, where App's Esc-as-back lives. */
function listenForBack(): { back: ReturnType<typeof vi.fn>; done: () => void } {
  const back = vi.fn()
  const listen = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') back(e)
  }
  window.addEventListener('keydown', listen)
  return { back, done: () => window.removeEventListener('keydown', listen) }
}
const hint = (): string => document.querySelector('.map-hint')?.textContent ?? ''

afterEach(() => {
  cleanup()
  // A keydown fired with no keyup leaves `afterKeysUp` waiting for good.
  window.dispatchEvent(new Event('blur'))
  vi.useRealTimers()
  vi.restoreAllMocks()
  useWyrm.setState({ ...REAL, project: null, mapShapes: [], mainView: { kind: 'doc' } })
})

describe('drawing on the map', () => {
  it('draws a land mass point by point and closes it on the first point', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape })
    await tool('Land')
    await clickMap(100, 100)
    await clickMap(300, 100)
    await clickMap(300, 300)
    expect(document.querySelector('.map-draft')).toBeTruthy()
    // Enough points: the first one says it closes the outline.
    expect(document.querySelector('.map-handle.first.closes')).toBeTruthy()
    await clickMap(104, 103)
    expect(createMapShape).toHaveBeenCalledWith('land', [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 }
    ])
    expect(document.querySelector('.map-draft')).toBeNull()
  })

  it('finishes on Return, and says so when there are too few points instead of doing nothing', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape })
    await tool('Area')
    await clickMap(10, 10)
    await clickMap(50, 10)
    await key('Enter')
    expect(createMapShape).not.toHaveBeenCalled()
    expect(hint()).toContain('Area needs at least 3 points — 2 so far.')
    await clickMap(50, 50)
    await key('Enter')
    expect(createMapShape).toHaveBeenCalledWith('area', [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 }
    ])
  })

  it('finishes a border, an open line, on Return with two points', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape })
    await tool('Border')
    await clickMap(10, 10)
    await clickMap(200, 30)
    await key('Enter')
    expect(createMapShape).toHaveBeenCalledWith('border', [
      { x: 10, y: 10 },
      { x: 200, y: 30 }
    ])
  })

  it('takes the last point back on Backspace', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape })
    await tool('Border')
    await clickMap(10, 10)
    await clickMap(200, 30)
    await clickMap(400, 40)
    await key('Backspace')
    await key('Enter')
    expect(createMapShape).toHaveBeenCalledWith('border', [
      { x: 10, y: 10 },
      { x: 200, y: 30 }
    ])
  })

  it('drops a half-drawn shape on Esc, which goes no further than the map', async () => {
    const createMapShape = vi.fn(async () => null)
    const back = vi.fn()
    window.addEventListener('keydown', back)
    try {
      await renderMap([], { createMapShape })
      await tool('Land')
      await clickMap(10, 10)
      await clickMap(50, 10)
      await key('Escape')
      expect(document.querySelector('.map-draft')).toBeNull()
      expect(back).not.toHaveBeenCalled()
      expect(createMapShape).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', back)
    }
  })

  it.each([
    ['River', 'river'],
    ['Road', 'road'],
    ['Railway', 'rail']
  ])(
    'draws a %s as a line finished on Return, and says when it is too short',
    async (name, kind) => {
      const createMapShape = vi.fn(async () => null)
      await renderMap([], { createMapShape })
      await tool(name)
      await clickMap(10, 10)
      await key('Enter')
      expect(createMapShape).not.toHaveBeenCalled()
      expect(hint()).toContain(`${name} needs at least 2 points — 1 so far.`)
      await clickMap(200, 30)
      await clickMap(400, 90)
      // An open line never closes on its first point.
      await clickMap(11, 10)
      await key('Enter')
      expect(createMapShape).toHaveBeenCalledWith(kind, [
        { x: 10, y: 10 },
        { x: 200, y: 30 },
        { x: 400, y: 90 },
        { x: 11, y: 10 }
      ])
    }
  )

  it.each(['Road', 'Railway', 'Border', 'Land'])(
    'keeps a %s straight while it is drawn',
    async (name) => {
      await renderMap()
      await tool(name)
      await clickMap(0, 0)
      await clickMap(60, 30)
      await clickMap(120, 0)
      expect(document.querySelector('.map-draft')!.getAttribute('d')).toBe(
        'M 0 0 L 60 30 L 120 0 L 120 0'
      )
    }
  )

  it('takes a double-click as one point', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape })
    await tool('Border')
    await clickMap(40, 40)
    await clickMap(40, 40)
    await key('Enter')
    expect(createMapShape).not.toHaveBeenCalled()
    expect(hint()).toContain('Border needs at least 2 points — 1 so far.')
  })

  it('says Return finishes a line, to a screen reader, rather than closing it', async () => {
    await renderMap()
    await tool('Railway')
    expect(region().getAttribute('aria-label')).toContain('Return finishes the railway.')
    await tool('Land')
    expect(region().getAttribute('aria-label')).toContain('Return closes the shape.')
  })

  it('shows a river bending as it is drawn', async () => {
    await renderMap()
    await tool('River')
    await clickMap(0, 0)
    await clickMap(60, 30)
    await clickMap(120, 0)
    expect(document.querySelector('.map-draft')!.getAttribute('d')).toContain(' C ')
  })

  it('drops the shape on Esc wherever focus is on the map, a zoom button included', async () => {
    const createMapShape = vi.fn(async () => null)
    const { back, done } = listenForBack()
    try {
      await renderMap([], { createMapShape })
      await tool('Land')
      await clickMap(10, 10)
      await clickMap(50, 10)
      await clickMap(50, 50)
      const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
      // A focused button keeps its own Return: it zooms, and the coast waits.
      await key('Enter', zoomIn)
      expect(createMapShape).not.toHaveBeenCalled()
      expect(document.querySelector('.map-draft')).toBeTruthy()
      await key('Escape', zoomIn)
      expect(document.querySelector('.map-draft')).toBeNull()
      expect(back).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('gives the keyboard back to the map after a zoom clicked mid-shape', async () => {
    await renderMap()
    await tool('Land')
    await clickMap(10, 10)
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
    await act(async () => {
      zoomIn.focus()
      fireEvent.click(zoomIn, { detail: 1 })
    })
    expect(document.activeElement).toBe(region())
  })

  it('lets Esc be "back" when nothing is drawn or chosen', async () => {
    const { back, done } = listenForBack()
    try {
      await renderMap()
      await key('Escape')
      expect(back).toHaveBeenCalledTimes(1)
      await tool('Land')
      await key('Escape')
      expect(back).toHaveBeenCalledTimes(2)
    } finally {
      done()
    }
  })

  it('drops the draft when the tool changes, so a coast never becomes a border', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape })
    await tool('Land')
    await clickMap(10, 10)
    await clickMap(50, 10)
    await clickMap(50, 50)
    await tool('Border')
    expect(document.querySelector('.map-draft')).toBeNull()
    await key('Backspace')
    expect(createMapShape).not.toHaveBeenCalled()
    await tool('Land')
    await clickMap(10, 10)
    await clickMap(50, 10)
    await tool('Hand')
    await tool('Area')
    expect(document.querySelector('.map-draft')).toBeNull()
    expect(hint()).not.toContain('Return, to close the area.')
  })

  it('starts each new line from its own first point, not where the last shape ended', async () => {
    await renderMap()
    await tool('Border')
    await clickMap(10, 10)
    await act(async () => pointer(sizer(), 'pointermove', 777, 666))
    await clickMap(777, 666)
    await key('Enter')
    await clickMap(500, 500)
    const d = document.querySelector('.map-draft')!.getAttribute('d')!
    expect(d).not.toContain('777')
    expect(d).toBe('M 500 500 L 500 500')
  })

  it('draws from the keyboard: Option and the arrows move a cursor, Space puts a point down', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape })
    await tool('Land')
    // jsdom has no layout, so the view's centre clamps to the map's corner.
    expect(document.querySelector('.map-cursor')).toBeTruthy()
    await key(' ')
    for (let i = 0; i < 5; i++) await key('ArrowRight', region(), { altKey: true })
    await key(' ')
    for (let i = 0; i < 5; i++) await key('ArrowDown', region(), { altKey: true })
    await key(' ')
    await key('Enter')
    expect(createMapShape).toHaveBeenCalledWith('land', [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 }
    ])
  })

  it('hides the keyboard cursor from a writer drawing with the pointer', async () => {
    await renderMap()
    await tool('Land')
    await clickMap(10, 10)
    // A Return here would make Chromium call the focus keyboard focus.
    expect(document.querySelector('.map-cursor')).toBeNull()
    await key('ArrowRight', region(), { altKey: true })
    expect(document.querySelector('.map-cursor')).toBeTruthy()
  })

  it('shows the cursor again when Space puts a point down', async () => {
    await renderMap()
    await tool('Land')
    await clickMap(100, 100)
    expect(document.querySelector('.map-cursor')).toBeNull()
    await key(' ')
    expect(document.querySelector('.map-cursor')).toBeTruthy()
    expect(document.querySelector('.map-draft')!.getAttribute('d')).toMatch(/^M 100 100 L 0 0/)
  })

  it('shows the cursor to a writer who Tabs back to the map, not to one who clicks it', async () => {
    await renderMap()
    await tool('Land')
    await clickMap(100, 100)
    const real = Element.prototype.matches
    const viaKeys = (yes: boolean): void => {
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
        this: Element,
        sel: string
      ) {
        return sel === ':focus-visible' ? yes : real.call(this, sel)
      })
    }
    viaKeys(false)
    await act(async () => region().blur())
    await act(async () => region().focus())
    expect(document.querySelector('.map-cursor')).toBeNull()
    viaKeys(true)
    await act(async () => region().blur())
    await act(async () => region().focus())
    expect(document.querySelector('.map-cursor')).toBeTruthy()
  })

  it('does not run the line to the hidden cursor when the pointer leaves the map', async () => {
    await renderMap()
    await tool('River')
    await clickMap(100, 100)
    await clickMap(200, 150)
    await clickMap(300, 100)
    await act(async () => {
      fireEvent.pointerLeave(document.querySelector('.map-scroll')!)
    })
    const d = document.querySelector('.map-draft')!.getAttribute('d')!
    expect(d).toMatch(/ 300 100$/)
    expect(d).not.toContain(' 0 0')
  })

  it('leaves pins alone while drawing: a click on a town is a point of the coast', async () => {
    const showEntity = vi.fn()
    const pin: MapPin = { id: 'pin-1', entityId: 'e1', x: 200, y: 200 }
    await renderMap([], { showEntity, pins: [pin] })
    await tool('Land')
    const el = document.querySelector('.world-map-pin[data-pin="pin-1"]') as HTMLElement
    expect(el.tabIndex).toBe(-1)
    await act(async () => pointer(el, 'pointerdown', 200, 200))
    await act(async () => pointer(el, 'pointerup', 200, 200))
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(showEntity).not.toHaveBeenCalled()
    expect(document.querySelector('.map-draft')).toBeTruthy()
  })

  it('never shrinks the map under a shape drawn beyond its stored edge', async () => {
    await renderMap([
      land([
        { x: 100, y: 100 },
        { x: 5000, y: 100 },
        { x: 100, y: 3000 }
      ])
    ])
    const style = (sizer() as HTMLElement).style
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(5000)
    expect(parseFloat(style.height)).toBeGreaterThanOrEqual(3000)
  })

  it('still moves the map on a drag, in a drawing tool, without putting a point down', async () => {
    await renderMap()
    await tool('Land')
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    scroller.scrollLeft = 300
    await act(async () => pointer(sizer(), 'pointerdown', 400, 300))
    await act(async () => pointer(sizer(), 'pointermove', 350, 300))
    await act(async () => pointer(sizer(), 'pointerup', 350, 300))
    expect(scroller.scrollLeft).toBe(350)
    expect(document.querySelector('.map-draft')).toBeNull()
  })

  it('reads clicks as map points at any zoom', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    })
    await tool('Border')
    await clickMap(100, 100)
    await clickMap(300, 100)
    await key('Enter')
    expect(createMapShape).toHaveBeenCalledWith('border', [
      { x: 50, y: 50 },
      { x: 150, y: 50 }
    ])
  })
})

describe('changing a shape with the hand', () => {
  /** A still click on the shape: chosen on the release, as a click. */
  const select = async (): Promise<void> => {
    const body = document.querySelector('[data-shape="shape-1"] .map-shape-body')!
    await act(async () => pointer(body, 'pointerdown', 0, 0))
    await act(async () => pointer(body, 'pointerup', 0, 0))
  }
  const corners = (): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>('.map-handle.corner')] as HTMLElement[]

  it('offers each shape to the keyboard and to a screen reader, with the hand only', async () => {
    await renderMap([land()])
    expect(screen.getByRole('button', { name: /^Land, 3 points,/ })).toBeTruthy()
    await tool('Area')
    expect(screen.queryByRole('button', { name: /^Land, 3 points,/ })).toBeNull()
  })

  it('selects a shape and shows its corners and the middles of its edges', async () => {
    await renderMap([land()])
    await select()
    expect(corners()).toHaveLength(3)
    expect(document.querySelectorAll('.map-handle.middle')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /^Land, 3 points, 1 of 1\. Selected/ })).toBeTruthy()
    expect(
      document.querySelector('[data-shape="shape-1"] .map-shape-body')!.getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('pans on a drag that starts on land, and chooses nothing', async () => {
    await renderMap([land()])
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    scroller.scrollLeft = 300
    const body = document.querySelector('[data-shape="shape-1"] .map-shape-body')!
    await act(async () => pointer(body, 'pointerdown', 200, 150))
    await act(async () => pointer(body, 'pointermove', 150, 150))
    await act(async () => pointer(body, 'pointerup', 150, 150))
    expect(scroller.scrollLeft).toBe(350)
    expect(corners()).toHaveLength(0)
  })

  it('grabs a shape by a wide band along its outline, at every zoom', async () => {
    await renderMap([land()])
    const hit = document.querySelector('[data-shape="shape-1"] .map-shape-hit') as SVGElement
    expect(hit.style.strokeWidth).toBe('14')
    await act(async () => pointer(hit, 'pointerdown', 0, 0))
    await act(async () => pointer(hit, 'pointerup', 0, 0))
    expect(corners()).toHaveLength(3)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    })
    expect(
      (document.querySelector('[data-shape="shape-1"] .map-shape-hit') as SVGElement).style
        .strokeWidth
    ).toBe('28')
  })

  it('puts no middle handle on an edge too short to hold one, and draws corners over middles', async () => {
    await renderMap([
      land([
        { x: 100, y: 100 },
        { x: 110, y: 100 },
        { x: 110, y: 300 }
      ])
    ])
    await select()
    const handles = [...document.querySelectorAll('.map-handle')]
    expect(document.querySelectorAll('.map-handle.middle')).toHaveLength(2)
    const lastMiddle = handles.map((h) => h.classList.contains('middle')).lastIndexOf(true)
    expect(handles.findIndex((h) => h.classList.contains('corner'))).toBeGreaterThan(lastMiddle)
  })

  it('keeps focus on the map when Esc lets go of a focused corner', async () => {
    const { back, done } = listenForBack()
    try {
      await renderMap([land()])
      await select()
      corners()[1].focus()
      await key('Escape', corners()[1])
      await settle()
      expect(corners()).toHaveLength(0)
      expect(document.activeElement).toBe(
        document.querySelector('[data-shape="shape-1"] .map-shape-body')
      )
      expect(back).not.toHaveBeenCalled()
      // Nothing chosen now: the next Esc is "back" again.
      await key('Escape', document.activeElement!)
      expect(back).toHaveBeenCalledTimes(1)
    } finally {
      done()
    }
  })

  it('moves focus to the new last corner when the last one is taken out', async () => {
    const four = land([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ])
    await renderMap([four])
    await select()
    corners()[3].focus()
    await act(async () => {
      fireEvent.keyDown(corners()[3], { key: 'Delete' })
    })
    expect(corners()).toHaveLength(3)
    expect(document.activeElement).toBe(corners()[2])
  })

  it('moves a corner by dragging it, written to the project it was made in', async () => {
    const updateMapShapeAt = vi.fn(async () => {})
    await renderMap([land()], { updateMapShapeAt })
    await select()
    const c = corners()[1]
    await act(async () => pointer(c, 'pointerdown', 300, 100))
    await act(async () => pointer(c, 'pointermove', 340, 80))
    await act(async () => pointer(c, 'pointerup', 340, 80))
    expect(updateMapShapeAt).toHaveBeenCalledWith('/demo', 'shape-1', [
      { x: 100, y: 100 },
      { x: 340, y: 80 },
      { x: 300, y: 300 }
    ])
  })

  it('adds a point at the middle of an edge', async () => {
    const updateMapShapeAt = vi.fn(async () => {})
    await renderMap([land()], { updateMapShapeAt })
    await select()
    await act(async () => {
      fireEvent.click(document.querySelectorAll('.map-handle.middle')[0])
    })
    expect(updateMapShapeAt).toHaveBeenCalledWith('/demo', 'shape-1', [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 }
    ])
  })

  it('takes a corner out with Delete, but not below a shape’s fewest — and says why', async () => {
    const updateMapShapeAt = vi.fn(async () => {})
    const four = land([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ])
    await renderMap([four], { updateMapShapeAt })
    await select()
    await act(async () => {
      fireEvent.keyDown(corners()[3], { key: 'Delete' })
    })
    expect(updateMapShapeAt).toHaveBeenCalledWith('/demo', 'shape-1', four.points.slice(0, 3))
    await act(async () => {
      fireEvent.keyDown(corners()[0], { key: 'Delete' })
    })
    expect(updateMapShapeAt).toHaveBeenCalledTimes(1)
    expect(hint()).toContain('Land needs at least 3 points')
  })

  it('nudges a corner with Option and the arrows, written once the keys stop', async () => {
    vi.useFakeTimers()
    const updateMapShapeAt = vi.fn(async () => {})
    await renderMap([land()], { updateMapShapeAt })
    await select()
    for (let i = 0; i < 3; i++)
      await act(async () => {
        fireEvent.keyDown(corners()[0], { key: 'ArrowRight', altKey: true })
      })
    expect(updateMapShapeAt).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(updateMapShapeAt).toHaveBeenCalledTimes(1)
    expect(updateMapShapeAt).toHaveBeenCalledWith('/demo', 'shape-1', [
      { x: 124, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 }
    ])
  })

  it('writes a corner nudge still waiting when the map goes away', async () => {
    vi.useFakeTimers()
    const updateMapShapeAt = vi.fn(async () => {})
    const r = await renderMap([land()], { updateMapShapeAt })
    await select()
    await act(async () => {
      fireEvent.keyDown(corners()[0], { key: 'ArrowDown', altKey: true })
    })
    r.unmount()
    expect(updateMapShapeAt).toHaveBeenCalledWith('/demo', 'shape-1', [
      { x: 100, y: 108 },
      { x: 300, y: 100 },
      { x: 300, y: 300 }
    ])
  })

  it('removes a whole shape with Delete on it, and lets go of it on Esc', async () => {
    const deleteMapShape = vi.fn(async () => {})
    await renderMap([land()], { deleteMapShape })
    const body = screen.getByRole('button', { name: /^Land, 3 points,/ })
    await act(async () => {
      fireEvent.keyDown(body, { key: 'Enter' })
    })
    expect(corners()).toHaveLength(3)
    await key('Escape')
    expect(corners()).toHaveLength(0)
    await act(async () => {
      fireEvent.keyDown(body, { key: 'Delete' })
    })
    expect(deleteMapShape).toHaveBeenCalledWith(expect.objectContaining({ id: 'shape-1' }))
  })

  it('lets go of the shape on a click elsewhere on the map', async () => {
    await renderMap([land()])
    await select()
    await clickMap(900, 900)
    expect(corners()).toHaveLength(0)
  })
})

describe('lines on the map', () => {
  const line = (kind: MapShape['kind'], id: string): MapShape => ({
    id,
    kind,
    points: [
      { x: 0, y: 0 },
      { x: 60, y: 30 },
      { x: 120, y: 0 }
    ],
    created: now,
    modified: now
  })

  it('cases a road in ink, ties a railway, and bends a river', async () => {
    await renderMap([line('road', 'r1'), line('rail', 'r2'), line('river', 'r3')])
    const road = document.querySelector('[data-shape="r1"]')!
    expect(document.querySelector('[data-casing="r1"]')!.getAttribute('d')).toBe(
      road.querySelector('.map-shape-body')!.getAttribute('d')
    )
    const rail = document.querySelector('[data-shape="r2"] .map-shape-body')!.getAttribute('d')
    expect(rail).toBe('M 0 0 L 60 30 L 120 0')
    expect(document.querySelector('[data-shape="r2"] .map-rail-ties')!.getAttribute('d')).toBe(rail)
    expect(
      document.querySelector('[data-shape="r3"] .map-shape-body')!.getAttribute('d')
    ).toContain(' C ')
    expect(document.querySelectorAll('.map-road-casing, .map-rail-ties')).toHaveLength(2)
  })

  it('puts a chosen river’s middle handles on the river', async () => {
    const river = line('river', 'r3')
    await renderMap([river])
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: /^River, 3 points/ }), { key: 'Enter' })
    })
    const on = midpoints(river.points, false, true)
    expect(on[0]).not.toEqual(midpoints(river.points, false)[0])
    const m = document.querySelector<HTMLElement>('.map-handle.middle')!
    expect([m.style.left, m.style.top]).toEqual([`${on[0].x}px`, `${on[0].y}px`])
  })

  it('cases every road before any road’s paper, so junctions join', async () => {
    await renderMap([line('road', 'a'), line('road', 'b')])
    const art = [...document.querySelectorAll('[data-casing], .map-shape.road')]
    expect(
      art.map((el) => el.getAttribute('data-casing') ?? `body:${el.getAttribute('data-shape')}`)
    ).toEqual(['a', 'b', 'body:a', 'body:b'])
  })

  it('shows a road chosen or keyboard-focused on its casing', async () => {
    await renderMap([line('road', 'a')])
    const body = document.querySelector('[data-shape="a"] .map-shape-body') as SVGElement
    const casing = (): string => document.querySelector('[data-casing="a"]')!.getAttribute('class')!
    // jsdom does not judge :focus-visible; this focus is the keyboard's.
    const real = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      sel: string
    ) {
      return sel === ':focus-visible' || real.call(this, sel)
    })
    await act(async () => body.focus())
    expect(casing()).toContain('focused')
    await act(async () => {
      fireEvent.keyDown(body, { key: 'Enter' })
    })
    expect(casing()).toContain('selected')
    await act(async () => body.blur())
    expect(casing()).not.toContain('focused')
  })

  it('draws rivers under roads, roads under railways, and borders over everything', async () => {
    await renderMap([
      line('border', 'b'),
      line('rail', 'r2'),
      line('road', 'r1'),
      line('river', 'r3'),
      land()
    ])
    const order = [...document.querySelectorAll('.map-shape')].map((g) =>
      g.getAttribute('data-shape')
    )
    expect(order).toEqual(['shape-1', 'r3', 'r1', 'r2', 'b'])
  })

  it('names lines for a screen reader, and lets a road be chosen and changed', async () => {
    const updateMapShapeAt = vi.fn(async () => {})
    await renderMap([line('road', 'r1')], { updateMapShapeAt })
    const body = screen.getByRole('button', { name: /^Road, 3 points, 1 of 1\./ })
    await act(async () => {
      fireEvent.keyDown(body, { key: 'Enter' })
    })
    // An open line: a middle for each of its two edges, none for a closing one.
    expect(document.querySelectorAll('.map-handle.corner')).toHaveLength(3)
    expect(document.querySelectorAll('.map-handle.middle')).toHaveLength(2)
    await act(async () => {
      fireEvent.keyDown(document.querySelectorAll('.map-handle.corner')[0], { key: 'Delete' })
    })
    expect(updateMapShapeAt).toHaveBeenCalledWith('/demo', 'r1', [
      { x: 60, y: 30 },
      { x: 120, y: 0 }
    ])
  })
})

describe('a map grown north and west', () => {
  // The map's origin is no longer (0, 0), and its box is not at the page's
  // corner: every conversion between the screen and the map has to use both.
  const grown: MapBounds = { x: -400, y: -300, width: 3000, height: 2000 }
  const boxed = (): void => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 50,
      top: 20,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 50,
      y: 20,
      toJSON: () => ({})
    })
  }
  const select = async (): Promise<void> => {
    const body = document.querySelector('[data-shape="shape-1"] .map-shape-body')!
    await act(async () => pointer(body, 'pointerdown', 0, 0))
    await act(async () => pointer(body, 'pointerup', 0, 0))
  }

  it('stores clicked points in map coordinates', async () => {
    const createMapShape = vi.fn(async () => null)
    await renderMap([], { createMapShape, mapBounds: grown })
    boxed()
    await tool('Border')
    await clickMap(150, 120)
    await clickMap(250, 220)
    expect(document.querySelector('.map-draft')!.getAttribute('d')).toMatch(/^M 100 100 /)
    await key('Enter')
    expect(createMapShape).toHaveBeenCalledWith('border', [
      { x: -300, y: -200 },
      { x: -200, y: -100 }
    ])
  })

  it('draws stored shapes and their handles from the map’s origin', async () => {
    const shape = land([
      { x: -300, y: -200 },
      { x: 100, y: -200 },
      { x: 100, y: 200 }
    ])
    await renderMap([shape], { mapBounds: grown })
    expect(
      document.querySelector('[data-shape="shape-1"] .map-shape-body')!.getAttribute('d')
    ).toBe('M 100 100 L 500 100 L 500 500 Z')
    await select()
    const c = document.querySelector<HTMLElement>('.map-handle.corner')!
    expect([c.style.left, c.style.top]).toEqual(['100px', '100px'])
    const m = document.querySelector<HTMLElement>('.map-handle.middle')!
    expect([m.style.left, m.style.top]).toEqual(['300px', '100px'])
  })
})

describe('the map’s focus look', () => {
  // jsdom applies no user-agent styles, so this is read from the source:
  // Chromium rings a focused SVG shape in an orange box, even on a click.
  it('turns off the browser’s own ring on every focused shape, not only keyboard focus', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles/retro.css'), 'utf8')
    expect(css).toMatch(/\.map-shape-body:focus\s*\{[^}]*outline:\s*none/)
  })
})
