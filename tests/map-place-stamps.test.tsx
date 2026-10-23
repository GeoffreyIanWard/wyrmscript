// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MapMark, MapPin, ProjectInfo } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { WorldMap } from '../src/renderer/src/components/WorldMap'
import { STAMP_H, STAMP_SCALE, STAMP_W } from '../src/renderer/src/lib/mapMarks'

/**
 * Places drawn as stamps: a World Book place on the map can be a castle
 * rather than a pin, at a size, and is still the place — it opens its entry,
 * it moves — and can go back to a pin. jsdom lays nothing out.
 */

const now = new Date().toISOString()
const pin = (over: Partial<MapPin> = {}): MapPin => ({
  id: 'p1',
  entityId: 'e1',
  x: 200,
  y: 150,
  created: now,
  modified: now,
  ...over
})

function project(): ProjectInfo {
  return { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } }
}

const REAL = (({
  styleMapPinAt,
  updateMapMarkAt,
  loadMapPins,
  loadMapShapes,
  loadMapMarks,
  showEntity
}) => ({
  styleMapPinAt,
  updateMapMarkAt,
  loadMapPins,
  loadMapShapes,
  loadMapMarks,
  showEntity
}))(useWyrm.getState())

async function renderMap(
  pins: MapPin[],
  marks: MapMark[] = []
): Promise<{
  styleMapPinAt: ReturnType<typeof vi.fn>
  showEntity: ReturnType<typeof vi.fn>
  updateMapMarkAt: ReturnType<typeof vi.fn>
}> {
  const mocks = {
    styleMapPinAt: vi.fn(async () => {}),
    showEntity: vi.fn(),
    updateMapMarkAt: vi.fn(async () => {})
  }
  useWyrm.setState({
    project: project(),
    entities: pins.map((p, i) => ({
      id: p.entityId,
      type: 'world' as const,
      name: i === 0 ? 'Harrowgate' : `Place ${i}`,
      aliases: [],
      created: now,
      modified: now
    })),
    mapPins: pins,
    mapShapes: [],
    mapMarks: [],
    mainView: { kind: 'map' },
    loadMapPins: vi.fn(async () => {}),
    loadMapShapes: vi.fn(async () => {}),
    loadMapMarks: vi.fn(async () => {
      useWyrm.setState({ mapMarks: marks })
    }),
    ...mocks
  })
  await act(async () => {
    render(<WorldMap />)
  })
  return mocks
}

const toggle = (): HTMLElement => screen.getByRole('button', { name: /^Show Harrowgate as/ })
const palette = (): HTMLElement | null => document.querySelector('#place-palette')
const item = (kind: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#place-palette [data-stamp="${kind}"]`)!
const mapPin = (): HTMLElement => document.querySelector<HTMLElement>('.world-map-pin')!
const hint = (): string => document.querySelector('.map-hint')?.textContent ?? ''
const key = async (k: string, on: Element): Promise<void> => {
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
/** A real press on a button: pointer down, then the click. */
const press = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.pointerDown(el, { button: 0 })
    fireEvent.mouseDown(el)
    el.focus()
    fireEvent.click(el)
  })
}
const open = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(toggle())
  })
}

afterEach(() => {
  cleanup()
  window.dispatchEvent(new Event('blur'))
  vi.restoreAllMocks()
  useWyrm.setState({ ...REAL, project: null, mapPins: [], mapMarks: [], mainView: { kind: 'doc' } })
})

