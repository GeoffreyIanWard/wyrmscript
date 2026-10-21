// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MapMark, MapPin, MapShape, ProjectInfo } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import {
  describeMark,
  labelAnchor,
  STAMP_ART,
  STAMP_H,
  stampNameAt
} from '../src/renderer/src/lib/mapMarks'

/**
 * F-12, part 4: stamps, free labels, and names on anything. jsdom lays
 * nothing out, so the map's box sits at (0, 0) and a click at a client point
 * is that map point at 100%.
 */

describe('where names go', () => {
  it('names an outline at the middle of its area, not the average of its points', () => {
    // A crescent: most of its points crowd one horn, so their average falls
    // near that horn; the centroid of the area does not.
    const crescent = {
      kind: 'land' as const,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 90 },
        { x: 0, y: 80 },
        { x: 0, y: 70 }
      ]
    }
    expect(labelAnchor(crescent)).toEqual({ x: 50, y: 50 })
    // A shape with no area falls back to the average of its points.
    expect(
      labelAnchor({
        kind: 'area',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 }
        ]
      })
    ).toEqual({ x: 10, y: 0 })
  })

  it('names a line halfway along its length, not at its middle point', () => {
    const river = {
      kind: 'river' as const,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 100, y: 0 }
      ]
    }
    expect(labelAnchor(river)).toEqual({ x: 50, y: 0 })
    expect(
      labelAnchor({
        kind: 'road',
        points: [
          { x: 5, y: 5 },
          { x: 5, y: 5 }
        ]
      })
    ).toEqual({
      x: 5,
      y: 5
    })
  })

  it('puts a stamp’s name under it, and says what a mark is', () => {
    expect(stampNameAt({ x: 10, y: 10 })).toEqual({ x: 10, y: 10 + STAMP_H / 2 + 2 })
    expect(describeMark('forest')).toBe('Forest')
    expect(describeMark('forest', 'Hollin Wood')).toBe('Forest, “Hollin Wood”')
    expect(describeMark('label', 'The Grey Sound')).toBe('Label “The Grey Sound”')
  })

  it('has art for every stamp, all of it ink lines on paper bodies', () => {
    for (const art of Object.values(STAMP_ART)) {
      expect(art.lines.length).toBeGreaterThan(0)
      expect(`${art.body} ${art.lines} ${art.solid ?? ''}`).toMatch(/^[MLHVQAZC0-9 .-]+$/)
    }
  })
})

/* ---------- the view ---------- */

const now = new Date().toISOString()
const mark = (over: Partial<MapMark> = {}): MapMark => ({
  id: 'm1',
  kind: 'forest',
  x: 200,
  y: 150,
  created: now,
  modified: now,
  ...over
})
const land: MapShape = {
  id: 's1',
  kind: 'land',
  points: [
    { x: 100, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 400 },
    { x: 100, y: 400 }
  ],
  created: now,
  modified: now
}

function project(): ProjectInfo {
  return { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } }
}

const REAL = (({
  createMapMarkAt,
  updateMapMarkAt,
  deleteMapMark,
  renameMapShapeAt,
  loadMapMarks,
  loadMapShapes,
  loadMapPins,
  showEntity
}) => ({
  createMapMarkAt,
  updateMapMarkAt,
  deleteMapMark,
  renameMapShapeAt,
  loadMapMarks,
  loadMapShapes,
  loadMapPins,
  showEntity
}))(useWyrm.getState())

interface Mocks {
  createMapMarkAt: ReturnType<typeof vi.fn>
  updateMapMarkAt: ReturnType<typeof vi.fn>
  deleteMapMark: ReturnType<typeof vi.fn>
  renameMapShapeAt: ReturnType<typeof vi.fn>
  showEntity: ReturnType<typeof vi.fn>
}

