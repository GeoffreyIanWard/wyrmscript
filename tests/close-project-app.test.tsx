// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * F-24: the title-bar close-box was decorative — no handler at all — until
 * now. This drives the real button against the real App tree rather than
 * calling `closeProject` directly, since the point is whether the click
 * actually reaches it.
 */

async function renderApp(): Promise<void> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
}

async function openProject(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', renamingId: null })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    project: null,
    booted: false,
    statsSettings: null,
    dailyStats: [],
    appearance: null
  })
})

describe('the title-bar close-box', () => {
  it('closes the open project and returns to Welcome', async () => {
    await openProject()
    await renderApp()
    expect(screen.getByLabelText('Close Project')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Close Project'))
    })

    expect(useWyrm.getState().project).toBeNull()
    expect(await screen.findByText('Welcome to WyrmStar')).toBeTruthy()
  })
})
