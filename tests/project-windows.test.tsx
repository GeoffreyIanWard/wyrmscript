// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'

/**
 * F-41 step 3: one window per open project.
 *
 * The state machine is tested in project-slice.test.tsx; this is the wiring —
 * whether the windows actually render, whether the one in front is the live
 * app and the others are not, and whether clicking and closing hit the
 * project the writer aimed at rather than whichever happens to be focused.
 *
 * The last of those is the one worth being careful about: a close box that
 * ignores its own window and closes the focused project instead would throw
 * away the wrong novel's window, and with a cascade of identical frames the
 * writer would have no warning it was about to happen.
 */

let demoPath: string | null = null

async function renderApp(): Promise<void> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  // Boot opens nothing. Otherwise its auto-reopen races the windows each test
  // sets up: `loadProject` resets openPaths, and the rest of boot's chain
  // keeps writing to the shared store after the previous test unmounted —
  // which is why these passed alone and failed together.
  vi.spyOn(api, 'getLastProjectPath').mockResolvedValue(null)
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
  // `boot()` runs from an effect and auto-reopens the last project, which
  // calls loadProject and resets openPaths. Setting windows up before it
  // lands would have them silently replaced.
  await waitFor(() => expect(useWyrm.getState().booted).toBe(true))
}

/** Opens the demo, then a second project alongside it. */
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

function windows(): HTMLElement[] {
  return [...document.querySelectorAll('.mac-window')] as HTMLElement[]
}

function titleOf(win: HTMLElement): string {
  return win.querySelector('.title')?.textContent ?? ''
}

beforeEach(async () => {
  vi.restoreAllMocks()
  // Captured before the spy above hides it.
  demoPath ??= await api.getLastProjectPath()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [], editor: null })
  __disposeAll()
})

describe('one project', () => {
  it('keeps the full-bleed window it has always had', async () => {
    await renderApp()
    await act(async () => {
      await useWyrm.getState().openRecentProject(demoPath!)
    })

    await waitFor(() => expect(windows()).toHaveLength(1))
    // Cascading a lone window would shrink the page for no reason.
    expect(windows()[0].className).toContain('main-window')
    expect(windows()[0].className).not.toContain('project-window')
  })
})

describe('two projects', () => {
  it('renders a window each, with exactly one in front', async () => {
    await renderApp()
    await openTwo()

    await waitFor(() => expect(windows()).toHaveLength(2))
    const inactive = windows().filter((w) => w.classList.contains('inactive'))
    expect(inactive).toHaveLength(1)
    expect(titleOf(inactive[0])).toBe('The Wyrm of Winter')
  })

  it('shows the background project’s own manuscript, not the front one’s', async () => {
    await renderApp()
    await openTwo()

    await waitFor(() => expect(windows()).toHaveLength(2))
    const page = document.querySelector('.inactive-page')
    expect(page?.textContent).toContain('wyrmlight')
  })

  it('names the project in the strip, since the title bar may be covered', async () => {
    await renderApp()
    await openTwo()

    await waitFor(() => expect(document.querySelector('.inactive-hint')).toBeTruthy())
    expect(document.querySelector('.inactive-hint')?.textContent).toContain('The Wyrm of Winter')
  })

  it('brings a background window forward when it is clicked', async () => {
    await renderApp()
    const { first } = await openTwo()
    await waitFor(() => expect(windows()).toHaveLength(2))

    const inactive = windows().find((w) => w.classList.contains('inactive'))!
    await act(async () => {
      fireEvent.mouseDown(inactive)
    })

    expect(useWyrm.getState().project?.path).toBe(first)
  })
})

describe('the close box', () => {
  it('closes the window it belongs to, not the focused one', async () => {
    // The dangerous case: with a cascade of identical frames, closing the
    // wrong project would be silent and unrecoverable-looking.
    await renderApp()
    const { first, second } = await openTwo()
    await waitFor(() => expect(windows()).toHaveLength(2))

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Close The Wyrm of Winter'))
    })

    const state = useWyrm.getState()
    expect(state.openPaths).toEqual([second])
    expect(state.project?.path).toBe(second)
    expect(state.parked[first]).toBeUndefined()
  })

  it('does not bring the window forward on its way to closing it', async () => {
    // The close box sits inside the click-to-focus surface, so without
    // stopping propagation the project would be focused and then immediately
    // closed — which also closes it via the *focused* path, a different code
    // route than the one being exercised.
    await renderApp()
    const { second } = await openTwo()
    await waitFor(() => expect(windows()).toHaveLength(2))

    await act(async () => {
      fireEvent.mouseDown(screen.getByLabelText('Close The Wyrm of Winter'))
    })

    expect(useWyrm.getState().project?.path).toBe(second)
  })

  it('leaves the surviving project full-bleed again', async () => {
    await renderApp()
    await openTwo()
    await waitFor(() => expect(windows()).toHaveLength(2))

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Close The Wyrm of Winter'))
    })

    await waitFor(() => expect(windows()).toHaveLength(1))
    expect(windows()[0].className).toContain('main-window')
  })
})
