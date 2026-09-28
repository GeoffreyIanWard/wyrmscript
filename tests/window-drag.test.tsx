// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'

/**
 * F-41 step 4: the pointer wiring for dragging and resizing.
 *
 * The arithmetic is covered in window-geometry.test.ts. What this file checks
 * is the part that only exists once there is a DOM: that the title bar and
 * the grow box are actually wired to the right transform, that a drag reaches
 * the store, that it is written to disk **once** at the end rather than on
 * every pointermove, and that the close box and grow box do not trip the
 * window's own click-to-focus surface on their way.
 *
 * jsdom reports zero for every measurement, so the desktop falls back to the
 * window size and the numbers are small — which is fine, because what matters
 * here is that the deltas arrive and the persistence fires once.
 */

let demoPath: string | null = null

async function renderApp(): Promise<void> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  // Boot opens nothing, so each test sets its own windows up deterministically
  // rather than racing the auto-reopen.
  vi.spyOn(api, 'getLastProjectPath').mockResolvedValue(null)
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
  await waitFor(() => expect(useWyrm.getState().booted).toBe(true))
}

/** Two projects, so windows are cascaded rather than full-bleed. */
async function openTwo(): Promise<{ first: string; second: string }> {
  const first = demoPath!
  await act(async () => {
    await useWyrm.getState().openRecentProject(first)
  })
  const info = await api.createProject('Second Novel')
  await act(async () => {
    await useWyrm.getState().openAdditionalProject(info.path)
  })
  return { first, second: info.path }
}

function focusedTitleBar(): HTMLElement {
  const el = document.querySelector('.mac-window:not(.inactive) > .title-bar')
  if (!el) throw new Error('no focused title bar')
  return el as HTMLElement
}

/** A full press-move-release, as pointer capture would deliver it. */
function dragBy(el: HTMLElement, dx: number, dy: number): void {
  el.setPointerCapture = vi.fn()
  el.releasePointerCapture = vi.fn()
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 200, clientY: 200 })
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy })
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy })
}

beforeEach(async () => {
  vi.restoreAllMocks()
  demoPath ??= await api.getLastProjectPath()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    windowGeometry: {},
    editor: null
  })
  __disposeAll()
})

describe('dragging a window', () => {
  it('moves it by the pointer delta', async () => {
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
    const before = useWyrm.getState().windowGeometry[second]

    dragBy(focusedTitleBar(), 40, 25)

    const after = useWyrm.getState().windowGeometry[second]
    expect(after.x).toBe(before.x + 40)
    expect(after.y).toBe(before.y + 25)
  })

  it('keeps the window the same size', async () => {
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
    const before = useWyrm.getState().windowGeometry[second]

    dragBy(focusedTitleBar(), 30, 30)

    const after = useWyrm.getState().windowGeometry[second]
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
  })

  it('ignores a non-primary button', async () => {
    // A right-click on the title bar must not drag the window out from under
    // whatever menu is about to appear.
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
    const before = useWyrm.getState().windowGeometry[second]
    const bar = focusedTitleBar()
    bar.setPointerCapture = vi.fn()

    fireEvent.pointerDown(bar, { button: 2, pointerId: 1, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 400, clientY: 400 })

    expect(useWyrm.getState().windowGeometry[second]).toEqual(before)
  })
})

describe('persistence', () => {
  it('writes the position once, at the end of the drag', async () => {
    // Persisting per pointermove would hit the settings file a hundred times
    // in a single gesture.
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
    const save = vi.spyOn(api, 'setWindowGeometry').mockResolvedValue()
    const bar = focusedTitleBar()
    bar.setPointerCapture = vi.fn()
    bar.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    for (let i = 1; i <= 8; i++) {
      fireEvent.pointerMove(bar, { pointerId: 1, clientX: 100 + i * 5, clientY: 100 })
    }
    expect(save).not.toHaveBeenCalled()
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 140, clientY: 100 })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(second, expect.objectContaining({ x: expect.any(Number) }))
  })

  it('restores a remembered position when the project opens', async () => {
    const remembered = { x: 31, y: 37, width: 640, height: 480 }
    vi.spyOn(api, 'getWindowGeometry').mockResolvedValue(remembered)
    await renderApp()

    await act(async () => {
      await useWyrm.getState().openRecentProject(demoPath!)
    })

    expect(useWyrm.getState().windowGeometry[demoPath!]).toEqual(remembered)
  })
})

