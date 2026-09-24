// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import type { StatsSettings } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { PrefsDialog } from '../src/renderer/src/components/Dialogs'
import { localDate } from '../src/renderer/src/lib/stats'

/**
 * Some writers do not want a number climbing beside the cursor while they
 * draft. The switch has to take every ambient counter with it — leaving one
 * behind would defeat the point entirely — while leaving Writing Stats
 * available on request.
 */

const today = localDate()

async function renderApp(stats: Partial<StatsSettings>): Promise<void> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue({ ...DEFAULT_STATS, ...stats })
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([
    { date: today, total: 4200, net: 640, added: 640, commits: 3 }
  ])
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ statsSettings: null, dailyStats: [], appearance: null })
})

describe('the word-count switch', () => {
  it('shows both the running count and today by default', async () => {
    await renderApp({ showCounter: true })

    expect(screen.getAllByText(/WORDS/).length).toBeGreaterThan(0)
    expect(screen.getByText(/TODAY/)).toBeTruthy()
  })

  it('hides every ambient counter at once when switched off', async () => {
    await renderApp({ showCounter: false })

    // The status bar count, the editor header count and the today indicator
    // all answer to the one switch.
    expect(screen.queryByText(/WORDS/)).toBeNull()
    expect(screen.queryByText(/\bwords\b/)).toBeNull()
    expect(screen.queryByText(/TODAY/)).toBeNull()
  })

  it('leaves the rest of the status bar alone', async () => {
    await renderApp({ showCounter: false })

    // Save state is not a word count and must survive — hiding it would cost
    // the writer the one signal that says their work is on disk.
    expect(screen.getByText('SAVED')).toBeTruthy()
  })
})

describe('the Preferences switch', () => {
  it('reports the change rather than toggling anything itself', () => {
    const onStatsChange = vi.fn()
    render(
      <PrefsDialog
        print={null}
        printers={[]}
        onPrintChange={() => {}}
        appearance={DEFAULT_APPEARANCE}
        stats={DEFAULT_STATS}
        onChange={vi.fn()}
        onStatsChange={onStatsChange}
        onClose={() => {}}
      />
    )

    fireEvent.click(screen.getByText(/Show word counts while writing/i))

    expect(onStatsChange).toHaveBeenCalledWith({ showCounter: false })
  })

  it('offers to turn the counter back on once it is off', () => {
    const onStatsChange = vi.fn()
    render(
      <PrefsDialog
        appearance={DEFAULT_APPEARANCE}
        stats={{ ...DEFAULT_STATS, showCounter: false }}
        onChange={vi.fn()}
        onStatsChange={onStatsChange}
        onClose={() => {}}
      />
    )

    fireEvent.click(screen.getByText(/Show word counts while writing/i))

    expect(onStatsChange).toHaveBeenCalledWith({ showCounter: true })
  })
})
