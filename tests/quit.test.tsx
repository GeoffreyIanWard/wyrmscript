// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import {
  useWyrm,
  __disposeAll,
  __ensureRuntime,
  __runtimeFor,
  QUIT_CHECKPOINT_MS
} from '../src/renderer/src/store'

/**
 * Quit: the page saved, every open project with unsaved history
 * checkpointed, then the app goes — from File → Quit, ⌘Q, or main's request
 * for any other way to quit. A page that cannot be saved asks first.
 */

const realFlush = useWyrm.getState().flushSave
const state = (): ReturnType<typeof useWyrm.getState> => useWyrm.getState()
let path = ''
const OTHER = '/novels/Second.wyrm'
const CLEAN = '/novels/Third.wyrm'

beforeEach(async () => {
  vi.restoreAllMocks()
  path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({
    project: info,
    booted: true,
    saveState: 'saved',
    openPaths: [OTHER, CLEAN, path]
  })
  __ensureRuntime(path).commitDirty = true
  __ensureRuntime(OTHER).commitDirty = true
  __ensureRuntime(CLEAN).commitDirty = false
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    flushSave: realFlush,
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    editor: null
  })
  __disposeAll()
  vi.useRealTimers()
})

describe('quitting', () => {
  it('saves the page, checkpoints every open project with work, and only then quits', async () => {
    const order: string[] = []
    useWyrm.setState({
      flushSave: vi.fn(async () => {
        order.push('save')
      })
    })
    vi.spyOn(api, 'commit').mockImplementation(async (p, message) => {
      order.push(`checkpoint ${p} ${message}`)
      return true
    })
    vi.spyOn(api, 'quitApp').mockImplementation(async () => {
      order.push('quit')
    })
    await act(async () => state().quit())
    expect(order[0]).toBe('save')
    expect(order.slice(1, 3).sort()).toEqual(
      [`checkpoint ${OTHER} Autosave on quit`, `checkpoint ${path} Autosave on quit`].sort()
    )
    expect(order[3]).toBe('quit')
    // A project with nothing since its last checkpoint is left alone.
    expect(order.some((o) => o.includes(CLEAN))).toBe(false)
    expect(__runtimeFor(path)!.commitDirty).toBe(false)
  })

  it('asks before quitting with a page it could not save, and stays if told to', async () => {
    useWyrm.setState({
      flushSave: vi.fn(async () => {
        throw new Error('disk full')
      })
    })
    const commit = vi.spyOn(api, 'commit').mockResolvedValue(true)
    const quitApp = vi.spyOn(api, 'quitApp').mockResolvedValue()
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => state().quit())
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('could not be saved'))
    expect(quitApp).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    // Asked again, the writer goes.
    ask.mockReturnValue(true)
    await act(async () => state().quit())
    expect(quitApp).toHaveBeenCalledTimes(1)
  })

  it('quits even if a checkpoint never finishes, and quits once for two presses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    useWyrm.setState({ flushSave: vi.fn(async () => {}) })
    vi.spyOn(api, 'commit').mockReturnValue(new Promise(() => {}))
    const quitApp = vi.spyOn(api, 'quitApp').mockResolvedValue()
    const first = state().quit()
    const second = state().quit()
    await vi.advanceTimersByTimeAsync(QUIT_CHECKPOINT_MS - 1)
    expect(quitApp).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([first, second])
    expect(quitApp).toHaveBeenCalledTimes(1)
  })
})

describe('Quit in the app', () => {
  async function renderApp(): Promise<void> {
    vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
    vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
    vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })
  }

  it('is the last item in File, with its key, and quits', async () => {
    const quit = vi.fn(async () => {})
    useWyrm.setState({ quit })
    await renderApp()
    const file = [...document.querySelectorAll('.menu-title')].find(
      (t) => t.textContent === 'File'
    ) as HTMLElement
    await act(async () => {
      fireEvent.mouseDown(file)
    })
    const items = [...document.querySelectorAll<HTMLElement>('.menu-drop .menu-item')]
    const last = items[items.length - 1]
    expect(last.textContent).toContain('Quit')
    expect(last.textContent).toContain('⌘Q')
    // Menu items act on the press, as the early Mac's did.
    await act(async () => {
      fireEvent.mouseDown(last)
    })
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('quits on ⌘Q, with or without a project open', async () => {
    const quit = vi.fn(async () => {})
    useWyrm.setState({ quit, project: null })
    await renderApp()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'q', metaKey: true })
    })
    expect(quit).toHaveBeenCalledTimes(1)
  })
})