async function renderMap(
  marks: MapMark[] = [],
  shapes: MapShape[] = [],
  pins: MapPin[] = []
): Promise<Mocks & { r: ReturnType<typeof render> }> {
  const mocks: Mocks = {
    createMapMarkAt: vi.fn(async () => null),
    updateMapMarkAt: vi.fn(async () => {}),
    deleteMapMark: vi.fn(async () => {}),
    renameMapShapeAt: vi.fn(async () => {}),
    showEntity: vi.fn()
  }
  useWyrm.setState({
    project: project(),
    entities: pins.map((p) => ({
      id: p.entityId,
      type: 'world' as const,
      name: `Place ${p.entityId}`,
      aliases: [],
      created: now,
      modified: now
    })),
    mapPins: pins,
    mapShapes: [],
    mapMarks: [],
    mainView: { kind: 'map' },
    loadMapPins: vi.fn(async () => {}),
    loadMapShapes: vi.fn(async () => {
      useWyrm.setState({ mapShapes: shapes })
    }),
    loadMapMarks: vi.fn(async () => {
      useWyrm.setState({ mapMarks: marks })
    }),
    ...mocks
  })
  let r!: ReturnType<typeof render>
  await act(async () => {
    r = render(<WorldMap />)
  })
  return { ...mocks, r }
}

function pointer(el: Element, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}
const sizer = (): Element => document.querySelector('.map-sizer')!
const clickOn = async (el: Element, x: number, y: number): Promise<void> => {
  await act(async () => pointer(el, 'pointerdown', x, y))
  await act(async () => pointer(el, 'pointerup', x, y))
}
const clickMap = (x: number, y: number): Promise<void> => clickOn(sizer(), x, y)
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
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1))
  })
}
const hint = (): string => document.querySelector('.map-hint')?.textContent ?? ''
/** Why a name cannot be kept, said beside its field. */
const refusal = (): string => document.querySelector('.map-name-problem')?.textContent ?? ''
/** jsdom's window never has focus; the app's does, unless it is ⌘Tabbed away. */
const windowFocused = (yes = true): void => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(yes)
}
const field = (): HTMLInputElement | null => document.querySelector('.map-name-field')
const typeIn = async (value: string): Promise<void> => {
  await act(async () => {
    fireEvent.change(field()!, { target: { value } })
  })
}
const stamp = (id = 'm1'): Element => document.querySelector(`[data-mark="${id}"]`)!
function listenForBack(): { back: ReturnType<typeof vi.fn>; done: () => void } {
  const back = vi.fn()
  const listen = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') back(e)
  }
  window.addEventListener('keydown', listen)
  return { back, done: () => window.removeEventListener('keydown', listen) }
}

afterEach(() => {
  cleanup()
  window.dispatchEvent(new Event('blur'))
  vi.useRealTimers()
  vi.restoreAllMocks()
  useWyrm.setState({
    ...REAL,
    project: null,
    mapShapes: [],
    mapMarks: [],
    mapPins: [],
    mainView: { kind: 'doc' }
  })
})

describe('stamping', () => {
  it('puts a stamp down at every click', async () => {
    const m = await renderMap()
    await tool('Mountain')
    await clickMap(120, 80)
    await clickMap(150, 90)
    expect(m.createMapMarkAt).toHaveBeenNthCalledWith(1, '/demo', 'mountain', 120, 80)
    expect(m.createMapMarkAt).toHaveBeenNthCalledWith(2, '/demo', 'mountain', 150, 90)
    await tool('Town')
    await clickMap(300, 300)
    expect(m.createMapMarkAt).toHaveBeenLastCalledWith('/demo', 'town', 300, 300)
  })

  it('says each stamp went down, and takes a double-click as one stamp', async () => {
    const m = await renderMap()
    m.createMapMarkAt.mockImplementation(async () => mark())
    await tool('Mountain')
    await clickMap(120, 80)
    expect(hint()).toContain('Mountain put down.')
    await clickMap(120, 80)
    expect(m.createMapMarkAt).toHaveBeenCalledTimes(1)
    // The swallowed second click does not take the news away either.
    expect(hint()).toContain('Mountain put down.')
    await tool('Hills')
    expect(hint()).not.toContain('put down')
  })

  it('stamps from the keyboard, at the cursor', async () => {
    const m = await renderMap()
    await tool('Marsh')
    for (let i = 0; i < 5; i++) await key('ArrowRight', region(), { altKey: true })
    await key(' ')
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'marsh', 40, 0)
    expect(region().getAttribute('aria-label')).toContain('Space puts one down')
  })

  it('draws each stamp’s art over what is drawn, at its point', async () => {
    await renderMap([mark({ kind: 'town', name: 'Kell' })], [land])
    const g = stamp()
    expect(g.querySelector('.map-stamp-body')!.getAttribute('d')).toBe(STAMP_ART.town.body)
    expect(g.querySelector('.map-stamp-solid')).toBeTruthy()
    // Over the land: drawn after every shape.
    const art = [...document.querySelectorAll('.map-shape, .map-mark')]
    expect(art.indexOf(g)).toBeGreaterThan(art.indexOf(document.querySelector('.map-shape')!))
    expect(document.querySelector('.map-label.stamp-name')!.textContent).toBe('Kell')
  })

  it('keeps pins out of the way while stamping', async () => {
    const pin: MapPin = { id: 'p1', entityId: 'e1', x: 200, y: 200 }
    const m = await renderMap([], [], [pin])
    await tool('Forest')
    const el = document.querySelector('.world-map-pin[data-pin="p1"]')!
    await clickOn(el, 200, 200)
    expect(m.showEntity).not.toHaveBeenCalled()
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'forest', 200, 200)
  })
})

