// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Entity, MapBounds, MapPin, ProjectInfo } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import {
  boundsOf,
  clampTo,
  DEFAULT_BOUNDS,
  grow,
  GROW_STEP,
  placeAt,
  scrollToCentre,
  stepZoom,
  toMap
} from '../src/renderer/src/lib/worldMap'

/**
 * F-12: the world map as a full-window place. A location is "on the map"
 * purely by having a MapPin; the map's extent is a `MapBounds` on the
 * project, grown by moving its origin so nothing on it ever moves.
 */

describe('the map’s extent', () => {
  it('starts at the default, and takes in any pin that lies outside it', () => {
    expect(boundsOf(undefined)).toEqual(DEFAULT_BOUNDS)
    expect(boundsOf(undefined, [{ x: -50, y: 2000 }])).toEqual({
      x: -50,
      y: 0,
      width: DEFAULT_BOUNDS.width + 50,
      height: 2000
    })
  })

  it('grows north and west by moving the origin, south and east by size alone', () => {
    const b: MapBounds = { x: 0, y: 0, width: 1000, height: 800 }
    expect(grow(b, 'north')).toEqual({ x: 0, y: -GROW_STEP, width: 1000, height: 800 + GROW_STEP })
    expect(grow(b, 'west')).toEqual({ x: -GROW_STEP, y: 0, width: 1000 + GROW_STEP, height: 800 })
    expect(grow(b, 'south')).toEqual({ ...b, height: 800 + GROW_STEP })
    expect(grow(b, 'east')).toEqual({ ...b, width: 1000 + GROW_STEP })
  })

  it('keeps a point on the map, rounded to a pixel', () => {
    const b: MapBounds = { x: -100, y: 0, width: 500, height: 300 }
    expect(clampTo(b, { x: -500, y: 400.6 })).toEqual({ x: -100, y: 300 })
    expect(clampTo(b, { x: 10.4, y: 20.6 })).toEqual({ x: 10, y: 21 })
  })
})

describe('looking at the map', () => {
  const b: MapBounds = { x: -400, y: -200, width: 2000, height: 1000 }

  it('turns a point in the view into a point on the map at any zoom', () => {
    expect(toMap(b, 1, { x: 400, y: 200 })).toEqual({ x: 0, y: 0 })
    expect(toMap(b, 2, { x: 800, y: 400 })).toEqual({ x: 0, y: 0 })
    expect(toMap(b, 0.5, { x: 200, y: 100 })).toEqual({ x: 0, y: 0 })
  })

  it('scrolls a point to the middle of the view, never past the start', () => {
    expect(scrollToCentre(b, 1, { x: 0, y: 0 }, { width: 200, height: 100 })).toEqual({
      x: 300,
      y: 150
    })
    expect(scrollToCentre(b, 1, { x: -400, y: -200 }, { width: 200, height: 100 })).toEqual({
      x: 0,
      y: 0
    })
  })

  it('zooms in whole and half steps, and stays put at either end', () => {
    expect(stepZoom(1, 1)).toBe(2)
    expect(stepZoom(2, 1)).toBe(2)
    expect(stepZoom(1, -1)).toBe(0.5)
    expect(stepZoom(0.5, -1)).toBe(0.5)
  })

  it('places a fresh pin at the middle, nudged off any pin already there', () => {
    expect(placeAt({ x: 100, y: 100 }, [])).toEqual({ x: 100, y: 100 })
    expect(placeAt({ x: 100, y: 100 }, [{ x: 100, y: 100 }])).toEqual({ x: 124, y: 124 })
  })
})

/* ---------- the view ---------- */

/** The store's own actions, captured before any test swaps in a mock, and
 *  put back after each — the store is shared by every test in the file. */
const REAL = (({
  setMapPin,
  moveMapPinAt,
  removeMapPin,
  showEntity,
  setMapBounds,
  loadMapPins
}) => ({
  setMapPin,
  moveMapPinAt,
  removeMapPin,
  showEntity,
  setMapBounds,
  loadMapPins
}))(useWyrm.getState())

function place(id: string, name: string): Entity {
  const now = new Date().toISOString()
  return { id, type: 'world', name, aliases: [], body: '', created: now, modified: now }
}

function pin(overrides: Partial<MapPin> = {}): MapPin {
  const now = new Date().toISOString()
  return { id: 'pin-1', entityId: 'a', x: 100, y: 60, created: now, modified: now, ...overrides }
}

