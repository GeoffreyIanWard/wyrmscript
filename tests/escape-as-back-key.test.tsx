// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * F-14, the wiring half: the store's `goBack` is tested directly elsewhere —
 * what this file covers is whether pressing Esc actually reaches it, and
 * whether an open dialog correctly wins first. Both are properties of the
 * real key handler and the real rendered tree, so they need the whole App.
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
    appearance: null
  })
})

describe('the Escape key', () => {
  it('walks back one hop', async () => {
    await renderApp()
    act(() => {
      useWyrm.getState().showEntity('a')
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'entity', id: 'a' })

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  it('is inert when there is nowhere to go back to', async () => {
    await renderApp()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  // Regression guard: a dialog closing on Esc must not *also* navigate the
  // pane behind it. `useFocusTrap` stops propagation while focus is inside
  // the dialog, but focus can be loose, so the handler checks for an open
  // overlay independently.
  it('leaves the view alone while a dialog is open, even with focus loose', async () => {
    await renderApp()
    act(() => {
      useWyrm.getState().showEntity('a')
    })

    // Stand in for any dialog: they all render `.dialog-overlay`.
    const overlay = document.createElement('div')
    overlay.className = 'dialog-overlay'
    document.body.appendChild(overlay)
    ;(document.activeElement as HTMLElement | null)?.blur()

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'entity', id: 'a' })

    overlay.remove()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })
})
