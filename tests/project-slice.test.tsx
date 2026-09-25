// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll, __ensureRuntime, __runtimeFor } from '../src/renderer/src/store'

/**
 * F-41 step 2: each open project's state is its own.
 *
 * The focused project's state stays in the flat fields, and the others are
 * parked by path. There is exactly one home for each project's data and
 * nothing is mirrored, so the failure mode this is really guarding against is
 * *leakage*: focusing project B and seeing A's open document, A's word count,
 * or A's sync status. Every test below switches focus and then asks whether
 * anything came across that should not have.
 *
 * No window renders a parked project yet — that is step 3. What exists here is
 * the state machine underneath it.
 */

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  await useWyrm.getState().openRecentProject(demoPath)
  return demoPath
}

/** A genuinely separate project, with its own binder and documents. */
async function makeSecond(title = 'Second Novel'): Promise<string> {
  const info = await api.createProject(title)
  return info.path
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  // `editor` too: a stub left behind here is reached by refreshEntityLinks on
  // the next project load and fails deep inside ProseMirror.
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [], editor: null })
  __disposeAll()
})

describe('opening a second project', () => {
  it('keeps the first open rather than replacing it', async () => {
    const first = await openDemo()
    const second = await makeSecond()

    await useWyrm.getState().openAdditionalProject(second)

    const state = useWyrm.getState()
    expect(state.project?.path).toBe(second)
    expect(state.openPaths).toEqual([first, second])
    expect(state.parked[first]).toBeDefined()
  })

  it('raises an already-open project instead of opening it twice', async () => {
    // Two editors on one documents/<id>.md would race autosave and git
    // against the same repository, and nothing serializes that.
    const first = await openDemo()
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)

    await useWyrm.getState().openAdditionalProject(first)

    const state = useWyrm.getState()
    expect(state.project?.path).toBe(first)
    expect(state.openPaths).toEqual([first, second])
    expect(Object.keys(state.parked)).toEqual([second])
  })

  it('does nothing when asked to open the project already in front', async () => {
    const first = await openDemo()

    await useWyrm.getState().openAdditionalProject(first)

    expect(useWyrm.getState().openPaths).toEqual([first])
  })

  it('gives the newcomer its own background work', async () => {
    const first = await openDemo()
    const second = await makeSecond()

    await useWyrm.getState().openAdditionalProject(second)

    expect(__runtimeFor(first)).toBeDefined()
    expect(__runtimeFor(second)).toBeDefined()
    expect(__runtimeFor(first)).not.toBe(__runtimeFor(second))
  })
})

describe('switching focus', () => {
  it('restores the project that comes forward', async () => {
    const first = await openDemo()
    const firstDocId = useWyrm.getState().activeId
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)

    await useWyrm.getState().focusProject(first)

    const state = useWyrm.getState()
    expect(state.project?.path).toBe(first)
    expect(state.activeId).toBe(firstDocId)
  })

  it('does not leak the other project’s open document', async () => {
    // The leak this whole shape exists to prevent: writing into what looks
    // like one novel and landing in another.
    await openDemo()
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)
    const secondDocId = useWyrm.getState().activeId

    await useWyrm.getState().focusProject(demoPath!)

    expect(useWyrm.getState().activeId).not.toBe(secondDocId)
    expect(useWyrm.getState().activeDoc?.meta.id).toBe(useWyrm.getState().activeId)
  })

  it('carries each project’s own view state', async () => {
    const first = await openDemo()
    useWyrm.getState().showStats()
    expect(useWyrm.getState().mainView.kind).toBe('stats')
    const second = await makeSecond()

    await useWyrm.getState().openAdditionalProject(second)
    // The newcomer starts on its manuscript, not on the other one's stats page.
    expect(useWyrm.getState().mainView.kind).toBe('doc')

    await useWyrm.getState().focusProject(first)
    expect(useWyrm.getState().mainView.kind).toBe('stats')
  })

  it('never parks a live editor', async () => {
    // The TipTap instance belongs to the component that mounted it; by the
    // time this project is focused again that component has unmounted and
    // destroyed it, so restoring the handle would hand back a corpse.
    const first = await openDemo()
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)
    // Registered after both projects exist, so parking goes through
    // focusProject rather than a fresh load — no entity re-scan to trip over.
    useWyrm.setState({ editor: { destroyed: false } as never })

    await useWyrm.getState().focusProject(first)

    expect(useWyrm.getState().parked[second].editor).toBeNull()
    useWyrm.setState({ editor: null })
  })

  it('leaves app-level settings alone', async () => {
    // Appearance, typewriter mode and the rest belong to the app, not to a
    // project — switching focus must not reset them.
    await openDemo()
    useWyrm.getState().setTypewriterMode(true)
    const second = await makeSecond()

    await useWyrm.getState().openAdditionalProject(second)

    expect(useWyrm.getState().typewriterMode).toBe(true)
  })

  it('ignores a focus request for a project that is not open', async () => {
    const first = await openDemo()

    await useWyrm.getState().focusProject('/nowhere/Missing.wyrm')

    expect(useWyrm.getState().project?.path).toBe(first)
  })
})

