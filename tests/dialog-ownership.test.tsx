// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'

/**
 * F-41 step 5: a dialog belongs to the project that was in front when it was
 * opened.
 *
 * Dialogs are app-modal and read the focused project live — the settled
 * design, and fine while one project could be open. With several, there is a
 * gap: the menu bar sits *above* the dialog overlay in the z-index budget, so
 * the project underneath an open dialog can change while it is open (File →
 * Open in New Window, or ⇧⌘O). The dialog does not notice. Compile opened
 * against one novel would export another, and the writer would have no way to
 * tell from looking at it.
 *
 * Verified by hand before the fix: with Compile open for "Novel 1", opening a
 * third project left the dialog on screen, now pointed at "Novel 2".
 */

let demoPath: string | null = null

async function renderApp(): Promise<void> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  vi.spyOn(api, 'getLastProjectPath').mockResolvedValue(null)
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
  await waitFor(() => expect(useWyrm.getState().booted).toBe(true))
}

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

/** ⇧⌘E — the real path a writer takes to the Compile dialog. */
async function openCompile(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(window, { key: 'E', metaKey: true, shiftKey: true })
  })
}

function dialogTitle(): string | null {
  return document.querySelector('.dialog .title')?.textContent ?? null
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

describe('a dialog and the project under it', () => {
  it('opens against the focused project', async () => {
    await renderApp()
    await openTwo()

    await openCompile()

    expect(dialogTitle()).toBe('Compile Manuscript')
  })

  it('closes when the focus moves to another project', async () => {
    // Otherwise it silently retargets: opened for one novel, acting on
    // another, with nothing on screen saying so.
    await renderApp()
    const { first } = await openTwo()
    await openCompile()
    expect(dialogTitle()).toBe('Compile Manuscript')

    await act(async () => {
      await useWyrm.getState().focusProject(first)
    })

    expect(document.querySelector('.dialog')).toBeNull()
  })

  it('stays open while the focus does not move', async () => {
    // The fix must not be so eager that a dialog cannot be used at all.
    await renderApp()
    await openTwo()
    await openCompile()

    await act(async () => {
      // A re-render with no focus change — the parked project checkpointing,
      // for instance.
      useWyrm.setState({ wordCount: 1234 })
    })

    expect(dialogTitle()).toBe('Compile Manuscript')
  })

  it('closes when a project is opened in a new window', async () => {
    // The specific route that exposed this: the menu bar sits above the
    // dialog overlay, so this is reachable with a dialog on screen.
    await renderApp()
    await openTwo()
    await openCompile()
    const third = await api.createProject('Third Novel')

    await act(async () => {
      await useWyrm.getState().openAdditionalProject(third.path)
    })

    expect(document.querySelector('.dialog')).toBeNull()
  })
})

describe('About is left alone', () => {
  it('survives a focus change, because it belongs to the app', async () => {
    // Nothing about About is project-scoped, so dismissing it when a window
    // changes would just be rude.
    await renderApp()
    const { first } = await openTwo()
    // About lives behind the wyrm menu, so it has to be opened first.
    const titles = [...document.querySelectorAll('.menu-bar [role="menuitem"]')]
    await act(async () => {
      fireEvent.keyDown(titles[0], { key: 'ArrowDown' })
    })
    await act(async () => {
      fireEvent.mouseDown(screen.getByText('About WyrmStar…'))
    })
    await waitFor(() => expect(dialogTitle()).toBe('About WyrmStar'))

    await act(async () => {
      await useWyrm.getState().focusProject(first)
    })

    expect(dialogTitle()).toBe('About WyrmStar')
  })
})
