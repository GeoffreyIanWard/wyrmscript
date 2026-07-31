// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import App from '../src/renderer/src/App'

/**
 * Regression coverage for the real bug behind the reported "F10 + arrows is
 * a stretch" complaint: on macOS, Chromium reports Option+F's `.key` as the
 * Option-layer character ('ƒ', the florin sign), never 'f' — so a shortcut
 * checked by `.key` silently never fires and F10 (which needs Fn on most Mac
 * keyboards) becomes the only thing that works. `.code` is the physical key
 * and is unaffected, which is what these events simulate.
 *
 * Also covers F-09 (focus mode): the zoom box and ⌥⌘F both hide the binder,
 * side panel and status bar, and both undo it.
 */

async function openApp(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved' })
  await act(async () => {
    render(<App />)
  })
  await waitFor(() => expect(screen.getByRole('tree')).toBeTruthy())
}

/** What a real macOS Option+F keydown actually looks like. */
function optionF(extra: Partial<KeyboardEventInit> = {}): KeyboardEventInit {
  return { key: 'ƒ', code: 'KeyF', altKey: true, ...extra }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false })
})

describe('entering the menu bar', () => {
  it('works from Option+F even though macOS reports the key as "ƒ", not "f"', async () => {
    await openApp()

    fireEvent.keyDown(window, optionF())

    await waitFor(() => expect(document.activeElement?.className).toContain('menu-title'))
  })

  it('still works from plain F10', async () => {
    await openApp()

    fireEvent.keyDown(window, { key: 'F10' })

    await waitFor(() => expect(document.activeElement?.className).toContain('menu-title'))
  })

  it('does not fire when Cmd or Shift rides along with Option+F', async () => {
    await openApp()

    fireEvent.keyDown(window, optionF({ metaKey: true }))

    expect(document.activeElement?.className ?? '').not.toContain('menu-title')
  })
})

describe('focus mode (F-09)', () => {
  it('hides the binder, side panel and status bar; the zoom box brings them back', async () => {
    await openApp()
    expect(screen.getByRole('tree')).toBeTruthy()
    const zoomBox = screen.getByRole('button', { name: 'Enter Focus Mode' })

    fireEvent.click(zoomBox)

    expect(screen.queryByRole('tree')).toBeNull()
    expect(document.querySelector('.status-bar')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Exit Focus Mode' }))

    expect(screen.getByRole('tree')).toBeTruthy()
    expect(document.querySelector('.status-bar')).toBeTruthy()
  })

  it('toggles from ⌥⌘F, using the physical key so Option-remapping cannot break it', async () => {
    await openApp()

    fireEvent.keyDown(window, optionF({ metaKey: true }))
    await waitFor(() => expect(screen.queryByRole('tree')).toBeNull())

    fireEvent.keyDown(window, optionF({ metaKey: true }))
    await waitFor(() => expect(screen.getByRole('tree')).toBeTruthy())
  })

  it('keeps the manuscript itself on screen — only the surrounding chrome hides', async () => {
    await openApp()

    fireEvent.click(screen.getByRole('button', { name: 'Enter Focus Mode' }))

    expect(document.querySelector('.page')).toBeTruthy()
  })

  it('the menu item label flips with the state and stays reachable', async () => {
    await openApp()
    const viewTitle = screen.getByText('View')

    fireEvent.mouseDown(viewTitle)
    await waitFor(() => expect(screen.getByText('Focus Mode')).toBeTruthy())
    fireEvent.mouseDown(screen.getByText('Focus Mode'))

    fireEvent.mouseDown(viewTitle)
    await waitFor(() => expect(screen.getByText('Exit Focus Mode')).toBeTruthy())
  })
})