describe('a window can always be reached', () => {
  it('clamps a position restored from a bigger screen', async () => {
    // The dangerous case: a project arranged on a large display, reopened on
    // a small one. Its stored position is outside the frame, and nothing about
    // the desktop has changed since the app started — so a clamp that only
    // watched the desktop size would never re-check it, and the window would
    // sit where no click can reach.
    vi.spyOn(api, 'getWindowGeometry').mockResolvedValue({
      x: 99999,
      y: 99999,
      width: 4000,
      height: 3000
    })
    await renderApp()

    await act(async () => {
      await useWyrm.getState().openRecentProject(demoPath!)
    })

    const g = useWyrm.getState().windowGeometry[demoPath!]
    await waitFor(() => {
      const now = useWyrm.getState().windowGeometry[demoPath!]
      expect(now.y).toBeLessThan(99999)
    })
    expect(g).toBeDefined()
    expect(useWyrm.getState().windowGeometry[demoPath!].y).toBeGreaterThanOrEqual(0)
  })

  it('Clean Up Windows forgets every position, on disk as well', async () => {
    // Recovery that needs no diagnosis of how a window got out of reach.
    await renderApp()
    const { first, second } = await openTwo()
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
    const forget = vi.spyOn(api, 'clearWindowGeometry').mockResolvedValue()

    await act(async () => {
      await useWyrm.getState().cleanUpWindows()
    })

    // Cleared on disk too, or reopening would restore the arrangement the
    // writer just asked to be rid of.
    expect(forget).toHaveBeenCalledWith(first)
    expect(forget).toHaveBeenCalledWith(second)
  })

  it('lays the windows out again after a clean up', async () => {
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
    vi.spyOn(api, 'clearWindowGeometry').mockResolvedValue()

    await act(async () => {
      await useWyrm.getState().cleanUpWindows()
    })

    // Forgetting the positions is only half of it — App must place them again,
    // or Clean Up would leave the writer with no windows at all.
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
  })
})

describe('resizing', () => {
  it('grows from the corner without moving the window', async () => {
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
    const before = useWyrm.getState().windowGeometry[second]
    const grow = document.querySelector('.mac-window:not(.inactive) .grow-box') as HTMLElement
    expect(grow).toBeTruthy()

    dragBy(grow, 40, 30)

    const after = useWyrm.getState().windowGeometry[second]
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
  })
})

describe('the chrome does not fight the window', () => {
  it('the close box does not drag the window', async () => {
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(useWyrm.getState().windowGeometry[second]).toBeDefined())
    const before = useWyrm.getState().windowGeometry[second]
    const close = screen.getByLabelText('Close Project')
    const bar = focusedTitleBar()
    // Stubbed on the *bar*, not the button: the drag handler runs on whatever
    // the event bubbles to, so without this the drag would die on a missing
    // setPointerCapture and the test would pass for the wrong reason.
    bar.setPointerCapture = vi.fn()
    bar.releasePointerCapture = vi.fn()
    close.setPointerCapture = vi.fn()

    fireEvent.pointerDown(close, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 300, clientY: 300 })

    expect(useWyrm.getState().windowGeometry[second]).toEqual(before)
  })

  it('the grow box does not raise a background window before resizing it', async () => {
    // Grabbing the corner of a window behind should resize it, not shuffle
    // the stack out from under the gesture.
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(document.querySelector('.inactive .grow-box')).toBeTruthy())
    const grow = document.querySelector('.inactive .grow-box') as HTMLElement
    grow.setPointerCapture = vi.fn()

    // Awaited: focusProject is async, so asserting synchronously would pass
    // before the focus it is checking for could possibly have happened.
    await act(async () => {
      fireEvent.pointerDown(grow, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
    })

    expect(useWyrm.getState().project?.path).toBe(second)
  })
})
