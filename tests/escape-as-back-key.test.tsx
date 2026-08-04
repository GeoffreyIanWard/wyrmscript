// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

async function openProject(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', renamingId: null })
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

  // I-10: the other half of the same story. The guard above keeps a loose-focus
  // Esc from navigating, but for a while that was all it did — the dialog
  // stayed open, because `useFocusTrap` only listened on the dialog's own root
  // and nothing inside it had focus. Opening Project → Writing Stats… and
  // pressing Esc left the writer reaching for the mouse.
  it('closes a dialog opened from the menu, with focus never inside it', async () => {
    await openProject()
    await renderApp()
    act(() => {
      useWyrm.getState().showEntity('a')
    })

    const project = screen.getByText('Project')
    act(() => project.focus())
    fireEvent.keyDown(project, { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menubar'), { key: 'w' }) // Writing Stats…
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('menubar'), { key: 'Enter' })
    })
    await waitFor(() => expect(document.querySelector('.dialog-overlay')).toBeTruthy())

    // The condition the bug needed: no dialog control holds focus.
    // The condition the bug needed. jsdom lands focus on the close box here;
    // the real browser did not (the menu takes it back as it closes), so the
    // blur is what stands in for that. What matters is that everything below
    // it — the dialog, the trap, App's handler — is the real thing.
    const dialog = document.querySelector('.dialog')!
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(dialog.contains(document.activeElement)).toBe(false)

    // Dispatched at <body>, which is where a real browser sends a keystroke
    // with focus loose — it bubbles through document to window, so both Esc
    // consumers get their chance and the ordering between them is what's
    // actually under test.
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })

    await waitFor(() => expect(document.querySelector('.dialog-overlay')).toBeNull())
    // …and the pane behind it stayed put: one Esc, one thing closed.
    expect(useWyrm.getState().mainView).toEqual({ kind: 'entity', id: 'a' })
  })
})