describe('free labels', () => {
  it('asks for the words where the click was, and makes the label only once it has some', async () => {
    const m = await renderMap()
    await tool('Label')
    await clickMap(300, 250)
    expect(m.createMapMarkAt).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field())
    expect(field()!.style.left).toBe('300px')
    await key('Enter', field()!)
    expect(m.createMapMarkAt).not.toHaveBeenCalled()
    expect(refusal()).toContain('A label needs some words')
    expect(document.querySelector('.map-name-problem')!.getAttribute('role')).toBe('alert')
    expect(field()!.getAttribute('aria-invalid')).toBe('true')
    expect(field()!.getAttribute('aria-describedby')).toBe('map-name-problem')
    expect(field()).toBeTruthy()
    await typeIn('  The Grey Sound ')
    await key('Enter', field()!)
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 300, 250, 'The Grey Sound')
    expect(field()).toBeNull()
  })

  it('drops a label on Esc without leaving the map, and on a blur when empty', async () => {
    const { back, done } = listenForBack()
    try {
      windowFocused()
      const m = await renderMap()
      await tool('Label')
      await clickMap(300, 250)
      await typeIn('Half a thought')
      await key('Escape', field()!)
      expect(field()).toBeNull()
      expect(back).not.toHaveBeenCalled()
      await clickMap(100, 100)
      await act(async () => field()!.blur())
      expect(field()).toBeNull()
      expect(m.createMapMarkAt).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('takes Return in a label opened after one was dropped', async () => {
    // A regression: the field remembered being "done" from the one before.
    const m = await renderMap()
    await tool('Label')
    await clickMap(100, 100)
    await key('Escape', field()!)
    await clickMap(200, 200)
    await typeIn('Northreach')
    await key('Enter', field()!)
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 200, 200, 'Northreach')
  })

  it('keeps a label typed and then clicked away from', async () => {
    windowFocused()
    const m = await renderMap()
    await tool('Label')
    await clickMap(100, 100)
    await typeIn('The Shallows')
    await act(async () => field()!.blur())
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 100, 100, 'The Shallows')
  })

  it('leaves the field open, half-typed, when the window loses focus', async () => {
    windowFocused(false)
    const m = await renderMap()
    await tool('Label')
    await clickMap(100, 100)
    await typeIn('The Sea of')
    await act(async () => field()!.blur())
    expect(field()!.value).toBe('The Sea of')
    expect(m.createMapMarkAt).not.toHaveBeenCalled()
  })

  it('keeps a label being typed when the map goes away under it', async () => {
    const m = await renderMap()
    await tool('Label')
    await clickMap(120, 90)
    await typeIn('The Sunless Sea')
    m.r.unmount()
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 120, 90, 'The Sunless Sea')
  })

  it('keeps a name being typed when the map goes away under it', async () => {
    const m = await renderMap([mark()], [land])
    await key('Enter', stamp())
    await key('Enter', stamp())
    await typeIn('Hollin Wood')
    m.r.unmount()
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { name: 'Hollin Wood' })
  })

  it('leaves the keyboard cursor at a label just made, not in the middle of the view', async () => {
    const m = await renderMap()
    await tool('Label')
    for (let i = 0; i < 5; i++) await key('ArrowRight', region(), { altKey: true })
    await key(' ')
    await typeIn('The Narrow Sea')
    await key('Enter', field()!)
    await settle()
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 40, 0, 'The Narrow Sea')
    expect(document.activeElement).toBe(region())
    expect(document.querySelector<HTMLElement>('.map-cursor')!.style.left).toBe('40px')
  })

  it('does not start another label from a press in the field', async () => {
    const m = await renderMap()
    await tool('Label')
    await clickMap(100, 100)
    await clickOn(field()!, 100, 100)
    expect(document.querySelectorAll('.map-name-field')).toHaveLength(1)
    expect(field()!.style.left).toBe('100px')
    expect(m.createMapMarkAt).not.toHaveBeenCalled()
  })

  it('shows a label as words that the hand can choose, and changes them on Return', async () => {
    const m = await renderMap([mark({ kind: 'label', name: 'The Grey Sound' })])
    const el = screen.getByRole('button', { name: /^Label “The Grey Sound”/ })
    expect(el.textContent).toBe('The Grey Sound')
    await key('Enter', el)
    expect(el.className).toContain('selected')
    expect(hint()).toContain('Return changes the words')
    await key('Enter', el)
    expect(field()!.value).toBe('The Grey Sound')
    await typeIn('')
    await key('Enter', field()!)
    expect(m.updateMapMarkAt).not.toHaveBeenCalled()
    expect(refusal()).toContain('A label needs some words')
    await typeIn('The Grey Deep')
    await key('Enter', field()!)
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { name: 'The Grey Deep' })
  })
})