describe('choosing how a place is drawn', () => {
  it('offers Pin first and every stamp, from the place’s row, saying what it is now', async () => {
    await renderMap([pin()])
    expect(toggle().getAttribute('aria-label')).toBe('Show Harrowgate as… (now a pin)')
    await open()
    expect(palette()!.getAttribute('aria-label')).toBe('Show Harrowgate as')
    expect(document.querySelector('#place-palette [data-stamp]')!.getAttribute('data-stamp')).toBe(
      'pin'
    )
    expect(item('pin').getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(item('pin'))
    // A pin has no size to choose.
    expect(palette()!.querySelector('.map-size')).toBeNull()
  })

  it('makes it a stamp, and stays open so its size can be chosen next', async () => {
    const m = await renderMap([pin()])
    await open()
    await act(async () => {
      fireEvent.click(item('castle'), { detail: 1 })
    })
    expect(m.styleMapPinAt).toHaveBeenCalledWith('/demo', 'p1', { stamp: 'castle' })
    expect(palette()).toBeTruthy()
  })

  it('sizes a stamped place from the palette', async () => {
    const m = await renderMap([pin({ stamp: 'castle' })])
    await open()
    expect(item('castle').getAttribute('aria-pressed')).toBe('true')
    const large = palette()!.querySelector<HTMLElement>('[aria-label^="Large ("]')!
    await act(async () => {
      fireEvent.click(large)
    })
    expect(m.styleMapPinAt).toHaveBeenCalledWith('/demo', 'p1', { size: 1.5 })
  })

  it('turns it back into a pin', async () => {
    const m = await renderMap([pin({ stamp: 'castle', size: 1.5 })])
    await open()
    await act(async () => {
      fireEvent.click(item('pin'), { detail: 1 })
    })
    expect(m.styleMapPinAt).toHaveBeenCalledWith('/demo', 'p1', { stamp: null })
  })

  it('gives the keyboard back to the row only once Esc is let go', async () => {
    await renderMap([pin()])
    await open()
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' })
    })
    await settle()
    expect(palette()).toBeNull()
    expect(document.activeElement).not.toBe(toggle())
    await act(async () => {
      fireEvent.keyUp(document.body, { key: 'Escape', code: 'Escape' })
    })
    await settle()
    expect(document.activeElement).toBe(toggle())
  })

  it('closes on its own Esc, back to its row’s button, without leaving the map', async () => {
    const back = vi.fn()
    const listen = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', listen)
    try {
      await renderMap([pin()])
      await open()
      await key('Escape', document.activeElement!)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1))
      })
      expect(palette()).toBeNull()
      expect(back).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(toggle())
    } finally {
      window.removeEventListener('keydown', listen)
    }
  })

  it('closes and reopens from its own button, pressed as a mouse presses it', async () => {
    await renderMap([pin()])
    await press(toggle())
    expect(palette()).toBeTruthy()
    await press(toggle())
    expect(palette()).toBeNull()
    await press(toggle())
    expect(palette()).toBeTruthy()
  })

  it('starts afresh for another place: its own choice, focused', async () => {
    await renderMap([pin(), pin({ id: 'p2', entityId: 'e2', stamp: 'tower' })])
    await press(toggle())
    expect(document.activeElement?.getAttribute('data-stamp')).toBe('pin')
    const second = screen.getByRole('button', { name: /^Show Place 1 as/ })
    await press(second)
    expect(palette()!.getAttribute('aria-label')).toBe('Show Place 1 as')
    expect(document.activeElement?.getAttribute('data-stamp')).toBe('tower')
  })

  it('walks from Pin into the stamps and back, by row', async () => {
    await renderMap([pin()])
    await open()
    const at = (): string | null => document.activeElement?.getAttribute('data-stamp') ?? null
    expect(at()).toBe('pin')
    await key('ArrowDown', document.activeElement!)
    expect(at()).toBe('mountain')
    await key('ArrowUp', document.activeElement!)
    expect(at()).toBe('pin')
    await key('End', document.activeElement!)
    expect(at()).toBe('ruins')
    await key('Home', document.activeElement!)
    expect(at()).toBe('pin')
  })

  it('goes back to the row on Tab past its last control, once the key is up', async () => {
    await renderMap([pin({ stamp: 'castle' })])
    await open()
    const stops = [...palette()!.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])')]
    const last = stops[stops.length - 1]
    last.focus()
    await act(async () => {
      fireEvent.keyDown(last, { key: 'Tab', code: 'Tab' })
    })
    await settle()
    expect(palette()).toBeNull()
    expect(document.activeElement).not.toBe(toggle())
    await act(async () => {
      fireEvent.keyUp(document.body, { key: 'Tab', code: 'Tab' })
    })
    await settle()
    expect(document.activeElement).toBe(toggle())
  })

  it('closes when the side panel scrolls or the window resizes under it', async () => {
    await renderMap([pin()])
    await open()
    await act(async () => {
      document.querySelector('.map-places')!.dispatchEvent(new Event('scroll'))
    })
    expect(palette()).toBeNull()
    await open()
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(palette()).toBeNull()
  })

  it('fits itself again when the size row appears, so the row is not cut off', async () => {
    const frame = { top: 100, left: 0, bottom: 500, right: 900 }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const r = (top: number, h: number, left = 20, w = 300): DOMRect =>
        ({
          top,
          bottom: top + h,
          left,
          right: left + w,
          width: w,
          height: h,
          x: left,
          y: top,
          toJSON: () => ({})
        }) as DOMRect
      if (this.classList.contains('world-map'))
        return r(frame.top, frame.bottom - frame.top, frame.left, frame.right)
      if (this.classList.contains('stamp-palette'))
        // Taller once the size row is in it.
        return r(300, this.querySelector('.map-size') ? 260 : 180)
      return r(0, 0)
    })
    const m = await renderMap([pin()])
    await open()
    // It fits as a pin: nothing moved.
    expect(palette()!.style.marginTop).toBe('')
    m.styleMapPinAt.mockImplementation(async () => {
      useWyrm.setState({ mapPins: [pin({ stamp: 'castle' })] })
    })
    await act(async () => {
      fireEvent.click(item('castle'), { detail: 1 })
    })
    // 300 + 260 runs 68 past the frame's foot less its margin: moved up so.
    expect(palette()!.style.marginTop).toBe('-68px')
  })
})

