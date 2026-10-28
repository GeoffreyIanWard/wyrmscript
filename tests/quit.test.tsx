// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api, __trackInFlight } from '../src/renderer/src/lib/api'
import {
  useWyrm,
  __disposeAll,
  __ensureRuntime,
  __runtimeFor,
  QUIT_CHECKPOINT_MS,
  QUIT_SAVE_MS
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
    quittingUi: false,
    mainView: { kind: 'doc' },
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

describe('waiting for the saves', () => {
  it('waits for every save still under way, and asks about one that never finishes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    useWyrm.setState({ flushSave: vi.fn(async () => {}) })
    vi.spyOn(api, 'commit').mockResolvedValue(true)
    const quitApp = vi.spyOn(api, 'quitApp').mockResolvedValue()
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    // A write on a disk that has stopped answering (until the test ends:
    // left hanging, it would hold up every later test's quit).
    let unstick = (): void => {}
    __trackInFlight(new Promise<void>((done) => (unstick = done)))
    const going = state().quit()
    await vi.advanceTimersByTimeAsync(QUIT_SAVE_MS - 10)
    expect(ask).not.toHaveBeenCalled()
    expect(state().quittingUi).toBe(true)
    await vi.advanceTimersByTimeAsync(20)
    await going
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('still being saved'))
    // Stayed: the window comes back, and a later quit is heard.
    expect(quitApp).not.toHaveBeenCalled()
    expect(state().quittingUi).toBe(false)
    ask.mockReturnValue(true)
    const again = state().quit()
    await vi.advanceTimersByTimeAsync(QUIT_SAVE_MS + 10)
    await again
    expect(quitApp).toHaveBeenCalledTimes(1)
    unstick()
  })
})

describe('quitting with work open on the board', () => {
  it('saves a card back left open, before the app goes', async () => {
    const docs = (await api.readAllDocs(path)).slice(0, 2)
    for (const d of docs)
      await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: ['scene'], synopsis: undefined } })
    const title = docs[0].meta.title
    await act(async () => {
      await state().openRecentProject(path)
    })
    useWyrm.setState({ activeId: null, activeDoc: null, mainView: { kind: 'corkboard' } })
    vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
    vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
    vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })
    // Opening the app reopens the project at the page; then to the board.
    await act(async () => {
      useWyrm.setState({ activeId: null, activeDoc: null })
      state().showCorkboard()
    })
    const turn = await waitFor(() =>
      screen.getByRole('button', { name: new RegExp(`^Turn ${title} over`) })
    )
    await act(async () => {
      fireEvent.click(turn)
    })
    const synopsis = screen.getByLabelText('Synopsis', { selector: 'textarea, input' })
    await act(async () => {
      fireEvent.change(synopsis, { target: { value: 'Reed comes for the ledger.' } })
    })
    let onDisk: string | undefined
    vi.spyOn(api, 'quitApp').mockImplementation(async () => {
      onDisk = (await api.readAllDocs(path)).find((d) => d.meta.title === title)!.meta.synopsis
    })
    await act(async () => state().quit())
    expect(onDisk).toBe('Reed comes for the ledger.')
    // The whole window was only the word that it is saving.
    expect(document.querySelector('.quitting')).not.toBeNull()
    expect(document.querySelector('.corkboard')).toBeNull()
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