describe('a project that is open but not focused', () => {
  it('still checkpoints on its own interval', async () => {
    // Otherwise a background project silently never writes history: its
    // interval fires, but `commitNow` acts on the focused project, so the
    // work would sit uncommitted until the writer happened to look at it.
    vi.useFakeTimers()
    const first = await openDemo()
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)
    __ensureRuntime(first).commitDirty = true
    const commit = vi.spyOn(api, 'commit').mockResolvedValue(true)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(commit).toHaveBeenCalledWith(first, 'Autosave')
    expect(__runtimeFor(first)!.commitDirty).toBe(false)
    vi.useRealTimers()
  })

  it('records its checkpoint against its own slice, not the focused one', async () => {
    vi.useFakeTimers()
    const first = await openDemo()
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)
    const focusedCommitAt = useWyrm.getState().lastCommitAt
    __ensureRuntime(first).commitDirty = true
    vi.spyOn(api, 'commit').mockResolvedValue(true)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(useWyrm.getState().parked[first].lastCommitAt).toBeGreaterThan(0)
    // The project actually in front was not touched.
    expect(useWyrm.getState().lastCommitAt).toBe(focusedCommitAt)
    vi.useRealTimers()
  })
})

describe('closing one of several', () => {
  it('closing a background project leaves the focused one alone', async () => {
    const first = await openDemo()
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)

    await useWyrm.getState().closeProject(first)

    const state = useWyrm.getState()
    expect(state.project?.path).toBe(second)
    expect(state.openPaths).toEqual([second])
    expect(__runtimeFor(first)).toBeUndefined()
    expect(__runtimeFor(second)).toBeDefined()
  })

  it('closing the focused project brings another forward', async () => {
    const first = await openDemo()
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)

    await useWyrm.getState().closeProject()

    const state = useWyrm.getState()
    expect(state.project?.path).toBe(first)
    expect(state.openPaths).toEqual([first])
    expect(state.parked).toEqual({})
  })

  it('closing the last project empties the app', async () => {
    const closeSpy = vi.spyOn(api, 'closeProject')
    await openDemo()

    await useWyrm.getState().closeProject()

    const state = useWyrm.getState()
    expect(state.project).toBeNull()
    expect(state.openPaths).toEqual([])
    expect(state.activeDoc).toBeNull()
    // Only now does the app really have no project — auto-reopen is turned
    // off exactly once, not every time a window closes.
    expect(closeSpy).toHaveBeenCalled()
  })

  it('does not turn off auto-reopen while another project is still open', async () => {
    await openDemo()
    const second = await makeSecond()
    await useWyrm.getState().openAdditionalProject(second)
    const closeSpy = vi.spyOn(api, 'closeProject')

    await useWyrm.getState().closeProject()

    expect(closeSpy).not.toHaveBeenCalled()
  })
})
