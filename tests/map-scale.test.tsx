// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MapScale, ProjectInfo } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { api } from '../src/renderer/src/lib/api'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import {
  describeRoute,
  formatDays,
  formatDistance,
  routeLength,
  scaleBar,
  toUnits,
  validScale
} from '../src/renderer/src/lib/mapScale'

/**
 * F-12: the map's scale and the Measure tool. "How long does this journey
 * take?" is a plotting question the map can answer once it knows what its
 * distances are. jsdom lays nothing out: a click at a client point is that
 * map point at 100%.
 */

const scale: MapScale = {
  pixels: 100,
  distance: 20,
  unit: 'miles',
  perDay: { foot: 20, horse: 40, ship: 100 }
}

describe('the arithmetic', () => {
  it('measures a route along its legs, in map pixels and in the scale’s units', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 300, y: 400 },
      { x: 300, y: 500 }
    ]
    expect(routeLength(route)).toBe(600)
    expect(routeLength(route.slice(0, 1))).toBe(0)
    expect(toUnits(600, scale)).toBe(120)
  })

  it('says days to the half day, and under a day below one', () => {
    expect(formatDays(0.4)).toBe('under a day')
    expect(formatDays(1)).toBe('1 day')
    expect(formatDays(1.3)).toBe('1½ days')
    expect(formatDays(1.8)).toBe('2 days')
    expect(formatDays(6.74)).toBe('6½ days')
    expect(formatDays(Infinity)).toBe('under a day')
  })

  it('says a distance to two figures under ten, whole from ten up', () => {
    expect(formatDistance(4.26, 'leagues')).toBe('4.3 leagues')
    expect(formatDistance(1234.6, 'miles')).toBe('1,235 miles')
    expect(formatDistance(12.34, 'miles')).toBe('12 miles')
    // A town plan's small lengths are never rounded to more, or to nothing.
    expect(formatDistance(0.05, 'miles')).toBe('0.05 miles')
    expect(formatDistance(0.02, 'miles')).toBe('0.02 miles')
  })

  it('tells a route in full: how far, and how long each way of going takes', () => {
    expect(describeRoute(600, scale)).toBe(
      '120 miles — on foot 6 days, on horseback 3 days, by ship 1 day'
    )
  })

  it('draws a round length near the size it aims for, at any zoom', () => {
    // 100 px is 20 miles: 120 screen px at 100% is 24 miles, nearest 20.
    expect(scaleBar(scale, 1)).toEqual({ units: 20, screen: 100 })
    // At 50%, 120 screen px is 48 miles, nearest 50.
    expect(scaleBar(scale, 0.5)).toEqual({ units: 50, screen: 125 })
    expect(scaleBar({ ...scale, distance: 3 }, 2).units).toBe(2)
    // Wanting about 9: ten is nearer than five.
    expect(scaleBar({ ...scale, distance: 7.5 }, 1).units).toBe(10)
  })

  it('takes only a scale whose every number is above nought, and has a unit', () => {
    expect(validScale(scale)).toBe(true)
    expect(validScale(undefined)).toBe(false)
    expect(validScale({ ...scale, pixels: 0 })).toBe(false)
    expect(validScale({ ...scale, distance: NaN })).toBe(false)
    expect(validScale({ ...scale, unit: ' ' })).toBe(false)
    expect(validScale({ ...scale, perDay: { ...scale.perDay, ship: -1 } })).toBe(false)
    // Half-formed, as a hand edit or a merge can leave it: no scale, no crash.
    expect(validScale({ pixels: 100, distance: 20, unit: 'miles' })).toBe(false)
    expect(validScale({ ...scale, perDay: null })).toBe(false)
    expect(validScale({ ...scale, unit: 5 })).toBe(false)
    expect(validScale('100 miles')).toBe(false)
  })
})

/* ---------- the view ---------- */

function project(mapScale?: MapScale): ProjectInfo {
  return {
    path: '/demo',
    data: { version: 1, title: 'T', binder: [], trash: [], ...(mapScale ? { mapScale } : {}) }
  }
}

const REAL = (({ setMapScale, loadMapPins, loadMapShapes, loadMapMarks }) => ({
  setMapScale,
  loadMapPins,
  loadMapShapes,
  loadMapMarks
}))(useWyrm.getState())

