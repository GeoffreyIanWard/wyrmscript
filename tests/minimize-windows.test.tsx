// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll, __runtimeFor } from '../src/renderer/src/store'

/**
 * F-41 step 6: a project collapsed to an icon on the desktop.
 *
 * A minimised project is still *open* — its state stays parked and its
 * background work keeps running — it simply is not drawn as a window. The
 * distinction matters: if minimising quietly stopped a project checkpointing
 * or backing up, a writer tidying their desktop would be switching off the
 * safety net without being told.
 *
 * The other thing worth pinning is that minimising the last window is not a
 * close. The projects stay open and reachable, and next launch still reopens
 * them.
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

const windows = (): number => document.querySelectorAll('.mac-window').length
const icons = (): string[] =>
  [...document.querySelectorAll('.desktop-icon')].map((b) => b.textContent ?? '')

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
    minimized: [],
    windowGeometry: {},
    editor: null
  })
  __disposeAll()
})

describe('minimising', () => {
  it('replaces the window with an icon', async () => {
    await renderApp()
    const { second } = await openTwo()

    await act(async () => {
      await useWyrm.getState().minimizeProject(second)
    })

    await waitFor(() => expect(windows()).toBe(1))
    expect(icons().some((t) => t.includes('Second Novel'))).toBe(true)
  })

  it('brings another window forward when the focused one goes', async () => {
    await renderApp()
    const { first, second } = await openTwo()
    expect(useWyrm.getState().project?.path).toBe(second)

    await act(async () => {
      await useWyrm.getState().minimizeProject(second)
    })

    expect(useWyrm.getState().project?.path).toBe(first)
  })

  it('leaves the focused project alone when a background one is minimised', async () => {
    await renderApp()
    const { first, second } = await openTwo()

    await act(async () => {
      await useWyrm.getState().minimizeProject(first)
    })

    expect(useWyrm.getState().project?.path).toBe(second)
    await waitFor(() => expect(windows()).toBe(1))
  })

  it('keeps the project open, and its background work running', async () => {
    // The point of the distinction: tidying the desktop must not quietly
    // switch off checkpointing and backup for a novel.
    await renderApp()
    const { second } = await openTwo()

    await act(async () => {
      await useWyrm.getState().minimizeProject(second)
    })

    expect(useWyrm.getState().openPaths).toContain(second)
    expect(__runtimeFor(second)).toBeDefined()
    expect(__runtimeFor(second)?.commitTimer).not.toBeNull()
  })
})

describe('minimising every window', () => {
  it('leaves an empty desktop with icons, not the home screen', async () => {
    // Minimising is not closing. The home screen would say "no project open",
    // which is untrue and would invite opening a second copy of one.
    await renderApp()
    const { first, second } = await openTwo()

    await act(async () => {
      await useWyrm.getState().minimizeProject(second)
    })
    await act(async () => {
      await useWyrm.getState().minimizeProject(first)
    })

    await waitFor(() => expect(windows()).toBe(0))
    expect(document.querySelector('.welcome')).toBeNull()
    expect(icons()).toHaveLength(2)
  })

  it('does not turn off auto-reopen for next launch', async () => {
    // `api.closeProject` is what forgets the project; minimising must never
    // call it, or tidying the desktop would silently change what opens next
    // time the app starts.
    await renderApp()
    const { first, second } = await openTwo()
    const forget = vi.spyOn(api, 'closeProject')

    await act(async () => {
      await useWyrm.getState().minimizeProject(second)
    })
    await act(async () => {
      await useWyrm.getState().minimizeProject(first)
    })

    expect(forget).not.toHaveBeenCalled()
  })
})

describe('restoring', () => {
  it('brings the project back as the focused window', async () => {
    await renderApp()
    const { second } = await openTwo()
    await act(async () => {
      await useWyrm.getState().minimizeProject(second)
    })
    await waitFor(() => expect(icons()).toHaveLength(1))

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Restore Second Novel'))
    })

    expect(useWyrm.getState().project?.path).toBe(second)
    expect(useWyrm.getState().minimized).toEqual([])
  })

  it('works when every window was minimised', async () => {
    await renderApp()
    const { first, second } = await openTwo()
    await act(async () => {
      await useWyrm.getState().minimizeProject(second)
    })
    await act(async () => {
      await useWyrm.getState().minimizeProject(first)
    })
    await waitFor(() => expect(windows()).toBe(0))

    await act(async () => {
      await useWyrm.getState().restoreProject(first)
    })

    expect(useWyrm.getState().project?.path).toBe(first)
    await waitFor(() => expect(windows()).toBe(1))
  })

  it('keeps the project it was reading', async () => {
    await renderApp()
    const { second } = await openTwo()
    const wasReading = useWyrm.getState().activeId

    await act(async () => {
      await useWyrm.getState().minimizeProject(second)
    })
    await act(async () => {
      await useWyrm.getState().restoreProject(second)
    })

    expect(useWyrm.getState().activeId).toBe(wasReading)
  })
})