describe('a place drawn as a stamp', () => {
  it('is drawn as its stamp, centred on its point, and named for a screen reader', async () => {
    await renderMap([pin({ stamp: 'castle', size: 1.5 })])
    expect(mapPin().className).toContain('stamped castle')
    const glyph = mapPin().querySelector('.stamp-glyph')!
    expect(Number(glyph.getAttribute('width'))).toBeCloseTo(24 * STAMP_SCALE * 1.5)
    expect(mapPin().style.transform).toBe(`translate(-50%, -${(20 * STAMP_SCALE * 1.5) / 2}px)`)
    expect(mapPin().getAttribute('aria-label')).toContain('Harrowgate, shown as castle.')
    expect(toggle().querySelector('.stamp-glyph')).toBeTruthy()
  })

  it('is still the place: a click opens its entry', async () => {
    const m = await renderMap([pin({ stamp: 'tower' })])
    await act(async () => {
      fireEvent.pointerDown(mapPin(), { button: 0, clientX: 0, clientY: 0 })
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: 0 }))
    })
    expect(m.showEntity).toHaveBeenCalledWith('e1', expect.anything())
  })

  it('sizes with [ and ], and says so at either end', async () => {
    const m = await renderMap([pin({ stamp: 'castle', size: 2.2 })])
    await key(']', mapPin())
    expect(m.styleMapPinAt).not.toHaveBeenCalled()
    expect(hint()).toContain('Already extra large, the largest size.')
    await key('[', mapPin())
    expect(m.styleMapPinAt).toHaveBeenCalledWith('/demo', 'p1', { size: 1.5 })
    await settle()
    expect(hint()).toContain('Harrowgate: large.')
  })

  it('says it is already the smallest', async () => {
    await renderMap([pin({ stamp: 'castle', size: 0.6 })])
    await key('[', mapPin())
    expect(hint()).toContain('Already small, the smallest size.')
  })

  it('sizes only the place, not a stamp chosen elsewhere on the map', async () => {
    const mark: MapMark = { id: 'm1', kind: 'forest', x: 500, y: 500, created: now, modified: now }
    const m = await renderMap([pin({ stamp: 'castle' })], [mark])
    await act(async () => {
      const hit = document.querySelector('[data-mark="m1"] .map-mark-hit')!
      hit.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 500 })
      )
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 500, clientY: 500 }))
    })
    await key(']', mapPin())
    expect(m.styleMapPinAt).toHaveBeenCalledTimes(1)
    expect(m.updateMapMarkAt).not.toHaveBeenCalled()
  })

  it('widens the map to take in a large stamped place at its edge', async () => {
    await renderMap([pin({ x: 2400, y: 1600, stamp: 'castle', size: 2.2 })])
    const style = (document.querySelector('.map-sizer') as HTMLElement).style
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2400 + (STAMP_W * 2.2) / 2)
    expect(parseFloat(style.height)).toBeGreaterThanOrEqual(1600 + (STAMP_H * 2.2) / 2 + 16)
  })

  it('centres at every zoom', async () => {
    await renderMap([pin({ stamp: 'castle', size: 1.5 })])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    })
    expect(mapPin().style.transform).toBe(`translate(-50%, -${(20 * STAMP_SCALE * 1.5 * 2) / 2}px)`)
  })

  it('leaves a plain pin alone on [ and ]', async () => {
    const m = await renderMap([pin()])
    await key('[', mapPin())
    expect(m.styleMapPinAt).not.toHaveBeenCalled()
  })

  it('is drawn no smaller on screen than small when zoomed out', async () => {
    await renderMap([pin({ stamp: 'ruins', size: 0.6 })])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    })
    const glyph = mapPin().querySelector('.stamp-glyph')!
    // At 50%, small (0.6) is floored to 1.2, which shows at 0.6 on screen.
    expect(Number(glyph.getAttribute('width'))).toBeCloseTo(24 * STAMP_SCALE * 1.2 * 0.5)
  })
})
