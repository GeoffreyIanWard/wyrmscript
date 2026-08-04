// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RecentProject } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { Welcome } from '../src/renderer/src/components/Welcome'

/**
 * F-24: Welcome is the home screen a returning writer actually sees now that
 * closing a project stops the silent auto-reopen — these cover the recents
 * list it gained rather than the pre-existing new/open/restore buttons.
 */

function recent(overrides: Partial<RecentProject> = {}): RecentProject {
  return {
    path: '/demo/a.wyrm',
    title: 'A Novel',
    openedAt: new Date().toISOString(),
    ...overrides
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ recentProjects: [] })
})

describe('Welcome: recents', () => {
  it('loads and shows the recents list on mount', async () => {
    vi.spyOn(api, 'getRecentProjects').mockResolvedValue([recent()])
    await act(async () => {
      render(<Welcome />)
    })
    expect(screen.getByText('A Novel')).toBeTruthy()
  })

  it('shows no RECENT section at all when the list is empty', async () => {
    vi.spyOn(api, 'getRecentProjects').mockResolvedValue([])
    await act(async () => {
      render(<Welcome />)
    })
    expect(screen.queryByText('RECENT')).toBeNull()
  })

  it('opens a recent project on click', async () => {
    vi.spyOn(api, 'getRecentProjects').mockResolvedValue([recent()])
    const openProjectPath = vi.spyOn(api, 'openProjectPath').mockResolvedValue({
      path: '/demo/a.wyrm',
      data: { version: 1, title: 'A Novel', binder: [], trash: [] }
    })
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

    await act(async () => {
      render(<Welcome />)
    })
    await act(async () => {
      fireEvent.click(screen.getByText('A Novel'))
    })

    expect(openProjectPath).toHaveBeenCalledWith('/demo/a.wyrm')
    expect(useWyrm.getState().project?.path).toBe('/demo/a.wyrm')
    useWyrm.setState({ project: null })
  })
})
