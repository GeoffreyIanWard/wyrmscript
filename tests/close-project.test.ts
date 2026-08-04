// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectInfo, RecentProject } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * F-24: closing a project clears the auto-reopen pointer (so the next launch
 * lands on Welcome) without ever touching the recents list itself — those are
 * two different pieces of state on purpose, and this file is mostly about
 * proving they stay that way. `openRecentProject` is the Welcome screen's
 * other half: reopening one of those entries.
 */

function project(overrides: Partial<ProjectInfo['data']> = {}): ProjectInfo {
  return {
    path: '/demo/recent.wyrm',
    data: { version: 1, title: 'Recent Novel', binder: [], trash: [], ...overrides }
  }
}

function stubLoadProjectDependencies(): void {
  vi.spyOn(api, 'listEntities').mockResolvedValue([])
  vi.spyOn(api, 'getBackupSettings').mockResolvedValue({
    path: null,
    auto: false,
    lastBackupAt: null
  })
  vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
    mode: 'unset',
    remoteUrl: null,
    login: null,
    clientIdSet: false,
    lastSyncAt: null,
    pendingSync: false
  })
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  vi.spyOn(api, 'log').mockResolvedValue([])
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  useWyrm.setState({
    project: null,
    activeId: null,
    activeDoc: null,
    editor: null,
    saveState: 'saved',
    entities: [],
    backupSettings: null,
    syncStatus: null,
    recentProjects: []
  })
})

describe('closeProject', () => {
  it('clears the open project and returns to no-project state', async () => {
    useWyrm.setState({ project: project(), activeId: 'x' })
    vi.spyOn(api, 'closeProject').mockResolvedValue(undefined)
    vi.spyOn(api, 'getRecentProjects').mockResolvedValue([])

    await useWyrm.getState().closeProject()

    expect(useWyrm.getState().project).toBeNull()
    expect(useWyrm.getState().activeId).toBeNull()
  })

  it('tells the main process to forget the auto-reopen pointer', async () => {
    useWyrm.setState({ project: project() })
    const closeProject = vi.spyOn(api, 'closeProject').mockResolvedValue(undefined)
    vi.spyOn(api, 'getRecentProjects').mockResolvedValue([])

    await useWyrm.getState().closeProject()

    expect(closeProject).toHaveBeenCalled()
  })

  it('refreshes the recents list, so a just-closed project is still offered', async () => {
    useWyrm.setState({ project: project() })
    vi.spyOn(api, 'closeProject').mockResolvedValue(undefined)
    const recents: RecentProject[] = [
      { path: '/demo/recent.wyrm', title: 'Recent Novel', openedAt: new Date().toISOString() }
    ]
    vi.spyOn(api, 'getRecentProjects').mockResolvedValue(recents)

    await useWyrm.getState().closeProject()

    expect(useWyrm.getState().recentProjects).toEqual(recents)
  })

  it('flushes any pending edit before closing — nothing is ever lost', async () => {
    const editor = { getJSON: () => ({ type: 'doc', content: [] }) }
    useWyrm.setState({
      project: project(),
      activeDoc: { meta: { id: 'a', title: 'A', created: '', modified: '' }, body: '' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor: editor as any,
      saveState: 'dirty'
    })
    const writeDoc = vi.spyOn(api, 'writeDoc').mockResolvedValue(undefined)
    vi.spyOn(api, 'closeProject').mockResolvedValue(undefined)
    vi.spyOn(api, 'getRecentProjects').mockResolvedValue([])

    await useWyrm.getState().closeProject()

    expect(writeDoc).toHaveBeenCalled()
  })
})

describe('openRecentProject', () => {
  it('opens the project and loads it into the main pane', async () => {
    stubLoadProjectDependencies()
    vi.spyOn(api, 'openProjectPath').mockResolvedValue(project())

    await useWyrm.getState().openRecentProject('/demo/recent.wyrm')

    expect(useWyrm.getState().project?.path).toBe('/demo/recent.wyrm')
  })

  it('reloads the recents list instead of opening, when the project no longer exists', async () => {
    vi.spyOn(api, 'openProjectPath').mockResolvedValue(null)
    vi.spyOn(api, 'getRecentProjects').mockResolvedValue([])

    await useWyrm.getState().openRecentProject('/gone.wyrm')

    expect(useWyrm.getState().project).toBeNull()
  })
})
