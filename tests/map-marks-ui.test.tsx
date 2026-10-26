// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MapMark, MapPin, MapShape, ProjectInfo } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import { MAP_STAMP_KINDS } from '../src/shared/types'
import {
  describeMark,
  labelAnchor,
  MARK_NAME,
  STAMP_ART,
  STAMP_GROUPS,
  STAMP_H,
  STAMP_SCALE,
  STAMP_W,
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
    expect(describeMark('forest')).toBe('Woods')
    expect(describeMark('forest', 'Hollin Wood')).toBe('Woods, “Hollin Wood”')
    expect(describeMark('label', 'The Grey Sound')).toBe('Label “The Grey Sound”')
  })

  it('offers every stamp in exactly one group of the palette', () => {
    const grouped = STAMP_GROUPS.flatMap((g) => g.kinds)
    expect([...grouped].sort()).toEqual([...MAP_STAMP_KINDS].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
    for (const kind of MAP_STAMP_KINDS) expect(MARK_NAME[kind]).toBeTruthy()
  })

  it('groups the stamps as a writer looks for them, in this order', () => {
    expect(STAMP_GROUPS.map((g) => [g.name, g.kinds])).toEqual([
      ['Land', ['mountain', 'hills', 'mesa', 'cliffs', 'volcano', 'dunes', 'cave']],
      [
        'Trees and plants',
        ['forest', 'pine', 'oak', 'deadtree', 'rainforest', 'highgrass', 'cactus', 'marsh']
      ],
      [
        'Water',
        ['waterfall', 'rocks', 'seastacks', 'boilingsea', 'oasis', 'ship', 'wreck', 'lighthouse']
      ],
      [
        'Settlements',
        [
          'encampment',
          'cabin',
          'town',
          'westerntown',
          'city',
          'metropolis',
          'castle',
          'gate',
          'tower',
          'cathedral',
          'ziggurat',
          'cyberspire',
          'hangingcitadel'
        ]
      ],
      [
        'Ruins and relics',
        [
          'ruins',
          'ruinedarch',
          'ruinedtower',
          'ruinedcity',
          'buriedstatue',
          'effigy',
          'battlefield',
          'cemetery',
          'graveyard'
        ]
      ]
    ])
  })

  it('puts a stamp’s name just under it, at every size', () => {
    expect(stampNameAt({ x: 0, y: 0 }, 2.2)).toEqual({ x: 0, y: STAMP_H * 1.1 + 2 })
    expect(stampNameAt({ x: 0, y: 0 }, 0.6)).toEqual({ x: 0, y: STAMP_H * 0.3 + 2 })
    for (const size of [0.6, 1, 1.5, 2.2])
      expect(stampNameAt({ x: 0, y: 0 }, size).y).toBeGreaterThan((STAMP_H * size) / 2)
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
/** Choose a stamp from the palette, as a writer does: open it, pick one. */
const stampTool = async (name: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Stamps/ }))
  })
  const item = [...document.querySelectorAll<HTMLElement>('.stamp-palette-item')].find(
    (b) => b.textContent === name
  )!
  await act(async () => {
    fireEvent.click(item, { detail: 1 })
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
    await stampTool('Mountain')
    await clickMap(120, 80)
    await clickMap(150, 90)
    expect(m.createMapMarkAt).toHaveBeenNthCalledWith(1, '/demo', 'mountain', 120, 80, undefined, 1)
    expect(m.createMapMarkAt).toHaveBeenNthCalledWith(2, '/demo', 'mountain', 150, 90, undefined, 1)
    await stampTool('Town')
    await clickMap(300, 300)
    expect(m.createMapMarkAt).toHaveBeenLastCalledWith('/demo', 'town', 300, 300, undefined, 1)
  })

  it('says each stamp went down, and takes a double-click as one stamp', async () => {
    const m = await renderMap()
    m.createMapMarkAt.mockImplementation(async () => mark())
    await stampTool('Mountain')
    await clickMap(120, 80)
    expect(hint()).toContain('Mountain put down.')
    await clickMap(120, 80)
    expect(m.createMapMarkAt).toHaveBeenCalledTimes(1)
    // The swallowed second click does not take the news away either.
    expect(hint()).toContain('Mountain put down.')
    await stampTool('Hills')
    expect(hint()).not.toContain('put down')
  })

  it('stamps from the keyboard, at the cursor', async () => {
    const m = await renderMap()
    await stampTool('Marsh')
    for (let i = 0; i < 5; i++) await key('ArrowRight', region(), { altKey: true })
    await key(' ')
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'marsh', 40, 0, undefined, 1)
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
    await stampTool('Woods')
    const el = document.querySelector('.world-map-pin[data-pin="p1"]')!
    await clickOn(el, 200, 200)
    expect(m.showEntity).not.toHaveBeenCalled()
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'forest', 200, 200, undefined, 1)
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
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 300, 250, 'The Grey Sound', 1)
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
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 200, 200, 'Northreach', 1)
  })

  it('keeps a label typed and then clicked away from', async () => {
    windowFocused()
    const m = await renderMap()
    await tool('Label')
    await clickMap(100, 100)
    await typeIn('The Shallows')
    await act(async () => field()!.blur())
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 100, 100, 'The Shallows', 1)
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
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 120, 90, 'The Sunless Sea', 1)
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
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 40, 0, 'The Narrow Sea', 1)
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

  it('removes a clicked stamp or label on Delete, with focus left on the map', async () => {
    const m = await renderMap([mark(), mark({ id: 'm2', kind: 'label', name: 'Sea' })])
    await clickOn(stamp().querySelector('.map-mark-hit')!, 200, 150)
    await key('Delete')
    expect(m.deleteMapMark).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }))
    await clickOn(stamp('m2'), 200, 150)
    await key('Backspace')
    expect(m.deleteMapMark).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'm2' }))
  })

  it('never deletes the chosen stamp from a Backspace typed in its name', async () => {
    const m = await renderMap([mark({ name: 'Hollin Wood' })])
    await key('Enter', stamp())
    await key('Enter', stamp())
    await key('Backspace', field()!)
    expect(m.deleteMapMark).not.toHaveBeenCalled()
    expect(field()).toBeTruthy()
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
    expect(screen.getByRole('button', { name: /^Woods, “Hollin Wood”\./ })).toBeTruthy()
    await tool('Land')
    expect(screen.queryByRole('button', { name: /^Woods, “Hollin Wood”/ })).toBeNull()
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
    await stampTool('Mountain')
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

describe('the stamp palette', () => {
  const toggle = (): HTMLElement => screen.getByRole('button', { name: /^Stamps/ })
  const palette = (): HTMLElement | null => document.querySelector('.stamp-palette')

  it('opens from one toolbar button, every stamp drawn and grouped', async () => {
    await renderMap()
    expect(palette()).toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      fireEvent.click(toggle())
    })
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelectorAll('.stamp-palette-item')).toHaveLength(MAP_STAMP_KINDS.length)
    expect(document.querySelectorAll('.stamp-palette-item .stamp-glyph')).toHaveLength(
      MAP_STAMP_KINDS.length
    )
    expect(palette()!.textContent).toContain('SETTLEMENTS')
    // The first stamp takes the keyboard as it opens.
    expect(document.activeElement).toBe(document.querySelector('[data-stamp="mountain"]'))
  })

  it('chooses a stamp, says which on its toggle, and hands the keyboard to the map', async () => {
    const m = await renderMap()
    await stampTool('Castle')
    expect(palette()).toBeNull()
    expect(toggle().getAttribute('aria-label')).toBe('Stamps: Castle')
    expect(toggle().querySelector('.stamp-glyph')).toBeTruthy()
    expect(document.activeElement).toBe(region())
    await clickMap(50, 60)
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'castle', 50, 60, undefined, 1)
  })

  it('reopens on the stamp in hand, walks with the arrows, and closes on Esc without leaving the map', async () => {
    const { back, done } = listenForBack()
    try {
      await renderMap()
      await stampTool('Mesa')
      await act(async () => {
        fireEvent.click(toggle())
      })
      expect(document.activeElement).toBe(document.querySelector('[data-stamp="mesa"]'))
      await key('ArrowRight', document.activeElement!)
      expect(document.activeElement).toBe(document.querySelector('[data-stamp="cliffs"]'))
      await key('ArrowLeft', document.activeElement!)
      await key('ArrowLeft', document.activeElement!)
      expect(document.activeElement).toBe(document.querySelector('[data-stamp="hills"]'))
      await key('Escape', document.activeElement!)
      await settle()
      expect(palette()).toBeNull()
      expect(back).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(toggle())
    } finally {
      done()
    }
  })

  it('closes on a press anywhere else', async () => {
    await renderMap()
    await act(async () => {
      fireEvent.click(toggle())
    })
    await act(async () => pointer(document.body, 'pointerdown', 0, 0))
    expect(palette()).toBeNull()
  })

  it('only closes on a press on the map, never stamps there too', async () => {
    const m = await renderMap()
    await stampTool('Pines')
    await act(async () => {
      fireEvent.click(toggle())
    })
    await clickMap(70, 80)
    expect(palette()).toBeNull()
    expect(m.createMapMarkAt).not.toHaveBeenCalled()
    await clickMap(70, 80)
    expect(m.createMapMarkAt).toHaveBeenCalledTimes(1)
  })

  it('closes and reopens from its own toggle', async () => {
    await renderMap()
    await act(async () => {
      fireEvent.click(toggle())
    })
    await act(async () => {
      pointer(toggle(), 'pointerdown', 0, 0)
      fireEvent.click(toggle())
    })
    expect(palette()).toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      fireEvent.click(toggle())
    })
    expect(palette()).toBeTruthy()
  })

  it('is one Tab stop, a dialog with named groups, and closes when focus leaves', async () => {
    await renderMap()
    await act(async () => {
      fireEvent.click(toggle())
    })
    expect(palette()!.getAttribute('role')).toBe('dialog')
    expect(toggle().getAttribute('aria-haspopup')).toBe('dialog')
    expect(toggle().getAttribute('aria-controls')).toBe(palette()!.id)
    expect(document.querySelectorAll('.stamp-palette-item[tabindex="0"]')).toHaveLength(1)
    const grids = [...document.querySelectorAll('.stamp-palette-grid')]
    expect(
      grids.map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)
    ).toEqual(['LAND', 'TREES AND PLANTS', 'WATER', 'SETTLEMENTS', 'RUINS AND RELICS'])
    const label = screen.getByRole('button', { name: 'Label' })
    await act(async () => {
      fireEvent.blur(document.activeElement!, { relatedTarget: label })
    })
    expect(palette()).toBeNull()
  })

  it('moves by row with Up and Down, keeping the column, across groups', async () => {
    await renderMap()
    await act(async () => {
      fireEvent.click(toggle())
    })
    const at = (): string | null => document.activeElement?.getAttribute('data-stamp') ?? null
    expect(at()).toBe('mountain')
    await key('ArrowUp', document.activeElement!)
    expect(at()).toBe('mountain')
    await key('ArrowDown', document.activeElement!)
    expect(at()).toBe('volcano')
    await key('ArrowRight', document.activeElement!)
    await key('ArrowRight', document.activeElement!)
    expect(at()).toBe('cave')
    await key('ArrowDown', document.activeElement!)
    // Into the next group, the same column: the third of its first row.
    expect(at()).toBe('oak')
    await key('ArrowUp', document.activeElement!)
    expect(at()).toBe('cave')
    expect(document.activeElement!.getAttribute('tabindex')).toBe('0')
    // A shorter row below in its own group: the nearest column it has, never
    // skipped. Land's second row has three, so the fourth column goes to its
    // third.
    await key('ArrowUp', document.activeElement!)
    await key('ArrowRight', document.activeElement!)
    expect(at()).toBe('cliffs')
    await key('ArrowDown', document.activeElement!)
    expect(at()).toBe('cave')
    // And the last row of all: Ruins and relics ends with Graveyard alone.
    await key('End', document.activeElement!)
    expect(at()).toBe('graveyard')
    await key('ArrowUp', document.activeElement!)
    for (let i = 0; i < 3; i++) await key('ArrowRight', document.activeElement!)
    expect(at()).toBe('cemetery')
    await key('ArrowDown', document.activeElement!)
    expect(at()).toBe('graveyard')
    // The bottom edge holds, as the top does.
    await key('ArrowDown', document.activeElement!)
    expect(at()).toBe('graveyard')
    // Up into another group's shorter row: its nearest column. Trees and
    // plants' fourth column goes up to Land's last row, which has three.
    await key('Home', document.activeElement!)
    for (let i = 0; i < 10; i++) await key('ArrowRight', document.activeElement!)
    expect(at()).toBe('deadtree')
    await key('ArrowUp', document.activeElement!)
    expect(at()).toBe('cave')
  })

  it('closes on Esc from its toggle without leaving the map', async () => {
    const { back, done } = listenForBack()
    try {
      await renderMap()
      await act(async () => {
        fireEvent.click(toggle())
      })
      await key('Escape', toggle())
      expect(palette()).toBeNull()
      expect(back).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('hands the keyboard to the map only once Return is let go', async () => {
    await renderMap()
    await act(async () => {
      fireEvent.click(toggle())
    })
    const item = document.querySelector<HTMLElement>('[data-stamp="hills"]')!
    await act(async () => {
      fireEvent.keyDown(item, { key: 'Enter', code: 'Enter' })
      fireEvent.click(item, { detail: 0 })
    })
    expect(toggle().getAttribute('aria-label')).toBe('Stamps: Hills')
    // The map does not take the keyboard while Return is down: it would
    // receive that Return and put a stamp down at the cursor.
    await settle()
    expect(document.activeElement).not.toBe(region())
    // Released where focus now is: the palette, and the item, are gone.
    await act(async () => {
      fireEvent.keyUp(document.body, { key: 'Enter', code: 'Enter' })
    })
    await settle()
    expect(palette()).toBeNull()
    expect(document.activeElement).toBe(region())
  })
})

describe('sizes', () => {
  const sizeButton = (name: string): HTMLElement =>
    screen.getByRole('group', { name: 'Size' }).querySelector(`[aria-label^="${name} ("]`)!

  it('shows the size control only while a stamp or a label is in play', async () => {
    await renderMap([mark()])
    expect(screen.queryByRole('group', { name: 'Size' })).toBeNull()
    await stampTool('Pines')
    expect(screen.getByRole('group', { name: 'Size' })).toBeTruthy()
    await tool('Land')
    expect(screen.queryByRole('group', { name: 'Size' })).toBeNull()
    await tool('Hand')
    await clickOn(stamp().querySelector('.map-mark-hit')!, 200, 150)
    expect(screen.getByRole('group', { name: 'Size' })).toBeTruthy()
  })

  it('makes new stamps and labels at the size chosen', async () => {
    const m = await renderMap()
    await stampTool('Ruins')
    await act(async () => {
      fireEvent.click(sizeButton('Large'))
    })
    expect(sizeButton('Large').getAttribute('aria-pressed')).toBe('true')
    await clickMap(30, 40)
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'ruins', 30, 40, undefined, 1.5)
    await tool('Label')
    await clickMap(90, 90)
    await typeIn('The Waste')
    await key('Enter', field()!)
    expect(m.createMapMarkAt).toHaveBeenLastCalledWith('/demo', 'label', 90, 90, 'The Waste', 1.5)
  })

  it('resizes a chosen stamp from the control, or with [ and ]', async () => {
    const m = await renderMap([mark({ size: 1.5 })])
    await clickOn(stamp().querySelector('.map-mark-hit')!, 200, 150)
    expect(sizeButton('Large').getAttribute('aria-pressed')).toBe('true')
    await act(async () => {
      fireEvent.click(sizeButton('Extra large'))
    })
    expect(m.updateMapMarkAt).toHaveBeenLastCalledWith('/demo', 'm1', { size: 2.2 })
    // With focus on the map, not the stamp, as after a click.
    await key('[')
    expect(m.updateMapMarkAt).toHaveBeenLastCalledWith('/demo', 'm1', { size: 1 })
    await key(']', stamp())
    expect(m.updateMapMarkAt).toHaveBeenLastCalledWith('/demo', 'm1', { size: 2.2 })
    // The mark's own [ and ] stop there: one write, not two.
    expect(m.updateMapMarkAt).toHaveBeenCalledTimes(3)
  })

  it('resizes a stamp that only has focus, not yet chosen', async () => {
    const m = await renderMap([mark({ size: 1.5 })])
    await act(async () => (stamp() as SVGElement).focus())
    await key(']', stamp())
    expect(m.updateMapMarkAt).toHaveBeenCalledTimes(1)
    expect(m.updateMapMarkAt).toHaveBeenCalledWith('/demo', 'm1', { size: 2.2 })
  })

  it('says each size step, and that the last press did nothing at an end', async () => {
    await renderMap([mark({ size: 2.2 })])
    await clickOn(stamp().querySelector('.map-mark-hit')!, 200, 150)
    await key(']')
    expect(hint()).toContain('Already extra large, the largest size.')
    await key('[')
    expect(hint()).toContain('Woods: large.')
  })

  it('never resizes from [ or ] typed into a name', async () => {
    const m = await renderMap([mark({ size: 1.5, name: 'Fort' })])
    await clickOn(stamp().querySelector('.map-mark-hit')!, 200, 150)
    await key('Enter', stamp())
    await key('[', field()!)
    await key(']', field()!)
    expect(m.updateMapMarkAt).not.toHaveBeenCalledWith(
      '/demo',
      'm1',
      expect.objectContaining({ size: expect.anything() })
    )
    expect(field()).toBeTruthy()
  })

  it('sizes a label being typed without closing it', async () => {
    const m = await renderMap()
    await tool('Label')
    await clickMap(90, 90)
    await typeIn('The Grey Sea')
    const xl = sizeButton('Extra large')
    // The press does not take focus from the field (its default is stopped).
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    xl.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    await act(async () => {
      fireEvent.click(xl)
    })
    expect(field()).toBeTruthy()
    await key('Enter', field()!)
    expect(m.createMapMarkAt).toHaveBeenCalledWith('/demo', 'label', 90, 90, 'The Grey Sea', 2.2)
  })

  it('draws a small stamp no smaller than small on screen when zoomed out', async () => {
    await renderMap([mark({ size: 0.6 })])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    })
    const w = Number(stamp().querySelector('.map-mark-hit')!.getAttribute('width'))
    expect(w).toBeCloseTo(STAMP_W * 1.2)
  })

  it('widens the map north and west for a large stamp at its top-left corner', async () => {
    await renderMap([mark({ x: 0, y: 0, size: 2.2 })])
    const style = (sizer() as HTMLElement).style
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2400 + (STAMP_W * 2.2) / 2)
    expect(parseFloat(style.height)).toBeGreaterThanOrEqual(1600 + (STAMP_H * 2.2) / 2)
  })

  it('widens the map to take in a large stamp at its edge', async () => {
    await renderMap([mark({ x: 2400, y: 1600, size: 2.2, name: 'Edge' })])
    const style = (sizer() as HTMLElement).style
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2400 + (STAMP_W * 2.2) / 2)
    expect(parseFloat(style.height)).toBeGreaterThanOrEqual(1600 + (STAMP_H * 2.2) / 2 + 16)
  })

  it('does not step past the smallest size', async () => {
    const m = await renderMap([mark({ size: 0.6 })])
    await clickOn(stamp().querySelector('.map-mark-hit')!, 200, 150)
    await key('[')
    expect(m.updateMapMarkAt).not.toHaveBeenCalled()
  })

  it('draws a stamp, its name and a label at their sizes', async () => {
    await renderMap([
      mark({ size: 2.2, name: 'Hollin Wood' }),
      mark({ id: 'm2', kind: 'label', name: 'Sea', size: 0.6 })
    ])
    const hit = stamp().querySelector('.map-mark-hit')!
    expect(Number(hit.getAttribute('width'))).toBeCloseTo(STAMP_W * 2.2)
    expect(stamp().querySelector('g')!.getAttribute('transform')).toBe(
      `scale(${STAMP_SCALE * 2.2})`
    )
    const name = document.querySelector<HTMLElement>('.map-label.stamp-name')!
    expect(name.style.top).toBe(`${150 + STAMP_H * 1.1 + 2}px`)
    // Centred on its point at any size: half the drawing either side.
    const [tx, ty] = stamp()
      .getAttribute('transform')!
      .match(/translate\(([-\d.]+) ([-\d.]+)\)/)!
      .slice(1)
      .map(Number)
    expect(tx + (STAMP_W * 2.2) / 2).toBeCloseTo(200)
    expect(ty + (STAMP_H * 2.2) / 2).toBeCloseTo(150)
    expect(stamp().getAttribute('aria-label')).toContain('Woods, “Hollin Wood”, extra large.')
    expect((stamp('m2') as HTMLElement).style.fontSize).toBe(`${14 * 0.6}px`)
  })
})
