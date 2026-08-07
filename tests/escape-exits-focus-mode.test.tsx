// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * F-36: Esc exits Focus Mode (F-09), but only once nothing higher in the
 * chain claims it — a dialog first (F-14/I-10), then unwinding one
 * story-bible detour, and only then Focus Mode itself. Getting the ordering
 * backwards would mean a writer deep in a bible detour inside Focus Mode
 * loses the mode on their first Esc instead of stepping back through their
 * trail, which is the whole reason this was worth designing rather than
 * guessing.
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

async function openProject(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', renamingId: null })
}

function isFocusModeOn(): boolean {
  return screen.getByLabelText(/Focus Mode/).getAttribute('aria-pressed') === 'true'
}

function enterFocusMode(): void {
  fireEvent.click(screen.getByLabelText('Enter Focus Mode'))
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

describe('Esc and Focus Mode', () => {
  it('exits Focus Mode when nothing else claims the key', async () => {
    await openProject()
    await renderApp()
    enterFocusMode()
    expect(isFocusModeOn()).toBe(true)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    expect(isFocusModeOn()).toBe(false)
  })

  it('does nothing when Focus Mode is already off', async () => {
    await openProject()
    await renderApp()
    expect(isFocusModeOn()).toBe(false)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    expect(isFocusModeOn()).toBe(false)
  })

  it('unwinds a story-bible detour first, leaving Focus Mode on for the next Esc', async () => {
    await openProject()
    await renderApp()
    enterFocusMode()
    act(() => {
      useWyrm.getState().showEntity('a')
    })

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    expect(isFocusModeOn()).toBe(true)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(isFocusModeOn()).toBe(false)
  })

  it('leaves Focus Mode on while a dialog is open, even with Focus Mode active', async () => {
    await openProject()
    await renderApp()
    enterFocusMode()

    // Stand in for any dialog, same technique as the F-14 regression test.
    const overlay = document.createElement('div')
    overlay.className = 'dialog-overlay'
    document.body.appendChild(overlay)
    ;(document.activeElement as HTMLElement | null)?.blur()

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(isFocusModeOn()).toBe(true)

    overlay.remove()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(isFocusModeOn()).toBe(false)
  })
})