function project(mapBounds?: MapBounds): ProjectInfo {
  return { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [], mapBounds } }
}

function pointer(el: Element, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}

async function renderMap(
  entities: Entity[],
  mapPins: MapPin[],
  extra: Partial<{
    setMapPin: ReturnType<typeof vi.fn>
    moveMapPinAt: ReturnType<typeof vi.fn>
    removeMapPin: ReturnType<typeof vi.fn>
    showEntity: ReturnType<typeof vi.fn>
    setMapBounds: ReturnType<typeof vi.fn>
    mapBounds: MapBounds
    mainView: ReturnType<typeof useWyrm.getState>['mainView']
  }> = {}
): Promise<void> {
  useWyrm.setState({
    project: project(extra.mapBounds),
    entities,
    mapPins: [],
    mainView: extra.mainView ?? { kind: 'map' },
    loadMapPins: vi.fn(async () => {
      useWyrm.setState({ mapPins })
    }),
    setMapPin: extra.setMapPin ?? vi.fn(async () => {}),
    moveMapPinAt: extra.moveMapPinAt ?? vi.fn(async () => {}),
    removeMapPin: extra.removeMapPin ?? vi.fn(async () => {}),
    showEntity: extra.showEntity ?? vi.fn(),
    setMapBounds: extra.setMapBounds ?? vi.fn(async () => {})
  })
  await act(async () => {
    render(<WorldMap />)
  })
}