describe('the hand, on marks', () => {
  it('moves a stamp on a drag, and leaves the view where it was', async () => {
    const m = await renderMap([mark()])
    const scroller = document.querySelector('.map-scroll') as HTMLElement
    scroller.scrollLeft = 100
    const el = stamp().querySelector('.map-mark-hit')!
    await act(async () => pointer(el, 'pointerdown', 200, 150))
    await act(async () => pointer(el, 'pointermove', 240, 130))
    await act(async () => pointer(el, 'pointerup', 240, 130))
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { x: 240, y: 130 })
    expect(scroller.scrollLeft).toBe(100)
    expect(stamp().getAttribute('class')).not.toContain('selected')
  })

  it('chooses a stamp on a still click, and lets go on a click elsewhere', async () => {
    await renderMap([mark()])
    await clickOn(stamp().querySelector('.map-mark-hit')!, 200, 150)
    expect(stamp().getAttribute('class')).toContain('selected')
    expect(hint()).toContain('Return names it')
    await clickMap(900, 900)
    expect(stamp().getAttribute('class')).not.toContain('selected')
  })

  it('names a stamp on a second Return, and gives the keyboard back to it', async () => {
    const m = await renderMap([mark()])
    const g = stamp() as SVGElement
    await act(async () => g.focus())
    await key('Enter', g)
    expect(field()).toBeNull()
    await key('Enter', g)
    expect(field()).toBeTruthy()
    const at = stampNameAt({ x: 200, y: 150 })
    expect([field()!.style.left, field()!.style.top]).toEqual([`${at.x}px`, `${at.y}px`])
    await typeIn('Hollin Wood')
    await key('Enter', field()!)
    await settle()
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { name: 'Hollin Wood' })
    expect(document.activeElement).toBe(stamp())
  })

  it('keeps a renamed shape or stamp when the field is clicked away from', async () => {
    windowFocused()
    const m = await renderMap([mark()], [land])
    const body = screen.getByRole('button', { name: /^Land, 4 points/ })
    await key('Enter', body)
    await key('Enter', body)
    await typeIn('Wendmark')
    await act(async () => field()!.blur())
    expect(m.renameMapShapeAt).toHaveBeenCalledWith('/demo', 's1', 'Wendmark')
    await key('Enter', stamp())
    await key('Enter', stamp())
    await typeIn('Hollin Wood')
    await act(async () => field()!.blur())
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { name: 'Hollin Wood' })
    expect(field()).toBeNull()
  })

  it('names a stamp or a label on a double-click with the hand', async () => {
    await renderMap([mark(), mark({ id: 'm2', kind: 'label', name: 'The Grey Sound' })])
    await act(async () => {
      fireEvent.doubleClick(stamp().querySelector('.map-mark-hit')!)
    })
    const at = stampNameAt({ x: 200, y: 150 })
    expect([field()!.style.left, field()!.style.top]).toEqual([`${at.x}px`, `${at.y}px`])
    expect(stamp().getAttribute('class')).toContain('selected')
    await key('Escape', field()!)
    await act(async () => {
      fireEvent.doubleClick(stamp('m2'))
    })
    expect(field()!.value).toBe('The Grey Sound')
  })

  it('moves a stamp with the pointer at any zoom', async () => {
    const m = await renderMap([mark()])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    })
    const el = stamp().querySelector('.map-mark-hit')!
    await act(async () => pointer(el, 'pointerdown', 400, 300))
    await act(async () => pointer(el, 'pointermove', 440, 280))
    expect(stamp().getAttribute('transform')).toMatch(/^translate\(202 125\)/)
    await act(async () => pointer(el, 'pointerup', 440, 280))
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { x: 220, y: 140 })
  })

  it('writes a stamp nudge still waiting when the map goes away', async () => {
    vi.useFakeTimers()
    const m = await renderMap([mark()])
    await key('ArrowLeft', stamp(), { altKey: true })
    expect(m.updateMapMarkAt).not.toHaveBeenCalled()
    m.r.unmount()
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { x: 192, y: 150 })
  })

  it('leaves a name as it was on Esc', async () => {
    const m = await renderMap([mark({ name: 'Hollin Wood' })])
    await key('Enter', stamp())
    await key('Enter', stamp())
    await typeIn('Something else')
    await key('Escape', field()!)
    expect(field()).toBeNull()
    expect(m.updateMapMarkAt).not.toHaveBeenCalled()
    expect(document.querySelector('.map-label.stamp-name')!.textContent).toBe('Hollin Wood')
  })

  it('nudges a stamp with Option and the arrows, and takes it off with Delete', async () => {
    vi.useFakeTimers()
    const m = await renderMap([mark()])
    for (let i = 0; i < 2; i++) await key('ArrowLeft', stamp(), { altKey: true })
    expect(m.updateMapMarkAt).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { x: 184, y: 150 })
    await act(async () => {
      fireEvent.keyDown(stamp(), { key: 'Delete' })
    })
    expect(m.deleteMapMark).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }))
  })

  it('offers marks to the keyboard and a screen reader only with the hand', async () => {
    await renderMap([mark({ name: 'Hollin Wood' }), mark({ id: 'm2', kind: 'label', name: 'Sea' })])
    expect(screen.getByRole('button', { name: /^Forest, “Hollin Wood”\./ })).toBeTruthy()
    await tool('Land')
    expect(screen.queryByRole('button', { name: /^Forest, “Hollin Wood”/ })).toBeNull()
    expect((stamp('m2') as HTMLElement).tabIndex).toBe(-1)
  })
})

