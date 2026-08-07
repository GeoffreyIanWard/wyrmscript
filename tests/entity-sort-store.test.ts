// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectInfo } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * F-32/F-33: the chosen sort mode is per-collection and per-project (stored
 * in project.json alongside the binder, not app-level settings) — a shared
 * project should look the same on every machine it's opened on.
 */

function project(): ProjectInfo {
  return {
    path: '/demo',
    data: { version: 1, title: 'T', binder: [], trash: [] }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  useWyrm.setState({ project: null })
})

describe('setEntitySort', () => {
  it('records the chosen mode for that collection on the project', async () => {
    useWyrm.setState({ project: project() })
    vi.spyOn(api, 'saveProject').mockResolvedValue(undefined)

    await useWyrm.getState().setEntitySort('character', 'tag')

    expect(useWyrm.getState().project?.data.entitySort).toEqual({ character: 'tag' })
  })

  it('persists it to the project file, not app-level settings', async () => {
    useWyrm.setState({ project: project() })
    const saveProject = vi.spyOn(api, 'saveProject').mockResolvedValue(undefined)

    await useWyrm.getState().setEntitySort('world', 'alphabetical')

    expect(saveProject).toHaveBeenCalledWith(
      '/demo',
      expect.objectContaining({ entitySort: { world: 'alphabetical' } })
    )
  })

  it('keeps each collection independent — setting one never touches another', async () => {
    useWyrm.setState({ project: project() })
    vi.spyOn(api, 'saveProject').mockResolvedValue(undefined)

    await useWyrm.getState().setEntitySort('character', 'tag')
    await useWyrm.getState().setEntitySort('world', 'alphabetical')

    expect(useWyrm.getState().project?.data.entitySort).toEqual({
      character: 'tag',
      world: 'alphabetical'
    })
  })
})
