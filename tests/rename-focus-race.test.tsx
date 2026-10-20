// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'

/**
 * Opening a document focuses the page, and that focus lands a frame later
 * (TipTap defers it to requestAnimationFrame). A rename started inside that
 * frame — F2 straight after clicking a corkboard card — had its field taken
 * away when the focus finally applied: the input blurred, its onBlur
 * finished the rename, and the rename silently ended. The mount effect's
 * renamingId check ran too early to see it. Seen as a ~1-in-6 flake under
 * load; here the frame is held back so the order is fixed.
 */

let frames: FrameRequestCallback[] = []

async function flushFrames(): Promise<void> {
  await act(async () => {
    // A frame callback may queue another; run until the queue is dry.
    for (let i = 0; i < 10 && frames.length; i++) {
      const run = frames
      frames = []
      for (const cb of run) cb(performance.now())
    }
  })
}

async function openApp(): Promise<string[]> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  const path = (await api.getLastProjectPath())!
  const ids = (await api.readAllDocs(path)).slice(0, 2).map((d) => d.meta.id)
  await act(async () => {
    await useWyrm.getState().openRecentProject(path)
  })
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
  await waitFor(() => expect(useWyrm.getState().editor).toBeTruthy())
  await flushFrames()
  return ids
}

/** Opens a document and waits for its editor, without letting a frame pass. */
async function open(id: string): Promise<void> {
  const before = useWyrm.getState().editor
  await act(async () => {
    await useWyrm.getState().selectDoc(id)
  })
  await waitFor(() => {
    const { editor, activeId } = useWyrm.getState()
    expect(activeId).toBe(id)
    expect(editor).toBeTruthy()
    expect(editor).not.toBe(before)
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    mainView: { kind: 'doc' },
    viewHistory: [],
    renamingId: null,
    statsSettings: null,
    dailyStats: [],
    appearance: null,
    project: null,
    parked: {},
    openPaths: [],
    booted: false
  })
  __disposeAll()
})

describe("the page's focus on opening a document", () => {
  it('never cancels a rename started before that focus lands', async () => {
    const [, second] = await openApp()
    await open(second)
    // The page's focus is still a frame away when the rename starts.
    await act(async () => {
      useWyrm.getState().startRename(second)
    })
    const input = await waitFor(() => {
      const el = document.querySelector('.rename-input')
      expect(el).toBeTruthy()
      return el as HTMLInputElement
    })
    expect(document.activeElement).toBe(input)

    await flushFrames()

    expect(useWyrm.getState().renamingId).toBe(second)
    expect(document.activeElement).toBe(input)
  })

  it('still focuses the page when nothing is being renamed', async () => {
    const [, second] = await openApp()
    await open(second)
    await flushFrames()
    expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true)
  })
})