async function renderMap(mapScale?: MapScale): Promise<{ setMapScale: ReturnType<typeof vi.fn> }> {
  const setMapScale = vi.fn(async (next: MapScale | null) => {
    const p = useWyrm.getState().project!
    useWyrm.setState({
      project: {
        ...p,
        data: { ...p.data, ...(next ? { mapScale: next } : { mapScale: undefined }) }
      }
    })
  })
  useWyrm.setState({
    project: project(mapScale),
    entities: [],
    mapPins: [],
    mapShapes: [],
    mapMarks: [],
    mainView: { kind: 'map' },
    loadMapPins: vi.fn(async () => {}),
    loadMapShapes: vi.fn(async () => {}),
    loadMapMarks: vi.fn(async () => {}),
    setMapScale
  })
  await act(async () => {
    render(<WorldMap />)
  })
  return { setMapScale }
}

function pointer(el: Element, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}
const sizer = (): Element => document.querySelector('.map-sizer')!
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
const key = async (k: string, on: Element = region()): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(on, { key: k, code: k })
    fireEvent.keyUp(on, { key: k, code: k })
  })
}
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1))
  })
}
const hint = (): string => document.querySelector('.map-hint')?.textContent ?? ''
const route = (): string | null =>
  document.querySelector('.map-measure path')?.getAttribute('d') ?? null

afterEach(() => {
  cleanup()
  window.dispatchEvent(new Event('blur'))
  vi.restoreAllMocks()
  useWyrm.setState({ ...REAL, project: null, mainView: { kind: 'doc' } })
})

describe('measuring', () => {
  it('measures a route in map pixels until there is a scale', async () => {
    await renderMap()
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(300, 400)
    expect(route()).toBe('M 0 0 L 300 400 L 300 400')
    expect(hint()).toContain('500 map pixels. Set the scale to see miles and days.')
    expect(screen.getByRole('button', { name: 'Set Scale…' })).toBeTruthy()
  })

  it('tells distance and travel time once there is', async () => {
    await renderMap(scale)
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(300, 400)
    await key('Enter')
    expect(hint()).toBe('100 miles — on foot 5 days, on horseback 2½ days, by ship 1 day')
    // Finished: the line stops at its last point.
    expect(route()).toBe('M 0 0 L 300 400')
  })

  it('starts another route with the first click after one is finished', async () => {
    await renderMap(scale)
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(100, 0)
    await key('Enter')
    await clickMap(500, 500)
    expect(route()).toBe('M 500 500 L 500 500')
  })

  it('takes the last point back on Backspace, and clears on Esc without leaving the map', async () => {
    const back = vi.fn()
    const listen = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', listen)
    try {
      await renderMap(scale)
      await tool('Measure')
      await clickMap(0, 0)
      await clickMap(100, 0)
      await clickMap(100, 100)
      await key('Backspace')
      // The point and the line to it are both gone.
      expect(route()).toBe('M 0 0 L 100 0')
      await key('Escape')
      expect(route()).toBeNull()
      expect(back).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', listen)
    }
  })

  it('measures from the keyboard: Space puts a point down at the cursor', async () => {
    await renderMap(scale)
    await tool('Measure')
    await key(' ')
    for (let i = 0; i < 5; i++)
      await act(async () => {
        fireEvent.keyDown(region(), { key: 'ArrowRight', code: 'ArrowRight', altKey: true })
        fireEvent.keyUp(region(), { key: 'ArrowRight', code: 'ArrowRight', altKey: true })
      })
    await key(' ')
    await key('Enter')
    expect(hint()).toContain('8 miles')
    expect(region().getAttribute('aria-label')).toContain('Measuring')
  })

  it('finishes on a double-click, as one point however it was clicked', async () => {
    await renderMap(scale)
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(300, 400)
    await clickMap(300, 400)
    await act(async () => {
      fireEvent.doubleClick(sizer())
    })
    expect(route()).toBe('M 0 0 L 300 400')
    expect(hint()).toBe('100 miles — on foot 5 days, on horseback 2½ days, by ship 1 day')
  })

  it('leaves a finished route alone on Backspace', async () => {
    await renderMap(scale)
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(100, 0)
    await key('Enter')
    await key('Backspace')
    expect(route()).toBe('M 0 0 L 100 0')
  })

  it('runs the line to the keyboard’s cursor, as it does to the pointer', async () => {
    await renderMap(scale)
    await tool('Measure')
    const nudge = async (): Promise<void> => {
      await act(async () => {
        fireEvent.keyDown(region(), { key: 'ArrowRight', code: 'ArrowRight', altKey: true })
        fireEvent.keyUp(region(), { key: 'ArrowRight', code: 'ArrowRight', altKey: true })
      })
    }
    await key(' ')
    await nudge()
    expect(route()).toBe('M 0 0 L 8 0')
    await nudge()
    await key(' ')
    await nudge()
    expect(route()).toBe('M 0 0 L 16 0 L 24 0')
    await key('Backspace')
    expect(route()).toBe('M 0 0')
  })

  it('tells a screen reader the route at its placed points, not at every pointer move', async () => {
    await renderMap(scale)
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(300, 400)
    await act(async () => pointer(sizer(), 'pointermove', 600, 800))
    const live = document.querySelector('[role="status"]')!.textContent
    expect(live).toContain('100 miles')
    // The line the eye follows runs to the pointer.
    expect(hint()).toContain('200 miles')
  })

  it('forgets the route on a change of tool', async () => {
    await renderMap(scale)
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(100, 0)
    await tool('Hand')
    await tool('Measure')
    expect(route()).toBeNull()
  })
})

