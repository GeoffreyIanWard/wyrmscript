// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/renderer/src/lib/api'
import {
  useWyrm,
  __disposeAll,
  __ensureRuntime,
  __runtimeCount,
  __runtimeFor
} from '../src/renderer/src/store'

/**
 * F-41: a project's background work belongs to that project.
 *
 * The debounced save, the five-minute Autosave checkpoint and the dirty flag
 * were module-level singletons — correct only while exactly one project could
 * be open. Each test here stands up a *second* project's runtime and proves
 * that operating on the first leaves it alone, because with the singletons
 * every one of these failed, and failed silently:
 *
 *  - a keystroke in B cleared A's pending 800ms save, so A's flush never fired
 *    and the draft sat unwritten;
 *  - opening B cleared A's auto-commit interval, so A stopped checkpointing;
 *  - a commit in A cleared the shared dirty flag, so B's unsaved work looked
 *    already checkpointed.
 *
 * None of this is reachable through the UI yet — one project opens at a time.
 * That is the point: the runtime is separated before any second window is
 * allowed to exist, so the windowing work cannot quietly introduce the worst
 * bug this app is capable of.
 */

const OTHER = '/novels/Other Project.wyrm'

/** Captured once: closing a project nulls the mock's last-project path, so
 *  asking for it again after a close test would hand back null. */
let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(demoPath))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved' })
  return demoPath
}

/** A second project with live background work, as if its window were open. */
function standUpOther(): void {
  const runtime = __ensureRuntime(OTHER)
  runtime.saveTimer = setTimeout(() => {}, 60_000)
  runtime.commitTimer = setInterval(() => {}, 60_000)
  runtime.commitDirty = true
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  // Deliberately not calling closeProject here — it is the subject of some of
  // these tests, and it clears the mock's last-project path.
  useWyrm.setState({ project: null, booted: false })
  __disposeAll()
})

describe('runtime identity', () => {
  it('gives each project its own', () => {
    const a = __ensureRuntime('/a.wyrm')
    const b = __ensureRuntime('/b.wyrm')

    expect(a).not.toBe(b)
    expect(__runtimeCount()).toBe(2)
  })

  it('returns the same one for the same project', () => {
    expect(__ensureRuntime('/a.wyrm')).toBe(__ensureRuntime('/a.wyrm'))
  })
})

describe('the pending save', () => {
  it('survives a flush in another project', async () => {
    // The nastiest of the three: another project's draft silently never
    // reaching disk because this one happened to save.
    await openDemo()
    standUpOther()
    const pending = __runtimeFor(OTHER)!.saveTimer

    await useWyrm.getState().flushSave()

    expect(__runtimeFor(OTHER)!.saveTimer).toBe(pending)
  })

  it('is cleared for the project that actually flushed', async () => {
    const path = await openDemo()
    __ensureRuntime(path).saveTimer = setTimeout(() => {}, 60_000)

    await useWyrm.getState().flushSave()

    expect(__runtimeFor(path)!.saveTimer).toBeNull()
  })
})

describe('the auto-commit interval', () => {
  it('survives another project being opened', async () => {
    // Goes through openRecentProject rather than setting state directly,
    // because loadProject is where the interval is installed — and where the
    // old code cleared whatever interval was already running, whoever owned
    // it. Setting state directly made this test vacuous.
    demoPath ??= (await api.getLastProjectPath())!
    // Asserted behaviourally, not by identity: `clearInterval` stops a timer
    // without changing the handle, so comparing the stored handle before and
    // after cannot tell a running interval from a cancelled one. The question
    // is whether the other project still checkpoints, so ask exactly that.
    vi.useFakeTimers()
    const otherTicked = vi.fn()
    __ensureRuntime(OTHER).commitTimer = setInterval(otherTicked, 1000)

    await useWyrm.getState().openRecentProject(demoPath)
    vi.advanceTimersByTime(3000)

    expect(useWyrm.getState().project?.path).toBe(demoPath)
    expect(otherTicked).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('is installed for the project that was opened', async () => {
    demoPath ??= (await api.getLastProjectPath())!

    await useWyrm.getState().openRecentProject(demoPath)

    expect(__runtimeFor(demoPath)!.commitTimer).not.toBeNull()
  })

  it('stops and is forgotten when its own project closes', async () => {
    const path = await openDemo()
    // openDemo sets state directly rather than going through loadProject, so
    // stand the runtime up the way a first edit would.
    __ensureRuntime(path).commitTimer = setInterval(() => {}, 60_000)

    await useWyrm.getState().closeProject()

    // Forgotten as well as stopped: a surviving entry leaks one object per
    // project ever opened, and a surviving interval keeps checkpointing a
    // project nobody has open.
    expect(__runtimeFor(path)).toBeUndefined()
  })

  it('leaves another project running when one closes', async () => {
    await openDemo()
    vi.useFakeTimers()
    const otherTicked = vi.fn()
    __ensureRuntime(OTHER).commitTimer = setInterval(otherTicked, 1000)

    await useWyrm.getState().closeProject()
    vi.advanceTimersByTime(3000)

    // Both halves matter. `?.commitTimer` alone would read `undefined` if the
    // entry had been disposed, and `expect(undefined).not.toBeNull()` passes —
    // the test would survive exactly the bug it exists to catch.
    expect(__runtimeFor(OTHER)).toBeDefined()
    expect(otherTicked).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('the dirty flag', () => {
  it('is not cleared by a checkpoint in another project', async () => {
    // With one shared flag, the other project's unsaved work would look
    // already checkpointed and never be committed.
    await openDemo()
    standUpOther()

    await useWyrm.getState().commitNow('A checkpoint over here')

    expect(__runtimeFor(OTHER)!.commitDirty).toBe(true)
  })

  it('is not set by an edit in another project', async () => {
    const path = await openDemo()
    __ensureRuntime(OTHER).commitDirty = false
    const docs = await api.readAllDocs(path)

    await useWyrm.getState().finishRename(docs[0].meta.id, 'A new title')

    expect(__runtimeFor(OTHER)!.commitDirty).toBe(false)
    // …but the project that was actually edited is dirty.
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
  })
})