describe('naming shapes', () => {
  it('names a shape chosen with Return, at the middle of the land', async () => {
    const m = await renderMap([], [land])
    const body = screen.getByRole('button', { name: /^Land, 4 points/ })
    await key('Enter', body)
    await key('Enter', body)
    expect([field()!.style.left, field()!.style.top]).toEqual(['250px', '250px'])
    await typeIn('Wendmark')
    await key('Enter', field()!)
    expect(m.renameMapShapeAt).toHaveBeenCalledWith('/demo', 's1', 'Wendmark')
  })

  it('names a shape on a double-click with the hand', async () => {
    await renderMap([], [{ ...land, name: 'Wendmark' }])
    await act(async () => {
      fireEvent.doubleClick(document.querySelector('[data-shape="s1"] .map-shape-body')!)
    })
    expect(field()!.value).toBe('Wendmark')
    // The name it is replacing is not drawn under the field.
    expect(document.querySelector('.map-label.feature')).toBeNull()
  })

  it('draws a shape’s name where it belongs, and tells a screen reader', async () => {
    await renderMap([], [{ ...land, name: 'Wendmark' }])
    const label = document.querySelector<HTMLElement>('.map-label.feature.land')!
    expect(label.textContent).toBe('Wendmark')
    expect([label.style.left, label.style.top]).toEqual(['250px', '250px'])
    expect(screen.getByRole('button', { name: /^Land, 4 points, “Wendmark”/ })).toBeTruthy()
  })

  it('does nothing on a double-click with a drawing tool', async () => {
    await renderMap([], [land])
    await tool('Mountain')
    await act(async () => {
      fireEvent.doubleClick(document.querySelector('[data-shape="s1"] .map-shape-body')!)
    })
    expect(field()).toBeNull()
  })
})

describe('the map’s extent', () => {
  it('never shrinks under a mark beyond its stored edge', async () => {
    await renderMap([mark({ x: 6000, y: 4000 })])
    const style = (sizer() as HTMLElement).style
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(6000)
    expect(parseFloat(style.height)).toBeGreaterThanOrEqual(4000)
  })
})