const pinEl = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${name}\\.`) })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  useWyrm.setState({
    ...REAL,
    entities: [],
    mapPins: [],
    project: null,
    mainView: { kind: 'doc' }
  })
})

describe('the world map', () => {
  it('says what a place is when there are none', async () => {
    await renderMap([], [])
    expect(screen.getByText(/A World Book entry is a place/)).toBeTruthy()
  })

  it('lists a place not yet on the map, and places it on request', async () => {
    const setMapPin = vi.fn(async () => {})
    await renderMap([place('a', 'Harrowgate')], [], { setMapPin })
    expect(screen.getByText('NOT ON THE MAP')).toBeTruthy()
    expect(screen.queryByText('ON THE MAP')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Put Harrowgate on the map' }))
    })
    // jsdom's view has no size, so its middle is the map's corner.
    expect(setMapPin).toHaveBeenCalledWith('a', 0, 0)
  })

  it('draws a placed one where its pin says, measured from the map’s origin', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin({ x: 100, y: 60 })], {
      mapBounds: { x: -400, y: -400, width: 3000, height: 2000 }
    })
    const el = pinEl('Harrowgate')
    expect([el.style.left, el.style.top]).toEqual(['500px', '460px'])
    expect(screen.getByText('ON THE MAP')).toBeTruthy()
  })

  it('opens the place on a click, as a detour back to the map', async () => {
    const showEntity = vi.fn()
    await renderMap([place('a', 'Harrowgate')], [pin()], { showEntity })
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    scroller.scrollLeft = 300
    scroller.scrollTop = 200
    const el = pinEl('Harrowgate')
    await act(async () => pointer(el, 'pointerdown', 10, 10))
    await act(async () => pointer(el, 'pointerup', 11, 11))
    expect(showEntity).toHaveBeenCalledWith('a', {
      kind: 'map',
      zoom: 1,
      scrollLeft: 300,
      scrollTop: 200,
      focusPin: 'pin-1'
    })
  })

  it('moves the pin on a real drag instead of opening the place, in its own project', async () => {
    const moveMapPinAt = vi.fn(async () => {})
    const showEntity = vi.fn()
    await renderMap([place('a', 'Harrowgate')], [pin({ x: 100, y: 60 })], {
      moveMapPinAt,
      showEntity
    })
    const el = pinEl('Harrowgate')
    await act(async () => pointer(el, 'pointerdown', 10, 10))
    await act(async () => pointer(el, 'pointermove', 60, 40))
    // Follows the pointer before anything is written.
    expect([el.style.left, el.style.top]).toEqual(['150px', '90px'])
    await act(async () => pointer(el, 'pointerup', 60, 40))
    expect(moveMapPinAt).toHaveBeenCalledWith('/demo', 'pin-1', 150, 90)
    expect(showEntity).not.toHaveBeenCalled()
  })

  it('opens the place on Return', async () => {
    const showEntity = vi.fn()
    await renderMap([place('a', 'Harrowgate')], [pin()], { showEntity })
    await act(async () => {
      fireEvent.keyDown(pinEl('Harrowgate'), { key: 'Enter' })
    })
    expect(showEntity).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'map' }))
  })

  it('nudges a pin with Option and the arrows, and writes once it stops', async () => {
    vi.useFakeTimers()
    const moveMapPinAt = vi.fn(async () => {})
    await renderMap([place('a', 'Harrowgate')], [pin({ x: 100, y: 60 })], { moveMapPinAt })
    const el = pinEl('Harrowgate')
    for (let i = 0; i < 3; i++)
      await act(async () => {
        fireEvent.keyDown(el, { key: 'ArrowRight', altKey: true })
      })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'ArrowDown', altKey: true, shiftKey: true })
    })
    expect([el.style.left, el.style.top]).toEqual(['124px', '100px'])
    expect(moveMapPinAt).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(moveMapPinAt).toHaveBeenCalledTimes(1)
    expect(moveMapPinAt).toHaveBeenCalledWith('/demo', 'pin-1', 124, 100)
  })

  it('takes a place off the map without touching the entry', async () => {
    const removeMapPin = vi.fn(async () => {})
    const p = pin()
    await renderMap([place('a', 'Harrowgate')], [p], { removeMapPin })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Take Harrowgate off the map' }))
    })
    expect(removeMapPin).toHaveBeenCalledWith(p)
  })

  it('zooms in and out in steps, sizing the scroll area to the zoomed map', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin()])
    const sizer = document.querySelector('.map-sizer') as HTMLElement
    expect(sizer.style.width).toBe(`${DEFAULT_BOUNDS.width}px`)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    })
    expect(sizer.style.width).toBe(`${DEFAULT_BOUNDS.width * 2}px`)
    expect(screen.getByText('200%')).toBeTruthy()
    // Unavailable, but not `disabled`: that would drop focus to <body>.
    const zin = screen.getByRole('button', { name: 'Zoom in' })
    expect(zin.getAttribute('aria-disabled')).toBe('true')
    expect(zin).toHaveProperty('disabled', false)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    })
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zoom out' }).getAttribute('aria-disabled')).toBe(
      'true'
    )
  })

  it('grows the map north by moving its edge, not the places on it', async () => {
    const setMapBounds = vi.fn(async () => {})
    await renderMap([place('a', 'Harrowgate')], [pin({ x: 100, y: 60 })], { setMapBounds })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'More map to the north' }))
    })
    expect(setMapBounds).toHaveBeenCalledWith({
      ...DEFAULT_BOUNDS,
      y: -GROW_STEP,
      height: DEFAULT_BOUNDS.height + GROW_STEP
    })
  })

  it('pans when the map itself is dragged, but not from its scroll bars', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin()])
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    const canvas = document.querySelector('.map-canvas') as HTMLElement
    scroller.scrollLeft = 300
    scroller.scrollTop = 200
    await act(async () => pointer(canvas, 'pointerdown', 400, 300))
    await act(async () => pointer(canvas, 'pointermove', 350, 260))
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([350, 240])
    await act(async () => pointer(canvas, 'pointerup', 350, 260))
    // The scroll bar belongs to the scroller itself, not the map.
    await act(async () => pointer(scroller, 'pointerdown', 10, 10))
    await act(async () => pointer(scroller, 'pointermove', 100, 100))
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([350, 240])
  })

  it('comes back from a place scrolled and zoomed as it was, with that pin focused, once', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin()], {
      mainView: { kind: 'map', zoom: 2, scrollLeft: 120, scrollTop: 80, focusPin: 'pin-1' }
    })
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(pinEl('Harrowgate')))
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([120, 80])
    expect(screen.getByText('200%')).toBeTruthy()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'map' })
  })
})

describe('the world map, carefully', () => {
  const realBounds = (): ReturnType<typeof vi.fn> =>
    vi.fn(async (b: MapBounds) => {
      const p = useWyrm.getState().project!
      useWyrm.setState({ project: { ...p, data: { ...p.data, mapBounds: b } } })
    })

  it('keeps the view still when the map grows north or west, at any zoom', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin()], { setMapBounds: realBounds() })
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    scroller.scrollLeft = 50
    scroller.scrollTop = 100
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'More map to the north' }))
    })
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([50, 100 + GROW_STEP])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    })
    const before = scroller.scrollLeft
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'More map to the west' }))
    })
    expect(scroller.scrollLeft).toBe(before + GROW_STEP * 2)
  })

  it('keeps the middle of the view in the middle across a zoom', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin()])
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    // jsdom's view has no size, so its middle is the scroll offset less the
    // desk round the map.
    scroller.scrollLeft = 324
    scroller.scrollTop = 224
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    })
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([624, 424])
  })

  it('moves a pin by map distance at 50%, not screen distance', async () => {
    const moveMapPinAt = vi.fn(async () => {})
    await renderMap([place('a', 'Harrowgate')], [pin({ x: 100, y: 60 })], { moveMapPinAt })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    })
    const el = pinEl('Harrowgate')
    // Drawn at half size, outside the scaled art, so its name stays legible.
    expect([el.style.left, el.style.top]).toEqual(['50px', '30px'])
    await act(async () => pointer(el, 'pointerdown', 10, 10))
    await act(async () => pointer(el, 'pointermove', 60, 40))
    await act(async () => pointer(el, 'pointerup', 60, 40))
    expect(moveMapPinAt).toHaveBeenCalledWith('/demo', 'pin-1', 200, 120)
  })

  it('writes a nudge still waiting when the map goes away', async () => {
    vi.useFakeTimers()
    const moveMapPinAt = vi.fn(async () => {})
    await renderMap([place('a', 'Harrowgate')], [pin({ x: 100, y: 60 })], { moveMapPinAt })
    await act(async () => {
      fireEvent.keyDown(pinEl('Harrowgate'), { key: 'ArrowRight', altKey: true })
    })
    expect(moveMapPinAt).not.toHaveBeenCalled()
    cleanup()
    expect(moveMapPinAt).toHaveBeenCalledWith('/demo', 'pin-1', 108, 60)
    vi.advanceTimersByTime(400)
    expect(moveMapPinAt).toHaveBeenCalledTimes(1)
  })

  it('does not bring a removed pin back with a nudge that was still waiting', async () => {
    vi.useFakeTimers()
    const moveMapPinAt = vi.fn(async () => {})
    const removeMapPin = vi.fn(async () => {})
    await renderMap([place('a', 'Harrowgate')], [pin()], { moveMapPinAt, removeMapPin })
    await act(async () => {
      fireEvent.keyDown(pinEl('Harrowgate'), { key: 'ArrowRight', altKey: true })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Take Harrowgate off the map' }))
    })
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(removeMapPin).toHaveBeenCalled()
    expect(moveMapPinAt).not.toHaveBeenCalled()
  })

  it('treats a cancelled gesture as neither a click nor a drop', async () => {
    const moveMapPinAt = vi.fn(async () => {})
    const showEntity = vi.fn()
    await renderMap([place('a', 'Harrowgate')], [pin({ x: 100, y: 60 })], {
      moveMapPinAt,
      showEntity
    })
    const el = pinEl('Harrowgate')
    await act(async () => pointer(el, 'pointerdown', 10, 10))
    await act(async () => pointer(el, 'pointermove', 60, 40))
    await act(async () => pointer(el, 'pointercancel', 60, 40))
    expect(showEntity).not.toHaveBeenCalled()
    expect(moveMapPinAt).not.toHaveBeenCalled()
    expect([el.style.left, el.style.top]).toEqual(['100px', '60px'])
  })

  it('places at the middle of the view, clear of a pin already there, and focuses the new pin', async () => {
    const setMapPin = vi.fn(async (entityId: string, x: number, y: number) => {
      useWyrm.setState({
        mapPins: [...useWyrm.getState().mapPins, pin({ id: 'pin-new', entityId, x, y })]
      })
    })
    await renderMap(
      [place('a', 'Harrowgate'), place('b', 'Winter Court')],
      [pin({ entityId: 'b', x: 300, y: 200 })],
      {
        setMapPin
      }
    )
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    scroller.scrollLeft = 324
    scroller.scrollTop = 224
    window.dispatchEvent(new Event('blur'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Put Harrowgate on the map' }))
    })
    expect(setMapPin).toHaveBeenCalledWith('a', 324, 224)
    await waitFor(() => expect(document.activeElement).toBe(pinEl('Harrowgate')))
  })

  it('finds a placed one: scrolls to it and focuses its pin', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin({ x: 900, y: 700 })])
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find Harrowgate on the map' }))
    })
    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([924, 724])
    expect(document.activeElement).toBe(pinEl('Harrowgate'))
  })

  it('keeps a pin whose place was deleted removable, and opens nothing for it', async () => {
    const removeMapPin = vi.fn(async () => {})
    const showEntity = vi.fn()
    const orphan = pin({ id: 'pin-x', entityId: 'gone' })
    await renderMap([place('a', 'Harrowgate')], [orphan], { removeMapPin, showEntity })
    const el = screen.getByRole('button', { name: /^\(deleted\)\./ })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(showEntity).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Take (deleted) off the map' }))
    })
    expect(removeMapPin).toHaveBeenCalledWith(orphan)
  })

  it('moves the view with the arrow keys from the map itself, Shift further', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin()])
    const region = screen.getByRole('region', { name: /^World map\./ })
    await act(async () => {
      fireEvent.keyDown(region, { key: 'ArrowRight' })
    })
    await act(async () => {
      fireEvent.keyDown(region, { key: 'ArrowDown', shiftKey: true })
    })
    expect([region.scrollLeft, region.scrollTop]).toEqual([60, 300])
    // Arrows on a pin are the pin's, not the view's.
    await act(async () => {
      fireEvent.keyDown(pinEl('Harrowgate'), { key: 'ArrowRight' })
    })
    expect(region.scrollLeft).toBe(60)
  })

  it('reads the pins again only when the project changes, not on every save', async () => {
    await renderMap([place('a', 'Harrowgate')], [pin()], { setMapBounds: realBounds() })
    const calls = (useWyrm.getState().loadMapPins as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'More map to the east' }))
    })
    expect((useWyrm.getState().loadMapPins as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      calls
    )
  })
})

describe('getting to the map', () => {
  it('is a detour: Esc goes back to what was on screen', () => {
    useWyrm.setState({ mainView: { kind: 'corkboard' }, viewHistory: [] })
    useWyrm.getState().showMap()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'map' })
    expect(useWyrm.getState().goBack()).toBe(true)
    expect(useWyrm.getState().mainView).toEqual({ kind: 'corkboard' })
  })
})

describe('pins in the store', () => {
  const now = new Date().toISOString()
  const p1: MapPin = { id: 'pin-1', entityId: 'a', x: 1, y: 2, created: now, modified: now }

  it('moves a pin in the project it is addressed to, focused or not', async () => {
    const { api } = await import('../src/renderer/src/lib/api')
    const write = vi.spyOn(api, 'writeMapPin').mockResolvedValue()
    useWyrm.setState({
      project: project(),
      mapPins: [],
      parked: { '/other': { ...useWyrm.getState(), mapPins: [p1] } as never }
    })
    await useWyrm.getState().moveMapPinAt('/other', 'pin-1', 50, 60)
    expect(write).toHaveBeenCalledWith('/other', { ...p1, x: 50, y: 60 })
    expect(useWyrm.getState().parked['/other'].mapPins).toEqual([{ ...p1, x: 50, y: 60 }])
    // The project in front is untouched.
    expect(useWyrm.getState().mapPins).toEqual([])
    useWyrm.setState({ parked: {} })
  })

  it('never creates a pin: a move for one already removed is nothing', async () => {
    const { api } = await import('../src/renderer/src/lib/api')
    const write = vi.spyOn(api, 'writeMapPin').mockResolvedValue()
    useWyrm.setState({ project: project(), mapPins: [] })
    await useWyrm.getState().moveMapPinAt('/demo', 'pin-1', 50, 60)
    expect(write).not.toHaveBeenCalled()
  })

  it('takes a place’s pin with it when the place is deleted', async () => {
    const { api } = await import('../src/renderer/src/lib/api')
    vi.spyOn(api, 'deleteEntity').mockResolvedValue()
    const del = vi.spyOn(api, 'deleteMapPin').mockResolvedValue()
    const e = place('a', 'Harrowgate')
    useWyrm.setState({ project: project(), entities: [e], mapPins: [p1] })
    await useWyrm.getState().deleteEntity(e)
    expect(del).toHaveBeenCalledWith('/demo', 'pin-1')
    expect(useWyrm.getState().mapPins).toEqual([])
  })
})
