// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * F-39: real OS fullscreen. The window call itself belongs to Electron and
 * cannot run here — what this covers is the wiring around it, which is where
 * the mistakes actually live: that F11 reaches the API at all, that it is not
 * swallowed outside Electron (the browser's own F11 has to keep working), and
 * that the menu item is reachable with no project open, unlike every other
 * View item.
 */

async function renderApp(): Promise<void> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    mainView: { kind: 'doc' },
    viewHistory: [],
    statsSettings: null,
    dailyStats: [],
    appearance: null,
    project: null,
    booted: false
  })
})

describe('fullscreen', () => {
  it('leaves F11 alone outside Electron, so the browser’s own fullscreen still works', async () => {
    // The test environment has no `window.wyrm`, so `isElectron` is false —
    // the same condition as the browser preview. Swallowing the key here
    // would take a working shortcut away for no gain.
    const toggle = vi.spyOn(api, 'toggleFullScreen')
    await renderApp()

    const event = new KeyboardEvent('keydown', { key: 'F11', cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(toggle).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('offers Full Screen in the View menu even with no project open', async () => {
    // Every other item in the View menu is gated on a project; this one is a
    // property of the window, and Welcome is a reasonable place to want it.
    // `boot()` reopens the last project by default, which would quietly make
    // this assertion vacuous — so the reopen is suppressed first.
    vi.spyOn(api, 'getLastProjectPath').mockResolvedValue(null)
    await renderApp()
    expect(useWyrm.getState().project).toBeNull()

    fireEvent.mouseDown(screen.getByText('View'))

    const item = screen.getByText('Full Screen')
    expect(item).toBeTruthy()
    expect(item.closest('button')?.disabled).toBe(false)
  })

  it('toggles fullscreen when the menu item is chosen', async () => {
    const toggle = vi.spyOn(api, 'toggleFullScreen').mockResolvedValue(true)
    await renderApp()

    fireEvent.mouseDown(screen.getByText('View'))
    await act(async () => {
      fireEvent.mouseDown(screen.getByText('Full Screen'))
    })

    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('does not fight the menu-bar focus shortcut on the neighbouring key', async () => {
    // F10 focuses the menu bar (F-07) and F11 is fullscreen; a handler that
    // matched loosely on "F1..." would break one of them.
    const toggle = vi.spyOn(api, 'toggleFullScreen')
    await renderApp()

    act(() => {
      fireEvent.keyDown(window, { key: 'F10' })
    })

    expect(toggle).not.toHaveBeenCalled()
  })
})
