// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_STATS } from '../src/shared/types'
import type { DayStat, StatsSettings } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { StatsDialog } from '../src/renderer/src/components/StatsDialog'
import { localDate } from '../src/renderer/src/lib/stats'

/**
 * The stats screen reports on the writer's own work, so the failure that
 * matters is a comfortable lie: a day of cutting shown as progress, or a
 * streak that quietly counts days nobody wrote. These drive the real
 * component rather than asserting on the pure helpers a second time.
 */

const today = localDate()
const yesterday = (): string => {
  const at = new Date()
  at.setDate(at.getDate() - 1)
  return localDate(at)
}

/** The value shown in a named summary tile — the same figure also appears in
 *  that day's history row, so assertions have to say which one they mean. */
function tile(label: string): string {
  const el = [...document.querySelectorAll('.stat-tile')].find(
    (t) => t.querySelector('.stat-tile-label')?.textContent === label
  )
  return el?.querySelector('.stat-tile-value')?.textContent ?? ''
}

async function renderStats(days: DayStat[], stats: Partial<StatsSettings> = {}): Promise<void> {
  useWyrm.setState({
    dailyStats: days,
    statsSettings: { ...DEFAULT_STATS, ...stats },
    // The dialog refreshes on open; in the test the history is already set.
    refreshStats: async () => {}
  })
  await act(async () => {
    render(<StatsDialog onClose={() => {}} />)
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ dailyStats: [], statsSettings: null })
})

describe('the writing stats screen', () => {
  it('reports today, the streak and the manuscript total', async () => {
    await renderStats([
      { date: yesterday(), total: 1200, net: 400, added: 400, commits: 2 },
      { date: today, total: 1900, net: 700, added: 700, commits: 3 }
    ])

    expect(tile('TODAY')).toBe('+700')
    expect(tile('STREAK')).toBe('2 DAYS')
    expect(tile('MANUSCRIPT')).toBe('1,900')
  })

  it('shows a day spent cutting as the loss it was, not as zero', async () => {
    await renderStats([{ date: today, total: 600, net: -400, added: 0, commits: 2 }])

    // The honest number, not a flattering one.
    expect(tile('TODAY')).toBe('-400')
  })

  it('reports the same cutting day as zero under net-positive', async () => {
    await renderStats([{ date: today, total: 600, net: -400, added: 0, commits: 2 }], {
      mode: 'net-positive'
    })

    expect(tile('TODAY')).toBe('0')
    expect(screen.queryByText('-400')).toBeNull()
  })

  it('reports words added rather than net under added mode', async () => {
    await renderStats([{ date: today, total: 600, net: -400, added: 1000, commits: 2 }], {
      mode: 'added'
    })

    expect(tile('TODAY')).toBe('+1,000')
  })

  it('keeps the streak alive on a day spent entirely cutting', async () => {
    await renderStats([
      { date: yesterday(), total: 4000, net: 900, added: 900, commits: 2 },
      { date: today, total: 1000, net: -3000, added: 0, commits: 4 }
    ])

    // Revision is work; a streak that punished it would discourage revising.
    expect(tile('STREAK')).toBe('2 DAYS')
  })

  it('says so plainly when there is no history yet', async () => {
    await renderStats([])

    expect(screen.getByText(/No checkpoints yet/i)).toBeTruthy()
  })

  it('names the goal when it has been met', async () => {
    await renderStats([{ date: today, total: 900, net: 900, added: 900, commits: 2 }], {
      dailyGoal: 500
    })

    expect(screen.getByText(/Goal met/i)).toBeTruthy()
  })

  it('shows remaining progress rather than a win when short of the goal', async () => {
    await renderStats([{ date: today, total: 200, net: 200, added: 200, commits: 1 }], {
      dailyGoal: 500
    })

    expect(screen.queryByText(/Goal met/i)).toBeNull()
    expect(screen.getByText(/\+200 of 500 words/i)).toBeTruthy()
  })

  it('labels the current day as Today and dates the rest', async () => {
    await renderStats([
      { date: yesterday(), total: 400, net: 400, added: 400, commits: 1 },
      { date: today, total: 900, net: 500, added: 500, commits: 1 }
    ])

    expect(screen.getByText('Today')).toBeTruthy()
    // Yesterday is dated, not called "Today" a second time.
    expect(screen.getAllByText('Today')).toHaveLength(1)
  })
})