describe('setting the scale', () => {
  const openScale = async (): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Scale…$/ }))
    })
  }
  const panel = (): HTMLElement | null => document.querySelector('.map-scale-panel')
  const fields = (): HTMLInputElement[] => [...panel()!.querySelectorAll('input')]

  it('sets the scale from a measured route', async () => {
    const m = await renderMap()
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(300, 400)
    await key('Enter')
    await openScale()
    expect(panel()!.textContent).toContain('The route you measured is')
    await act(async () => {
      fireEvent.change(fields()[0], { target: { value: '150' } })
      fireEvent.change(fields()[1], { target: { value: 'leagues' } })
    })
    await key('Enter', fields()[0])
    await settle()
    expect(m.setMapScale).toHaveBeenCalledWith({
      pixels: 500,
      distance: 150,
      unit: 'leagues',
      perDay: { foot: 20, horse: 40, ship: 100 }
    })
    expect(panel()).toBeNull()
    expect(hint()).toContain('150 leagues')
  })

  it('saves against the route it was opened for, whatever happens to the route after', async () => {
    const m = await renderMap()
    await tool('Measure')
    await clickMap(0, 0)
    await clickMap(300, 400)
    await key('Enter')
    await openScale()
    // A click on the map starts another route while the panel is open.
    await clickMap(900, 900)
    expect(panel()!.textContent).toContain('The route you measured is')
    await act(async () => {
      fireEvent.change(fields()[0], { target: { value: '150' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set Scale' }))
    })
    expect(m.setMapScale).toHaveBeenCalledWith(
      expect.objectContaining({ pixels: 500, distance: 150 })
    )
  })

  it('saves on Return only once the key is up, and hands the keyboard back to its button', async () => {
    const m = await renderMap()
    await tool('Measure')
    await openScale()
    await act(async () => {
      fireEvent.change(fields()[0], { target: { value: '10' } })
      fireEvent.keyDown(fields()[0], { key: 'Enter', code: 'Enter' })
    })
    await settle()
    expect(m.setMapScale).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.keyUp(document.body, { key: 'Enter', code: 'Enter' })
    })
    await settle()
    expect(m.setMapScale).toHaveBeenCalledTimes(1)
    expect(panel()).toBeNull()
    expect(hint()).toContain('Scale set.')
    await settle()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Scale…$/ }))
  })

  it('refuses a blank unit, says so beside it, and trims one that is set', async () => {
    const m = await renderMap()
    await tool('Measure')
    await openScale()
    await act(async () => {
      fireEvent.change(fields()[1], { target: { value: '   ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set Scale' }))
    })
    expect(m.setMapScale).not.toHaveBeenCalled()
    expect(fields()[1].getAttribute('aria-invalid')).toBe('true')
    expect(fields()[0].getAttribute('aria-invalid')).toBeNull()
    expect(fields()[1].getAttribute('aria-describedby')).toBe(
      panel()!.querySelector('[role="alert"]')!.id
    )
    await act(async () => {
      fireEvent.change(fields()[1], { target: { value: ' leagues ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set Scale' }))
    })
    expect(m.setMapScale).toHaveBeenCalledWith(expect.objectContaining({ unit: 'leagues' }))
  })

  it('sets the scale from a grid square when nothing is measured', async () => {
    const m = await renderMap()
    await tool('Measure')
    await openScale()
    expect(panel()!.textContent).toContain('One square of the grid across is')
    await act(async () => {
      fireEvent.change(fields()[0], { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set Scale' }))
    })
    expect(m.setMapScale).toHaveBeenCalledWith(
      expect.objectContaining({ pixels: 100, distance: 10, unit: 'miles' })
    )
  })

  it('says why a scale cannot be set, and sets nothing', async () => {
    const m = await renderMap()
    await tool('Measure')
    await openScale()
    await act(async () => {
      fireEvent.change(fields()[0], { target: { value: 'far' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set Scale' }))
    })
    expect(m.setMapScale).not.toHaveBeenCalled()
    expect(panel()!.querySelector('[role="alert"]')!.textContent).toContain('a number above nought')
    await act(async () => {
      fireEvent.change(fields()[0], { target: { value: '10' } })
      fireEvent.change(fields()[3], { target: { value: '0' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set Scale' }))
    })
    expect(m.setMapScale).not.toHaveBeenCalled()
    expect(panel()!.querySelector('[role="alert"]')!.textContent).toContain(
      'day’s travel on horseback'
    )
    // Only the field at fault is marked.
    expect(fields()[3].getAttribute('aria-invalid')).toBe('true')
    expect(fields()[2].getAttribute('aria-invalid')).toBeNull()
  })

  it('closes on Esc without leaving the map or saving', async () => {
    const back = vi.fn()
    const listen = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', listen)
    try {
      const m = await renderMap()
      await tool('Measure')
      await openScale()
      await key('Escape', fields()[0])
      expect(panel()).toBeNull()
      expect(back).not.toHaveBeenCalled()
      expect(m.setMapScale).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', listen)
    }
  })

  it('takes the scale off', async () => {
    const m = await renderMap(scale)
    await tool('Measure')
    await openScale()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Scale' }))
    })
    expect(m.setMapScale).toHaveBeenCalledWith(null)
  })
})

describe('a scale that is not usable', () => {
  it.each([
    ['no day’s travel', { pixels: 100, distance: 20, unit: 'miles' }],
    ['a number for a unit', { ...scale, unit: 5 }]
  ])('opens the map anyway, with %s, and offers to set it', async (_, broken) => {
    await renderMap(broken as unknown as MapScale)
    expect(document.querySelector('.map-scale-bar')).toBeNull()
    await tool('Measure')
    expect(screen.getByRole('button', { name: 'Set Scale…' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Set Scale…' }))
    })
    expect(document.querySelector('.map-scale-panel')).toBeTruthy()
  })
})

describe('the scale bar', () => {
  it('shows a round length once there is a scale, and opens the scale from it', async () => {
    await renderMap()
    expect(document.querySelector('.map-scale-bar')).toBeNull()
    cleanup()
    await renderMap(scale)
    const bar = screen.getByRole('button', { name: /^Scale: this bar is 20 miles/ })
    expect((bar.querySelector('.map-scale-ruler') as HTMLElement).style.width).toBe('100px')
    await act(async () => {
      fireEvent.click(bar)
    })
    expect(document.querySelector('.map-scale-panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Measure' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('keeps a round length as the zoom changes', async () => {
    await renderMap(scale)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    })
    expect(screen.getByRole('button', { name: /^Scale: this bar is 50 miles/ })).toBeTruthy()
  })
})

describe('the scale in the project', () => {
  it('is saved with the project, and taken off by deleting it', async () => {
    const path = (await api.getLastProjectPath())!
    const info = (await api.openProjectPath(path))!
    useWyrm.setState({ ...REAL, project: info, booted: true })
    let before = useWyrm.getState().project
    await useWyrm.getState().setMapScale(scale)
    // A new project object, so everything showing the scale draws it.
    expect(useWyrm.getState().project).not.toBe(before)
    expect(useWyrm.getState().project!.data.mapScale).toEqual(scale)
    before = useWyrm.getState().project
    expect((await api.openProjectPath(path))!.data.mapScale).toEqual(scale)
    await useWyrm.getState().setMapScale(null)
    expect(useWyrm.getState().project).not.toBe(before)
    expect('mapScale' in useWyrm.getState().project!.data).toBe(false)
    expect('mapScale' in (await api.openProjectPath(path))!.data).toBe(false)
  })
})
